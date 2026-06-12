'use strict';

const functions = require('firebase-functions');
const admin     = require('firebase-admin');
const Stripe    = require('stripe');
const crypto    = require('crypto');

admin.initializeApp();

const { createNotification, notifyAllAdmins, notifyClientContacts } = require('./notifications');

// Lazy-init Stripe — the secret key comes from environment config and may not
// be present during deploy-time analysis. Any billing function that needs it
// calls getStripe() which throws a clear error if the key is missing.
let _stripe;
function getStripe() {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new functions.https.HttpsError('failed-precondition', 'STRIPE_SECRET_KEY is not configured.');
    _stripe = Stripe(key);
  }
  return _stripe;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: verify the caller is an admin by checking the users collection.
// We use Firestore role (not custom claims) to match the existing auth model.
// ─────────────────────────────────────────────────────────────────────────────
async function assertAdmin(context) {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');
  }
  const snap = await admin.firestore().collection('users').doc(uid).get();
  if (!snap.exists || snap.data().role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: markPayment                                              (P1 + P5)
// Marks one or more routeAssignments as paid.
//   - Verifies admin role server-side
//   - Only marks assignments that are currently 'pending' (idempotent)
//   - Writes all updates + audit records in one batch
// Payload: { assignmentIds: string[] }
// Returns: { marked: number }
// ─────────────────────────────────────────────────────────────────────────────
exports.markPayment = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const { assignmentIds } = data;
  if (!Array.isArray(assignmentIds) || assignmentIds.length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'assignmentIds must be a non-empty array.');
  }
  if (assignmentIds.length > 490) {
    // Firestore batch limit is 500 ops; each assignment = 2 ops (update + audit)
    throw new functions.https.HttpsError('invalid-argument', 'Too many assignments in one call (max 245).');
  }

  const db    = admin.firestore();
  const now   = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  let markedCount = 0;

  for (const id of assignmentIds) {
    if (typeof id !== 'string') continue;
    const ref  = db.collection('routeAssignments').doc(id);
    const snap = await ref.get();
    if (!snap.exists) continue;
    if (snap.data().status !== 'pending') continue; // already paid — skip silently

    batch.update(ref, { status: 'paid', paidDate: now });
    batch.set(db.collection('auditLog').doc(), {
      action:     'mark_paid',
      collection: 'routeAssignments',
      docId:      id,
      actorUid:   context.auth.uid,
      before:     { status: 'pending' },
      after:      { status: 'paid' },
      timestamp:  now,
    });
    markedCount++;
  }

  await batch.commit();
  return { marked: markedCount };
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER: recalcPayout                                              (P2 + P5)
// Fires when a routeAssignment document is created.
// Reads the booking's actual weeklyRate and overwrites the weeklyPayout field
// so the browser-supplied value is never trusted.
// ─────────────────────────────────────────────────────────────────────────────
exports.recalcPayout = functions.firestore
  .document('routeAssignments/{assignmentId}')
  .onCreate(async (snap, context) => {
    const assignment = snap.data();
    const bookingId  = assignment.bookingId;
    if (typeof bookingId !== 'string' || !bookingId) return;

    const db          = admin.firestore();
    const bookingSnap = await db.collection('bookings').doc(bookingId).get();
    if (!bookingSnap.exists) return;

    const weeklyRate   = bookingSnap.data().weeklyRate || 0;
    const weeklyPayout = Math.round(weeklyRate * 0.70 * 100) / 100; // 70/30 split

    await snap.ref.update({ weeklyPayout });

    await db.collection('auditLog').add({
      action:      'payout_calculated',
      collection:  'routeAssignments',
      docId:       context.params.assignmentId,
      bookingId,
      weeklyRate,
      weeklyPayout,
      timestamp:   admin.firestore.FieldValue.serverTimestamp(),
    });
  });

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER: autoCompleteRoute
// Fires when a routeLog document is written (create or update).
// If every student in the booking is either dropped_off or absent, the
// route is automatically marked ran=true so drivers don't need to do it
// manually and payout calculates correctly.
// ─────────────────────────────────────────────────────────────────────────────
exports.autoCompleteRoute = functions.firestore
  .document('routeLogs/{logId}')
  .onWrite(async (change, context) => {
    const after = change.after.exists ? change.after.data() : null;
    if (!after) return; // deleted — nothing to do

    // If already explicitly marked ran=false (driver said missed), don't override
    if (after.ran === false) return;
    // If already ran=true with no student events, skip (manual complete)
    if (after.ran === true && !after.studentEvents) return;

    const bookingId = after.bookingId;
    if (!bookingId) return;

    const db = admin.firestore();
    const bookingSnap = await db.collection('bookings').doc(bookingId).get();
    if (!bookingSnap.exists) return;

    const studentIds = bookingSnap.data().studentIds || [];
    if (studentIds.length === 0) return; // no students to check

    const events = after.studentEvents || {};
    const allAccountedFor = studentIds.every(sid => {
      const status = events[sid]?.status;
      return status === 'dropped_off' || status === 'absent' || status === 'no_show';
    });

    // Auto-set ran=true when all students are accounted for
    if (allAccountedFor && after.ran !== true) {
      await change.after.ref.update({ ran: true, autoCompleted: true });
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: saveContractRecord                                       (P3 + P5)
// Browser handles PDF generation + Storage upload, then calls this function
// with the resulting pdfUrl. This function atomically writes the contract
// doc, updates the booking status, and logs the action — so partial state
// is impossible regardless of browser crashes or network drops.
// Payload: { bookingId: string, pdfUrl: string, contractData: object }
// Returns: { contractId: string }
// ─────────────────────────────────────────────────────────────────────────────
exports.saveContractRecord = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const { bookingId, pdfUrl, contractData } = data;
  if (typeof bookingId !== 'string' || !bookingId)
    throw new functions.https.HttpsError('invalid-argument', 'bookingId is required.');
  if (typeof pdfUrl !== 'string' || !pdfUrl)
    throw new functions.https.HttpsError('invalid-argument', 'pdfUrl is required.');
  if (!contractData || typeof contractData !== 'object')
    throw new functions.https.HttpsError('invalid-argument', 'contractData is required.');

  // Strip any attempt to inject server-controlled fields from the client payload
  const { generatedAt: _g, sentAt: _s, ...safeContractData } = contractData;

  const db          = admin.firestore();
  const bookingRef  = db.collection('bookings').doc(bookingId);
  const bookingSnap = await bookingRef.get();
  if (!bookingSnap.exists)
    throw new functions.https.HttpsError('not-found', `Booking ${bookingId} not found.`);

  const now         = admin.firestore.FieldValue.serverTimestamp();
  const contractRef = db.collection('contracts').doc();
  const signingToken = crypto.randomBytes(32).toString('base64url');
  const batch       = db.batch();

  batch.set(contractRef, {
    bookingId,
    ...safeContractData,
    pdfUrl,
    generatedAt: now,
    sentAt:      null,
    signingToken,
    signedAt:    null,
  });

  batch.update(bookingRef, {
    status:     'contract_sent',
    contractId: contractRef.id,
  });

  batch.set(db.collection('auditLog').doc(), {
    action:     'contract_generated',
    collection: 'contracts',
    docId:      contractRef.id,
    bookingId,
    actorUid:   context.auth.uid,
    timestamp:  now,
  });

  await batch.commit();
  return { contractId: contractRef.id, signingToken };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: getContractForSigning                                (public)
// Unauthenticated. Returns the minimum data needed to render the signing
// page and regenerate the PDF with the parent's signature baked in.
// The contractId + signingToken pair acts as the authorization credential;
// invalid or already-signed tokens return permission-denied.
// Payload: { contractId: string, token: string }
// ─────────────────────────────────────────────────────────────────────────────
exports.getContractForSigning = functions.https.onCall(async (data /* , context */) => {
  const { contractId, token } = data || {};
  if (typeof contractId !== 'string' || !contractId)
    throw new functions.https.HttpsError('invalid-argument', 'contractId is required.');
  if (typeof token !== 'string' || !token)
    throw new functions.https.HttpsError('invalid-argument', 'token is required.');

  const db          = admin.firestore();
  const contractRef = db.collection('contracts').doc(contractId);
  const contractSnap = await contractRef.get();
  if (!contractSnap.exists)
    throw new functions.https.HttpsError('not-found', 'Contract not found.');

  const contract = contractSnap.data();
  if (contract.signingToken !== token)
    throw new functions.https.HttpsError('permission-denied', 'Invalid signing link.');

  const bookingSnap = await db.collection('bookings').doc(contract.bookingId).get();
  if (!bookingSnap.exists)
    throw new functions.https.HttpsError('not-found', 'Booking not found.');
  const booking = { id: bookingSnap.id, ...bookingSnap.data() };

  const clientSnap = await db.collection('clients').doc(booking.clientId).get();
  if (!clientSnap.exists)
    throw new functions.https.HttpsError('not-found', 'Client not found.');
  const client = { id: clientSnap.id, ...clientSnap.data() };

  const studentsSnap = await db.collection('students')
    .where('clientId', '==', booking.clientId).get();
  const students = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Normalize serviceStartDate (Timestamp → Date serializable)
  const ssd = booking.serviceStartDate;
  if (ssd && typeof ssd.toDate === 'function') {
    booking.serviceStartDate = ssd.toDate().toISOString();
  }

  return {
    contract: {
      id: contractSnap.id,
      pdfUrl: contract.pdfUrl,
      studentNames: contract.studentNames || [],
      signedAt: contract.signedAt || null,
      signedByName: contract.signedByName || null,
      signedPdfUrl: contract.signedPdfUrl || null,
    },
    booking,
    client,
    students,
    alreadySigned: !!contract.signedAt,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: finalizeContractSignature                            (public)
// Unauthenticated. Accepts the signed PDF (base64) + signature metadata.
// Verifies the signing token, uploads the signed PDF to Storage, updates
// the contract doc, moves the booking to 'active', and writes an audit log.
// Payload: {
//   contractId, token,
//   signedPdfBase64,   // base64-encoded PDF content (no data: prefix)
//   signatureDataUrl,  // data:image/png;base64,... (stored for audit)
//   signedByName
// }
// Returns: { signedPdfUrl: string }
// ─────────────────────────────────────────────────────────────────────────────
exports.finalizeContractSignature = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    const { contractId, token, signedPdfBase64, signatureDataUrl, signedByName } = data || {};
    if (typeof contractId !== 'string' || !contractId)
      throw new functions.https.HttpsError('invalid-argument', 'contractId is required.');
    if (typeof token !== 'string' || !token)
      throw new functions.https.HttpsError('invalid-argument', 'token is required.');
    if (typeof signedPdfBase64 !== 'string' || signedPdfBase64.length < 100)
      throw new functions.https.HttpsError('invalid-argument', 'signedPdfBase64 is required.');
    if (typeof signatureDataUrl !== 'string' || !signatureDataUrl.startsWith('data:image/'))
      throw new functions.https.HttpsError('invalid-argument', 'signatureDataUrl is required.');
    if (typeof signedByName !== 'string' || signedByName.trim().length < 2)
      throw new functions.https.HttpsError('invalid-argument', 'signedByName is required.');

    // Cap PDF size at 10 MB decoded to prevent abuse
    const approxBytes = Math.floor((signedPdfBase64.length * 3) / 4);
    if (approxBytes > 10 * 1024 * 1024)
      throw new functions.https.HttpsError('invalid-argument', 'Signed PDF exceeds 10 MB limit.');

    const db          = admin.firestore();
    const contractRef = db.collection('contracts').doc(contractId);
    const contractSnap = await contractRef.get();
    if (!contractSnap.exists)
      throw new functions.https.HttpsError('not-found', 'Contract not found.');
    const contract = contractSnap.data();

    if (contract.signingToken !== token)
      throw new functions.https.HttpsError('permission-denied', 'Invalid signing link.');

    if (contract.signedAt)
      throw new functions.https.HttpsError('already-exists', 'This contract has already been signed.');

    // Upload the signed PDF to Storage
    const bucket    = admin.storage().bucket();
    const pdfBuffer = Buffer.from(signedPdfBase64, 'base64');
    const fileName  = `contracts/${contract.bookingId}_${contractId}_signed_${Date.now()}.pdf`;
    const file      = bucket.file(fileName);

    // Use a random download token so the getDownloadURL pattern works
    const downloadToken = crypto.randomBytes(16).toString('hex');
    await file.save(pdfBuffer, {
      metadata: {
        contentType: 'application/pdf',
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
      resumable: false,
    });
    const signedPdfUrl =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(fileName)}?alt=media&token=${downloadToken}`;

    const now     = admin.firestore.FieldValue.serverTimestamp();
    const ip      = (context.rawRequest && (context.rawRequest.ip || context.rawRequest.headers?.['x-forwarded-for'])) || '';
    const signerIp = typeof ip === 'string' ? ip.split(',')[0].trim().slice(0, 64) : '';

    const bookingRef = db.collection('bookings').doc(contract.bookingId);
    const batch = db.batch();

    batch.update(contractRef, {
      signedAt:     now,
      signedByName: signedByName.trim().slice(0, 120),
      signedByEmail: contract.emailedTo || '',
      signerIp,
      signedPdfUrl,
      pdfUrl:        signedPdfUrl,        // swap primary URL to the signed PDF
      // One-shot: invalidate the signing token so the link can't be reused
      signingToken:  admin.firestore.FieldValue.delete(),
    });

    batch.update(bookingRef, { status: 'active' });

    batch.set(db.collection('auditLog').doc(), {
      action:     'contract_signed',
      collection: 'contracts',
      docId:      contractId,
      bookingId:  contract.bookingId,
      actorUid:   null,        // unauthenticated — parent via signing link
      signedByName: signedByName.trim().slice(0, 120),
      signerIp,
      timestamp:  now,
    });

    await batch.commit();

    return { signedPdfUrl };
  });

// ═══════════════════════════════════════════════════════════════════════════════
// DRIVER CONTRACT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: saveDriverContractRecord                              (admin only)
// Browser renders PDF + uploads to Storage, then calls this to atomically
// write the driverContracts doc, stamp the driver, and log the action.
// ─────────────────────────────────────────────────────────────────────────────
exports.saveDriverContractRecord = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const { driverId, pdfUrl, contractData } = data;
  if (typeof driverId !== 'string' || !driverId)
    throw new functions.https.HttpsError('invalid-argument', 'driverId is required.');
  if (typeof pdfUrl !== 'string' || !pdfUrl)
    throw new functions.https.HttpsError('invalid-argument', 'pdfUrl is required.');
  if (!contractData || typeof contractData !== 'object')
    throw new functions.https.HttpsError('invalid-argument', 'contractData is required.');

  const { generatedAt: _g, sentAt: _s, ...safeContractData } = contractData;

  const db        = admin.firestore();
  const driverRef = db.collection('drivers').doc(driverId);
  const driverSnap = await driverRef.get();
  if (!driverSnap.exists)
    throw new functions.https.HttpsError('not-found', `Driver ${driverId} not found.`);

  const now         = admin.firestore.FieldValue.serverTimestamp();
  const contractRef = db.collection('driverContracts').doc();
  const signingToken = crypto.randomBytes(32).toString('base64url');
  const batch       = db.batch();

  batch.set(contractRef, {
    driverId,
    ...safeContractData,
    pdfUrl,
    generatedAt: now,
    sentAt:      null,
    signingToken,
    signedAt:    null,
  });

  batch.update(driverRef, { latestDriverContractId: contractRef.id });

  batch.set(db.collection('auditLog').doc(), {
    action:     'driver_contract_generated',
    collection: 'driverContracts',
    docId:      contractRef.id,
    driverId,
    actorUid:   context.auth.uid,
    timestamp:  now,
  });

  await batch.commit();
  return { contractId: contractRef.id, signingToken };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: getDriverContractForSigning                           (public)
// Unauthenticated. Returns minimal data needed to render the signing page.
// ─────────────────────────────────────────────────────────────────────────────
exports.getDriverContractForSigning = functions.https.onCall(async (data) => {
  const { contractId, token } = data || {};
  if (typeof contractId !== 'string' || !contractId)
    throw new functions.https.HttpsError('invalid-argument', 'contractId is required.');
  if (typeof token !== 'string' || !token)
    throw new functions.https.HttpsError('invalid-argument', 'token is required.');

  const db           = admin.firestore();
  const contractRef  = db.collection('driverContracts').doc(contractId);
  const contractSnap = await contractRef.get();
  if (!contractSnap.exists)
    throw new functions.https.HttpsError('not-found', 'Contract not found.');

  const contract = contractSnap.data();
  if (contract.signingToken !== token)
    throw new functions.https.HttpsError('permission-denied', 'Invalid signing link.');

  const driverSnap = await db.collection('drivers').doc(contract.driverId).get();
  if (!driverSnap.exists)
    throw new functions.https.HttpsError('not-found', 'Driver not found.');
  const driver = { id: driverSnap.id, ...driverSnap.data() };

  return {
    contract: {
      id:           contractSnap.id,
      pdfUrl:       contract.pdfUrl,
      driverName:   contract.driverName   || '',
      payoutSplit:  contract.payoutSplit   || 70,
      signedAt:     contract.signedAt      || null,
      signedByName: contract.signedByName  || null,
      signedPdfUrl: contract.signedPdfUrl  || null,
    },
    driver,
    alreadySigned: !!contract.signedAt,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: finalizeDriverContractSignature                       (public)
// Accepts signed PDF (base64) + signature metadata. Validates token, uploads
// signed PDF to Storage, marks driver active, and writes audit log.
// ─────────────────────────────────────────────────────────────────────────────
exports.finalizeDriverContractSignature = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    const { contractId, token, signedPdfBase64, signatureDataUrl, signedByName } = data || {};
    if (typeof contractId !== 'string' || !contractId)
      throw new functions.https.HttpsError('invalid-argument', 'contractId is required.');
    if (typeof token !== 'string' || !token)
      throw new functions.https.HttpsError('invalid-argument', 'token is required.');
    if (typeof signedPdfBase64 !== 'string' || signedPdfBase64.length < 100)
      throw new functions.https.HttpsError('invalid-argument', 'signedPdfBase64 is required.');
    if (typeof signatureDataUrl !== 'string' || !signatureDataUrl.startsWith('data:image/'))
      throw new functions.https.HttpsError('invalid-argument', 'signatureDataUrl is required.');
    if (typeof signedByName !== 'string' || signedByName.trim().length < 2)
      throw new functions.https.HttpsError('invalid-argument', 'signedByName is required.');

    const approxBytes = Math.floor((signedPdfBase64.length * 3) / 4);
    if (approxBytes > 10 * 1024 * 1024)
      throw new functions.https.HttpsError('invalid-argument', 'Signed PDF exceeds 10 MB limit.');

    const db           = admin.firestore();
    const contractRef  = db.collection('driverContracts').doc(contractId);
    const contractSnap = await contractRef.get();
    if (!contractSnap.exists)
      throw new functions.https.HttpsError('not-found', 'Contract not found.');
    const contract = contractSnap.data();

    if (contract.signingToken !== token)
      throw new functions.https.HttpsError('permission-denied', 'Invalid signing link.');
    if (contract.signedAt)
      throw new functions.https.HttpsError('already-exists', 'This contract has already been signed.');

    const bucket    = admin.storage().bucket();
    const pdfBuffer = Buffer.from(signedPdfBase64, 'base64');
    const fileName  = `driverContracts/${contract.driverId}_${contractId}_signed_${Date.now()}.pdf`;
    const file      = bucket.file(fileName);

    const downloadToken = crypto.randomBytes(16).toString('hex');
    await file.save(pdfBuffer, {
      metadata: {
        contentType: 'application/pdf',
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
      resumable: false,
    });
    const signedPdfUrl =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(fileName)}?alt=media&token=${downloadToken}`;

    const now      = admin.firestore.FieldValue.serverTimestamp();
    const ip       = (context.rawRequest && (context.rawRequest.ip || context.rawRequest.headers?.['x-forwarded-for'])) || '';
    const signerIp = typeof ip === 'string' ? ip.split(',')[0].trim().slice(0, 64) : '';

    const driverRef = db.collection('drivers').doc(contract.driverId);
    const batch     = db.batch();

    batch.update(contractRef, {
      signedAt:     now,
      signedByName: signedByName.trim().slice(0, 120),
      signedByEmail: contract.emailedTo || '',
      signerIp,
      signedPdfUrl,
      pdfUrl:       signedPdfUrl,
      signingToken: admin.firestore.FieldValue.delete(),
    });

    batch.update(driverRef, { status: 'active' });

    batch.set(db.collection('auditLog').doc(), {
      action:       'driver_contract_signed',
      collection:   'driverContracts',
      docId:        contractId,
      driverId:     contract.driverId,
      actorUid:     null,
      signedByName: signedByName.trim().slice(0, 120),
      signerIp,
      timestamp:    now,
    });

    await batch.commit();
    return { signedPdfUrl };
  });

// ═══════════════════════════════════════════════════════════════════════════════
// BILLING & STRIPE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// PRICING CONSTANTS (mirrored from frontend src/utils/pricing.ts)
// ─────────────────────────────────────────────────────────────────────────────
const DAILY_BASE = 20.0;
const SURCHARGE_PER_MILE_9_12 = 3.0;
const RATE_13_PLUS = 2.25;
const ADDON_ONEWAY = 10.0;
const ADDON_ROUNDTRIP = 20.0;

function computeWeeklyCharge(mileage, daysPerWeek, isRoundTrip, numChildren) {
  if (mileage <= 0 || daysPerWeek <= 0) return { weekly: 0, daily: 0 };
  let dailyOneWay;
  if (mileage <= 8) dailyOneWay = DAILY_BASE;
  else if (mileage <= 12) dailyOneWay = DAILY_BASE + (mileage - 8) * SURCHARGE_PER_MILE_9_12;
  else dailyOneWay = mileage * RATE_13_PLUS;
  const billableDays = daysPerWeek >= 3 ? 5 : daysPerWeek;
  let weeklyRide = dailyOneWay * billableDays;
  if (isRoundTrip) weeklyRide *= 2;
  const extraRiders = Math.max(0, numChildren - 1);
  const addon = isRoundTrip ? ADDON_ROUNDTRIP : ADDON_ONEWAY;
  const weekly = Math.round((weeklyRide + extraRiders * addon) * 100) / 100;
  const daily = Math.round((weekly / billableDays) * 100) / 100;
  return { weekly, daily };
}

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: createCheckoutSession
// Parent initiates Stripe Checkout to pay an invoice.
// Payload: { invoiceId: string }
// Returns: { url: string }  — Stripe Checkout URL to redirect to
// ─────────────────────────────────────────────────────────────────────────────
exports.createCheckoutSession = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');

  const { invoiceId } = data;
  if (!invoiceId) throw new functions.https.HttpsError('invalid-argument', 'invoiceId is required.');

  const db  = admin.firestore();
  const inv = await db.collection('invoices').doc(invoiceId).get();
  if (!inv.exists) throw new functions.https.HttpsError('not-found', 'Invoice not found.');

  const invoice = inv.data();
  if (invoice.status === 'paid' || invoice.status === 'waived') {
    throw new functions.https.HttpsError('failed-precondition', 'This invoice is already paid.');
  }

  // Validate the charge amount. Stripe rejects amounts < $0.50, and a missing
  // or non-positive amount means the invoice is malformed — fail loudly with a
  // clear message instead of letting Stripe throw a generic error.
  const amount = Number(invoice.totalAmount);
  if (!isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError('failed-precondition', 'This invoice has no amount due.');
  }
  if (amount < 0.5) {
    throw new functions.https.HttpsError('failed-precondition', 'Invoice amount is below the minimum that can be charged.');
  }

  // Verify caller owns this invoice
  const userSnap = await db.collection('users').doc(uid).get();
  const linkedId = userSnap.data()?.linkedId;
  if (linkedId !== invoice.clientId) {
    throw new functions.https.HttpsError('permission-denied', 'Not your invoice.');
  }

  const baseUrl = process.env.APP_URL || 'https://kidz-transportation.com';

  try {
    // Get or create Stripe customer
    const clientSnap = await db.collection('clients').doc(invoice.clientId).get();
    const client = clientSnap.data();
    let customerId = client?.stripeCustomerId;

    if (!customerId) {
      const customer = await getStripe().customers.create({
        email: client?.email || '',
        name: client?.name || '',
        metadata: { clientId: invoice.clientId },
      });
      customerId = customer.id;
      await clientSnap.ref.update({ stripeCustomerId: customerId });
    }

    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `KIDZ Transportation — Week of ${invoice.weekOf || invoice.periodStart}`,
            description: invoice.lineItems?.map(li => li.description).join(', ') || 'Weekly transportation service',
          },
          unit_amount: Math.round(amount * 100), // cents
        },
        quantity: 1,
      }],
      metadata: {
        invoiceId: invoiceId,
        clientId: invoice.clientId,
      },
      success_url: `${baseUrl}/parent/billing?paid=${invoiceId}`,
      cancel_url:  `${baseUrl}/parent/billing?cancelled=true`,
      payment_intent_data: {
        // 'off_session' saves the card to the Stripe customer so auto-pay can
        // charge it later without the parent being present.
        setup_future_usage: 'off_session',
        metadata: {
          invoiceId: invoiceId,
          clientId: invoice.clientId,
        },
      },
    });

    await inv.ref.update({ stripeSessionId: session.id });

    if (!session.url) {
      throw new functions.https.HttpsError('internal', 'Stripe did not return a checkout URL. Please try again.');
    }

    return { url: session.url };
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    console.error('createCheckoutSession failed:', err);
    throw new functions.https.HttpsError(
      'internal',
      'We could not start the payment session. Please try again in a moment, or contact KIDZ Transportation if it persists.',
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP: stripeWebhook
// Handles Stripe webhook events (checkout.session.completed, etc.)
// ─────────────────────────────────────────────────────────────────────────────
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = getStripe().webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  // ── Idempotency guard ───────────────────────────────────────────────────────
  const idempotencyRef = db.collection('processedStripeEvents').doc(event.id);
  const idempotencySnap = await idempotencyRef.get();
  if (idempotencySnap.exists) {
    console.log(`Stripe event ${event.id} already processed — skipping`);
    return res.status(200).send('ok');
  }
  // ── End idempotency guard ───────────────────────────────────────────────────

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const invoiceId = session.metadata?.invoiceId;

    // ── Payment-mode session: an invoice was paid ────────────────────────────
    // Guarded by invoiceId presence so that setup-mode sessions (card updates,
    // which carry no invoiceId) fall through to the setup handler below and
    // still reach the idempotency write at the end of the function.
    if (invoiceId) {
      const invRef = db.collection('invoices').doc(invoiceId);
      const invSnap = await invRef.get();
      if (invSnap.exists) {
        if (invSnap.data().status !== 'paid') {
          await invRef.update({
            status: 'paid',
            paidAt: now,
            stripePaymentIntentId: session.payment_intent || null,
            stripeSessionId: session.id,
          });

          await db.collection('auditLog').add({
            action: 'invoice_paid_stripe',
            collection: 'invoices',
            docId: invoiceId,
            clientId: session.metadata?.clientId,
            amount: invSnap.data().totalAmount,
            stripeSessionId: session.id,
            timestamp: now,
          });
        }

        // Attach payment method to the Stripe customer as the default so
        // subsequent auto-pay off-session charges always have a usable PM.
        if (session.customer && session.payment_intent) {
          try {
            const pi = await getStripe().paymentIntents.retrieve(session.payment_intent);
            if (pi.payment_method) {
              const pm = await getStripe().paymentMethods.retrieve(pi.payment_method);
              // Attach if not already attached to this customer
              if (!pm.customer) {
                await getStripe().paymentMethods.attach(pm.id, { customer: session.customer });
              }
              // Set as the customer's default invoice payment method
              await getStripe().customers.update(session.customer, {
                invoice_settings: { default_payment_method: pm.id },
              });
              const clientId = session.metadata?.clientId;
              if (clientId) {
                await db.collection('clients').doc(clientId).update({
                  paymentMethodLast4: pm.card?.last4 || '',
                  paymentMethodBrand: pm.card?.brand || '',
                });
              }
              // Notify parent that payment was received
              const userSnap = await db.collection('users')
                .where('linkedId', '==', session.metadata?.clientId).limit(1).get();
              if (!userSnap.empty) {
                const invData = invSnap.data();
                await createNotification({
                  recipientUid: userSnap.docs[0].id,
                  audience:     'parent',
                  type:         'invoice_paid',
                  title:        'Payment Received',
                  body:         `Your payment of $${invData?.totalAmount?.toFixed(2) ?? '0.00'} for the week of ${invData?.weekOf || invData?.periodStart || 'N/A'} has been received. Thank you!`,
                  clientId:     session.metadata?.clientId,
                  invoiceId:    invoiceId,
                  priority:     'normal',
                });
              }
            }
          } catch (e) { console.warn('Could not save payment method details:', e.message); }
        }
      }
    }

    // ── Setup-mode session: parent saved/updated their card ──────────────────
    if (session.mode === 'setup' && session.setup_intent && session.customer) {
      try {
        const si = await getStripe().setupIntents.retrieve(session.setup_intent);
        if (si.payment_method) {
          const pm = await getStripe().paymentMethods.retrieve(si.payment_method);
          if (!pm.customer) {
            await getStripe().paymentMethods.attach(si.payment_method, { customer: session.customer });
          }
          await getStripe().customers.update(session.customer, {
            invoice_settings: { default_payment_method: si.payment_method },
          });
          const clientId = si.metadata?.clientId;
          if (clientId) {
            await db.collection('clients').doc(clientId).update({
              paymentMethodLast4: pm.card?.last4 || '',
              paymentMethodBrand: pm.card?.brand || '',
            });
          }
        }
      } catch (e) { console.warn('Could not process setup session:', e.message); }
    }
  }

  // Mark event as processed for future idempotency checks
  await idempotencyRef.set({
    eventType: event.type,
    processedAt: now,
    livemode: event.livemode,
  });

  res.status(200).send('ok');
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: createSetupSession
// Parent requests a Stripe Checkout session in "setup" mode to save or replace
// their payment method without being charged.
// Returns: { url: string }
// ─────────────────────────────────────────────────────────────────────────────
exports.createSetupSession = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');

  const db = admin.firestore();
  const userSnap = await db.collection('users').doc(uid).get();
  const linkedId = userSnap.data()?.linkedId;
  if (!linkedId) throw new functions.https.HttpsError('not-found', 'No linked client.');

  const baseUrl = process.env.APP_URL || 'https://kidz-transportation.com';

  try {
    const clientSnap = await db.collection('clients').doc(linkedId).get();
    const client = clientSnap.data();
    let customerId = client?.stripeCustomerId;

    if (!customerId) {
      const customer = await getStripe().customers.create({
        email: client?.email || '',
        name:  client?.name  || '',
        metadata: { clientId: linkedId },
      });
      customerId = customer.id;
      await clientSnap.ref.update({ stripeCustomerId: customerId });
    }

    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'setup',
      setup_intent_data: {
        metadata: { clientId: linkedId },
      },
      success_url: `${baseUrl}/parent/billing?card_updated=1`,
      cancel_url:  `${baseUrl}/parent/billing`,
    });

    if (!session.url) {
      throw new functions.https.HttpsError('internal', 'Stripe did not return a setup URL. Please try again.');
    }

    return { url: session.url };
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    console.error('createSetupSession failed:', err);
    throw new functions.https.HttpsError(
      'internal',
      'We could not start the card-update session. Please try again in a moment.',
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: setupAutoPay
// Parent enables/disables auto-pay. When enabling, we attach their last
// payment method as default for future charges.
// Payload: { enabled: boolean }
// ─────────────────────────────────────────────────────────────────────────────
exports.setupAutoPay = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');

  const db = admin.firestore();
  const userSnap = await db.collection('users').doc(uid).get();
  const linkedId = userSnap.data()?.linkedId;
  if (!linkedId) throw new functions.https.HttpsError('not-found', 'No linked client.');

  const { enabled } = data;
  await db.collection('clients').doc(linkedId).update({
    autoPay: !!enabled,
  });

  return { autoPay: !!enabled };
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: doGenerateWeeklyInvoices
// Core logic extracted so both the onCall and the Firestore-trigger can use it.
// ─────────────────────────────────────────────────────────────────────────────
async function doGenerateWeeklyInvoices(weekOfInput) {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  // Determine the target Monday
  let weekOf = weekOfInput;
  if (!weekOf) {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysUntilMon = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
    const nextMon = new Date(today);
    nextMon.setDate(today.getDate() + daysUntilMon);
    weekOf = nextMon.toISOString().split('T')[0];
  }

  // Friday of that week
  const monDate = new Date(weekOf + 'T00:00:00');
  const friDate = new Date(monDate);
  friDate.setDate(monDate.getDate() + 4);
  const periodEnd = friDate.toISOString().split('T')[0];

  // Due date = Saturday before (i.e. the day before Monday)
  const satDate = new Date(monDate);
  satDate.setDate(monDate.getDate() - 2);
  const dueDate = satDate.toISOString().split('T')[0];

  // Get all active bookings
  const bookingsSnap = await db.collection('bookings').where('status', '==', 'active').get();
  const bookings = bookingsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Group by clientId
  const byClient = {};
  for (const b of bookings) {
    if (!byClient[b.clientId]) byClient[b.clientId] = [];
    byClient[b.clientId].push(b);
  }

  // Get student names for line items
  const studentsSnap = await db.collection('students').get();
  const students = {};
  studentsSnap.docs.forEach(d => { students[d.id] = d.data(); });

  let created = 0;
  let skipped = 0;

  for (const [clientId, clientBookings] of Object.entries(byClient)) {
    // Check if invoice already exists for this weekOf + clientId
    const existing = await db.collection('invoices')
      .where('clientId', '==', clientId)
      .where('weekOf', '==', weekOf)
      .limit(1)
      .get();
    if (!existing.empty) { skipped++; continue; }

    const lineItems = [];
    let total = 0;
    const bookingIds = [];

    for (const booking of clientBookings) {
      const daysPerWeek = booking.daysOfWeek?.length || 0;
      const isRoundTrip = booking.transportationType === 'roundtrip';
      const numStudents = booking.studentIds?.length || 1;
      const studentNames = (booking.studentIds || [])
        .map(sid => students[sid]?.name || 'Student')
        .join(', ');

      const billableDays = daysPerWeek >= 3 ? 5 : daysPerWeek || 5;

      // Prefer admin-set rates over the auto-calculated price so manual
      // overrides on the Clients page are honoured in invoices.
      let weekly, daily;
      if (booking.weeklyRate > 0) {
        weekly = Math.round(booking.weeklyRate * 100) / 100;
        daily  = Math.round((weekly / billableDays) * 100) / 100;
      } else {
        ({ weekly, daily } = computeWeeklyCharge(
          booking.mileage || 0, daysPerWeek, isRoundTrip, numStudents
        ));
      }

      lineItems.push({
        description: `${studentNames} — ${isRoundTrip ? 'Round-trip' : 'One-way'} (${daysPerWeek} days/wk)`,
        bookingId: booking.id,
        quantity: billableDays,
        unitPrice: daily,
        total: weekly,
      });

      total += weekly;
      bookingIds.push(booking.id);
    }

    if (total <= 0) continue;

    await db.collection('invoices').add({
      clientId,
      bookingIds,
      weekOf,
      periodStart: weekOf,
      periodEnd,
      lineItems,
      totalAmount: Math.round(total * 100) / 100,
      status: 'sent',
      dueDate,
      sentAt: now,
      paidAt: null,
      createdAt: now,
      notes: '',
    });

    created++;
  }

  return { created, skipped, weekOf };
}

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: generateWeeklyInvoices  (kept for backward compat / server calls)
// ─────────────────────────────────────────────────────────────────────────────
exports.generateWeeklyInvoices = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);
  return doGenerateWeeklyInvoices(data?.weekOf);
});

// ─────────────────────────────────────────────────────────────────────────────
// FIRESTORE TRIGGER: processTask
// Generic task processor that bypasses Cloud Functions IAM restrictions.
// Client writes a task doc → this trigger picks it up, runs the logic,
// and writes the result back to the same doc.
// ─────────────────────────────────────────────────────────────────────────────
exports.processTask = functions.firestore
  .document('_tasks/{taskId}')
  .onCreate(async (snap, context) => {
    const task = snap.data();
    const taskRef = snap.ref;

    try {
      // Firestore security rules already enforce admin-only create on _tasks,
      // so no need to re-check admin role here.

      let result;
      switch (task.type) {
        case 'generateWeeklyInvoices':
          result = await doGenerateWeeklyInvoices(task.weekOf);
          break;
        default:
          throw new Error(`Unknown task type: ${task.type}`);
      }

      await taskRef.update({
        status: 'completed',
        result,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error('processTask error:', error);
      try {
        await taskRef.update({
          status: 'error',
          error: error.message,
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (updateErr) {
        console.error('processTask: failed to write error back to task doc:', updateErr);
      }
    }

    return null;
  });

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: adminOverrideInvoice
// Admin can mark an invoice as paid, waived, or extend due date. (v2)
// Payload: { invoiceId: string, action: 'mark_paid' | 'waive' | 'extend', note?: string, newDueDate?: string }
// ─────────────────────────────────────────────────────────────────────────────
exports.adminOverrideInvoice = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const { invoiceId, action, note, newDueDate } = data;
  if (!invoiceId) throw new functions.https.HttpsError('invalid-argument', 'invoiceId required.');
  if (!['mark_paid', 'waive', 'extend'].includes(action)) {
    throw new functions.https.HttpsError('invalid-argument', 'action must be mark_paid, waive, or extend.');
  }

  const db     = admin.firestore();
  const now    = admin.firestore.FieldValue.serverTimestamp();
  const invRef = db.collection('invoices').doc(invoiceId);
  const snap   = await invRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Invoice not found.');

  const updates = {
    adminOverride: true,
    overrideBy: context.auth.uid,
    overrideNote: note || '',
  };

  if (action === 'mark_paid') {
    updates.status = 'paid';
    updates.paidAt = now;
  } else if (action === 'waive') {
    updates.status = 'waived';
  } else if (action === 'extend') {
    if (!newDueDate) throw new functions.https.HttpsError('invalid-argument', 'newDueDate required for extend.');
    updates.dueDate = newDueDate;
  }

  await invRef.update(updates);
  await db.collection('auditLog').add({
    action: `invoice_${action}`,
    collection: 'invoices',
    docId: invoiceId,
    actorUid: context.auth.uid,
    before: { status: snap.data().status },
    after: updates,
    timestamp: now,
  });

  return { success: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: deleteInvoice
// Admin can permanently delete an invoice. (v2)
// Payload: { invoiceId: string }
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteInvoice = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const { invoiceId } = data;
  if (!invoiceId) throw new functions.https.HttpsError('invalid-argument', 'invoiceId required.');

  const db     = admin.firestore();
  const invRef = db.collection('invoices').doc(invoiceId);
  const snap   = await invRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Invoice not found.');

  const invoiceData = snap.data();

  // Delete the invoice document
  await invRef.delete();

  // Write audit log (fire-and-forget)
  db.collection('auditLog').add({
    action:      'invoice_deleted',
    collection:  'invoices',
    docId:       invoiceId,
    actorUid:    context.auth.uid,
    clientId:    invoiceData.clientId || '',
    amount:      invoiceData.totalAmount || 0,
    weekOf:      invoiceData.weekOf || '',
    timestamp:   admin.firestore.FieldValue.serverTimestamp(),
  }).catch(err => {
    console.error('deleteInvoice: failed to write auditLog', err);
  });

  return { success: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: processAutoPay
// Admin-triggered: charges all auto-pay parents for unpaid invoices.
// For each client with autoPay=true and a stripeCustomerId, charges their
// default payment method.
// ─────────────────────────────────────────────────────────────────────────────
exports.processAutoPay = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  // Get all unpaid/sent invoices
  const invSnap = await db.collection('invoices')
    .where('status', 'in', ['sent', 'overdue'])
    .get();

  let charged = 0;
  let failed  = 0;
  let skipped = 0;

  for (const invDoc of invSnap.docs) {
    const inv = invDoc.data();
    const clientSnap = await db.collection('clients').doc(inv.clientId).get();
    if (!clientSnap.exists) { skipped++; continue; }
    const client = clientSnap.data();

    if (!client.autoPay || !client.stripeCustomerId) { skipped++; continue; }

    try {
      // Get default payment method
      const paymentMethods = await getStripe().paymentMethods.list({
        customer: client.stripeCustomerId,
        type: 'card',
        limit: 1,
      });

      if (paymentMethods.data.length === 0) { skipped++; continue; }

      const pmId = paymentMethods.data[0].id;

      const pi = await getStripe().paymentIntents.create({
        amount: Math.round(inv.totalAmount * 100),
        currency: 'usd',
        customer: client.stripeCustomerId,
        payment_method: pmId,
        off_session: true,
        confirm: true,
        metadata: {
          invoiceId: invDoc.id,
          clientId: inv.clientId,
        },
      });

      if (pi.status === 'succeeded') {
        await invDoc.ref.update({
          status: 'paid',
          paidAt: now,
          stripePaymentIntentId: pi.id,
        });
        charged++;
      } else {
        await invDoc.ref.update({ autoPayFailed: true });
        failed++;
      }
    } catch (err) {
      console.error(`Auto-pay failed for client ${inv.clientId}:`, err.message);
      await invDoc.ref.update({ autoPayFailed: true });
      failed++;
      // Notify the parent so they can update their payment method
      try {
        const userSnap = await db.collection('users')
          .where('linkedId', '==', inv.clientId).limit(1).get();
        if (!userSnap.empty) {
          await createNotification({
            recipientUid: userSnap.docs[0].id,
            audience:     'parent',
            type:         'invoice_overdue',
            title:        'Auto-Pay Failed',
            body:         `We were unable to process your auto-payment of $${inv.totalAmount?.toFixed(2) ?? '0.00'}. Please pay manually or update your payment method.`,
            clientId:     inv.clientId,
            invoiceId:    invDoc.id,
            priority:     'high',
          });
        }
      } catch (notifyErr) {
        console.warn('processAutoPay: notification failed:', notifyErr.message);
      }
    }
  }

  return { charged, failed, skipped };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: createManualInvoice
// Admin creates a one-off invoice for a specific client.
// Payload: { clientId, description, amount, dueDate, weekOf? }
// ─────────────────────────────────────────────────────────────────────────────
exports.createManualInvoice = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const { clientId, description, amount, dueDate, weekOf } = data;
  if (!clientId || !description || amount == null || !dueDate) {
    throw new functions.https.HttpsError('invalid-argument', 'clientId, description, amount, dueDate required.');
  }

  if (typeof amount !== 'number' || amount <= 0 || !isFinite(amount)) {
    throw new functions.https.HttpsError('invalid-argument', 'amount must be a positive number.');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new functions.https.HttpsError('invalid-argument', 'dueDate must be in YYYY-MM-DD format.');
  }

  const db  = admin.firestore();
  const serverTime = admin.firestore.FieldValue.serverTimestamp();

  try {
    const ref = await db.collection('invoices').add({
      clientId,
      bookingIds: [],
      weekOf: weekOf || '',
      periodStart: dueDate,
      periodEnd: dueDate,
      lineItems: [{
        description,
        quantity: 1,
        unitPrice: amount,
        total: amount,
      }],
      totalAmount: amount,
      status: 'sent',
      dueDate,
      sentAt: serverTime,
      paidAt: null,
      createdAt: serverTime,
      notes: 'Manual invoice created by admin',
    });

    // Audit log write is fire-and-forget — do not fail the invoice creation if it errors
    db.collection('auditLog').add({
      action: 'invoice_created_manual',
      collection: 'invoices',
      docId: ref.id,
      clientId,
      amount,
      actorUid: context.auth.uid,
      timestamp: serverTime,
    }).catch(err => {
      console.error('createManualInvoice: failed to write auditLog', err);
    });

    return { invoiceId: ref.id };
  } catch (err) {
    console.error('createManualInvoice: failed to create invoice', err);
    throw new functions.https.HttpsError('internal', 'Failed to create invoice: ' + (err.message || 'unknown error'));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: sendDriverInvite                                    (admin only)
// Generates a secure one-time token, stores it on the driver doc, and sends
// an invite email via the emailQueue so the driver can self-register.
// Payload: { driverId: string }
// Returns: { success: true }
// ─────────────────────────────────────────────────────────────────────────────
exports.sendDriverInvite = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const { driverId } = data;
  if (!driverId || typeof driverId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'driverId is required.');
  }

  const db = admin.firestore();
  const driverRef = db.collection('drivers').doc(driverId);
  const driverSnap = await driverRef.get();

  if (!driverSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Driver not found.');
  }

  const driverData = driverSnap.data();

  if (!driverData.email) {
    throw new functions.https.HttpsError('failed-precondition', 'Driver has no email address. Add one before sending an invite.');
  }
  if (driverData.uid) {
    throw new functions.https.HttpsError('already-exists', 'This driver already has a linked account.');
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiry = admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await driverRef.update({ inviteToken: token, inviteTokenExpiry: expiry });

  const baseUrl = 'https://kidz-transportation.com';
  const inviteUrl = `${baseUrl}/driver/accept-invite?token=${token}`;

  await db.collection('emailQueue').add({
    to: driverData.email,
    subject: 'Your KIDZ Transportation Driver Account Invitation',
    body: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="color:#0f766e;margin-top:0;">Welcome to KIDZ Transportation</h2>
        <p>Hi ${driverData.name || 'there'},</p>
        <p>You've been invited to join as a driver. Click the button below to set up your account password and complete onboarding.</p>
        <p style="text-align:center;margin:32px 0;">
          <a href="${inviteUrl}"
             style="background:#0f766e;color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
            Set Up My Account
          </a>
        </p>
        <p style="color:#64748b;font-size:13px;">This link expires in 7 days. If you did not expect this email, you can safely ignore it.</p>
        <p style="color:#64748b;font-size:13px;">Or copy this link:<br><a href="${inviteUrl}" style="color:#0f766e;">${inviteUrl}</a></p>
      </div>
    `,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: validateDriverInvite                                    (public)
// Validates an invite token without requiring authentication.
// Payload: { token: string }
// Returns: { valid: true, driverId, driverName, email }
//        | { valid: false, reason: string }
// ─────────────────────────────────────────────────────────────────────────────
exports.validateDriverInvite = functions.https.onCall(async (data, _context) => {
  const { token } = data;

  if (!token || typeof token !== 'string' || token.length < 16) {
    return { valid: false, reason: 'invalid_token' };
  }

  const db = admin.firestore();
  const snap = await db.collection('drivers')
    .where('inviteToken', '==', token)
    .limit(1)
    .get();

  if (snap.empty) return { valid: false, reason: 'not_found' };

  const driverDoc = snap.docs[0];
  const d = driverDoc.data();

  if (d.uid) return { valid: false, reason: 'already_linked' };

  const expiry = d.inviteTokenExpiry;
  if (!expiry || expiry.toMillis() < Date.now()) {
    return { valid: false, reason: 'expired' };
  }

  return {
    valid: true,
    driverId: driverDoc.id,
    driverName: d.name || '',
    email: d.email || '',
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER: processEmailQueue
// Fires when a new document is created in the `emailQueue` collection.
// Sends an email via SendGrid (or any HTTP-based email API).
// Set env vars: SENDGRID_API_KEY, EMAIL_FROM (e.g. "noreply@kidztransportation.com")
// Queue doc shape: { to: string, subject: string, body: string (HTML allowed) }
// Updates the queue doc with status: 'sent' | 'failed'.
// ─────────────────────────────────────────────────────────────────────────────
exports.processEmailQueue = functions
  .runWith({ secrets: ['RESEND_API_KEY'] })
  .firestore
  .document('emailQueue/{itemId}')
  .onCreate(async (snap, context) => {
    const data    = snap.data();
    const to      = data.to;
    const subject = data.subject;
    const body    = data.body;

    if (!to || !subject || !body) {
      await snap.ref.update({ status: 'failed', error: 'Missing to, subject, or body', processedAt: admin.firestore.FieldValue.serverTimestamp() });
      return;
    }

    const apiKey    = process.env.RESEND_API_KEY;
    // Until a custom domain is verified, Resend only allows sending from
    // onboarding@resend.dev (test) or a verified domain.
    const fromEmail = process.env.EMAIL_FROM || 'KIDZ Transportation <noreply@kidz-transportation.com>';

    if (!apiKey) {
      console.warn('processEmailQueue: RESEND_API_KEY not configured.');
      await snap.ref.update({ status: 'failed', error: 'Resend not configured', processedAt: admin.firestore.FieldValue.serverTimestamp() });
      return;
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    fromEmail,
          to:      [to],
          subject,
          html:    body,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (response.ok && result.id) {
        await snap.ref.update({
          status:      'sent',
          messageId:   result.id,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`Email sent to ${to}: "${subject}" (${result.id})`);
      } else {
        const errMsg = result.message || result.error || `HTTP ${response.status}`;
        await snap.ref.update({
          status: 'failed',
          error:  errMsg,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.error(`Email failed for ${to}: ${errMsg}`);
      }
    } catch (err) {
      await snap.ref.update({
        status: 'failed',
        error:  err?.message || String(err),
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.error('processEmailQueue error:', err);
    }
  });

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULED AUTOMATION
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED: rollForwardAssignments
// Runs every Monday at 6:00 AM UTC (1:00 AM Central).
// For each active booking that has a routeAssignment for the previous week,
// automatically creates a new assignment for the current week, preserving
// the same driverId and daysWorked. Skips if an assignment already exists
// for this week. The recalcPayout trigger fires on each new doc to calculate
// the server-side payout.
// ─────────────────────────────────────────────────────────────────────────────
exports.rollForwardAssignments = functions.pubsub
  .schedule('every monday 06:00')
  .timeZone('America/Chicago')
  .onRun(async () => {
    const db  = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();

    // This Monday at midnight
    const today = new Date();
    const day   = today.getDay();
    const diff  = today.getDate() - day + (day === 0 ? -6 : 1);
    const thisMonday = new Date(today);
    thisMonday.setDate(diff);
    thisMonday.setHours(0, 0, 0, 0);

    // Last Monday
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);

    // Get all active bookings
    const activeBookings = await db.collection('bookings')
      .where('status', '==', 'active')
      .get();

    const activeBookingIds = new Set(activeBookings.docs.map(d => d.id));

    // Get last week's assignments
    const lastWeekAssignments = await db.collection('routeAssignments')
      .where('weekStart', '>=', lastMonday)
      .where('weekStart', '<', thisMonday)
      .get();

    // Get this week's existing assignments to avoid duplicates
    const nextMonday = new Date(thisMonday);
    nextMonday.setDate(thisMonday.getDate() + 7);
    const thisWeekAssignments = await db.collection('routeAssignments')
      .where('weekStart', '>=', thisMonday)
      .where('weekStart', '<', nextMonday)
      .get();

    const existingThisWeek = new Set(
      thisWeekAssignments.docs.map(d => `${d.data().driverId}_${d.data().bookingId}`)
    );

    let created = 0;
    let skipped = 0;

    for (const doc of lastWeekAssignments.docs) {
      const prev = doc.data();

      // Only roll forward if the booking is still active
      if (!activeBookingIds.has(prev.bookingId)) { skipped++; continue; }

      // Skip if already assigned this week
      const key = `${prev.driverId}_${prev.bookingId}`;
      if (existingThisWeek.has(key)) { skipped++; continue; }

      await db.collection('routeAssignments').add({
        driverId:     prev.driverId,
        bookingId:    prev.bookingId,
        weekStart:    thisMonday,
        daysWorked:   prev.daysWorked || [],
        weeklyPayout: 0, // recalcPayout trigger will overwrite with server-calculated value
        status:       'pending',
        paidDate:     null,
        autoGenerated: true,
        createdAt:    now,
      });

      created++;
    }

    console.log(`rollForwardAssignments: created=${created}, skipped=${skipped}`);
    return null;
  });

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED: createMissedRouteLogs
// Runs every day at 11:00 PM Central (05:00 UTC next day).
// For each active booking scheduled today that has no routeLog, creates a
// log with ran=false so missed routes have an audit trail and $0 payout.
// ─────────────────────────────────────────────────────────────────────────────
exports.createMissedRouteLogs = functions.pubsub
  .schedule('every day 23:00')
  .timeZone('America/Chicago')
  .onRun(async () => {
    const db  = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();

    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today     = new Date();
    const todayName = DAY_NAMES[today.getDay()];
    const todayStr  = today.toISOString().split('T')[0]; // YYYY-MM-DD

    // Skip weekends
    if (today.getDay() === 0 || today.getDay() === 6) {
      console.log('createMissedRouteLogs: weekend — skipping');
      return null;
    }

    // Get all active bookings scheduled for today
    const bookingsSnap = await db.collection('bookings')
      .where('status', '==', 'active')
      .get();

    const todayBookings = bookingsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(b => (b.daysOfWeek || []).includes(todayName));

    if (todayBookings.length === 0) {
      console.log('createMissedRouteLogs: no bookings scheduled today');
      return null;
    }

    // Find assignments for today to get driverId
    const thisMonday = new Date(today);
    const dayOfWeek  = today.getDay();
    thisMonday.setDate(today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
    thisMonday.setHours(0, 0, 0, 0);
    const nextMonday = new Date(thisMonday);
    nextMonday.setDate(thisMonday.getDate() + 7);

    const assignmentsSnap = await db.collection('routeAssignments')
      .where('weekStart', '>=', thisMonday)
      .where('weekStart', '<', nextMonday)
      .get();

    const assignmentByBooking = {};
    assignmentsSnap.docs.forEach(d => {
      const data = d.data();
      assignmentByBooking[data.bookingId] = data;
    });

    let created = 0;
    let skippedExisting = 0;

    for (const booking of todayBookings) {
      const logId = `${booking.id}_${todayStr}`;
      const existing = await db.collection('routeLogs').doc(logId).get();
      if (existing.exists) { skippedExisting++; continue; }

      const assignment = assignmentByBooking[booking.id];
      const driverId   = assignment?.driverId || '';

      await db.collection('routeLogs').doc(logId).set({
        bookingId:     booking.id,
        driverId,
        date:          todayStr,
        ran:           false,
        autoMissed:    true,
        confirmedBy:   'system',
        confirmedAt:   now,
        notes:         'Auto-generated: no driver activity recorded for this route today.',
      });

      created++;
    }

    console.log(`createMissedRouteLogs: created=${created}, skippedExisting=${skippedExisting}`);
    return null;
  });

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER: provisionParentAccount
// Fires when a new client document is created.
// Ensures a Firebase Auth user + Firestore users/{uid} doc exists so the
// parent can sign in to the portal. Works for ALL three client creation
// paths (Apply form, Admin Add Client, Admin Import).
// ─────────────────────────────────────────────────────────────────────────────
exports.provisionParentAccount = functions
  .runWith({ secrets: ['RESEND_API_KEY'] })
  .firestore
  .document('bookings/{bookingId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after  = change.after.data();

    // Only fire when status transitions INTO 'active'
    if (before.status === after.status) return null;
    if (after.status !== 'active') return null;

    const clientId = after.clientId;
    if (!clientId) {
      console.log(`provisionParentAccount: booking ${context.params.bookingId} has no clientId, skipping.`);
      return null;
    }

    const db  = admin.firestore();
    const auth = admin.auth();

    const clientSnap = await db.collection('clients').doc(clientId).get();
    if (!clientSnap.exists) {
      console.log(`provisionParentAccount: client ${clientId} not found, skipping.`);
      return null;
    }
    const client = clientSnap.data();
    const email  = (client.email || '').trim().toLowerCase();

    if (!email) {
      console.log(`provisionParentAccount: client ${clientId} has no email, skipping.`);
      return null;
    }

    // Check if a users doc already links to this client (e.g. already provisioned)
    const existingLink = await db.collection('users')
      .where('linkedId', '==', clientId)
      .limit(1)
      .get();
    if (!existingLink.empty) {
      console.log(`provisionParentAccount: client ${clientId} already linked, skipping.`);
      return null;
    }

    let uid;
    let isNewAccount = false;

    try {
      // Try to find existing Auth user by email
      const existingUser = await auth.getUserByEmail(email);
      uid = existingUser.uid;
      console.log(`provisionParentAccount: existing Auth user ${uid} found for ${email}`);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        // Create new Auth user with a random temp password
        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
        let tempPassword = '';
        for (let i = 0; i < 16; i++) tempPassword += chars[Math.floor(Math.random() * chars.length)];

        const newUser = await auth.createUser({
          email,
          password: tempPassword,
          displayName: client.name || '',
        });
        uid = newUser.uid;
        isNewAccount = true;
        console.log(`provisionParentAccount: created Auth user ${uid} for ${email}`);
      } else {
        console.error(`provisionParentAccount: error looking up ${email}:`, err);
        return null;
      }
    }

    // Create or merge the users doc
    await db.collection('users').doc(uid).set({
      role:      'parent',
      email,
      name:      client.name || '',
      linkedId:  clientId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Send password reset email so the parent can set their own password
    try {
      const resetLink = await auth.generatePasswordResetLink(email, {
        url: 'https://kidz-transportation.com/login',
        handleCodeInApp: false,
      });
      // Queue an email via the existing email queue system
      await db.collection('emailQueue').add({
        to:      email,
        subject: 'Welcome to KIDZ Transportation — Activate Your Parent Portal',
        body: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1e293b">
  <h2 style="color:#4f46e5;margin:0 0 16px">Welcome to KIDZ Transportation!</h2>
  <p>Hi ${client.name || 'there'},</p>
  <p>Thanks for choosing KIDZ Transportation. Your <strong>Parent Portal</strong> account has been created and is ready to go.</p>
  <p>From the portal you can:</p>
  <ul style="padding-left:20px">
    <li>Track your child's ride in real time</li>
    <li>View schedules, drivers, and invoices</li>
    <li>Update pickup/drop-off details</li>
  </ul>
  <p style="margin:24px 0">
    <a href="${resetLink}" style="background:#4f46e5;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
      Set Your Password &amp; Sign In
    </a>
  </p>
  <p style="color:#64748b;font-size:13px">Or paste this link into your browser: <br>${resetLink}</p>
  <p style="color:#64748b;font-size:13px;margin-top:24px">
    After setting your password, sign in any time at
    <a href="https://kidz-transportation.com/login">kidz-transportation.com/login</a>.
  </p>
  <p style="color:#94a3b8;font-size:12px;margin-top:32px">— The KIDZ Transportation Team</p>
</div>`,
        status:    'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`provisionParentAccount: welcome email queued for ${email}`);
    } catch (emailErr) {
      console.error(`provisionParentAccount: failed to queue reset email for ${email}:`, emailErr);
      // Non-fatal — account is still created
    }

    console.log(`provisionParentAccount: ${isNewAccount ? 'created' : 'linked'} account for client ${clientId}`);
    return null;
  });

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: sendPortalInvite
// Admin-triggered manual send/resend of the parent portal setup email for a
// given clientId. Handles three cases:
//   1. Auth user exists + users doc linked → just resend password reset email
//   2. Auth user exists but no users doc → create users doc + send email
//   3. No Auth user yet → create Auth user + users doc + send email
// Payload: { clientId: string }
// Returns: { sent: true, action: 'created' | 'linked' | 'resent' }
// ─────────────────────────────────────────────────────────────────────────────
exports.sendPortalInvite = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const { clientId } = data;
  if (typeof clientId !== 'string' || !clientId) {
    throw new functions.https.HttpsError('invalid-argument', 'clientId is required.');
  }

  const db   = admin.firestore();
  const auth = admin.auth();

  const clientSnap = await db.collection('clients').doc(clientId).get();
  if (!clientSnap.exists) {
    throw new functions.https.HttpsError('not-found', `Client ${clientId} not found.`);
  }
  const client = clientSnap.data();
  const email  = (client.email || '').trim().toLowerCase();
  if (!email) {
    throw new functions.https.HttpsError('failed-precondition', 'Client has no email on file.');
  }

  let uid;
  let action;

  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
    const linkSnap = await db.collection('users')
      .where('linkedId', '==', clientId)
      .limit(1)
      .get();
    action = linkSnap.empty ? 'linked' : 'resent';
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
    let tempPassword = '';
    for (let i = 0; i < 16; i++) tempPassword += chars[Math.floor(Math.random() * chars.length)];
    const newUser = await auth.createUser({ email, password: tempPassword, displayName: client.name || '' });
    uid = newUser.uid;
    action = 'created';
  }

  // Upsert users/{uid} so the link to this client exists
  await db.collection('users').doc(uid).set({
    role:      'parent',
    email,
    name:      client.name || '',
    linkedId:  clientId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  const resetLink = await auth.generatePasswordResetLink(email, {
    url: 'https://kidz-transportation.com/login',
    handleCodeInApp: false,
  });

  await db.collection('emailQueue').add({
    to:      email,
    subject: action === 'resent'
      ? 'Your KIDZ Transportation Parent Portal — Reset Link'
      : 'Welcome to KIDZ Transportation — Activate Your Parent Portal',
    body: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1e293b">
  <h2 style="color:#4f46e5;margin:0 0 16px">${action === 'resent' ? 'Reset your portal password' : 'Welcome to KIDZ Transportation!'}</h2>
  <p>Hi ${client.name || 'there'},</p>
  <p>${action === 'resent'
    ? 'Here is a fresh link to reset your Parent Portal password:'
    : 'Your <strong>Parent Portal</strong> account is ready. Click below to set your password and sign in.'}</p>
  <p style="margin:24px 0">
    <a href="${resetLink}" style="background:#4f46e5;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
      Set Your Password &amp; Sign In
    </a>
  </p>
  <p style="color:#64748b;font-size:13px">Or paste this link into your browser: <br>${resetLink}</p>
  <p style="color:#64748b;font-size:13px;margin-top:24px">Sign in any time at <a href="https://kidz-transportation.com/login">kidz-transportation.com/login</a>.</p>
  <p style="color:#94a3b8;font-size:12px;margin-top:32px">— The KIDZ Transportation Team</p>
</div>`,
    status:    'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('auditLog').add({
    action:     'portal_invite_sent',
    collection: 'clients',
    docId:      clientId,
    actorUid:   context.auth.uid,
    email,
    inviteAction: action,
    timestamp:  admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`sendPortalInvite: ${action} for ${email} (client ${clientId})`);
  return { sent: true, action };
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER: calculateBookingMileage
// Fires when a new booking document is created.
// If mileage is 0 and both addresses are present, calls Google Maps
// Distance Matrix API to compute the driving distance and updates the
// booking with the correct mileage and recalculated pricing.
// ─────────────────────────────────────────────────────────────────────────────
exports.calculateBookingMileage = functions.firestore
  .document('bookings/{bookingId}')
  .onCreate(async (snap, context) => {
    const booking   = snap.data();
    const bookingId = context.params.bookingId;

    // Only run if mileage is missing/zero and addresses are present
    if (booking.mileage && booking.mileage > 0) return null;
    if (!booking.pickupAddress || !booking.dropoffAddress) {
      console.log(`calculateBookingMileage: booking ${bookingId} missing addresses, skipping.`);
      return null;
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.error('calculateBookingMileage: GOOGLE_MAPS_API_KEY not configured.');
      return null;
    }

    try {
      const origin = encodeURIComponent(booking.pickupAddress);
      const dest   = encodeURIComponent(booking.dropoffAddress);
      const url    = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${dest}&units=imperial&key=${apiKey}`;

      const fetch  = globalThis.fetch;
      const res    = await fetch(url);
      const data   = await res.json();

      if (data.status !== 'OK' || !data.rows?.[0]?.elements?.[0]) {
        console.error(`calculateBookingMileage: API returned status ${data.status}`);
        return null;
      }

      const element = data.rows[0].elements[0];
      if (element.status !== 'OK') {
        console.error(`calculateBookingMileage: element status ${element.status}`);
        return null;
      }

      // Distance is in meters — convert to miles
      const meters = element.distance.value;
      const miles  = Math.round((meters / 1609.34) * 10) / 10;

      if (miles <= 0) return null;

      // Recalculate pricing with the server-side pricing logic
      const daysCount      = (booking.daysOfWeek || []).length || 5;
      const isRoundTrip    = booking.transportationType === 'roundtrip';
      const studentCount   = (booking.studentIds || []).length || 1;
      const pricing        = computeWeeklyCharge(miles, daysCount, isRoundTrip, studentCount);

      await snap.ref.update({
        mileage:    miles,
        weeklyRate: pricing.weekly,
        dailyRate:  pricing.daily,
      });

      console.log(`calculateBookingMileage: booking ${bookingId} updated — ${miles} mi, $${pricing.weekly}/wk`);
    } catch (err) {
      console.error(`calculateBookingMileage: error for booking ${bookingId}:`, err);
    }

    return null;
  });

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: sendContactInvite
// Admin invites a secondary or coordinator contact to a client's portal.
// Creates a clientAccess doc (id = uid_clientId placeholder using a temp key
// until accepted), stores a one-time token with 14-day expiry, and queues
// an invite email via the existing emailQueue / processEmailQueue path.
//
// Payload: { clientId, email, name, role, permissions }
// role: 'secondary' | 'coordinator'
// permissions: { canSeeBilling, canSeeInvoices, canEdit }
// ─────────────────────────────────────────────────────────────────────────────
exports.sendContactInvite = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const { clientId, email, name, role, permissions } = data;

  if (!clientId || !email || !name || !role) {
    throw new functions.https.HttpsError('invalid-argument', 'clientId, email, name, and role are required.');
  }
  if (!['secondary', 'coordinator'].includes(role)) {
    throw new functions.https.HttpsError('invalid-argument', 'role must be secondary or coordinator.');
  }

  const db  = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  // Check for an existing clientAccess doc for this email + clientId
  const existing = await db.collection('clientAccess')
    .where('clientId', '==', clientId)
    .where('email',    '==', email.trim().toLowerCase())
    .limit(1)
    .get();

  if (!existing.empty) {
    throw new functions.https.HttpsError('already-exists', 'A contact with this email already exists for this client.');
  }

  // Generate a secure random token
  const crypto = require('crypto');
  const token  = crypto.randomBytes(32).toString('hex');

  // 14-day expiry
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 14);

  // Doc id: invite_{clientId}_{token.slice(0,8)} — will be re-keyed to uid_clientId on acceptance
  const docId  = `invite_${clientId}_${token.slice(0, 8)}`;
  const docRef = db.collection('clientAccess').doc(docId);

  const resolvedPermissions = permissions ?? {
    canSeeBilling:  role === 'secondary' ? false : false,
    canSeeInvoices: role === 'secondary' ? false : false,
    canEdit:        role === 'secondary' ? true  : false,
  };

  await docRef.set({
    clientId,
    uid:              null,
    email:            email.trim().toLowerCase(),
    name:             name.trim(),
    role,
    permissions:      resolvedPermissions,
    inviteToken:      token,
    inviteStatus:     'pending',
    inviteExpiresAt:  admin.firestore.Timestamp.fromDate(expiresAt),
    invitedAt:        now,
    acceptedAt:       null,
    createdAt:        now,
  });

  // Build invite URL — uses the app's base URL from env or a fallback
  const baseUrl = process.env.APP_BASE_URL || 'https://kidz-transportation.com';
  const inviteUrl = `${baseUrl}/parent/setup?invite=${token}`;

  // Queue the invite email via existing emailQueue / processEmailQueue path
  await db.collection('emailQueue').add({
    to:      email.trim().toLowerCase(),
    subject: 'You have been invited to the KIDZ Transportation Parent Portal',
    body: `<p>Hello ${name.trim()},</p>
<p>You have been added as a contact for a KIDZ Transportation family. Click the link below to create your account and access the parent portal:</p>
<p><a href="${inviteUrl}" style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Accept Invitation</a></p>
<p>This link expires in 14 days. If you did not expect this email, you can safely ignore it.</p>
<p>— KIDZ Transportation<br/>(314) 425-9668</p>`,
    status:    'pending',
    createdAt: now,
  });

  // Audit log
  await db.collection('auditLog').add({
    action:    'contact_invite_sent',
    collection: 'clientAccess',
    docId,
    clientId,
    email:     email.trim().toLowerCase(),
    role,
    actorUid:  context.auth.uid,
    timestamp: now,
  });

  return { success: true, docId };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: removeContactAccess
// Admin removes a clientAccess doc. Soft approach: sets inviteStatus to
// 'expired' and clears the token rather than deleting, preserving audit trail.
//
// Payload: { docId }
// ─────────────────────────────────────────────────────────────────────────────
exports.removeContactAccess = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const { docId } = data;
  if (!docId) throw new functions.https.HttpsError('invalid-argument', 'docId is required.');

  const db  = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const ref  = db.collection('clientAccess').doc(docId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'clientAccess doc not found.');

  await ref.update({
    inviteStatus:    'expired',
    inviteToken:     null,
    inviteExpiresAt: null,
    uid:             null,
  });

  await db.collection('auditLog').add({
    action:    'contact_access_removed',
    collection: 'clientAccess',
    docId,
    clientId:  snap.data().clientId,
    email:     snap.data().email,
    actorUid:  context.auth.uid,
    timestamp: now,
  });

  return { success: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: acceptContactInvite
// Called from the parent setup page when a user signs up via an invite token.
// Validates the token, links the uid, re-keys the doc to uid_clientId,
// creates/updates the users/{uid} doc, and writes the audit log.
//
// Payload: { token }
// ─────────────────────────────────────────────────────────────────────────────
exports.acceptContactInvite = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');

  const { token } = data;
  if (!token) throw new functions.https.HttpsError('invalid-argument', 'token is required.');

  const db   = admin.firestore();
  const now  = admin.firestore.FieldValue.serverTimestamp();
  const uid  = context.auth.uid;

  // Find the pending invite doc by token
  const snap = await db.collection('clientAccess')
    .where('inviteToken', '==', token)
    .where('inviteStatus', '==', 'pending')
    .limit(1)
    .get();

  if (snap.empty) {
    throw new functions.https.HttpsError('not-found', 'Invite token is invalid or has already been used.');
  }

  const inviteDoc  = snap.docs[0];
  const inviteData = inviteDoc.data();

  // Check expiry
  const expiresAt = inviteData.inviteExpiresAt?.toDate();
  if (expiresAt && new Date() > expiresAt) {
    await inviteDoc.ref.update({ inviteStatus: 'expired' });
    throw new functions.https.HttpsError('deadline-exceeded', 'This invite link has expired. Please ask your administrator to resend.');
  }

  // Check email matches the signed-in user
  const authUser = await admin.auth().getUser(uid);
  if (authUser.email?.toLowerCase() !== inviteData.email.toLowerCase()) {
    throw new functions.https.HttpsError('permission-denied', 'The email address on your account does not match this invitation.');
  }

  const clientId   = inviteData.clientId;
  const newDocId   = `${uid}_${clientId}`;

  // Use a batch: delete old invite doc, create new uid-keyed doc, upsert users doc
  const batch = db.batch();

  batch.delete(inviteDoc.ref);

  batch.set(db.collection('clientAccess').doc(newDocId), {
    ...inviteData,
    uid,
    inviteToken:     null,
    inviteStatus:    'accepted',
    inviteExpiresAt: null,
    acceptedAt:      now,
  });

  // Create or merge users doc so the parent can log in normally
  batch.set(db.collection('users').doc(uid), {
    role:      'parent',
    email:     inviteData.email,
    name:      inviteData.name,
    linkedId:  clientId,
    createdAt: now,
  }, { merge: true });

  await batch.commit();

  await db.collection('auditLog').add({
    action:    'contact_invite_accepted',
    collection: 'clientAccess',
    docId:     newDocId,
    clientId,
    uid,
    role:      inviteData.role,
    timestamp: now,
  });

  return { success: true, clientId, role: inviteData.role };
});

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED: checkDocumentExpiration
// Runs daily. Scans all driver documents for expiry and sends in-app
// notifications at 30-day, 14-day, and 3-day thresholds.
// ─────────────────────────────────────────────────────────────────────────────
exports.checkDocumentExpiration = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async () => {
    const db  = admin.firestore();
    const now = Date.now();

    const DOC_TYPES = ['license', 'insurance', 'backgroundCheck', 'cpr', 'childPassengerSafety', 'vehicleInspection'];
    const THRESHOLDS = [
      { days: 30, field: 'reminderSentAt30' },
      { days: 14, field: 'reminderSentAt14' },
      { days:  3, field: 'reminderSentAt3'  },
    ];

    const driversSnap = await db.collection('drivers').get();

    const tasks = driversSnap.docs.map(async driverDoc => {
      const driver = driverDoc.data();
      const driverId = driverDoc.id;

      // Find the uid of this driver's user account so we can send them a notification
      const userSnap = await db.collection('users')
        .where('linkedId', '==', driverId)
        .limit(1)
        .get();
      const driverUid = userSnap.empty ? null : userSnap.docs[0].id;

      for (const docType of DOC_TYPES) {
        const docData = driver.documents?.[docType];
        if (!docData?.expiresAt) continue;

        const expiresAtMs = docData.expiresAt.toMillis ? docData.expiresAt.toMillis() : docData.expiresAt;
        const daysLeft = Math.ceil((expiresAtMs - now) / (1000 * 60 * 60 * 24));
        if (daysLeft < 0) continue; // already expired — handled separately

        for (const threshold of THRESHOLDS) {
          if (daysLeft > threshold.days) continue;
          if (docData[threshold.field]) continue; // reminder already sent

          // Notify driver
          if (driverUid) {
            await createNotification({
              recipientUid: driverUid,
              audience:     'driver',
              type:         'doc_expiring_soon',
              title:        `Document Expiring Soon`,
              body:         `Your ${docType} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Please upload a renewal.`,
              driverId,
              priority:     daysLeft <= 3 ? 'high' : 'normal',
            });
          }

          // Notify admins
          await notifyAllAdmins({
            type:     'doc_expiring_soon',
            title:    `Driver Doc Expiring — ${driver.name ?? driverId}`,
            body:     `${driver.name ?? driverId}'s ${docType} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
            driverId,
            priority: daysLeft <= 3 ? 'high' : 'normal',
          });

          // Mark reminder sent
          await driverDoc.ref.update({
            [`documents.${docType}.${threshold.field}`]: admin.firestore.FieldValue.serverTimestamp(),
          });
          break; // Only send one threshold reminder per run
        }
      }
    });

    await Promise.allSettled(tasks);
    console.log(`checkDocumentExpiration: processed ${driversSnap.size} drivers`);
    return null;
  });

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED: generateWeeklyInvoicesAuto
// Runs every Monday at 6 AM Central to automatically generate weekly invoices.
// P12 — Invoice automation
// ─────────────────────────────────────────────────────────────────────────────
exports.generateWeeklyInvoicesAuto = functions.pubsub
  .schedule('every monday 06:00')
  .timeZone('America/Chicago')
  .onRun(async () => {
    try {
      const result = await doGenerateWeeklyInvoices(null);
      console.log('generateWeeklyInvoicesAuto completed:', result);

      // Notify admins
      await notifyAllAdmins({
        type:     'invoice_generated',
        title:    'Weekly Invoices Generated',
        body:     `Automated weekly invoice run completed. ${result?.created ?? 0} invoice(s) created.`,
        priority: 'normal',
      });
    } catch (err) {
      console.error('generateWeeklyInvoicesAuto failed:', err);
      await notifyAllAdmins({
        type:     'admin_alert',
        title:    'Invoice Generation Failed',
        body:     `Automated weekly invoice run failed: ${err.message}`,
        priority: 'high',
      });
    }
    return null;
  });

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED: markInvoicesOverdue
// Runs daily at 7 AM Central. Marks any 'sent' invoice whose dueDate is in the
// past as 'overdue' and sends a notification to the parent.
// ─────────────────────────────────────────────────────────────────────────────
exports.markInvoicesOverdue = functions.pubsub
  .schedule('every day 07:00')
  .timeZone('America/Chicago')
  .onRun(async () => {
    const db = admin.firestore();
    const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"

    const snap = await db.collection('invoices')
      .where('status', '==', 'sent')
      .get();

    let marked = 0;
    const batch = db.batch();

    for (const invDoc of snap.docs) {
      const inv = invDoc.data();
      if (!inv.dueDate || inv.dueDate >= today) continue;

      batch.update(invDoc.ref, { status: 'overdue' });
      marked++;

      // Notify the parent
      try {
        const userSnap = await db.collection('users')
          .where('linkedId', '==', inv.clientId).limit(1).get();
        if (!userSnap.empty) {
          await createNotification({
            recipientUid: userSnap.docs[0].id,
            audience:     'parent',
            type:         'invoice_overdue',
            title:        'Invoice Overdue',
            body:         `Your payment of $${inv.totalAmount?.toFixed(2) ?? '0.00'} for the week of ${inv.weekOf || inv.periodStart || 'N/A'} was due on ${inv.dueDate}. Please pay as soon as possible.`,
            clientId:     inv.clientId,
            invoiceId:    invDoc.id,
            priority:     'high',
          });
        }
      } catch (notifyErr) {
        console.warn('markInvoicesOverdue: notification failed for', invDoc.id, notifyErr.message);
      }
    }

    if (marked > 0) await batch.commit();
    console.log(`markInvoicesOverdue: marked ${marked} invoice(s) overdue`);
    return null;
  });

// ─────────────────────────────────────────────────────────────────────────────
// P13 — Stripe Connect: create onboarding link for a driver
// CALLABLE: createConnectOnboardingLink
// Payload: { driverId: string }
// ─────────────────────────────────────────────────────────────────────────────
exports.createConnectOnboardingLink = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);
  const { driverId } = data;
  if (!driverId) throw new functions.https.HttpsError('invalid-argument', 'driverId is required.');

  const db = admin.firestore();
  const stripe = getStripe();
  const driverSnap = await db.collection('drivers').doc(driverId).get();
  if (!driverSnap.exists) throw new functions.https.HttpsError('not-found', 'Driver not found.');

  const driver = driverSnap.data();
  let accountId = driver.stripeConnectAccountId;

  if (!accountId) {
    const account = await stripe.accounts.create({
      type:         'express',
      country:      'US',
      email:        driver.email ?? undefined,
      capabilities: { transfers: { requested: true } },
      business_type: 'individual',
      metadata:     { driverId },
    });
    accountId = account.id;
    await db.collection('drivers').doc(driverId).update({
      stripeConnectAccountId: accountId,
      stripeConnectOnboarded:  false,
      stripeConnectPayoutsEnabled: false,
    });
  }

  const origin = process.env.APP_ORIGIN ?? 'https://kidzstl.com';
  const link = await stripe.accountLinks.create({
    account:      accountId,
    refresh_url:  `${origin}/admin/drivers?connect=refresh&driverId=${driverId}`,
    return_url:   `${origin}/admin/drivers?connect=success&driverId=${driverId}`,
    type:         'account_onboarding',
  });

  return { url: link.url };
});

// ─────────────────────────────────────────────────────────────────────────────
// P13 — Stripe Connect: issue a payout to a driver
// CALLABLE: issueDriverPayout
// Payload: { driverId: string, amountCents: number, description?: string }
// ─────────────────────────────────────────────────────────────────────────────
exports.issueDriverPayout = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);
  const { driverId, amountCents, description } = data;
  if (!driverId || !amountCents) {
    throw new functions.https.HttpsError('invalid-argument', 'driverId and amountCents are required.');
  }

  const db = admin.firestore();
  const stripe = getStripe();
  const driverSnap = await db.collection('drivers').doc(driverId).get();
  if (!driverSnap.exists) throw new functions.https.HttpsError('not-found', 'Driver not found.');

  const driver = driverSnap.data();
  const accountId = driver.stripeConnectAccountId;
  if (!accountId) throw new functions.https.HttpsError('failed-precondition', 'Driver has not connected a Stripe account.');
  if (!driver.stripeConnectPayoutsEnabled) {
    throw new functions.https.HttpsError('failed-precondition', 'Driver payouts are not enabled yet. Complete Stripe onboarding first.');
  }

  const now = admin.firestore.FieldValue.serverTimestamp();

  // Transfer funds from platform account to driver's connected account
  const transfer = await stripe.transfers.create({
    amount:      amountCents,
    currency:    'usd',
    destination: accountId,
    description: description ?? `KIDZ Transportation driver payout`,
    metadata:    { driverId },
  });

  const payoutRef = await db.collection('driverPayouts').add({
    driverId,
    stripeTransferId:    transfer.id,
    stripeConnectAccountId: accountId,
    amountCents,
    currency:            'usd',
    description:         description ?? null,
    status:              'paid',
    createdAt:           now,
    paidAt:              now,
    periodStart:         null,
    periodEnd:           null,
    hoursWorked:         null,
    ratePerHour:         null,
  });

  await db.collection('auditLog').add({
    action:     'driver_payout_issued',
    collection: 'driverPayouts',
    docId:      payoutRef.id,
    driverId,
    amountCents,
    stripeTransferId: transfer.id,
    issuedBy:   context.auth?.uid,
    timestamp:  now,
  });

  // Notify driver
  const userSnap = await db.collection('users').where('linkedId', '==', driverId).limit(1).get();
  if (!userSnap.empty) {
    await createNotification({
      recipientUid: userSnap.docs[0].id,
      audience:     'driver',
      type:         'payout_issued',
      title:        'Payout Sent',
      body:         `A payout of $${(amountCents / 100).toFixed(2)} has been sent to your account.`,
      driverId,
      priority:     'normal',
    });
  }

  return { success: true, payoutId: payoutRef.id, transferId: transfer.id };
});

// ─────────────────────────────────────────────────────────────────────────────
// P13 — Stripe Connect webhook: sync account status
// Updates stripeConnectOnboarded + stripeConnectPayoutsEnabled when Stripe
// sends account.updated events.
// ─────────────────────────────────────────────────────────────────────────────
exports.stripeConnectWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const sig = req.headers['stripe-signature'];
  const connectSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.rawBody, sig, connectSecret);
  } catch (err) {
    console.error('Connect webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'account.updated') {
    const account = event.data.object;
    const driverId = account.metadata?.driverId;
    if (driverId) {
      const db = admin.firestore();
      await db.collection('drivers').doc(driverId).update({
        stripeConnectOnboarded:      account.details_submitted ?? false,
        stripeConnectPayoutsEnabled: account.payouts_enabled   ?? false,
      });
    }
  }

  res.status(200).send('ok');
});
