// One-off fix: link haydenm69@gmail.com's Auth account to their driver document.
// Run with: node functions/fix-driver-link.js
/* eslint-disable */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'kidz-transportation' });
const db = admin.firestore();
const auth = admin.auth();

const TARGET_EMAIL = 'haydenm69@gmail.com';

(async () => {
  // 1. Look up the Auth user by email
  let authUser;
  try {
    authUser = await auth.getUserByEmail(TARGET_EMAIL);
    console.log(`Found Auth user: uid=${authUser.uid}, email=${authUser.email}`);
  } catch (e) {
    console.error(`No Firebase Auth account found for ${TARGET_EMAIL}. They may not have signed up yet.`);
    process.exit(1);
  }

  const uid = authUser.uid;

  // 2. Find their driver document (case-insensitive email match)
  const driversSnap = await db.collection('drivers').get();
  const driverDoc = driversSnap.docs.find(
    d => (d.data().email || '').toLowerCase() === TARGET_EMAIL.toLowerCase()
  );

  if (!driverDoc) {
    console.error(`No driver document found with email ${TARGET_EMAIL}.`);
    process.exit(1);
  }

  console.log(`Found driver document: id=${driverDoc.id}, name=${driverDoc.data().name || driverDoc.data().driverName}`);

  // 3. Stamp uid onto the driver document
  await db.collection('drivers').doc(driverDoc.id).set({ uid }, { merge: true });
  console.log(`✓ Stamped drivers/${driverDoc.id} with uid=${uid}`);

  // 4. Ensure users/{uid} doc exists and is correct
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    const name = driverDoc.data().name || driverDoc.data().driverName || authUser.displayName || '';
    await userRef.set({
      role: 'driver',
      email: TARGET_EMAIL,
      name,
      linkedId: driverDoc.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`✓ Created users/${uid} doc with role=driver, linkedId=${driverDoc.id}`);
  } else {
    const existing = userSnap.data();
    if (existing.linkedId !== driverDoc.id) {
      await userRef.set({ linkedId: driverDoc.id }, { merge: true });
      console.log(`✓ Updated users/${uid} linkedId to ${driverDoc.id}`);
    } else {
      console.log(`  users/${uid} doc already correct (linkedId=${existing.linkedId})`);
    }
  }

  console.log('\nDone! The driver should now show as "Linked" in the admin panel.');
  process.exit(0);
})();
