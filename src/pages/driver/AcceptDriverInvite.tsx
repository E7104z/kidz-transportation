import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../services/firebase';
import { createUserRecord } from '../../services/userService';

interface ValidateResponse {
  valid: boolean;
  reason?: string;
  driverId?: string;
  driverName?: string;
  email?: string;
}

const INVALID_MESSAGES: Record<string, string> = {
  not_found:     'This invitation link is invalid or has already been used.',
  expired:       'This invitation link has expired. Please ask an admin to resend your invite.',
  already_linked:'This invitation has already been used. Please log in to your existing account.',
  invalid_token: 'This invitation link is invalid.',
};

const AcceptDriverInvite: React.FC = () => {
  const [searchParams]  = useSearchParams();
  const navigate        = useNavigate();
  const token           = searchParams.get('token') ?? '';

  const [pageState, setPageState]   = useState<'loading' | 'valid' | 'invalid'>('loading');
  const [invalidMsg, setInvalidMsg] = useState('');
  const [driverInfo, setDriverInfo] = useState<{
    driverId: string;
    driverName: string;
    email: string;
  } | null>(null);

  const [password, setPassword]               = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting]           = useState(false);
  const [error, setError]                     = useState('');

  useEffect(() => {
    if (!token) {
      setInvalidMsg('No invitation token was found in this link.');
      setPageState('invalid');
      return;
    }

    const fn = httpsCallable<{ token: string }, ValidateResponse>(
      getFunctions(), 'validateDriverInvite'
    );

    fn({ token })
      .then(res => {
        const data = res.data;
        if (data.valid) {
          setDriverInfo({
            driverId:   data.driverId!,
            driverName: data.driverName!,
            email:      data.email!,
          });
          setPageState('valid');
        } else {
          setInvalidMsg(
            INVALID_MESSAGES[data.reason ?? ''] ?? 'This invitation link is invalid.'
          );
          setPageState('invalid');
        }
      })
      .catch(() => {
        setInvalidMsg('Unable to validate this invitation. Please try again later.');
        setPageState('invalid');
      });
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!driverInfo) return;

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setError('');
    setSubmitting(true);

    try {
      const cred = await createUserWithEmailAndPassword(auth, driverInfo.email, password);
      await createUserRecord(cred.user.uid, driverInfo.email, driverInfo.driverName, 'driver', driverInfo.driverId);
      navigate('/driver/onboarding', { replace: true });
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? '';
      if (msg.includes('email-already-in-use')) {
        setError('An account with this email already exists. Please log in instead.');
      } else {
        setError('Failed to create your account. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Loading ─────────────────────────────────────────────────────────── */
  if (pageState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-emerald-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Validating your invitation…</p>
        </div>
      </div>
    );
  }

  /* ── Invalid / Expired ───────────────────────────────────────────────── */
  if (pageState === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-emerald-50 px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">
            ✕
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Invitation Unavailable</h2>
          <p className="text-slate-500 text-sm mb-6">{invalidMsg}</p>
          <Link to="/login" className="text-teal-600 hover:underline text-sm font-medium">
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  /* ── Set Password Form ───────────────────────────────────────────────── */
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-emerald-50 px-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full">
        <div className="mb-6 text-center">
          <div className="w-14 h-14 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-3 text-2xl">
            🚐
          </div>
          <h2 className="text-xl font-bold text-slate-800">Set Up Your Driver Account</h2>
          <p className="text-slate-500 text-sm mt-1">
            Welcome, <span className="font-semibold text-slate-700">{driverInfo!.driverName}</span>!
            Choose a password to get started.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email — pre-filled and disabled */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">
              Email
            </label>
            <input
              type="email"
              value={driverInfo!.email}
              disabled
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-slate-500 bg-slate-50 text-sm cursor-not-allowed"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              autoComplete="new-password"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
            />
          </div>

          {/* Confirm password */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Repeat your password"
              required
              autoComplete="new-password"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-xl py-3 text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Creating account…
              </>
            ) : (
              'Create Account & Continue'
            )}
          </button>

          <p className="text-center text-xs text-slate-400 pt-1">
            Already have an account?{' '}
            <Link to="/login" className="text-teal-600 hover:underline font-medium">
              Log in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
};

export default AcceptDriverInvite;
