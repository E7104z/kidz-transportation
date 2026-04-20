// One-time script: delete all stale driverLocations docs from Firestore
// Run:  cd functions && node cleanupDriverLocations.js

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'kidz-transportation' });

const db = admin.firestore();

async function main() {
  const snap = await db.collection('driverLocations').get();
  if (snap.empty) { console.log('No driverLocations docs found.'); return; }

  for (const doc of snap.docs) {
    const data = doc.data();
    const age = data.updatedAt
      ? Math.round((Date.now() - data.updatedAt.toMillis()) / 1000 / 60)
      : '??';
    console.log(`Deleting ${doc.id} (age: ${age} min)`);
    await doc.ref.delete();
  }
  console.log(`Done — deleted ${snap.size} doc(s).`);
}

main().catch(console.error);
