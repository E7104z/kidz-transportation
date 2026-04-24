'use strict';

const { getFirestore, FieldValue } = require('firebase-admin/firestore');

/**
 * Create an in-app notification. All fields validated.
 * Returns the created doc ID.
 */
async function createNotification({
  recipientUid, audience, type, title, body,
  linkTo, bookingId, studentId, driverId, clientId, invoiceId, incidentId,
  priority = 'normal',
}) {
  if (!recipientUid || !audience || !type || !title || !body) {
    throw new Error('createNotification: missing required fields');
  }
  const db = getFirestore();
  const ref = await db.collection('notifications').add({
    recipientUid, audience, type, title, body,
    linkTo: linkTo || null,
    bookingId: bookingId || null,
    studentId: studentId || null,
    driverId: driverId || null,
    clientId: clientId || null,
    invoiceId: invoiceId || null,
    incidentId: incidentId || null,
    priority,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

/**
 * Broadcast a notification to all admins. Used for driver-triggered events
 * (incident reports, route-missed, etc.) that need admin attention.
 */
async function notifyAllAdmins(payload) {
  const db = getFirestore();
  const snap = await db.collection('users').where('role', '==', 'admin').get();
  const ids = [];
  for (const doc of snap.docs) {
    const id = await createNotification({ ...payload, recipientUid: doc.id, audience: 'admin' });
    ids.push(id);
  }
  return ids;
}

/**
 * Broadcast a notification to every contact (primary + secondary) of a client.
 */
async function notifyClientContacts(clientId, payload) {
  const db = getFirestore();
  const userSnap = await db.collection('users').where('linkedId', '==', clientId).get();
  const accessSnap = await db.collection('clientAccess').where('clientId', '==', clientId).get();
  const uids = new Set();
  userSnap.forEach(d => uids.add(d.id));
  accessSnap.forEach(d => { const uid = d.data().uid; if (uid) uids.add(uid); });
  const ids = [];
  for (const uid of uids) {
    const id = await createNotification({ ...payload, recipientUid: uid, audience: 'parent' });
    ids.push(id);
  }
  return ids;
}

module.exports = { createNotification, notifyAllAdmins, notifyClientContacts };
