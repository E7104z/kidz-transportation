import { doc, getDoc, setDoc, getDocs, collection, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export type UserRole = 'admin' | 'driver' | 'parent';

export async function getUserRole(uid: string): Promise<UserRole | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (snap.exists()) {
    const data = snap.data();
    const role = (data.role as UserRole) ?? null;
    const linkedId = data.linkedId as string | undefined;
    // Backfill: ensure the linked driver/client doc has this uid stamped on it
    // so admin "Linked / No account" badge is accurate. Safe to run repeatedly.
    if (linkedId && (role === 'driver' || role === 'parent')) {
      const coll = role === 'driver' ? 'drivers' : 'clients';
      setDoc(doc(db, coll, linkedId), { uid }, { merge: true }).catch(() => {});
    }
    return role;
  }

  // No users doc — try to recover by matching the auth email against the
  // drivers and clients collections. This handles cases where a Firebase Auth
  // account exists but the users/{uid} link doc never got written (e.g. signup
  // failed midway, or the Auth account was created before Firestore records).
  const { getAuth } = await import('firebase/auth');
  const { auth } = await import('./firebase');
  const currentUser = getAuth(auth.app).currentUser;
  const emailLower = currentUser?.email?.toLowerCase() ?? '';
  if (emailLower) {
    // Try drivers first (case-insensitive scan since email may be stored mixed-case)
    const driversSnap = await getDocs(collection(db, 'drivers'));
    const driverDoc = driversSnap.docs.find(
      d => (d.data().email as string | undefined)?.trim().toLowerCase() === emailLower
    );
    if (driverDoc) {
      await setDoc(doc(db, 'users', uid), {
        role: 'driver',
        email: emailLower,
        name: driverDoc.data().name || '',
        linkedId: driverDoc.id,
        createdAt: serverTimestamp(),
      });
      // Also stamp uid back onto the driver doc so admin sees "Linked" status
      await setDoc(doc(db, 'drivers', driverDoc.id), { uid }, { merge: true });
      return 'driver';
    }

    // Then clients (parent)
    const clientSnap = await getDocs(
      query(collection(db, 'clients'), where('email', '==', currentUser!.email))
    );
    if (!clientSnap.empty) {
      const clientDoc = clientSnap.docs[0];
      await setDoc(doc(db, 'users', uid), {
        role: 'parent',
        email: currentUser!.email,
        name: clientDoc.data().name || '',
        linkedId: clientDoc.id,
        createdAt: serverTimestamp(),
      });
      // Also stamp uid back onto the client doc
      await setDoc(doc(db, 'clients', clientDoc.id), { uid }, { merge: true });
      return 'parent';
    }
  }

  return null;
}

export async function createUserRecord(
  uid: string,
  email: string,
  name: string,
  role: UserRole,
  linkedId = ''
): Promise<void> {
  await setDoc(doc(db, 'users', uid), {
    role,
    email,
    name,
    linkedId,
    createdAt: serverTimestamp(),
  });
  // Stamp uid onto the linked driver/client doc so admin UIs can show link status
  if (linkedId && (role === 'driver' || role === 'parent')) {
    const coll = role === 'driver' ? 'drivers' : 'clients';
    await setDoc(doc(db, coll, linkedId), { uid }, { merge: true });
  }
}
