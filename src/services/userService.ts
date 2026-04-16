import { doc, getDoc, setDoc, getDocs, collection, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export type UserRole = 'admin' | 'driver' | 'parent';

export async function getUserRole(uid: string): Promise<UserRole | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (snap.exists()) return (snap.data().role as UserRole) ?? null;

  // No users doc — check if there's a client record matching this user's email.
  // This handles the case where an admin added a client whose email already
  // existed in Firebase Auth but had no Firestore users doc.
  const { getAuth } = await import('firebase/auth');
  const { auth } = await import('./firebase');
  const currentUser = getAuth(auth.app).currentUser;
  if (currentUser?.email) {
    const clientSnap = await getDocs(
      query(collection(db, 'clients'), where('email', '==', currentUser.email))
    );
    if (!clientSnap.empty) {
      const clientDoc = clientSnap.docs[0];
      await setDoc(doc(db, 'users', uid), {
        role: 'parent',
        email: currentUser.email,
        name: clientDoc.data().name || '',
        linkedId: clientDoc.id,
        createdAt: serverTimestamp(),
      });
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
}
