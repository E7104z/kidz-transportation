import React, { useState } from 'react';
import { createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut as firebaseSignOut } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { auth, db } from '../../services/firebase';
import { createUserRecord } from '../../services/userService';
import { Bus, Lock, Mail, ArrowRight, CheckCircle } from 'lucide-react';

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    <path fill="none" d="M0 0h48v48H0z"/>
  </svg>
);

const DriverSetup: React.FC = () => {
  const [email, setEmail] = useState('');  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const lookupDriver = async (emailAddr: string) => {
    const allDrivers = await getDocs(collection(db, 'drivers'));
    return allDrivers.docs.find(
      d => (d.data().email as string | undefined)?.trim().toLowerCase() === emailAddr.toLowerCase()
    ) ?? null;
  };

  const handleGoogle = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      const googleEmail = result.user.email ?? '';
      const driverDoc = await lookupDriver(googleEmail);
      if (!driverDoc) {
        await firebaseSignOut(auth);
        setError('This Google account\'s email is not registered as a driver. Contact KIDZ Transportation to be added.');
        return;
      }
      await createUserRecord(result.user.uid, googleEmail.toLowerCase(), driverDoc.data().name || result.user.displayName || '', 'driver', driverDoc.id);
      setDone(true);
      setTimeout(() => { window.location.replace('/driver/today'); }, 1500);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        setError('Google sign-in failed. Please try again.');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      // 1. Check that this email exists in the drivers collection (case-insensitive)
      const trimmed = email.trim().toLowerCase();
      const driverDoc = await lookupDriver(trimmed);
      if (!driverDoc) {
        setError('This email is not registered as a driver. Contact KIDZ Transportation to be added.');
        setLoading(false);
        return;
      }
      const driverId = driverDoc.id;
      const driverName = (driverDoc.data().name as string) || '';

      // 2. Create the Firebase Auth account
      const cred = await createUserWithEmailAndPassword(auth, trimmed, password);

      // 3. Write the users/{uid} record linking auth ↔ driver record
      await createUserRecord(cred.user.uid, trimmed, driverName, 'driver', driverId);

      setDone(true);
      setTimeout(() => { window.location.replace('/driver/today'); }, 1500);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/email-already-in-use') {
        setError('An account with this email already exists. Go to the Login page to sign in instead.');
      } else if (code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else {
        setError(`Setup failed (${code ?? 'unknown error'}). Please try again or contact support.`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-emerald-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-teal-600 rounded-2xl shadow-lg mb-4">
            <Bus size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">KIDZ Transportation</h1>
          <p className="text-slate-500 text-sm mt-1">Driver Account Setup</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          {done ? (
            <div className="text-center py-4">
              <CheckCircle size={48} className="mx-auto text-emerald-500 mb-3" />
              <p className="text-lg font-semibold text-slate-800">Account created!</p>
              <p className="text-sm text-slate-500 mt-1">Redirecting to your dashboard…</p>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-bold text-slate-800 mb-1">Create your account</h2>
              <p className="text-sm text-slate-500 mb-6">
                Use the email address your admin registered for you.
              </p>

              {error && (
                <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                  {error}
                </div>
              )}

              {/* Google sign-in */}
              <button
                type="button"
                onClick={handleGoogle}
                disabled={googleLoading || loading}
                className="w-full flex items-center justify-center gap-3 bg-white border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-700 hover:border-teal-400 hover:shadow-md transition-all duration-150 disabled:opacity-60 mb-4"
              >
                {googleLoading
                  ? <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                  : <GoogleIcon />}
                {googleLoading ? 'Signing in…' : 'Continue with Google'}
              </button>

              <div className="flex items-center mb-4">
                <div className="flex-1 border-t border-slate-200" />
                <span className="mx-3 text-xs text-slate-400 font-medium">or</span>
                <div className="flex-1 border-t border-slate-200" />
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    Email address
                  </label>
                  <div className="relative">
                    <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      placeholder="your@email.com"
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    Create password
                  </label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      placeholder="At least 6 characters"
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    Confirm password
                  </label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="password"
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      required
                      placeholder="Re-enter password"
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors mt-2"
                >
                  {loading
                    ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : <ArrowRight size={16} />}
                  {loading ? 'Setting up…' : 'Create Account'}
                </button>
              </form>

              <p className="text-center text-xs text-slate-400 mt-6">
                Already have an account?{' '}
                <a href="/login" className="text-teal-600 hover:underline font-medium">Sign in</a>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DriverSetup;
