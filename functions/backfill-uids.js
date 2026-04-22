// One-off backfill: for every users/{uid} doc with role=driver or parent,
// stamp the uid back onto the linked drivers/{linkedId} or clients/{linkedId}.
// Run with: node functions/backfill-uids.js
/* eslint-disable */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'kidz-transportation' });
const db = admin.firestore();

(async () => {
  const users = await db.collection('users').get();
  let drivers = 0, clients = 0, skipped = 0;
  for (const u of users.docs) {
    const { role, linkedId } = u.data();
    if (!linkedId) { skipped++; continue; }
    const coll = role === 'driver' ? 'drivers' : role === 'parent' ? 'clients' : null;
    if (!coll) { skipped++; continue; }
    await db.collection(coll).doc(linkedId).set({ uid: u.id }, { merge: true });
    if (role === 'driver') drivers++; else clients++;
    console.log(`  ✓ Stamped ${coll}/${linkedId} with uid=${u.id} (${u.data().email})`);
  }
  console.log(`\nDone. drivers=${drivers} clients=${clients} skipped=${skipped}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
