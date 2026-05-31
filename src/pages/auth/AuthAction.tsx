/**
 * AuthAction.tsx
 *
 * Custom Firebase Auth action handler at /auth/action
 * Handles: resetPassword, verifyEmail, recoverEmail
 *
 * To activate, go to Firebase Console →
 *   Authentication → Templates → (any template) → Customize action URL
 *   Set to: https://kidz-transportation.com/auth/action
 *
 * Firebase will append ?mode=resetPassword&oobCode=...&continueUrl=... automatically.
 */
import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  getAuth,
  confirmPasswordReset,
  verifyPasswordResetCode,
  applyActionCode,
  checkActionCode,
} from 'firebase/auth';
import { Bus, CheckCircle2, Loader2, Eye, EyeOff } from 'lucide-react';

type Mode = 'resetPassword' | 'verifyEmail' | 'recoverEmail' | null;
type Stage = 'loading' | 'form' | 'success' | 'error';

const AuthAction: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const mode       = params.get('mode') as Mode;
  const oobCode    = params.get('oobCode') || '';
  const continueUrl = params.get('continueUrl') || 'https://kidz-transportation.com/login';

  const [stage, setStage]         = useState<Stage>('loading');
  const [error, setError]         = useState('');
  const [email, setEmail]         = useState('');

  // Password reset form
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [saving, setSaving]       = useState(false);

  // ── On mount: verify the oobCode and determine what to show ─────────────
  useEffect(() => {
    if (!oobCode) {
      setError('This link is missing required parameters. Request a new one.');
      setStage('error');
      return;
    }

    const auth = getAuth();

    (async () => {
      try {
        if (mode === 'resetPassword') {
          const accountEmail = await verifyPasswordResetCode(auth, oobCode);
          setEmail(accountEmail);
          setStage('form');
        } else if (mode === 'verifyEmail' || mode === 'recoverEmail') {
          const info = await checkActionCode(auth, oobCode);
          setEmail(info.data.email || '');
          await applyActionCode(auth, oobCode);
          setStage('success');
        } else {
          setError('Unknown action. Please request a new link.');
          setStage('error');
        }
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === 'auth/expired-action-code') {
          setError('This link has expired. Please request a new password reset email.');
        } else if (code === 'auth/invalid-action-code') {
          setError('This link is invalid or has already been used. Please request a new one.');
        } else {
          setError('Something went wrong. Please request a new link.');
        }
        setStage('error');
      }
    })();
  }, [mode, oobCode]);

  // ── Handle password reset submission ─────────────────────────────────────
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await confirmPasswordReset(getAuth(), oobCode, password);
      setStage('success');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/expired-action-code') {
        setError('This link has expired. Please request a new password reset email.');
      } else if (code === 'auth/weak-password') {
        setError('Password is too weak. Use at least 8 characters with a mix of letters and numbers.');
      } else {
        setError('Failed to reset password. Please try again or request a new link.');
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Title helpers ─────────────────────────────────────────────────────────
  const title = mode === 'verifyEmail'   ? 'Email verified'
              : mode === 'recoverEmail'  ? 'Email recovered'
              : mode === 'resetPassword' ? (stage === 'success' ? 'Password updated!' : 'Set your password')
              : 'Authentication';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="mb-6 flex items-center gap-2 text-slate-700">
        <Bus size={22} className="text-indigo-600" />
        <span className="font-bold text-lg">KIDZ Transportation</span>
      </div>

      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        {/* LOADING */}
        {stage === 'loading' && (
          <div className="flex flex-col items-center py-8 gap-3 text-slate-500">
            <Loader2 size={32} className="animate-spin text-indigo-600" />
            <p className="text-sm">Verifying your link…</p>
          </div>
        )}

        {/* ERROR */}
        {stage === 'error' && (
          <div className="text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-red-100 flex items-center justify-center mb-4">
              <span className="text-red-600 text-2xl font-bold">!</span>
            </div>
            <h1 className="text-xl font-bold text-slate-800 mb-2">Link not valid</h1>
            <p className="text-sm text-slate-600 mb-6">{error}</p>
            <a
              href="https://kidz-transportation.com/login"
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition-colors"
            >
              Back to Sign In
            </a>
          </div>
        )}

        {/* RESET PASSWORD FORM */}
        {stage === 'form' && mode === 'resetPassword' && (
          <>
            <h1 className="text-2xl font-bold text-slate-800 mb-1">{title}</h1>
            {email && (
              <p className="text-sm text-slate-500 mb-6">
                Setting a new password for <strong className="text-slate-700">{email}</strong>
              </p>
            )}
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                    minLength={8}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
                  Confirm Password
                </label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Re-enter your password"
                  required
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold rounded-xl py-2.5 transition-colors"
              >
                {saving
                  ? <><Loader2 size={16} className="animate-spin" /> Saving…</>
                  : 'Set Password & Sign In'}
              </button>
            </form>
          </>
        )}

        {/* SUCCESS */}
        {stage === 'success' && (
          <div className="text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-4">
              <CheckCircle2 size={32} className="text-green-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 mb-2">{title}</h1>
            <p className="text-sm text-slate-600 mb-6">
              {mode === 'resetPassword'
                ? 'Your password has been updated. You can now sign in.'
                : mode === 'verifyEmail'
                ? 'Your email has been verified.'
                : 'Your email has been recovered.'}
            </p>
            <button
              onClick={() => {
                const dest = continueUrl.startsWith('https://kidz-transportation.com')
                  ? continueUrl.replace('https://kidz-transportation.com', '')
                  : '/login';
                navigate(dest, { replace: true });
              }}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition-colors"
            >
              Sign In Now
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400 mt-6">
        Questions? Call or text <strong>(314) 425-9668</strong>
      </p>
    </div>
  );
};

export default AuthAction;
