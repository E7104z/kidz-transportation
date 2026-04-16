'use strict';

const functions = require('firebase-functions');
const admin     = require('firebase-admin');
const cors      = require('cors')({ origin: true });

admin.initializeApp();

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
// HTTP: getDistance
// Proxy to Google Maps Distance Matrix API (keeps the key server-side).
// ─────────────────────────────────────────────────────────────────────────────
exports.getDistance = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const origin      = req.query.origin;
      const destination = req.query.destination;
      if (!origin || !destination)
        return res.status(400).json({ error: 'origin and destination query parameters required' });

      const key = process.env.GOOGLE_MAPS_API_KEY;
      if (!key) return res.status(500).json({ error: 'Server missing Google Maps API key' });

      const params = new URLSearchParams({ origins: origin, destinations: destination, units: 'imperial', key });
      const url    = `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;
      const r      = await fetch(url);
      if (!r.ok) {
        const text = await r.text();
        return res.status(502).json({ error: 'Remote API error', status: r.status, body: text });
      }
      const data = await r.json();
      if (data.status !== 'OK') return res.status(200).json({ miles: null, raw: data });
      const element = data.rows?.[0]?.elements?.[0];
      if (!element || element.status !== 'OK') return res.status(200).json({ miles: null, raw: data });
      const meters = element.distance?.value;
      if (typeof meters !== 'number') return res.status(200).json({ miles: null, raw: data });
      const miles = Math.round((meters / 1609.344) * 10) / 10;
      return res.json({ miles, raw: data });
    } catch (err) {
      console.error('getDistance error', err);
      return res.status(500).json({ error: err?.message || String(err) });
    }
  });
});

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
    const weeklyPayout = Math.round(weeklyRate * 0.75 * 100) / 100; // cents-accurate

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
  const batch       = db.batch();

  batch.set(contractRef, {
    bookingId,
    ...safeContractData,
    pdfUrl,
    generatedAt: now,
    sentAt:      null,
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
  return { contractId: contractRef.id };
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER: processSmsQueue
// Fires when a new document is created in the `smsQueue` collection.
// Reads Twilio credentials from environment config:
//   firebase functions:config:set twilio.sid="ACxxx" twilio.token="xxx" twilio.from="+1xxxxxxxxxx"
// Updates the queue doc with status: 'sent' | 'failed' and timestamps.
// ─────────────────────────────────────────────────────────────────────────────
exports.processSmsQueue = functions.firestore
  .document('smsQueue/{itemId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    const to   = data.to;
    const body = data.body;

    if (!to || !body) {
      await snap.ref.update({ status: 'failed', error: 'Missing to or body', sentAt: admin.firestore.FieldValue.serverTimestamp() });
      return;
    }

    // Read Twilio credentials from environment variables
    const sid  = process.env.TWILIO_SID;
    const token = process.env.TWILIO_TOKEN;
    const from = process.env.TWILIO_FROM;

    if (!sid || !token || !from) {
      console.warn('processSmsQueue: Twilio credentials not configured. Set env vars TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM');
      await snap.ref.update({ status: 'failed', error: 'Twilio not configured', sentAt: admin.firestore.FieldValue.serverTimestamp() });
      return;
    }

    try {
      // Use the Twilio REST API directly with fetch (no SDK dependency needed)
      const credentials = Buffer.from(`${sid}:${token}`).toString('base64');
      const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
      const params = new URLSearchParams({ To: to, From: from, Body: body });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      const result = await response.json();

      if (response.ok && result.sid) {
        await snap.ref.update({
          status:    'sent',
          twilioSid: result.sid,
          sentAt:    admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`SMS sent: ${result.sid} → ${to}`);
      } else {
        const errMsg = result.message || `HTTP ${response.status}`;
        await snap.ref.update({
          status: 'failed',
          error:  errMsg,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.error(`SMS failed for ${to}: ${errMsg}`);
      }
    } catch (err) {
      await snap.ref.update({
        status: 'failed',
        error:  err?.message || String(err),
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.error('processSmsQueue error:', err);
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: createParentAccount
// Admin creates a Firebase Auth user + Firestore users/{uid} record for a
// parent, linking them to an existing clients/{clientId} doc.
// A temporary random password is generated — the parent can use "Forgot
// password" to set their own, or sign in with Google.
// Payload: { email: string, name: string, clientId: string }
// Returns: { uid: string, tempPassword: string }
// ─────────────────────────────────────────────────────────────────────────────
exports.createParentAccount = functions.https.onCall(async (data, context) => {
  try {
    const callerUid = context.auth?.uid;
    if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');

    const db = admin.firestore();
    const userSnap = await db.collection('users').doc(callerUid).get();
    if (!userSnap.exists || userSnap.data().role !== 'admin')
      throw new functions.https.HttpsError('permission-denied', 'Admin access required.');

    const { email, name, clientId } = data;
    if (typeof email !== 'string' || !email.trim())
      throw new functions.https.HttpsError('invalid-argument', 'email is required.');
    if (typeof clientId !== 'string' || !clientId.trim())
      throw new functions.https.HttpsError('invalid-argument', 'clientId is required.');

    const trimmedEmail = email.trim().toLowerCase();
    const displayName  = (name || '').trim();

    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
    let tempPassword = '';
    for (let i = 0; i < 16; i++) tempPassword += chars[Math.floor(Math.random() * chars.length)];

    let uid;
    const existing = await admin.auth().getUserByEmail(trimmedEmail).catch(() => null);
    if (existing) {
      uid = existing.uid;
    } else {
      const rec = await admin.auth().createUser({ email: trimmedEmail, password: tempPassword, displayName });
      uid = rec.uid;
    }

    await db.collection('users').doc(uid).set({
      role: 'parent', email: trimmedEmail, name: displayName, linkedId: clientId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await db.collection('auditLog').add({
      action: 'parent_account_created', docId: uid, clientId,
      actorUid: callerUid, timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { uid, tempPassword };

  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    console.error('[createParentAccount] UNHANDLED:', err.message, err.stack);
    throw new functions.https.HttpsError('internal', err.message);
  }
});
