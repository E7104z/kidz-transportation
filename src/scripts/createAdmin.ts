/**
 * ONE-TIME ADMIN BOOTSTRAP SCRIPT
 * ================================
 * Use this to create the first admin user record in Firestore.
 *
 * HOW TO USE:
 * 1. Open the app in the browser and sign in with your Google account via /login.
 * 2. Open the browser DevTools console (F12).
 * 3. Run: (await import('/src/scripts/createAdmin.ts')).createAdmin()
 * 4. You should see "Admin record created!" in the console.
 * 5. Refresh and you will be able to access /admin/dashboard.
 * 6. DELETE THIS FILE once the first admin account is set up.
 */

import { auth } from '../services/firebase';
import { createUserRecord } from '../services/userService';

export async function createAdmin(): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    console.error('Not signed in. Sign in with Google first, then run this.');
    return;
  }
  await createUserRecord(user.uid, user.email ?? '', user.displayName ?? 'Admin', 'admin');
  console.log(`Admin record created for ${user.email}. You can now delete src/scripts/createAdmin.ts.`);
}
