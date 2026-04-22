import React, { useState } from 'react';
import { useParentContext } from '../../context/ParentDataContext';
import { useAuth } from '../../context/AuthContext';
import { doc, updateDoc } from 'firebase/firestore';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth } from '../../services/firebase';
import { db } from '../../services/firebase';
import toast from 'react-hot-toast';
import {
  UserCircle, Mail, Phone, MapPin, Shield, Save, Eye, EyeOff,
  AlertTriangle, CheckCircle,
} from 'lucide-react';

const ParentProfile: React.FC = () => {
  const { user } = useAuth();
  const { loading, parentName, client, clientId, permissions, isPrimary } = useParentContext();

  // Profile edit
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', address: '' });
  const [saving, setSaving] = useState(false);

  // Password change
  const [showPw, setShowPw] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' });
  const [pwLoading, setPwLoading] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  const startEdit = () => {
    setForm({
      name: client?.name || parentName,
      phone: client?.phone || '',
      address: client?.address || '',
    });
    setEditing(true);
  };

  const saveProfile = async () => {
    if (!clientId) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'clients', clientId), {
        name: form.name,
        phone: form.phone,
        address: form.address,
      });
      // Also update user doc name
      if (user) {
        await updateDoc(doc(db, 'users', user.uid), { name: form.name });
      }
      toast.success('Profile updated');
      setEditing(false);
    } catch {
      toast.error('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (pwForm.newPw.length < 6) {
      toast.error('New password must be at least 6 characters.');
      return;
    }
    if (pwForm.newPw !== pwForm.confirm) {
      toast.error('Passwords do not match.');
      return;
    }

    setPwLoading(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser || !currentUser.email) throw new Error('Not authenticated');

      // Re-authenticate first
      const credential = EmailAuthProvider.credential(currentUser.email, pwForm.current);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, pwForm.newPw);

      toast.success('Password changed successfully');
      setPwForm({ current: '', newPw: '', confirm: '' });
      setShowPw(false);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        toast.error('Current password is incorrect.');
      } else {
        toast.error('Failed to change password. Try logging out and back in.');
      }
    } finally {
      setPwLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 animate-pulse h-60" />
      </div>
    );
  }

  const isGoogleUser = user?.providerData?.[0]?.providerId === 'google.com';

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Profile & Settings</h1>
        <p className="text-slate-500 text-sm mt-1">Manage your account information</p>
      </div>

      {/* Avatar + Name */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-8 flex items-center gap-5">
          {user?.photoURL ? (
            <img src={user.photoURL} alt="" className="w-16 h-16 rounded-2xl border-2 border-white/30" />
          ) : (
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
              <UserCircle size={36} className="text-white/80" />
            </div>
          )}
          <div>
            <div className="text-white font-bold text-lg">{client?.name || parentName}</div>
            <div className="text-blue-200 text-sm">{user?.email}</div>
            {isGoogleUser && (
              <span className="inline-flex items-center gap-1 mt-1.5 bg-white/20 px-2 py-0.5 rounded-full text-xs text-white">
                <CheckCircle size={10} /> Google account
              </span>
            )}
          </div>
        </div>

        <div className="p-6 space-y-5">
          {editing ? (
            <>
              <div className="space-y-4">
                <ProfileInput label="Full Name" icon={UserCircle} value={form.name}
                  onChange={v => setForm(f => ({ ...f, name: v }))} />
                <ProfileInput label="Phone Number" icon={Phone} value={form.phone}
                  onChange={v => setForm(f => ({ ...f, phone: v }))} placeholder="(314) 555-1234" />
                <ProfileInput label="Home Address" icon={MapPin} value={form.address}
                  onChange={v => setForm(f => ({ ...f, address: v }))} />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={saveProfile}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition disabled:opacity-60"
                >
                  <Save size={14} /> {saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="px-5 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-800 transition"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ProfileField icon={Mail} label="Email" value={user?.email || '—'} />
                <ProfileField icon={Phone} label="Phone" value={client?.phone || '—'} />
                <ProfileField icon={MapPin} label="Address" value={client?.address || '—'} />
              </div>
              {permissions.canEdit ? (
                <button
                  onClick={startEdit}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium transition"
                >
                  Edit Profile
                </button>
              ) : (
                <div className="text-xs text-slate-400 italic">
                  Your account has view-only access. Contact the primary parent to request changes.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Password Change — only for email/password users, and only primary contact */}
      {!isGoogleUser && isPrimary && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Shield size={18} className="text-slate-400" />
              <h2 className="font-semibold text-slate-800">Security</h2>
            </div>
            {!showPw && (
              <button
                onClick={() => setShowPw(true)}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium transition"
              >
                Change Password
              </button>
            )}
          </div>

          {showPw && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Current Password</label>
                <div className="relative">
                  <input
                    type={showCurrentPw ? 'text' : 'password'}
                    value={pwForm.current}
                    onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPw(!showCurrentPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                  >
                    {showCurrentPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">New Password</label>
                <div className="relative">
                  <input
                    type={showNewPw ? 'text' : 'password'}
                    value={pwForm.newPw}
                    onChange={e => setPwForm(f => ({ ...f, newPw: e.target.value }))}
                    placeholder="At least 6 characters"
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPw(!showNewPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                  >
                    {showNewPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Confirm New Password</label>
                <input
                  type="password"
                  value={pwForm.confirm}
                  onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={changePassword}
                  disabled={pwLoading}
                  className="flex items-center gap-1.5 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition disabled:opacity-60"
                >
                  <Shield size={14} /> {pwLoading ? 'Changing…' : 'Update Password'}
                </button>
                <button
                  onClick={() => { setShowPw(false); setPwForm({ current: '', newPw: '', confirm: '' }); }}
                  className="px-5 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-800 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Contact support */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold text-amber-800 text-sm">Need to update your email?</div>
          <div className="text-xs text-amber-600 mt-0.5">
            Email changes require verification. Please contact us at{' '}
            <a href="tel:+13144259668" className="font-semibold underline">(314) 425-9668</a> for assistance.
          </div>
        </div>
      </div>
    </div>
  );
};

function ProfileField({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 bg-slate-100 rounded-xl flex items-center justify-center flex-shrink-0">
        <Icon size={16} className="text-slate-400" />
      </div>
      <div>
        <div className="text-xs text-slate-400">{label}</div>
        <div className="text-sm font-medium text-slate-800">{value}</div>
      </div>
    </div>
  );
}

function ProfileInput({ label, icon: Icon, value, onChange, placeholder }: {
  label: string; icon: React.ElementType; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">{label}</label>
      <div className="relative">
        <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}

export default ParentProfile;
