import React, { useEffect, useState, useMemo, useRef } from 'react';
import { collection, onSnapshot, addDoc, deleteDoc, doc, getDoc, updateDoc, serverTimestamp, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, uploadBytesResumable } from 'firebase/storage';
import { db, storage } from '../../services/firebase';
import { useAuth } from '../../context/AuthContext';
import type { Driver, DriverDocument, RouteAssignment, Booking, Client, Student } from '../../types';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Car, Mail, Phone, Plus, X, Check, Link as LinkIcon, MapPin, Clock, Trash2, AlertTriangle, Pencil, Camera, User as UserIcon, FileText, UploadCloud, ExternalLink, Download, Loader2, ShieldAlert, ShieldOff, Send } from 'lucide-react';
import toast from 'react-hot-toast';

interface DriverForm {
  name: string;
  email: string;
  phone: string;
}

function getWeekStart(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/** Returns true if the driver currently has an active, non-expired emergency override. */
function isOverrideActive(d: Driver): boolean {
  const ov = d.emergencyOverride;
  if (!ov || !ov.active) return false;
  const exp = (ov.expiresAt as unknown as { toDate?: () => Date })?.toDate?.();
  if (!exp) return false;
  return exp.getTime() > Date.now();
}

const Drivers: React.FC = () => {
  const { user } = useAuth();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [assignments, setAssignments] = useState<RouteAssignment[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [clients, setClients] = useState<Record<string, Client>>({});
  const [students, setStudents] = useState<Record<string, Student>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<DriverForm>({ name: '', email: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Driver | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [unassigning, setUnassigning] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState<string | null>(null);
  const [confirmDeleteDriver, setConfirmDeleteDriver] = useState<string | null>(null);
  const [deletingDriver, setDeletingDriver] = useState(false);
  const [cleaningOrphans, setCleaningOrphans] = useState(false);

  // Emergency override modal state
  const [overrideTarget, setOverrideTarget] = useState<Driver | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideDays,   setOverrideDays]   = useState(7);
  const [savingOverride, setSavingOverride] = useState(false);

  // Edit driver state
  const [editTarget, setEditTarget]   = useState<Driver | null>(null);
  const [editForm,   setEditForm]     = useState<DriverForm>({ name: '', email: '', phone: '' });
  const [editTab,    setEditTab]      = useState<'info' | 'documents'>('info');
  const [savingEdit, setSavingEdit]   = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [editPhotoURL, setEditPhotoURL] = useState<string | null>(null);
  const editFileRef = useRef<HTMLInputElement>(null);

  // Per-doc upload state for the Documents tab
  type RequiredDocKey = 'driversLicense' | 'insurance' | 'registration' | 'w9';
  const REQUIRED_DOCS: { key: RequiredDocKey; label: string }[] = [
    { key: 'driversLicense', label: "Driver's License" },
    { key: 'insurance',      label: 'Vehicle Insurance Card' },
    { key: 'registration',   label: 'Vehicle Registration' },
    { key: 'w9',             label: 'Signed W-9 Form' },
  ];
  const [docUploading, setDocUploading] = useState<Record<string, boolean>>({});
  const [docProgress,  setDocProgress]  = useState<Record<string, number>>({});
  const docFileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [additionalUploading, setAdditionalUploading] = useState(false);
  const additionalFileRef = useRef<HTMLInputElement>(null);

  // Invite state
  const [sendingInvite, setSendingInvite] = useState<string | null>(null);

  useEffect(() => {
    let count = 0;
    const done = () => { count++; if (count >= 5) setLoading(false); };
    const u1 = onSnapshot(collection(db, 'drivers'), snap => {
      setDrivers(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Driver));
      done();
    });
    const u2 = onSnapshot(collection(db, 'routeAssignments'), snap => {
      setAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() }) as RouteAssignment));
      done();
    });
    const u3 = onSnapshot(collection(db, 'bookings'), snap => {
      setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Booking));
      done();
    });
    const u4 = onSnapshot(collection(db, 'clients'), snap => {
      const map: Record<string, Client> = {};
      snap.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() } as Client; });
      setClients(map);
      done();
    });
    const u5 = onSnapshot(collection(db, 'students'), snap => {
      const map: Record<string, Student> = {};
      snap.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() } as Student; });
      setStudents(map);
      done();
    });
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, []);

  const handleSendInvite = async (driverId: string) => {
    setSendingInvite(driverId);
    try {
      const fn = httpsCallable<{ driverId: string }, { success: boolean }>(
        getFunctions(), 'sendDriverInvite'
      );
      await fn({ driverId });
      toast.success('Invite email sent!');
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? '';
      if (msg.includes('already-exists')) {
        toast.error('This driver already has a linked account.');
      } else if (msg.includes('failed-precondition')) {
        toast.error('Add an email address to this driver first.');
      } else {
        toast.error('Failed to send invite. Please try again.');
      }
    } finally {
      setSendingInvite(null);
    }
  };

  const addDriver = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    await addDoc(collection(db, 'drivers'), { ...form, uid: '', createdAt: serverTimestamp() });
    setForm({ name: '', email: '', phone: '' });
    setShowAdd(false);
    setSaving(false);
  };

  // Set of valid driver IDs — used to detect orphan assignments
  const driverIdSet = useMemo(() => new Set(drivers.map(d => d.id)), [drivers]);

  // Orphan assignments = driverId no longer exists in `drivers` collection
  const orphanAssignments = useMemo(
    () => assignments.filter(a => !driverIdSet.has(a.driverId)),
    [assignments, driverIdSet],
  );

  // bookingId → assignment (only counts assignments with a VALID driver;
  // orphans are ignored so the booking still shows up in Assign Route)
  const assignmentByBooking = useMemo(() => {
    const map: Record<string, RouteAssignment> = {};
    assignments.forEach(a => {
      if (driverIdSet.has(a.driverId)) map[a.bookingId] = a;
    });
    return map;
  }, [assignments, driverIdSet]);

  // Which bookings still have a dangling orphan assignment (cosmetic hint)
  const orphanedBookingIds = useMemo(
    () => new Set(orphanAssignments.map(a => a.bookingId)),
    [orphanAssignments],
  );

  // Active bookings not currently assigned to anyone
  const unassignedActiveBookings = useMemo(() =>
    bookings.filter(b => b.status === 'active' && !assignmentByBooking[b.id]),
    [bookings, assignmentByBooking]
  );

  // Assignments belonging to a specific driver (with resolved booking).
  // Orphan assignments (driver already deleted) are intentionally excluded
  // from the per-driver list below because we resolve by real driver ID.
  const getDriverAssignments = (driverId: string) =>
    assignments
      .filter(a => a.driverId === driverId)
      .map(a => ({ assignment: a, booking: bookings.find(b => b.id === a.bookingId) }));

  const cleanupOrphanAssignments = async () => {
    if (orphanAssignments.length === 0) return;
    setCleaningOrphans(true);
    try {
      for (let i = 0; i < orphanAssignments.length; i += 400) {
        const batch = writeBatch(db);
        orphanAssignments.slice(i, i + 400).forEach(a => batch.delete(doc(db, 'routeAssignments', a.id)));
        await batch.commit();
      }
    } finally {
      setCleaningOrphans(false);
    }
  };

  const assignRoute = async (booking: Booking) => {
    if (!assignTarget) return;
    setAssigning(true);
    try {
      // If this booking has an orphan assignment (driver deleted), remove it
      // first so we don't leave a duplicate/ghost record.
      const stale = orphanAssignments.filter(a => a.bookingId === booking.id);
      if (stale.length > 0) {
        const batch = writeBatch(db);
        stale.forEach(a => batch.delete(doc(db, 'routeAssignments', a.id)));
        await batch.commit();
      }
      await addDoc(collection(db, 'routeAssignments'), {
        driverId: assignTarget.id,
        bookingId: booking.id,
        weekStart: getWeekStart(),
        daysWorked: booking.daysOfWeek,
        weeklyPayout: (booking.weeklyRate || 0) * 0.70,
        status: 'pending',
        paidDate: null,
        createdAt: serverTimestamp(),
      });
    } finally {
      setAssigning(false);
      setAssignTarget(null);
    }
  };

  const unassignRoute = async (assignmentId: string) => {
    setUnassigning(assignmentId);
    await deleteDoc(doc(db, 'routeAssignments', assignmentId));
    setUnassigning(null);
  };

  const reassignRoute = async (assignmentId: string, driverId: string) => {
    setReassigning(assignmentId);
    try {
      await updateDoc(doc(db, 'routeAssignments', assignmentId), { driverId });
    } finally {
      setReassigning(null);
    }
  };

  const openEdit = async (d: Driver) => {
    setEditTarget(d);
    setEditForm({ name: d.name || '', email: d.email || '', phone: d.phone || '' });
    setEditPhotoURL(d.photoURL || null);
    setEditTab('info');
    setDocUploading({});
    setDocProgress({});

    // If the top-level driver doc has no documents yet, check the onboarding
    // subcollection (where DriverOnboarding.tsx stores them) and back-fill.
    if (!d.documents) {
      try {
        const profileSnap = await getDoc(doc(db, 'drivers', d.id, 'onboarding', 'profile'));
        if (profileSnap.exists()) {
          const profileData = profileSnap.data();
          const subDocs = profileData?.documents as Driver['documents'] | undefined;
          if (subDocs) {
            // Write to top-level doc so it appears immediately and on all
            // future opens without needing the subcollection fetch.
            await updateDoc(doc(db, 'drivers', d.id), { documents: subDocs });
            setEditTarget(prev => prev ? { ...prev, documents: subDocs } : prev);
          }
        }
      } catch {
        // Non-fatal — documents tab will just show as missing
      }
    }
  };

  const closeEdit = () => {
    setEditTarget(null);
    setEditForm({ name: '', email: '', phone: '' });
    setEditPhotoURL(null);
    setEditTab('info');
    if (editFileRef.current) editFileRef.current.value = '';
  };

  // Upload a required document from the admin side
  const uploadRequiredDoc = (key: RequiredDocKey, file: File) => {
    if (!editTarget) return;
    const MAX = 10 * 1024 * 1024;
    if (!['application/pdf','image/jpeg','image/png','image/jpg'].includes(file.type)) {
      alert('File must be PDF, JPG, or PNG.'); return;
    }
    if (file.size > MAX) { alert('File must be under 10 MB.'); return; }

    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
    const ts  = Date.now();
    const path = `drivers/${editTarget.id}/onboarding/${key}_${ts}.${ext}`;
    const r    = ref(storage, path);
    const task = uploadBytesResumable(r, file, { contentType: file.type });

    setDocUploading(p => ({ ...p, [key]: true }));
    setDocProgress(p => ({ ...p, [key]: 0 }));

    task.on('state_changed',
      snap => {
        const pct = snap.totalBytes ? (snap.bytesTransferred / snap.totalBytes) * 100 : 0;
        setDocProgress(p => ({ ...p, [key]: pct }));
      },
      err => {
        setDocUploading(p => ({ ...p, [key]: false }));
        alert('Upload failed: ' + err.message);
      },
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        const docValue: DriverDocument = { name: file.name, size: file.size, url, path, uploadedAt: ts, uploadedBy: 'admin' };
        await updateDoc(doc(db, 'drivers', editTarget.id), {
          [`documents.${key}`]: docValue,
        });
        setEditTarget(prev => prev ? {
          ...prev,
          documents: { ...prev.documents, [key]: docValue },
        } : prev);
        setDocUploading(p => ({ ...p, [key]: false }));
        setDocProgress(p => ({ ...p, [key]: 100 }));
      }
    );
  };

  // Upload an additional (non-required) document
  const uploadAdditionalDoc = async (file: File) => {
    if (!editTarget) return;
    const MAX = 10 * 1024 * 1024;
    if (!['application/pdf','image/jpeg','image/png','image/jpg'].includes(file.type)) {
      alert('File must be PDF, JPG, or PNG.'); return;
    }
    if (file.size > MAX) { alert('File must be under 10 MB.'); return; }
    setAdditionalUploading(true);
    try {
      const ext  = file.name.split('.').pop()?.toLowerCase() || 'bin';
      const ts   = Date.now();
      const path = `drivers/${editTarget.id}/additional/${ts}.${ext}`;
      const r    = ref(storage, path);
      await uploadBytes(r, file, { contentType: file.type });
      const url = await getDownloadURL(r);
      const entry: DriverDocument = { name: file.name, size: file.size, url, path, uploadedAt: ts, uploadedBy: 'admin' };
      const updated = [...(editTarget.additionalDocuments || []), entry];
      await updateDoc(doc(db, 'drivers', editTarget.id), { additionalDocuments: updated });
      setEditTarget(prev => prev ? { ...prev, additionalDocuments: updated } : prev);
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    } finally {
      setAdditionalUploading(false);
      if (additionalFileRef.current) additionalFileRef.current.value = '';
    }
  };

  const deleteAdditionalDoc = async (idx: number) => {
    if (!editTarget) return;
    const updated = (editTarget.additionalDocuments || []).filter((_, i) => i !== idx);
    await updateDoc(doc(db, 'drivers', editTarget.id), { additionalDocuments: updated });
    setEditTarget(prev => prev ? { ...prev, additionalDocuments: updated } : prev);
  };

  // ── Emergency override ──────────────────────────────────────────────────
  const openOverrideModal = (d: Driver) => {
    setOverrideTarget(d);
    setOverrideReason('');
    setOverrideDays(7);
  };

  const grantOverride = async () => {
    if (!overrideTarget || !user) return;
    const reason = overrideReason.trim();
    if (!reason) { toast.error('Reason is required'); return; }
    const days = Math.max(1, Math.min(30, Math.floor(overrideDays)));
    setSavingOverride(true);
    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + days);
      const override = {
        active:         true,
        approvedByUid:  user.uid,
        approvedByName: user.email ?? 'admin',
        approvedAt:     serverTimestamp(),
        expiresAt,
        reason,
      };
      await updateDoc(doc(db, 'drivers', overrideTarget.id), { emergencyOverride: override });
      toast.success(`Emergency override granted — expires in ${days} day${days !== 1 ? 's' : ''}`);
      setOverrideTarget(null);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to grant override');
    } finally {
      setSavingOverride(false);
    }
  };

  const revokeOverride = async (driverId: string) => {
    try {
      await updateDoc(doc(db, 'drivers', driverId), { 'emergencyOverride.active': false });
      toast.success('Emergency override revoked');
      if (editTarget?.id === driverId) {
        setEditTarget(prev => prev && prev.emergencyOverride
          ? { ...prev, emergencyOverride: { ...prev.emergencyOverride, active: false } }
          : prev);
      }
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to revoke override');
    }
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setSavingEdit(true);
    try {
      await updateDoc(doc(db, 'drivers', editTarget.id), {
        name:  editForm.name.trim(),
        email: editForm.email.trim(),
        phone: editForm.phone.trim(),
      });
      closeEdit();
    } finally {
      setSavingEdit(false);
    }
  };

  const uploadEditPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editTarget) return;
    if (!file.type.startsWith('image/')) { alert('Please choose an image file'); return; }
    if (file.size > 5 * 1024 * 1024)    { alert('Image must be under 5 MB'); return; }
    setUploadingPhoto(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const storageRef = ref(storage, `driverPhotos/${editTarget.id}.${ext}`);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const url = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'drivers', editTarget.id), { photoURL: url });
      setEditPhotoURL(url);
    } catch (err) {
      console.error(err);
      alert('Upload failed');
    } finally {
      setUploadingPhoto(false);
      if (editFileRef.current) editFileRef.current.value = '';
    }
  };

  const deleteDriver = async (driverId: string) => {
    setDeletingDriver(true);
    try {
      // Cascade: remove every route assignment belonging to this driver,
      // plus their live GPS doc (if any) so parent maps stop showing them.
      const assignSnap = await getDocs(
        query(collection(db, 'routeAssignments'), where('driverId', '==', driverId))
      );
      const refs: ReturnType<typeof doc>[] = [doc(db, 'drivers', driverId)];
      assignSnap.forEach(d => refs.push(d.ref));
      refs.push(doc(db, 'driverLocations', driverId));

      for (let i = 0; i < refs.length; i += 400) {
        const batch = writeBatch(db);
        refs.slice(i, i + 400).forEach(r => batch.delete(r));
        await batch.commit();
      }
    } finally {
      setDeletingDriver(false);
      setConfirmDeleteDriver(null);
    }
  };

  return (
    <div>
      <div className="bg-gradient-to-r from-teal-600 to-emerald-600 px-8 py-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Drivers</h1>
          <p className="text-teal-100 text-sm">Driver roster ({drivers.length})</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-white/20 hover:bg-white/30 text-white rounded-xl px-4 py-2 text-sm font-semibold transition-colors"
        >
          <Plus size={16} />
          Add Driver
        </button>
      </div>

      <div className="p-8">
        {/* Orphan-assignment cleanup banner */}
        {orphanAssignments.length > 0 && !loading && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
            <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-amber-900">
                {orphanAssignments.length} orphan route assignment{orphanAssignments.length === 1 ? '' : 's'} found
              </div>
              <div className="text-xs text-amber-800 mt-0.5">
                These assignments point to a driver that no longer exists, which was hiding the affected bookings from the Assign Route list. Clean them up to make those routes assignable again.
              </div>
            </div>
            <button
              onClick={cleanupOrphanAssignments}
              disabled={cleaningOrphans}
              className="rounded-lg bg-amber-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-amber-700 transition-colors disabled:opacity-60"
            >
              {cleaningOrphans ? 'Cleaning…' : 'Clean up'}
            </button>
          </div>
        )}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 animate-pulse">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-slate-200 rounded-full" />
                  <div className="h-4 bg-slate-200 rounded w-32" />
                </div>
                <div className="h-3 bg-slate-200 rounded w-2/3 mb-2" />
                <div className="h-3 bg-slate-200 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : drivers.length === 0 ? (
          <div className="text-center py-24">
            <Car size={48} className="mx-auto text-slate-300 mb-4" />
            <p className="text-slate-600 font-semibold">No drivers yet</p>
            <button
              onClick={() => setShowAdd(true)}
              className="mt-4 bg-teal-600 text-white rounded-xl px-5 py-2 text-sm font-semibold hover:bg-teal-700 transition-colors"
            >
              Add First Driver
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {drivers.map(d => {
              const driverAssignments = getDriverAssignments(d.id);
              return (
                <div key={d.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  {/* Driver header */}
                  <div className="p-5 pb-3">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {d.photoURL ? (
                          <img
                            src={d.photoURL}
                            alt={d.name}
                            className="w-12 h-12 rounded-full object-cover border-2 border-slate-100 shrink-0"
                          />
                        ) : (
                          <div className="w-12 h-12 bg-teal-100 rounded-full flex items-center justify-center text-teal-700 font-bold shrink-0">
                            {d.name?.charAt(0)?.toUpperCase() || '?'}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-800 truncate">{d.name}</div>
                          <div className="text-xs text-slate-500">
                            {driverAssignments.length} route{driverAssignments.length !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isOverrideActive(d) && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 inline-flex items-center gap-1" title="Emergency override active">
                            <ShieldAlert size={11} /> Emergency
                          </span>
                        )}
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${d.uid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {d.uid ? 'Linked' : 'No account'}
                        </span>
                        <button
                          onClick={() => openEdit(d)}
                          title="Edit driver"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <Mail size={11} /> {d.email || '—'}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <Phone size={11} /> {d.phone || '—'}
                      </div>
                    </div>
                  </div>

                  {/* Assigned routes */}
                  {driverAssignments.length > 0 && (
                    <div className="border-t border-slate-100 divide-y divide-slate-50">
                      {driverAssignments.map(({ assignment, booking }) => {
                        const client = booking ? clients[booking.clientId] : null;
                        const studentNames = booking
                          ? booking.studentIds.map(sid => students[sid]?.name).filter(Boolean).join(', ')
                          : '';
                        return (
                          <div key={assignment.id} className="px-5 py-3 flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-slate-700 truncate">
                                {client?.name || 'Unknown client'}
                              </div>
                              {studentNames && (
                                <div className="text-xs text-slate-400 truncate">{studentNames}</div>
                              )}
                              <div className="flex items-center gap-3 mt-1">
                                <span className="flex items-center gap-1 text-xs text-slate-400">
                                  <MapPin size={10} />
                                  {booking?.pickupAddress?.split(',')[0] || '—'}
                                </span>
                                <span className="flex items-center gap-1 text-xs text-slate-400">
                                  <Clock size={10} />
                                  {booking?.daysOfWeek?.map(d => d.slice(0,2)).join(', ') || '—'}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <select
                                value={assignment.driverId}
                                onChange={(e) => {
                                  const nextDriverId = e.target.value;
                                  if (!nextDriverId || nextDriverId === assignment.driverId) return;
                                  reassignRoute(assignment.id, nextDriverId);
                                }}
                                disabled={reassigning === assignment.id}
                                className="text-xs border border-slate-200 rounded-lg px-2 py-1 text-slate-600 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60"
                                title="Move route to another driver"
                              >
                                {drivers.map(driver => (
                                  <option key={driver.id} value={driver.id}>{driver.name || 'Unnamed driver'}</option>
                                ))}
                              </select>
                              <span className="text-xs font-bold text-emerald-600">
                                ${(assignment.weeklyPayout || 0).toFixed(0)}/wk
                              </span>
                              <button
                                onClick={() => unassignRoute(assignment.id)}
                                disabled={unassigning === assignment.id || reassigning === assignment.id}
                                title="Remove assignment"
                                className="p-1 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors disabled:opacity-40"
                              >
                                {unassigning === assignment.id
                                  ? <div className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
                                  : <X size={14} />}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Assign button + Delete */}
                  <div className="px-5 py-3 border-t border-slate-100 space-y-2">
                    <p className="text-[11px] text-slate-400">Tip: use the driver dropdown on a route to move it instantly.</p>
                    {confirmDeleteDriver === d.id ? (
                      <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                        <p className="text-xs font-semibold text-red-700 mb-2">Delete {d.name}? This will also remove all of their route assignments and live GPS entry.</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => deleteDriver(d.id)}
                            disabled={deletingDriver}
                            className="flex items-center gap-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60 transition-colors"
                          >
                            {deletingDriver
                              ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                              : <Trash2 size={11} />}
                            {deletingDriver ? 'Deleting…' : 'Yes, delete'}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteDriver(null)}
                            className="text-xs px-3 py-1.5 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => setAssignTarget(d)}
                          className="flex-1 flex items-center justify-center gap-2 border border-teal-300 text-teal-700 hover:bg-teal-50 rounded-xl py-2 text-xs font-semibold transition-colors"
                        >
                          <LinkIcon size={13} />
                          Assign Route
                        </button>
                        {!d.uid && (
                          <button
                            onClick={() => handleSendInvite(d.id)}
                            disabled={sendingInvite === d.id}
                            title="Send account invite to driver"
                            className="flex items-center gap-1.5 border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 rounded-xl px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-60"
                          >
                            {sendingInvite === d.id
                              ? <div className="w-3 h-3 border border-teal-600 border-t-transparent rounded-full animate-spin" />
                              : <Send size={12} />}
                            {sendingInvite === d.id ? 'Sending…' : 'Invite'}
                          </button>
                        )}
                        <button
                          onClick={() => setConfirmDeleteDriver(d.id)}
                          className="p-2 border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 rounded-xl transition-colors"
                          title="Delete driver"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Driver Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowAdd(false)} />
          <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-slate-800">Add New Driver</h3>
              <button onClick={() => setShowAdd(false)} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div className="space-y-3">
              {[
                { label: 'Full Name', key: 'name', type: 'text', placeholder: 'John Smith' },
                { label: 'Email', key: 'email', type: 'email', placeholder: 'john@example.com' },
                { label: 'Phone', key: 'phone', type: 'tel', placeholder: '(314) 555-0000' },
              ].map(({ label, key, type, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
                  <input
                    type={type}
                    placeholder={placeholder}
                    value={form[key as keyof DriverForm]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                  />
                </div>
              ))}
            </div>
            <button
              onClick={addDriver}
              disabled={saving || !form.name.trim()}
              className="mt-5 w-full bg-teal-600 hover:bg-teal-700 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
            >
              {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
              {saving ? 'Adding…' : 'Add Driver'}
            </button>
          </div>
        </div>
      )}

      {/* Assign Route Modal */}
      {assignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setAssignTarget(null)} />
          <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Assign Route</h3>
                <p className="text-sm text-slate-500">to {assignTarget.name}</p>
              </div>
              <button onClick={() => setAssignTarget(null)} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              {unassignedActiveBookings.length === 0 ? (
                <div className="text-center py-10">
                  <Check size={36} className="mx-auto text-emerald-400 mb-3" />
                  <p className="text-slate-500 text-sm font-medium">All active routes are assigned.</p>
                  <p className="text-slate-400 text-xs mt-1">Unassign a route from another driver to move it here.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {unassignedActiveBookings.map(b => {
                    const client = clients[b.clientId];
                    const studentNames = b.studentIds
                      .map(sid => students[sid]?.name).filter(Boolean).join(', ');
                    const hadOrphan = orphanedBookingIds.has(b.id);
                    return (
                      <button
                        key={b.id}
                        onClick={() => assignRoute(b)}
                        disabled={assigning}
                        className="w-full text-left bg-slate-50 hover:bg-teal-50 border border-slate-200 hover:border-teal-300 rounded-xl p-3.5 transition-colors disabled:opacity-60"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-slate-800">
                              {client?.name || 'Unknown client'}
                            </div>
                            {hadOrphan && (
                              <div className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                                <AlertTriangle size={9} /> Was orphaned · will replace ghost
                              </div>
                            )}
                            {studentNames && (
                              <div className="text-xs text-slate-500 mt-0.5 truncate">{studentNames}</div>
                            )}
                            <div className="flex items-center gap-1 mt-1.5 text-xs text-slate-400">
                              <MapPin size={10} />
                              <span className="truncate">{b.pickupAddress || '—'}</span>
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {(b.daysOfWeek || []).map(day => (
                                <span key={day} className="text-xs bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded font-medium">
                                  {day.slice(0, 2)}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold text-emerald-600">${(b.weeklyRate || 0).toFixed(0)}/wk</div>
                            <div className="text-xs text-slate-400">Driver: ${((b.weeklyRate || 0) * 0.75).toFixed(0)}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Edit Driver Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeEdit} />
          <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800">{editTarget.name || 'Edit Driver'}</h3>
              <button onClick={closeEdit} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-100 px-6">
              {(['info', 'documents'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setEditTab(t)}
                  className={`py-3 px-4 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                    editTab === t
                      ? 'border-teal-500 text-teal-700'
                      : 'border-transparent text-slate-400 hover:text-slate-700'
                  }`}
                >
                  {t === 'info' ? 'Info' : 'Documents'}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto flex-1 p-6">
              {/* ── INFO TAB ─────────────────────────────────────────────── */}
              {editTab === 'info' && (
                <>
                  {/* Photo */}
                  <div className="flex flex-col items-center mb-5">
                    <div className="relative">
                      {editPhotoURL ? (
                        <img
                          src={editPhotoURL}
                          alt={editForm.name}
                          className="w-28 h-28 rounded-full object-cover border-4 border-white shadow-lg ring-2 ring-teal-100"
                        />
                      ) : (
                        <div className="w-28 h-28 rounded-full bg-slate-200 border-4 border-white shadow-lg ring-2 ring-teal-100 flex items-center justify-center text-slate-400">
                          <UserIcon size={44} />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => editFileRef.current?.click()}
                        disabled={uploadingPhoto}
                        className="absolute bottom-0 right-0 bg-teal-600 hover:bg-teal-700 text-white rounded-full p-2 shadow-md border-2 border-white disabled:opacity-60"
                        title="Upload photo"
                      >
                        {uploadingPhoto
                          ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          : <Camera size={14} />}
                      </button>
                      <input ref={editFileRef} type="file" accept="image/*" onChange={uploadEditPhoto} className="hidden" />
                    </div>
                    <button type="button" onClick={() => editFileRef.current?.click()} className="text-xs text-teal-600 hover:text-teal-700 font-semibold mt-2">
                      {editPhotoURL ? 'Change photo' : 'Upload photo'}
                    </button>
                  </div>

                  {/* Fields */}
                  <div className="space-y-3">
                    {([
                      { label: 'Full Name', key: 'name',  type: 'text',  placeholder: 'John Smith' },
                      { label: 'Email',     key: 'email', type: 'email', placeholder: 'john@example.com' },
                      { label: 'Phone',     key: 'phone', type: 'tel',   placeholder: '(314) 555-0000' },
                    ] as const).map(({ label, key, type, placeholder }) => (
                      <div key={key}>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
                        <input
                          type={type}
                          placeholder={placeholder}
                          value={editForm[key as keyof DriverForm]}
                          onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                        />
                      </div>
                    ))}
                  </div>

                  {editTarget.uid && editForm.email.trim().toLowerCase() !== (editTarget.email || '').toLowerCase() && (
                    <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
                      <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                      <span>This driver has a linked login. Changing the email here won't change their sign-in email — they'll still log in with <b>{editTarget.email}</b>.</span>
                    </div>
                  )}

                  <div className="flex gap-2 mt-5">
                    <button onClick={closeEdit} className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl py-2.5 text-sm font-semibold transition-colors">Cancel</button>
                    <button
                      onClick={saveEdit}
                      disabled={savingEdit || !editForm.name.trim()}
                      className="flex-1 bg-teal-600 hover:bg-teal-700 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
                    >
                      {savingEdit && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {savingEdit ? 'Saving…' : 'Save Changes'}
                    </button>
                  </div>
                </>
              )}

              {/* ── DOCUMENTS TAB ─────────────────────────────────────────── */}
              {editTab === 'documents' && (
                <div className="space-y-4">
                  {/* Emergency override panel */}
                  <div className={`rounded-xl border p-4 ${isOverrideActive(editTarget) ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex items-start gap-3">
                      <ShieldAlert size={18} className={isOverrideActive(editTarget) ? 'text-amber-600 mt-0.5' : 'text-slate-400 mt-0.5'} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-800">Emergency Override</div>
                        {isOverrideActive(editTarget) && editTarget.emergencyOverride ? (
                          <>
                            <div className="text-xs text-slate-600 mt-1">
                              Active — driver may operate without complete documents.
                            </div>
                            <div className="text-xs text-slate-500 mt-2 space-y-0.5">
                              <div><span className="font-semibold">Approved by:</span> {editTarget.emergencyOverride.approvedByName}</div>
                              <div><span className="font-semibold">Expires:</span> {(editTarget.emergencyOverride.expiresAt as unknown as { toDate?: () => Date })?.toDate?.()?.toLocaleString() ?? '—'}</div>
                              <div><span className="font-semibold">Reason:</span> {editTarget.emergencyOverride.reason}</div>
                            </div>
                            <button
                              onClick={() => revokeOverride(editTarget.id)}
                              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold bg-white border border-amber-300 text-amber-700 hover:bg-amber-100 rounded-lg px-3 py-1.5 transition-colors"
                            >
                              <ShieldOff size={12} /> End Override
                            </button>
                          </>
                        ) : (
                          <>
                            <div className="text-xs text-slate-500 mt-1">
                              One-click authorization for a driver to start work before all required documents are uploaded. Time-limited and auditable.
                            </div>
                            <button
                              onClick={() => openOverrideModal(editTarget)}
                              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg px-3 py-1.5 transition-colors"
                            >
                              <ShieldAlert size={12} /> Emergency Start
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Required documents */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Required Documents</p>
                    <div className="space-y-3">
                      {REQUIRED_DOCS.map(({ key, label }) => {
                        const existing = editTarget.documents?.[key];
                        const uploading = !!docUploading[key];
                        const progress  = docProgress[key] ?? 0;
                        return (
                          <div key={key} className="border border-slate-200 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-semibold text-slate-700">{label}</span>
                              {existing ? (
                                <span className="text-xs bg-emerald-100 text-emerald-700 font-medium px-2 py-0.5 rounded-full">Uploaded</span>
                              ) : (
                                <span className="text-xs bg-slate-100 text-slate-500 font-medium px-2 py-0.5 rounded-full">Missing</span>
                              )}
                            </div>

                            {existing && (
                              <div className="flex items-center gap-2 text-xs text-slate-500 mb-3 bg-slate-50 rounded-lg px-3 py-2">
                                <FileText size={12} className="shrink-0" />
                                <span className="truncate flex-1">{existing.name}</span>
                                <span className="shrink-0">{(existing.size / 1024).toFixed(0)} KB</span>
                                {existing.uploadedBy === 'admin' && (
                                  <span className="text-xs text-teal-600 font-medium shrink-0">Admin</span>
                                )}
                                <a href={existing.url} target="_blank" rel="noopener noreferrer" title="View" className="shrink-0 text-violet-500 hover:text-violet-700">
                                  <ExternalLink size={13} />
                                </a>
                                <a href={existing.url} download={existing.name} title="Download" className="shrink-0 text-teal-600 hover:text-teal-800">
                                  <Download size={13} />
                                </a>
                              </div>
                            )}

                            {uploading && (
                              <div className="mb-3">
                                <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                                  <span>Uploading…</span><span>{Math.round(progress)}%</span>
                                </div>
                                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
                                </div>
                              </div>
                            )}

                            <input
                              ref={el => { docFileRefs.current[key] = el; }}
                              type="file"
                              accept="application/pdf,image/jpeg,image/png"
                              className="hidden"
                              onChange={e => {
                                const f = e.target.files?.[0];
                                if (f) uploadRequiredDoc(key, f);
                                e.target.value = '';
                              }}
                            />
                            <button
                              onClick={() => docFileRefs.current[key]?.click()}
                              disabled={uploading}
                              className="w-full flex items-center justify-center gap-2 border border-dashed border-slate-300 hover:border-teal-400 hover:bg-teal-50 text-slate-500 hover:text-teal-700 rounded-lg py-2 text-xs font-semibold transition-colors disabled:opacity-50"
                            >
                              <UploadCloud size={13} />
                              {existing ? 'Replace' : 'Upload'} (PDF / JPG / PNG, max 10 MB)
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Additional documents */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Additional Documents</p>
                    {(editTarget.additionalDocuments || []).length === 0 && (
                      <p className="text-xs text-slate-400 mb-3">No additional documents uploaded yet.</p>
                    )}
                    <div className="space-y-2 mb-3">
                      {(editTarget.additionalDocuments || []).map((d, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                          <FileText size={12} className="shrink-0 text-slate-400" />
                          <span className="flex-1 truncate">{d.name}</span>
                          <span className="shrink-0 text-slate-400">{(d.size / 1024).toFixed(0)} KB</span>
                          <a href={d.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-violet-500 hover:text-violet-700" title="View">
                            <ExternalLink size={13} />
                          </a>
                          <a href={d.url} download={d.name} className="shrink-0 text-teal-600 hover:text-teal-800" title="Download">
                            <Download size={13} />
                          </a>
                          <button onClick={() => deleteAdditionalDoc(i)} className="shrink-0 text-slate-300 hover:text-red-400 transition-colors" title="Remove">
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <input
                      ref={additionalFileRef}
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) uploadAdditionalDoc(f);
                      }}
                    />
                    <button
                      onClick={() => additionalFileRef.current?.click()}
                      disabled={additionalUploading}
                      className="w-full flex items-center justify-center gap-2 border border-dashed border-slate-300 hover:border-teal-400 hover:bg-teal-50 text-slate-500 hover:text-teal-700 rounded-lg py-2 text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      {additionalUploading
                        ? <><Loader2 size={13} className="animate-spin" /> Uploading…</>
                        : <><UploadCloud size={13} /> Upload Additional Document</>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── EMERGENCY OVERRIDE MODAL ────────────────────────────────────── */}
      {overrideTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !savingOverride && setOverrideTarget(null)} />
          <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                <ShieldAlert size={20} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-slate-800">Grant Emergency Override</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Allow <span className="font-semibold">{overrideTarget.name}</span> to work before all required documents are uploaded. This action is logged.
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Reason (required)</label>
                <textarea
                  value={overrideReason}
                  onChange={e => setOverrideReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. Urgent coverage needed; insurance renewal in progress, will upload by Friday"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Expires in</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={overrideDays}
                    onChange={e => setOverrideDays(Number(e.target.value))}
                    className="w-20 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <span className="text-sm text-slate-600">day{overrideDays !== 1 ? 's' : ''} from now</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Override auto-expires. Max 30 days.</p>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setOverrideTarget(null)}
                disabled={savingOverride}
                className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl py-2.5 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={grantOverride}
                disabled={savingOverride || !overrideReason.trim()}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white rounded-xl py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
              >
                {savingOverride ? <><Loader2 size={14} className="animate-spin" /> Granting…</> : <><ShieldAlert size={14} /> Grant Override</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Drivers;
