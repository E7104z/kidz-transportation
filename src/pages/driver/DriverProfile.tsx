import React, { useEffect, useRef, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../services/firebase';
import { useAuth } from '../../context/AuthContext';
import { Camera, Mail, Phone, User as UserIcon, Check } from 'lucide-react';
import toast from 'react-hot-toast';

const DriverProfile: React.FC = () => {
  const { user } = useAuth();
  const [linkedId, setLinkedId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const userSnap = await getDoc(doc(db, 'users', user.uid));
      const id = userSnap.data()?.linkedId as string | undefined;
      if (!id) return;
      setLinkedId(id);
      const driverSnap = await getDoc(doc(db, 'drivers', id));
      const d = driverSnap.data();
      if (d) {
        setName(d.name || '');
        setEmail(d.email || user.email || '');
        setPhone(d.phone || '');
        setPhotoURL(d.photoURL || null);
      }
    })();
  }, [user]);

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !linkedId) return;
    if (!file.type.startsWith('image/')) { toast.error('Please choose an image file'); return; }
    if (file.size > 5 * 1024 * 1024)    { toast.error('Image must be under 5 MB'); return; }

    setUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const storageRef = ref(storage, `driverPhotos/${linkedId}.${ext}`);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const url = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'drivers', linkedId), { photoURL: url });
      setPhotoURL(url);
      toast.success('Photo updated');
    } catch (err) {
      console.error(err);
      toast.error('Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const savePhone = async () => {
    if (!linkedId) return;
    setSavingPhone(true);
    try {
      await updateDoc(doc(db, 'drivers', linkedId), { phone });
      toast.success('Phone saved');
    } catch {
      toast.error('Failed to save phone');
    } finally {
      setSavingPhone(false);
    }
  };

  return (
    <div className="p-5 max-w-md mx-auto">
      <h1 className="text-xl font-bold text-slate-800 mb-4">My Profile</h1>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Photo */}
        <div className="bg-gradient-to-br from-teal-500 to-emerald-500 px-5 py-6 flex flex-col items-center">
          <div className="relative">
            {photoURL ? (
              <img src={photoURL} alt={name}
                className="w-28 h-28 rounded-full object-cover border-4 border-white shadow-lg" />
            ) : (
              <div className="w-28 h-28 rounded-full bg-white/20 border-4 border-white shadow-lg flex items-center justify-center">
                <UserIcon size={48} className="text-white" />
              </div>
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute bottom-0 right-0 bg-white rounded-full p-2.5 shadow-md border border-slate-100 text-teal-600 hover:bg-teal-50 disabled:opacity-60">
              {uploading
                ? <span className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin block" />
                : <Camera size={16} />}
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={handlePhotoSelect} className="hidden" />
          </div>
          <div className="mt-3 text-white font-bold text-lg">{name || 'Driver'}</div>
          <button type="button" onClick={() => fileRef.current?.click()}
            className="text-teal-50 text-xs mt-1 underline hover:text-white">
            {photoURL ? 'Change photo' : 'Add photo'}
          </button>
        </div>

        {/* Info */}
        <div className="p-5 space-y-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">
              <Mail size={12} /> Email
            </div>
            <div className="text-slate-700 text-sm">{email || '—'}</div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">
              <Phone size={12} /> Phone
            </label>
            <div className="flex gap-2">
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="(555) 555-5555"
                className="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={savePhone}
                disabled={savingPhone}
                className="flex items-center gap-1 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 rounded-lg disabled:opacity-60">
                {savingPhone
                  ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Check size={15} />}
                Save
              </button>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400 text-center mt-4">
        Need to update your name or email? Contact an admin.
      </p>
    </div>
  );
};

export default DriverProfile;
