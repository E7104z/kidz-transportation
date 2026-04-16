import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithGoogle, signInWithEmail } from '../../services/authService';
import logo from '../../assets/KIDZ logo4 site.png';
import { getUserRole } from '../../services/userService';
import { useAuth } from '../../context/AuthContext';

function resolveRedirect(role: string | null): string {
  if (role === 'admin') return '/admin/dashboard';
  if (role === 'driver') return '/driver/dashboard';
  if (role === 'parent') return '/parent/status';
  return '/login';
}

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    <path fill="none" d="M0 0h48v48H0z"/>
  </svg>
);

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { user, role, loading: authLoading } = useAuth();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState('');

  // Auto-redirect if already signed in (saved session)
  useEffect(() => {
    if (!authLoading && user && role) {
      navigate(resolveRedirect(role), { replace: true });
    }
  }, [authLoading, user, role, navigate]);

  const handleGoogleSignIn = async () => {
    setGoogleError('');
    setGoogleLoading(true);
    try {
      const result = await signInWithGoogle();
      const userRole = await getUserRole(result.user.uid);
      if (!userRole) {
        setGoogleError('Account not recognized. Contact KIDZ Transportation to get access.');
        await import('../../services/authService').then(m => m.signOut());
        return;
      }
      navigate(resolveRedirect(userRole), { replace: true });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        // user dismissed — no error needed
      } else if (code === 'auth/unauthorized-domain') {
        setGoogleError('This domain is not authorized in Firebase. Add "localhost" to Firebase Console → Authentication → Settings → Authorized domains.');
      } else if (code === 'auth/operation-not-allowed') {
        setGoogleError('Google sign-in is not enabled. Go to Firebase Console → Authentication → Sign-in method and enable Google.');
      } else if (code) {
        setGoogleError(`Sign-in failed (${code}). Check the browser console for details.`);
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    setEmailLoading(true);
    try {
      const cred = await signInWithEmail(email, password);
      const role = await getUserRole(cred.user.uid);
      console.log('[Login] signed in uid:', cred.user.uid, '| email:', cred.user.email, '| role from Firestore:', role);
      if (!role) {
        setEmailError('Account not recognized. Contact KIDZ Transportation to get access.');
        await import('../../services/authService').then(m => m.signOut());
        return;
      }
      navigate(resolveRedirect(role), { replace: true });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
        setEmailError('No account found with that email address.');
      } else if (code === 'auth/wrong-password') {
        setEmailError('Incorrect password. Please try again.');
      } else if (code === 'auth/too-many-requests') {
        setEmailError('Too many attempts. Please wait a moment and try again.');
      } else {
        setEmailError('Sign-in failed. Check your credentials and try again.');
      }
    } finally {
      setEmailLoading(false);
    }
  };

  // Show a branded splash while checking auth state
  if (authLoading || (user && role)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-800 to-violet-900 flex flex-col items-center justify-center p-4">
        <img src={logo} alt="KIDZ Transportation" className="h-36 w-auto object-contain drop-shadow-lg mb-6" />
        <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-800 to-violet-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src={logo} alt="KIDZ Transportation" className="h-36 w-auto object-contain drop-shadow-lg" />
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* Admin Google section */}
          <div className="px-8 pt-8 pb-6">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Admin Sign In</p>
            <button
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
              className="w-full flex items-center justify-center gap-3 bg-white border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-700 hover:border-indigo-400 hover:shadow-md transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {googleLoading ? (
                <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <GoogleIcon />
              )}
              {googleLoading ? 'Signing in…' : 'Sign in with Google'}
            </button>
            {googleError && (
              <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {googleError}
              </p>
            )}
          </div>

          {/* Divider */}
          <div className="flex items-center px-8">
            <div className="flex-1 border-t border-slate-200" />
            <span className="mx-3 text-xs text-slate-400 font-medium">or</span>
            <div className="flex-1 border-t border-slate-200" />
          </div>

          {/* Driver / Parent email section */}
          <form onSubmit={handleEmailSignIn} className="px-8 pt-6 pb-8">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Driver / Parent Sign In</p>
            <div className="space-y-3">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                  placeholder="••••••••"
                />
              </div>
            </div>
            {emailError && (
              <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {emailError}
              </p>
            )}
            <button
              type="submit"
              disabled={emailLoading}
              className="mt-5 w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {emailLoading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : null}
              {emailLoading ? 'Signing in…' : 'Sign In'}
            </button>
            <p className="mt-4 text-center text-xs text-slate-400">
              Driver setting up for the first time?{' '}
              <a href="/driver/setup" className="text-indigo-600 hover:underline font-medium">Create your account</a>
            </p>
            <p className="mt-2 text-center text-xs text-slate-400">
              Parent setting up for the first time?{' '}
              <a href="/parent/setup" className="text-indigo-600 hover:underline font-medium">Create your account</a>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;

