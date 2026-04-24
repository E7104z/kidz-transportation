import React, { useEffect, useState, useCallback } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  getDocs,
  writeBatch,
  serverTimestamp,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { format } from 'date-fns';
import {
  Users,
  Search,
  Plus,
  X,
  Check,
  Edit2,
  GraduationCap,
  FileText,
  Loader2,
  ExternalLink,
  Trash2,
  AlertTriangle,
  Mail,
  UserPlus,
  Shield,
  RefreshCw,
  MessageSquare,
  Eye,
  Download,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { db } from '../../services/firebase';
import { computeWeeklyCharge } from '../../utils/pricing';
import { getMileage } from '../../services/mileageService';
import { generateAndSaveContract, queueContractEmail } from '../../services/contractService';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import CommsLog from '../../components/CommsLog';
import { useImpersonation } from '../../context/ImpersonationContext';
import { exportToCSV } from '../../utils/csvExport';
import type { Client, Student, Booking, Contract, ClientAccess, ContactRole, ContactPermissions, TransportationPurpose } from '../../types';
import { DEFAULT_PERMISSIONS } from '../../types';
import { getFunctions, httpsCallable } from 'firebase/functions';

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  under_review: 'bg-amber-100 text-amber-700',
  contract_sent: 'bg-purple-100 text-purple-700',
  active: 'bg-green-100 text-green-700',
  paused: 'bg-gray-100 text-gray-500',
  completed: 'bg-gray-100 text-gray-500',
};
const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  under_review: 'Under Review',
  contract_sent: 'Contract Sent',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
};
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TRANSPORT_OPTIONS = [
  { value: 'roundtrip', label: 'Round Trip' },
  { value: 'am_only', label: 'AM Only' },
  { value: 'pm_only', label: 'PM Only' },
  { value: 'midday', label: 'Midday' },
];
const PURPOSE_OPTIONS: TransportationPurpose[] = ['School', 'Daycare', 'Afterschool', 'Summer Program', 'Other'];

const inputCls = 'w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 transition';
const labelCls = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1';

/** Convert a Firestore Timestamp, Date, or ISO string to a YYYY-MM-DD string for <input type="date"> */
const toDateStr = (raw: any): string => {
  if (!raw) return '';
  if (typeof raw?.toDate === 'function') return raw.toDate().toISOString().split('T')[0];
  if (raw instanceof Date) return raw.toISOString().split('T')[0];
  if (typeof raw === 'string') return raw.substring(0, 10);
  return '';
};

interface StudentDraft {
  name: string; dob: string; grade: string; schoolName: string;
  schoolContact: string; allergies: string; medicalNotes: string;
  specialRequirements: string;
}
const blankStudent = (): StudentDraft => ({ name: '', dob: '', grade: '', schoolName: '', schoolContact: '', allergies: '', medicalNotes: '', specialRequirements: '' });

interface AddClientModalProps { onClose: () => void; }

const AddClientModal: React.FC<AddClientModalProps> = ({ onClose }) => {
  const [parentName, setParentName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [homeAddress, setHomeAddress] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [emergencyContactRelationship, setEmergencyContactRelationship] = useState('');
  const [transportationPurpose, setTransportationPurpose] = useState<TransportationPurpose>('School');
  const [pickupAddress, setPickupAddress] = useState('');
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [transportationType, setTransportationType] = useState('roundtrip');
  const [daysOfWeek, setDaysOfWeek] = useState<string[]>([]);
  const [schoolStartTime, setSchoolStartTime] = useState('');
  const [schoolEndTime, setSchoolEndTime] = useState('');
  const [serviceStartDate, setServiceStartDate] = useState('');
  const [students, setStudents] = useState<StudentDraft[]>([blankStudent()]);
  const [mileage, setMileage] = useState(0);
  const [fetchingMileage, setFetchingMileage] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const pricing = computeWeeklyCharge(mileage, daysOfWeek.length, transportationType === 'roundtrip', students.length);

  const tryFetchMileage = useCallback(async (pickup: string, dropoff: string) => {
    if (!pickup || !dropoff) return;
    setFetchingMileage(true);
    const m = await getMileage(pickup, dropoff);
    if (m !== null) setMileage(m);
    setFetchingMileage(false);
  }, []);

  const toggleDay = (d: string) => setDaysOfWeek(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  const updateStudent = (i: number, field: keyof StudentDraft, val: string) =>
    setStudents(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s));

  const handleSubmit = async () => {
    if (!parentName.trim() || !email.trim()) { toast.error('Parent name and email are required'); return; }
    if (students.some(s => !s.name.trim())) { toast.error('Each student must have a name'); return; }
    if (!emergencyContact.trim() || !emergencyPhone.trim() || !emergencyContactRelationship.trim()) {
      toast.error('Emergency contact name, phone, and relationship are required'); return;
    }
    if (!transportationPurpose) { toast.error('Transportation purpose is required'); return; }
    setSubmitting(true);
    try {
      const trimmedEmail = email.trim().toLowerCase();
      // Deduplicate: reuse existing client if one exists with this email
      const existingClientSnap = await getDocs(query(collection(db, 'clients'), where('email', '==', trimmedEmail)));
      let clientId: string;
      if (!existingClientSnap.empty) {
        clientId = existingClientSnap.docs[0].id;
      } else {
        const clientRef = await addDoc(collection(db, 'clients'), {
          name: parentName.trim(), email: trimmedEmail, phone: phone.trim(),
          address: homeAddress.trim(), createdAt: serverTimestamp(),
        });
        clientId = clientRef.id;
      }
      const studentIds: string[] = [];
      for (const s of students) {
        const sRef = await addDoc(collection(db, 'students'), {
          clientId, name: s.name.trim(), dob: s.dob, age: 0, grade: s.grade,
          schoolName: s.schoolName, schoolContact: s.schoolContact, allergies: s.allergies,
          medicalNotes: s.medicalNotes, specialRequirements: s.specialRequirements, phone: '',
        });
        studentIds.push(sRef.id);
      }
      await addDoc(collection(db, 'bookings'), {
        clientId, studentIds, pickupAddress: pickupAddress.trim(),
        dropoffAddress: dropoffAddress.trim(), transportationType, daysOfWeek,
        transportationPurpose,
        schoolStartTime, schoolEndTime,
        serviceStartDate: serviceStartDate ? new Date(serviceStartDate) : null,
        mileage, weeklyRate: pricing.weekly, dailyRate: pricing.daily, status: 'new',
        applicationFeePaid: false, emergencyContact: emergencyContact.trim(),
        emergencyPhone: emergencyPhone.trim(),
        emergencyContactRelationship: emergencyContactRelationship.trim(),
        notes: '',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });

      // Parent account provisioning is handled automatically by the
      // provisionParentAccount Cloud Function (fires on clients onCreate).
      // A password reset email is sent to the parent automatically.

      toast.success(`${parentName} added successfully — parent portal account will be provisioned automatically.`);
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to add client');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-slate-800">Add New Client</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} className="text-slate-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <section>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Parent / Guardian</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1"><label className={labelCls}>Full Name *</label><input className={inputCls} value={parentName} onChange={e => setParentName(e.target.value)} placeholder="Jane Smith" /></div>
              <div className="col-span-2 sm:col-span-1"><label className={labelCls}>Email *</label><input className={inputCls} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@email.com" /></div>
              <div><label className={labelCls}>Phone</label><input className={inputCls} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(314) 000-0000" /></div>
              <div><label className={labelCls}>Home Address</label><AddressAutocomplete value={homeAddress} onChange={setHomeAddress} placeholder="Start typing..." className={inputCls} /></div>
              <div><label className={labelCls}>Emergency Contact *</label><input className={inputCls} value={emergencyContact} onChange={e => setEmergencyContact(e.target.value)} /></div>
              <div><label className={labelCls}>Emergency Phone *</label><input className={inputCls} type="tel" value={emergencyPhone} onChange={e => setEmergencyPhone(e.target.value)} /></div>
              <div><label className={labelCls}>Relationship to Student *</label><input className={inputCls} value={emergencyContactRelationship} onChange={e => setEmergencyContactRelationship(e.target.value)} placeholder="e.g. Aunt, Grandparent" /></div>
              <div><label className={labelCls}>Purpose of Transportation *</label><select className={inputCls} value={transportationPurpose} onChange={e => setTransportationPurpose(e.target.value as TransportationPurpose)}>{PURPOSE_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
            </div>
          </section>
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Students</h3>
              <button type="button" onClick={() => setStudents(prev => [...prev, blankStudent()])} className="inline-flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-semibold"><Plus size={13} /> Add sibling</button>
            </div>
            <div className="space-y-4">
              {students.map((s, i) => (
                <div key={i} className="bg-slate-50 rounded-xl p-4 relative">
                  {students.length > 1 && (
                    <button type="button" onClick={() => setStudents(prev => prev.filter((_, idx) => idx !== i))} className="absolute top-3 right-3 p-1 hover:bg-slate-200 rounded-lg transition-colors"><X size={13} className="text-slate-400" /></button>
                  )}
                  <div className="text-xs font-semibold text-slate-500 mb-2">Student {i + 1}</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={labelCls}>Name *</label><input className={inputCls} value={s.name} onChange={e => updateStudent(i, 'name', e.target.value)} /></div>
                    <div><label className={labelCls}>Date of Birth</label><input className={inputCls} type="date" value={s.dob} onChange={e => updateStudent(i, 'dob', e.target.value)} /></div>
                    <div><label className={labelCls}>Grade</label><input className={inputCls} value={s.grade} onChange={e => updateStudent(i, 'grade', e.target.value)} placeholder="e.g. 3rd" /></div>
                    <div><label className={labelCls}>School Name</label><input className={inputCls} value={s.schoolName} onChange={e => updateStudent(i, 'schoolName', e.target.value)} /></div>
                    <div><label className={labelCls}>School Contact</label><input className={inputCls} value={s.schoolContact} onChange={e => updateStudent(i, 'schoolContact', e.target.value)} /></div>
                    <div><label className={labelCls}>Allergies</label><input className={inputCls} value={s.allergies} onChange={e => updateStudent(i, 'allergies', e.target.value)} /></div>
                    <div className="col-span-2"><label className={labelCls}>Medical Conditions / Notes</label><textarea className={inputCls} rows={2} value={s.medicalNotes} onChange={e => updateStudent(i, 'medicalNotes', e.target.value)} placeholder="Asthma, EpiPen, daily medication, etc." /></div>
                    <div className="col-span-2"><label className={labelCls}>Special Requirements / Instructions</label><textarea className={inputCls} rows={2} value={s.specialRequirements} onChange={e => updateStudent(i, 'specialRequirements', e.target.value)} placeholder="Booster seat, wheelchair, behavioral notes, etc." /></div>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Route &amp; Schedule</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className={labelCls}>Pickup Address</label><AddressAutocomplete value={pickupAddress} onChange={setPickupAddress} onSelect={v => { if (dropoffAddress) tryFetchMileage(v, dropoffAddress); }} placeholder="Start typing..." className={inputCls} /></div>
              <div className="col-span-2"><label className={labelCls}>Dropoff Address</label><AddressAutocomplete value={dropoffAddress} onChange={setDropoffAddress} onSelect={v => { if (pickupAddress) tryFetchMileage(pickupAddress, v); }} placeholder="Start typing..." className={inputCls} /></div>
              <div><label className={labelCls}>Transportation Type</label><select className={inputCls} value={transportationType} onChange={e => setTransportationType(e.target.value)}>{TRANSPORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              <div><label className={labelCls}>Mileage {fetchingMileage && <span className="text-violet-400">(auto-fetching...)</span>}</label><input type="number" step="0.1" className={inputCls} value={mileage} onChange={e => setMileage(Number(e.target.value))} /></div>
              <div><label className={labelCls}>School Start Time</label><input type="time" className={inputCls} value={schoolStartTime} onChange={e => setSchoolStartTime(e.target.value)} /></div>
              <div><label className={labelCls}>School End Time</label><input type="time" className={inputCls} value={schoolEndTime} onChange={e => setSchoolEndTime(e.target.value)} /></div>
              <div><label className={labelCls}>Service Start Date</label><input type="date" className={inputCls} value={serviceStartDate} onChange={e => setServiceStartDate(e.target.value)} /></div>
              <div className="col-span-2">
                <label className={labelCls}>Days of Service</label>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map(d => (
                    <button key={d} type="button" onClick={() => toggleDay(d)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${daysOfWeek.includes(d) ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'}`}>{d.slice(0, 3)}</button>
                  ))}
                </div>
              </div>
            </div>
          </section>
          {(mileage > 0 || daysOfWeek.length > 0) && (
            <section>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Pricing Preview</h3>
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 grid grid-cols-2 gap-4">
                <div><div className="text-2xl font-bold text-slate-800">${pricing.weekly.toFixed(2)}</div><div className="text-xs text-slate-500">Weekly Rate</div></div>
                <div><div className="text-2xl font-bold text-slate-800">${pricing.daily.toFixed(2)}</div><div className="text-xs text-slate-500">Daily Rate</div></div>
              </div>
            </section>
          )}
        </div>
        <div className="px-6 py-4 border-t flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">Cancel</button>
          <button onClick={handleSubmit} disabled={submitting} className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60">
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {submitting ? 'Saving...' : 'Add Client'}
          </button>
        </div>
      </div>
    </div>
  );
};

type TabId = 'overview' | 'booking' | 'contract' | 'contacts' | 'comms';

interface ClientDetailPanelProps {
  client: Client; students: Student[]; booking: Booking | null;
  onClose: () => void;
  onDeleted: () => void;
}

const ClientDetailPanel: React.FC<ClientDetailPanelProps> = ({ client, students, booking, onClose, onDeleted }) => {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [latestContract, setLatestContract] = useState<Contract | null>(null);
  const [generatingContract, setGeneratingContract] = useState(false);
  const [editingClient, setEditingClient] = useState(false);
  const [clientForm, setClientForm] = useState({ name: client.name, email: client.email, phone: client.phone, address: client.address });
  const [savingClient, setSavingClient] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [studentForm, setStudentForm] = useState<Partial<Student>>({});
  const [savingStudent, setSavingStudent] = useState(false);
  const [editingBooking, setEditingBooking] = useState(false);
  const [bookingForm, setBookingForm] = useState<Partial<Booking>>(booking ?? {});
  const [savingBooking, setSavingBooking] = useState(false);
  const [fetchingMileage, setFetchingMileage] = useState(false);
  const [addingStudent, setAddingStudent] = useState(false);
  const [newStudent, setNewStudent] = useState<StudentDraft>(blankStudent());
  const [savingNewStudent, setSavingNewStudent] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [togglingFee, setTogglingFee] = useState(false);
  const [savingStartDate, setSavingStartDate] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'contracts'), where('clientId', '==', client.id), orderBy('generatedAt', 'desc'));
    return onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Contract);
      setContracts(list);
      setLatestContract(list[0] ?? null);
    });
  }, [client.id]);

  const bk = editingBooking ? bookingForm : booking;
  const daysCount = bk?.daysOfWeek?.length ?? 0;
  const isRoundTrip = bk?.transportationType === 'roundtrip';
  const pricing = computeWeeklyCharge(bk?.mileage ?? 0, daysCount, isRoundTrip, students.length || 1);

  const saveClient = async () => {
    setSavingClient(true);
    try { await updateDoc(doc(db, 'clients', client.id), { ...clientForm }); toast.success('Client updated'); setEditingClient(false); }
    catch { toast.error('Failed to save'); } finally { setSavingClient(false); }
  };

  const startEditStudent = (s: Student) => { setEditingStudentId(s.id); setStudentForm({ ...s }); };

  const saveStudent = async () => {
    if (!editingStudentId) return;
    setSavingStudent(true);
    try { await updateDoc(doc(db, 'students', editingStudentId), { ...studentForm }); toast.success('Student updated'); setEditingStudentId(null); }
    catch { toast.error('Failed to save'); } finally { setSavingStudent(false); }
  };

  const saveNewStudent = async () => {
    if (!newStudent.name.trim()) { toast.error('Student name required'); return; }
    setSavingNewStudent(true);
    try {
      await addDoc(collection(db, 'students'), { clientId: client.id, name: newStudent.name.trim(), dob: newStudent.dob, grade: newStudent.grade, schoolName: newStudent.schoolName, schoolContact: newStudent.schoolContact, allergies: newStudent.allergies, medicalNotes: newStudent.medicalNotes, age: 0, phone: '', specialRequirements: newStudent.specialRequirements });
      toast.success('Student added'); setAddingStudent(false); setNewStudent(blankStudent());
    } catch { toast.error('Failed to add student'); } finally { setSavingNewStudent(false); }
  };

  const saveBooking = async () => {
    if (!booking) return;
    setSavingBooking(true);
    try { await updateDoc(doc(db, 'bookings', booking.id), { ...bookingForm, weeklyRate: pricing.weekly, dailyRate: pricing.daily, updatedAt: serverTimestamp() }); toast.success('Booking updated'); setEditingBooking(false); }
    catch { toast.error('Failed to save booking'); } finally { setSavingBooking(false); }
  };

  const tryFetchMileage = useCallback(async (pickup: string, dropoff: string) => {
    if (!pickup || !dropoff) return;
    setFetchingMileage(true);
    const m = await getMileage(pickup, dropoff);
    if (m !== null) setBookingForm(prev => ({ ...prev, mileage: m }));
    setFetchingMileage(false);
  }, []);

  const handleDeleteClient = async () => {
    setDeleting(true);
    try {
      // Collect every document ref that belongs to this client
      const refs: ReturnType<typeof doc>[] = [];
      refs.push(doc(db, 'clients', client.id));

      const [studentsSnap, bookingsSnap, contractsSnap] = await Promise.all([
        getDocs(query(collection(db, 'students'),  where('clientId', '==', client.id))),
        getDocs(query(collection(db, 'bookings'),  where('clientId', '==', client.id))),
        getDocs(query(collection(db, 'contracts'), where('clientId', '==', client.id))),
      ]);
      studentsSnap.forEach(d  => refs.push(d.ref));
      bookingsSnap.forEach(d  => refs.push(d.ref));
      contractsSnap.forEach(d => refs.push(d.ref));

      // Cascade into routeAssignments + routeLogs per booking
      await Promise.all(
        bookingsSnap.docs.map(async bDoc => {
          const [assignSnap, logsSnap] = await Promise.all([
            getDocs(query(collection(db, 'routeAssignments'), where('bookingId', '==', bDoc.id))),
            getDocs(query(collection(db, 'routeLogs'),        where('bookingId', '==', bDoc.id))),
          ]);
          assignSnap.forEach(d => refs.push(d.ref));
          logsSnap.forEach(d  => refs.push(d.ref));
        })
      );

      // Commit in chunks of 400 (Firestore batch limit is 500)
      for (let i = 0; i < refs.length; i += 400) {
        const batch = writeBatch(db);
        refs.slice(i, i + 400).forEach(r => batch.delete(r));
        await batch.commit();
      }

      toast.success(`${client.name} and all associated data deleted`);
      onDeleted();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to delete client');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleGenerateContract = async () => {
    if (!booking) { toast.error('No booking found for this client'); return; }
    setGeneratingContract(true);
    try {
      await generateAndSaveContract(booking, client, students);
      toast.success('Contract generated ✓  —  use "Email to Parent" to send it');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to generate contract');
    } finally { setGeneratingContract(false); }
  };

  const handleSendPortalInvite = async () => {
    if (!client.email) { toast.error('No email on file for this client'); return; }
    const ok = window.confirm(`Send Parent Portal setup email to ${client.email}?`);
    if (!ok) return;
    setSendingInvite(true);
    try {
      const fn = httpsCallable<{ clientId: string }, { sent: boolean; action: 'created' | 'linked' | 'resent' }>(
        getFunctions(), 'sendPortalInvite'
      );
      const res = await fn({ clientId: client.id });
      const label = res.data.action === 'resent' ? 'Reset link resent' : 'Portal invite sent';
      toast.success(`${label} to ${client.email}`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to send invite');
    } finally { setSendingInvite(false); }
  };

  const toggleApplicationFee = async () => {
    if (!booking) return;
    setTogglingFee(true);
    try {
      await updateDoc(doc(db, 'bookings', booking.id), { applicationFeePaid: !booking.applicationFeePaid });
      toast.success(booking.applicationFeePaid ? 'Marked as unpaid' : 'Application fee marked as paid ✓');
    } catch { toast.error('Failed to update fee status'); } finally { setTogglingFee(false); }
  };

  const handleSendEmail = async () => {
    if (!latestContract) return;
    setSendingEmail(true);
    try {
      await queueContractEmail(latestContract, client.email, client.name);
      toast.success('Contract email queued for delivery ✓');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to queue email');
    } finally { setSendingEmail(false); }
  };

  const formatTs = (ts: any) => {
    if (!ts) return '---';
    const d = ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
    return d ? format(d, 'MMM d, yyyy h:mm a') : '---';
  };

  const { startImpersonation } = useImpersonation();
  const [impersonating, setImpersonating] = useState(false);

  const handleImpersonate = async () => {
    setImpersonating(true);
    try {
      const usersSnap = await getDocs(query(collection(db, 'users'), where('linkedId', '==', client.id), where('role', '==', 'parent')));
      if (usersSnap.empty) {
        toast.error('No linked parent account. Send a portal invite first.');
        return;
      }
      const u = usersSnap.docs[0];
      startImpersonation({ uid: u.id, name: client.name, role: 'parent', linkedId: client.id });
      toast.success(`Viewing as ${client.name}`);
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to start impersonation');
    } finally { setImpersonating(false); }
  };

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <Users size={14} /> },
    { id: 'booking', label: 'Booking', icon: <GraduationCap size={14} /> },
    { id: 'contract', label: 'Contract', icon: <FileText size={14} /> },
    { id: 'contacts', label: 'Contacts', icon: <Shield size={14} /> },
    { id: 'comms', label: 'Comms', icon: <MessageSquare size={14} /> },
  ];

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 w-[520px] max-w-full h-full bg-white shadow-2xl border-l border-slate-200 flex flex-col z-50 overflow-hidden">
        <div className="bg-violet-600 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-white font-bold text-lg">{client.name}</h2>
            <p className="text-violet-200 text-xs mt-0.5">{client.email}</p>
          </div>
          <div className="flex items-center gap-2 ml-3">
            <button
              onClick={handleImpersonate}
              disabled={impersonating}
              title="View portal as this parent (read-only)"
              className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {impersonating ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
            </button>
            <button
              onClick={handleSendPortalInvite}
              disabled={sendingInvite || !client.email}
              title="Send/Resend Parent Portal invite email"
              className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sendingInvite ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              title="Delete client"
              className="p-1.5 text-white/60 hover:text-red-300 hover:bg-white/10 rounded-lg transition-colors"
            >
              <Trash2 size={16} />
            </button>
            <button onClick={onClose} className="text-white/70 hover:text-white text-2xl leading-none">×</button>
          </div>
        </div>
        <div className="flex border-b border-slate-200 bg-white flex-shrink-0">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold transition-colors ${activeTab === t.id ? 'text-violet-700 border-b-2 border-violet-600' : 'text-slate-500 hover:text-slate-700'}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
        {/* ── Delete confirmation overlay ───────────────────────────── */}
        {confirmDelete && (
          <div className="absolute inset-0 z-10 flex items-end">
            <div className="absolute inset-0 bg-black/40" onClick={() => !deleting && setConfirmDelete(false)} />
            <div className="relative w-full bg-white border-t border-slate-200 rounded-t-2xl p-6 shadow-2xl">
              <div className="flex items-start gap-3 mb-4">
                <div className="flex-shrink-0 w-9 h-9 bg-red-100 rounded-full flex items-center justify-center">
                  <AlertTriangle size={18} className="text-red-600" />
                </div>
                <div>
                  <div className="font-bold text-slate-800">Delete {client.name}?</div>
                  <div className="text-xs text-slate-500 mt-1">
                    This permanently removes the client, all students, bookings, route assignments, route logs, and contracts. This cannot be undone.
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteClient}
                  disabled={deleting}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
                >
                  {deleting
                    ? <><Loader2 size={14} className="animate-spin" /> Deleting...</>
                    : <><Trash2 size={14} /> Delete Permanently</>
                  }
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-5">

          {activeTab === 'overview' && (
            <div className="space-y-5">
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Parent Info</span>
                  {!editingClient ? (
                    <button onClick={() => { setClientForm({ name: client.name, email: client.email, phone: client.phone, address: client.address }); setEditingClient(true); }} className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors"><Edit2 size={13} className="text-slate-500" /></button>
                  ) : (
                    <div className="flex gap-1.5">
                      <button onClick={saveClient} disabled={savingClient} className="inline-flex items-center gap-1 px-2.5 py-1 bg-violet-600 text-white rounded-lg text-xs font-medium disabled:opacity-60">{savingClient ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save</button>
                      <button onClick={() => setEditingClient(false)} className="px-2.5 py-1 bg-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-300 transition-colors">Cancel</button>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  {editingClient ? (
                    <div className="grid grid-cols-2 gap-3">
                      {(['name', 'email', 'phone'] as const).map(k => (<div key={k}><label className={labelCls}>{k}</label><input className={inputCls} value={clientForm[k]} onChange={e => setClientForm(f => ({ ...f, [k]: e.target.value }))} /></div>))}
                      <div><label className={labelCls}>Address</label><AddressAutocomplete value={clientForm.address} onChange={v => setClientForm(f => ({ ...f, address: v }))} className={inputCls} /></div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      {([['Name', client.name], ['Email', client.email], ['Phone', client.phone], ['Address', client.address]] as [string, string][]).map(([lbl, val]) => (
                        <div key={lbl}><div className="text-xs text-slate-400 mb-0.5">{lbl}</div><div className="font-medium text-slate-800">{val || '---'}</div></div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Students</span>
                  <button onClick={() => setAddingStudent(true)} className="inline-flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-semibold"><Plus size={12} /> Add student</button>
                </div>
                <div className="p-4 space-y-3">
                  {students.map(s => (
                    <div key={s.id} className="bg-slate-50 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-slate-800">{s.name}</span>
                        {editingStudentId !== s.id ? (
                          <button onClick={() => startEditStudent(s)} className="p-1 hover:bg-slate-200 rounded-lg transition-colors"><Edit2 size={12} className="text-slate-400" /></button>
                        ) : (
                          <div className="flex gap-1.5">
                            <button onClick={saveStudent} disabled={savingStudent} className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-600 text-white rounded text-xs disabled:opacity-60">{savingStudent ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Save</button>
                            <button onClick={() => setEditingStudentId(null)} className="px-2 py-0.5 bg-slate-200 text-slate-600 rounded text-xs">Cancel</button>
                          </div>
                        )}
                      </div>
                      {editingStudentId === s.id ? (
                        <div className="grid grid-cols-2 gap-2">
                          {(['name', 'dob', 'grade', 'schoolName', 'schoolContact', 'allergies', 'medicalNotes', 'specialRequirements'] as (keyof Student)[]).map(k => (
                            <div key={k as string} className={k === 'medicalNotes' || k === 'specialRequirements' ? 'col-span-2' : ''}><label className={labelCls}>{(k as string).replace(/([A-Z])/g, ' $1').trim()}</label><input className={inputCls} value={(studentForm[k] as string) ?? ''} onChange={e => setStudentForm(f => ({ ...f, [k]: e.target.value }))} /></div>
                          ))}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-1.5 text-xs text-slate-600">
                          <span><span className="text-slate-400">DOB: </span>{s.dob || '---'}</span>
                          <span><span className="text-slate-400">Grade: </span>{s.grade || '---'}</span>
                          <span className="col-span-2"><span className="text-slate-400">School: </span>{s.schoolName || '---'}</span>
                          {s.allergies && <span className="col-span-2"><span className="text-slate-400">Allergies: </span>{s.allergies}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                  {addingStudent && (
                    <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 space-y-2">
                      <div className="text-xs font-semibold text-violet-700 mb-1">New Student</div>
                      <div className="grid grid-cols-2 gap-2">
                        {(['name', 'dob', 'grade', 'schoolName'] as (keyof StudentDraft)[]).map(k => (
                          <div key={k}><label className={labelCls}>{k.replace(/([A-Z])/g, ' $1').trim()} {k === 'name' ? '*' : ''}</label><input className={inputCls} type={k === 'dob' ? 'date' : 'text'} value={newStudent[k]} onChange={e => setNewStudent(f => ({ ...f, [k]: e.target.value }))} /></div>
                        ))}
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button onClick={saveNewStudent} disabled={savingNewStudent} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-semibold disabled:opacity-60">{savingNewStudent ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save</button>
                        <button onClick={() => { setAddingStudent(false); setNewStudent(blankStudent()); }} className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
                      </div>
                    </div>
                  )}
                  {students.length === 0 && !addingStudent && <p className="text-sm text-slate-400 text-center py-3">No students linked yet</p>}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'booking' && (
            <div className="space-y-4">
              {!booking ? (
                <p className="text-sm text-slate-400 text-center py-8">No booking found for this client</p>
              ) : (
                <>
                  {!editingBooking ? (
                    <div className="flex justify-end"><button onClick={() => { setBookingForm({ ...booking }); setEditingBooking(true); }} className="inline-flex items-center gap-1.5 text-sm text-violet-600 hover:text-violet-800 font-semibold"><Edit2 size={13} /> Edit Booking</button></div>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <button onClick={saveBooking} disabled={savingBooking} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white rounded-lg text-sm font-semibold disabled:opacity-60">{savingBooking ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save</button>
                      <button onClick={() => setEditingBooking(false)} className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors">Cancel</button>
                    </div>
                  )}
                  <div>
                    <label className={labelCls}>Status</label>
                    <select className={inputCls} value={editingBooking ? (bookingForm.status ?? booking.status) : booking.status} onChange={async e => { const val = e.target.value; if (!editingBooking) { await updateDoc(doc(db, 'bookings', booking.id), { status: val }); toast.success('Status updated'); } else { setBookingForm(f => ({ ...f, status: val as any })); } }}>
                      {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200"><span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Route &amp; Schedule</span></div>
                    <div className="p-4 grid grid-cols-2 gap-3">
                      {editingBooking ? (
                        <>
                          <div className="col-span-2"><label className={labelCls}>Pickup Address</label><AddressAutocomplete value={bookingForm.pickupAddress ?? ''} onChange={v => setBookingForm(f => ({ ...f, pickupAddress: v }))} onSelect={v => { if (bookingForm.dropoffAddress) tryFetchMileage(v, bookingForm.dropoffAddress); }} className={inputCls} /></div>
                          <div className="col-span-2"><label className={labelCls}>Dropoff Address</label><AddressAutocomplete value={bookingForm.dropoffAddress ?? ''} onChange={v => setBookingForm(f => ({ ...f, dropoffAddress: v }))} onSelect={v => { if (bookingForm.pickupAddress) tryFetchMileage(bookingForm.pickupAddress, v); }} className={inputCls} /></div>
                          <div><label className={labelCls}>Transport Type</label><select className={inputCls} value={bookingForm.transportationType} onChange={e => setBookingForm(f => ({ ...f, transportationType: e.target.value as any }))}>{TRANSPORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                          <div><label className={labelCls}>Purpose of Transportation</label><select className={inputCls} value={bookingForm.transportationPurpose ?? 'School'} onChange={e => setBookingForm(f => ({ ...f, transportationPurpose: e.target.value as TransportationPurpose }))}>{PURPOSE_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                          <div><label className={labelCls}>Mileage {fetchingMileage && <span className="text-violet-400">(fetching...)</span>}</label><input type="number" step="0.1" className={inputCls} value={bookingForm.mileage ?? 0} onChange={e => setBookingForm(f => ({ ...f, mileage: Number(e.target.value) }))} /></div>
                          <div><label className={labelCls}>School Start</label><input type="time" className={inputCls} value={bookingForm.schoolStartTime ?? ''} onChange={e => setBookingForm(f => ({ ...f, schoolStartTime: e.target.value }))} /></div>
                          <div><label className={labelCls}>School End</label><input type="time" className={inputCls} value={bookingForm.schoolEndTime ?? ''} onChange={e => setBookingForm(f => ({ ...f, schoolEndTime: e.target.value }))} /></div>
                          <div><label className={labelCls}>Service Start Date</label><input type="date" className={inputCls} value={toDateStr(bookingForm.serviceStartDate)} onChange={e => setBookingForm(f => ({ ...f, serviceStartDate: e.target.value ? new Date(e.target.value + 'T12:00:00') : undefined as any }))} /></div>
                          <div className="flex items-center gap-2 pt-6"><input type="checkbox" id="bfAppFee" checked={bookingForm.applicationFeePaid ?? false} onChange={e => setBookingForm(f => ({ ...f, applicationFeePaid: e.target.checked }))} className="w-4 h-4 accent-violet-600 cursor-pointer" /><label htmlFor="bfAppFee" className="text-sm text-slate-700 cursor-pointer">Application fee paid ($40)</label></div>
                          <div><label className={labelCls}>Emergency Contact Name</label><input className={inputCls} value={bookingForm.emergencyContact ?? ''} onChange={e => setBookingForm(f => ({ ...f, emergencyContact: e.target.value }))} /></div>
                          <div><label className={labelCls}>Emergency Phone</label><input className={inputCls} type="tel" value={bookingForm.emergencyPhone ?? ''} onChange={e => setBookingForm(f => ({ ...f, emergencyPhone: e.target.value }))} /></div>
                          <div className="col-span-2"><label className={labelCls}>Relationship to Student</label><input className={inputCls} value={bookingForm.emergencyContactRelationship ?? ''} onChange={e => setBookingForm(f => ({ ...f, emergencyContactRelationship: e.target.value }))} placeholder="e.g. Aunt, Grandparent" /></div>
                          <div className="col-span-2"><label className={labelCls}>Days of Service</label><div className="flex flex-wrap gap-2">{DAYS.map(d => (<button key={d} type="button" onClick={() => setBookingForm(f => ({ ...f, daysOfWeek: f.daysOfWeek?.includes(d) ? f.daysOfWeek.filter(x => x !== d) : [...(f.daysOfWeek ?? []), d] }))} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${(bookingForm.daysOfWeek ?? []).includes(d) ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'}`}>{d.slice(0, 3)}</button>))}</div></div>
                        </>
                      ) : (
                        <>
                          {([['Pickup', booking.pickupAddress], ['Dropoff', booking.dropoffAddress], ['Type', booking.transportationType?.replace(/_/g, ' ')], ['Purpose', booking.transportationPurpose ?? 'School'], ['Days', booking.daysOfWeek?.join(', ')], ['Start Time', booking.schoolStartTime], ['End Time', booking.schoolEndTime], ['Service Start', toDateStr(booking.serviceStartDate)], ['App Fee', booking.applicationFeePaid ? 'Paid ✓' : 'Not paid'], ['Emergency Contact', booking.emergencyContact || '—'], ['Emergency Phone', booking.emergencyPhone || '—'], ['Relationship', booking.emergencyContactRelationship || '—']] as [string, string][]).map(([l, v]) => (
                            <div key={l}><div className="text-xs text-slate-400 mb-0.5">{l}</div><div className={`text-sm font-medium ${l === 'App Fee' && !booking.applicationFeePaid ? 'text-amber-600' : 'text-slate-800'}`}>{v || '---'}</div></div>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Pricing</div>
                    <div className="grid grid-cols-2 gap-4">
                      <div><div className="text-2xl font-bold text-slate-800">${pricing.weekly.toFixed(2)}</div><div className="text-xs text-slate-500">Weekly Rate</div></div>
                      <div><div className="text-2xl font-bold text-slate-800">${pricing.daily.toFixed(2)}</div><div className="text-xs text-slate-500">Daily Rate</div></div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'contract' && (
            <div className="space-y-4">

              {/* ── Pre-flight checklist ─────────────────────────────── */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Pre-flight Checklist</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {/* 1. Booking on file */}
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${booking ? 'bg-green-100' : 'bg-red-100'}`}>
                        {booking ? <Check size={11} className="text-green-600" /> : <X size={11} className="text-red-500" />}
                      </span>
                      <span className="text-sm text-slate-700">Booking on file</span>
                    </div>
                    {!booking && <span className="text-xs text-red-500">Create a booking first</span>}
                  </div>
                  {/* 2. Addresses */}
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${booking?.pickupAddress && booking?.dropoffAddress ? 'bg-green-100' : 'bg-amber-100'}`}>
                        {booking?.pickupAddress && booking?.dropoffAddress ? <Check size={11} className="text-green-600" /> : <X size={11} className="text-amber-500" />}
                      </span>
                      <span className="text-sm text-slate-700">Pickup &amp; dropoff addresses</span>
                    </div>
                    {!(booking?.pickupAddress && booking?.dropoffAddress) && <span className="text-xs text-amber-600">Set in Booking tab</span>}
                  </div>
                  {/* 3. Service start date */}
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${booking?.serviceStartDate ? 'bg-green-100' : 'bg-amber-100'}`}>
                        {booking?.serviceStartDate ? <Check size={11} className="text-green-600" /> : <X size={11} className="text-amber-500" />}
                      </span>
                      <span className="text-sm text-slate-700">Service start date</span>
                      {booking?.serviceStartDate && <span className="text-xs text-slate-400 ml-1">{toDateStr(booking.serviceStartDate)}</span>}
                    </div>
                    {booking && (
                      <input
                        type="date"
                        disabled={savingStartDate}
                        value={toDateStr(booking.serviceStartDate)}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-50"
                        onChange={async e => {
                          if (!e.target.value) return;
                          setSavingStartDate(true);
                          try {
                            await updateDoc(doc(db, 'bookings', booking.id), { serviceStartDate: new Date(e.target.value + 'T12:00:00') });
                            toast.success('Service start date saved');
                          } catch { toast.error('Failed to save date'); } finally { setSavingStartDate(false); }
                        }}
                      />
                    )}
                  </div>
                  {/* 4. Application fee */}
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${booking?.applicationFeePaid ? 'bg-green-100' : 'bg-amber-100'}`}>
                        {booking?.applicationFeePaid ? <Check size={11} className="text-green-600" /> : <X size={11} className="text-amber-500" />}
                      </span>
                      <span className="text-sm text-slate-700">Application fee ($40)</span>
                    </div>
                    {booking && (
                      <button
                        onClick={toggleApplicationFee}
                        disabled={togglingFee}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${booking.applicationFeePaid ? 'bg-green-100 text-green-700 hover:bg-red-100 hover:text-red-600' : 'bg-amber-100 text-amber-700 hover:bg-green-100 hover:text-green-700'}`}
                      >
                        {togglingFee ? '…' : booking.applicationFeePaid ? 'Mark Unpaid' : 'Mark as Paid'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Generate button ───────────────────────────────────── */}
              {(() => {
                const allReady = !!booking && !!(booking.pickupAddress && booking.dropoffAddress) && !!booking.serviceStartDate && !!booking.applicationFeePaid;
                return (
                  <button
                    disabled={!allReady || generatingContract}
                    onClick={handleGenerateContract}
                    className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${allReady && !generatingContract ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                  >
                    {generatingContract ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : latestContract ? <><RefreshCw size={14} /> Re-generate Contract</> : 'Generate Contract'}
                  </button>
                );
              })()}

              {/* ── Latest contract card ──────────────────────────────── */}
              {latestContract && (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Latest Contract</span>
                    {latestContract.signedAt ? (
                      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-emerald-100 text-emerald-700">
                        <Check size={11} /> Signed
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-green-100 text-green-700">Generated</span>
                    )}
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="text-xs text-slate-400">Generated {formatTs(latestContract.generatedAt)}</div>
                    {latestContract.signedAt && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-xs text-emerald-800">
                        <div className="font-semibold">Signed by {latestContract.signedByName || 'parent'}</div>
                        <div className="text-emerald-700">{formatTs(latestContract.signedAt)}</div>
                      </div>
                    )}
                    <a href={latestContract.signedPdfUrl || latestContract.pdfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-violet-600 hover:underline font-medium">
                      {latestContract.signedAt ? 'Download Signed PDF' : 'Download PDF'} <ExternalLink size={12} />
                    </a>
                    {!latestContract.signedAt && latestContract.signingToken && (
                      <button
                        type="button"
                        onClick={() => {
                          const url = `${window.location.origin}/sign/${latestContract.id}?t=${encodeURIComponent(latestContract.signingToken as string)}`;
                          navigator.clipboard.writeText(url).then(
                            () => toast.success('Signing link copied'),
                            () => toast.error('Unable to copy — please select manually')
                          );
                        }}
                        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-violet-600 font-medium"
                      >
                        Copy signing link
                      </button>
                    )}
                    <div className="pt-2 border-t border-slate-100">
                      {latestContract.sentAt ? (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-green-600">Emailed {formatTs(latestContract.sentAt)}</span>
                          <button onClick={handleSendEmail} disabled={sendingEmail} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-violet-600 font-medium disabled:opacity-50">
                            {sendingEmail ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />} Resend
                          </button>
                        </div>
                      ) : (
                        <button onClick={handleSendEmail} disabled={sendingEmail} className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${!sendingEmail ? 'bg-violet-600 hover:bg-violet-700 text-white' : 'bg-slate-200 text-slate-400'}`}>
                          {sendingEmail ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
                          {sendingEmail ? 'Sending…' : `Email to ${client.name.split(' ')[0]}`}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Contract history ──────────────────────────────────── */}
              {contracts.length > 1 && (
                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Previous Versions</div>
                  <div className="space-y-2">
                    {contracts.slice(1).map((c, i) => (
                      <div key={c.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2.5">
                        <div>
                          <div className="text-xs font-medium text-slate-700">Version {contracts.length - 1 - i}</div>
                          <div className="text-xs text-slate-400">{formatTs(c.generatedAt)}</div>
                          {c.sentAt && <div className="text-xs text-green-600">Emailed {formatTs(c.sentAt)}</div>}
                        </div>
                        <a href={c.pdfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-violet-600 hover:underline font-medium">Download <ExternalLink size={10} /></a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'contacts' && (
            <ContactsPanel clientId={client.id} />
          )}

          {activeTab === 'comms' && (
            <CommsLog clientId={client.id} />
          )}
        </div>
      </div>
    </>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// ContactsPanel — manage multi-parent / coordinator access for a client
// ────────────────────────────────────────────────────────────────────────────
interface ContactsPanelProps { clientId: string; }

const ContactsPanel: React.FC<ContactsPanelProps> = ({ clientId }) => {
  const [contacts, setContacts] = useState<ClientAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<ContactRole>('secondary');
  const [invitePerms, setInvitePerms] = useState<ContactPermissions>(DEFAULT_PERMISSIONS.secondary);
  const [sending, setSending] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'clientAccess'), where('clientId', '==', clientId));
    const unsub = onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as ClientAccess);
      list.sort((a, b) => {
        const order = { primary: 0, secondary: 1, coordinator: 2 } as const;
        return order[a.role] - order[b.role];
      });
      setContacts(list);
      setLoading(false);
    });
    return unsub;
  }, [clientId]);

  const handleRoleChange = (role: ContactRole) => {
    setInviteRole(role);
    setInvitePerms(DEFAULT_PERMISSIONS[role]);
  };

  const sendInvite = async () => {
    if (!inviteName.trim() || !inviteEmail.trim()) {
      toast.error('Name and email required');
      return;
    }
    setSending(true);
    try {
      const fn = httpsCallable(getFunctions(), 'sendContactInvite');
      await fn({
        clientId,
        name: inviteName.trim(),
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        permissions: invitePerms,
      });
      toast.success('Invitation sent');
      setShowInvite(false);
      setInviteName('');
      setInviteEmail('');
      setInviteRole('secondary');
      setInvitePerms(DEFAULT_PERMISSIONS.secondary);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send invite');
    } finally {
      setSending(false);
    }
  };

  const resendInvite = async (c: ClientAccess) => {
    setSending(true);
    try {
      const fn = httpsCallable(getFunctions(), 'sendContactInvite');
      await fn({
        clientId,
        name: c.name,
        email: c.email,
        role: c.role,
        permissions: c.permissions,
      });
      const rm = httpsCallable(getFunctions(), 'removeContactAccess');
      await rm({ docId: c.id });
      toast.success('Invitation resent');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to resend');
    } finally {
      setSending(false);
    }
  };

  const removeContact = async (c: ClientAccess) => {
    if (!confirm(`Remove ${c.name} (${c.email})? They will lose portal access.`)) return;
    setRemovingId(c.id);
    try {
      const fn = httpsCallable(getFunctions(), 'removeContactAccess');
      await fn({ docId: c.id });
      toast.success('Contact removed');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to remove contact');
    } finally {
      setRemovingId(null);
    }
  };

  const roleBadge = (role: ContactRole) => {
    const styles: Record<ContactRole, string> = {
      primary:     'bg-violet-100 text-violet-700',
      secondary:   'bg-blue-100 text-blue-700',
      coordinator: 'bg-amber-100 text-amber-700',
    };
    const labels: Record<ContactRole, string> = {
      primary: 'Primary', secondary: 'Secondary', coordinator: 'Coordinator',
    };
    return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles[role]}`}>{labels[role]}</span>;
  };

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending:  'bg-amber-100 text-amber-700',
      accepted: 'bg-green-100 text-green-700',
      expired:  'bg-gray-100 text-gray-500',
    };
    return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles[status] || 'bg-gray-100'}`}>{status}</span>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Portal Contacts</div>
        <button onClick={() => setShowInvite(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white transition-colors">
          <UserPlus size={12} /> Invite Contact
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-slate-400"><Loader2 size={18} className="animate-spin" /></div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-8 bg-slate-50 rounded-xl">
          <Shield size={28} className="mx-auto text-slate-300 mb-2" />
          <div className="text-sm text-slate-500">No additional contacts yet.</div>
          <div className="text-xs text-slate-400 mt-1">The primary parent is managed on the Overview tab.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {contacts.map(c => (
            <div key={c.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <div className="text-sm font-semibold text-slate-800 truncate">{c.name}</div>
                  {roleBadge(c.role)}
                  {statusBadge(c.inviteStatus)}
                </div>
                <div className="text-xs text-slate-500 truncate">{c.email}</div>
                <div className="text-[10px] text-slate-400 mt-1 flex gap-2 flex-wrap">
                  {c.permissions.canEdit && <span>Can Edit</span>}
                  {c.permissions.canSeeBilling && <span>Billing</span>}
                  {c.permissions.canSeeInvoices && <span>Invoices</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {c.inviteStatus === 'pending' && (
                  <button disabled={sending} onClick={() => resendInvite(c)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40" title="Resend invite">
                    <RefreshCw size={14} />
                  </button>
                )}
                {c.role !== 'primary' && (
                  <button disabled={removingId === c.id} onClick={() => removeContact(c)} className="p-2 rounded-lg text-rose-500 hover:bg-rose-50 disabled:opacity-40" title="Remove contact">
                    {removingId === c.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !sending && setShowInvite(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-800">Invite Contact</h3>
              <button onClick={() => !sending && setShowInvite(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Full Name</label>
                <input className={inputCls} value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Jane Smith" />
              </div>
              <div>
                <label className={labelCls}>Email</label>
                <input type="email" className={inputCls} value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="jane@example.com" />
              </div>
              <div>
                <label className={labelCls}>Role</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => handleRoleChange('secondary')} className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${inviteRole === 'secondary' ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-700 border-slate-200 hover:border-violet-300'}`}>Secondary Parent</button>
                  <button type="button" onClick={() => handleRoleChange('coordinator')} className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${inviteRole === 'coordinator' ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-700 border-slate-200 hover:border-violet-300'}`}>Coordinator</button>
                </div>
                <div className="text-[11px] text-slate-400 mt-1.5">
                  {inviteRole === 'secondary' ? 'Can view and edit child details. No billing access.' : 'View-only access (e.g., school staff or caregiver).'}
                </div>
              </div>
              <div>
                <label className={labelCls}>Permissions</label>
                <div className="space-y-1.5 bg-slate-50 rounded-xl p-3">
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={invitePerms.canEdit} onChange={e => setInvitePerms(p => ({ ...p, canEdit: e.target.checked }))} className="rounded" />
                    Can edit child details
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={invitePerms.canSeeBilling} onChange={e => setInvitePerms(p => ({ ...p, canSeeBilling: e.target.checked }))} className="rounded" />
                    Can see billing
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={invitePerms.canSeeInvoices} onChange={e => setInvitePerms(p => ({ ...p, canSeeInvoices: e.target.checked }))} className="rounded" />
                    Can see invoices
                  </label>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowInvite(false)} disabled={sending} className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={sendInvite} disabled={sending} className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                {sending ? <><Loader2 size={14} className="animate-spin" /> Sending...</> : <><Mail size={14} /> Send Invite</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Clients: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    let resolved = 0;
    const tryDone = () => { resolved++; if (resolved >= 3) setLoading(false); };
    const u1 = onSnapshot(collection(db, 'clients'), snap => { setClients(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Client)); tryDone(); });
    const u2 = onSnapshot(collection(db, 'students'), snap => { setStudents(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Student)); tryDone(); });
    const u3 = onSnapshot(collection(db, 'bookings'), snap => { setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Booking)); tryDone(); });
    return () => { u1(); u2(); u3(); };
  }, []);

  const totalFamilies = clients.length;
  // Use the same "first booking" logic as the table Status column so numbers always match
  const activeCount = clients.filter(c => {
    const bk = bookings.find(b => b.clientId === c.id);
    return bk?.status === 'active';
  }).length;
  const pendingCount = clients.filter(c => {
    const bk = bookings.find(b => b.clientId === c.id);
    return bk?.status === 'new' || bk?.status === 'under_review';
  }).length;

  const q = search.toLowerCase();
  const filtered = clients.filter(c => {
    if (!q) return true;
    if (c.name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)) return true;
    return students.filter(s => s.clientId === c.id).some(s => s.name?.toLowerCase().includes(q) || s.schoolName?.toLowerCase().includes(q));
  });

  const getClientBooking = (clientId: string) => bookings.find(b => b.clientId === clientId) ?? null;
  const getClientStudents = (clientId: string) => students.filter(s => s.clientId === clientId);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-8 py-8">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Clients</h1>
            <p className="text-violet-200 text-sm mt-1">All registered families</p>
          </div>
          <button onClick={() => setShowAddModal(true)} className="inline-flex items-center gap-2 bg-white text-violet-700 hover:bg-violet-50 font-semibold text-sm px-4 py-2.5 rounded-xl shadow-sm transition-colors"><Plus size={16} /> Add Client</button>
        </div>
        <div className="flex flex-wrap gap-3 mt-5">
          {[{ label: 'Total Families', value: totalFamilies, color: 'bg-white/20' }, { label: 'Active', value: activeCount, color: 'bg-green-500/30' }, { label: 'Pending', value: pendingCount, color: 'bg-amber-500/30' }].map(s => (
            <div key={s.label} className={`${s.color} rounded-xl px-4 py-2 text-white flex items-center gap-2`}><span className="text-lg font-bold">{s.value}</span><span className="text-sm text-white/80">{s.label}</span></div>
          ))}
        </div>
      </div>
      <div className="px-8 py-6">
        <div className="flex items-center justify-between mb-5 gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 transition" placeholder="Search by name, student, or school..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 whitespace-nowrap">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
            <button
              onClick={() => {
                const rows = filtered.map(c => {
                  const bk = getClientBooking(c.id);
                  const sts = getClientStudents(c.id);
                  return {
                    name: c.name,
                    email: c.email,
                    phone: c.phone ?? '',
                    address: c.address ?? '',
                    students: sts.map(s => s.name).join('; '),
                    schools: sts.map(s => s.schoolName).filter(Boolean).join('; '),
                    status: bk?.status ?? '',
                    weeklyRate: bk?.weeklyRate ?? '',
                  };
                });
                exportToCSV(rows, `clients-${new Date().toISOString().slice(0, 10)}`);
              }}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Export current list to CSV"
            >
              <Download size={13} /> Export CSV
            </button>
          </div>
        </div>
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 animate-pulse flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-slate-200 flex-shrink-0" />
                <div className="flex-1 space-y-2"><div className="h-4 bg-slate-200 rounded w-1/3" /><div className="h-3 bg-slate-200 rounded w-1/4" /></div>
                <div className="h-6 w-20 bg-slate-200 rounded-full" />
              </div>
            ))}
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-24">
            <Users size={48} className="mx-auto text-slate-300 mb-4" />
            <p className="text-slate-600 font-semibold">{search ? 'No results found' : 'No clients yet'}</p>
            <p className="text-slate-400 text-sm mt-1">{search ? 'Try a different search term.' : 'Click "Add Client" to get started.'}</p>
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Parent</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Students</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">School(s)</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Weekly Rate</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(c => {
                  const bk = getClientBooking(c.id);
                  const sts = getClientStudents(c.id);
                  return (
                    <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5"><div className="font-semibold text-slate-800">{c.name}</div><div className="text-xs text-slate-400">{c.email}</div></td>
                      <td className="px-5 py-3.5"><div className="flex flex-wrap gap-1">{sts.length > 0 ? sts.map(s => (<span key={s.id} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700">{s.name}</span>)) : <span className="text-slate-400 text-xs">---</span>}</div></td>
                      <td className="px-5 py-3.5 text-slate-600 text-xs">{sts.map(s => s.schoolName).filter(Boolean).join(', ') || '---'}</td>
                      <td className="px-5 py-3.5">{bk ? (<span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[bk.status] ?? 'bg-gray-100 text-gray-500'}`}>{STATUS_LABELS[bk.status] ?? bk.status}</span>) : <span className="text-slate-400 text-xs">No booking</span>}</td>
                      <td className="px-5 py-3.5 text-right font-medium text-slate-700">{bk?.status === 'active' && bk.weeklyRate ? `$${bk.weeklyRate.toFixed(2)}` : '---'}</td>
                      <td className="px-5 py-3.5 text-right"><button onClick={() => setSelectedClient(c)} className="text-xs font-semibold text-violet-600 hover:text-violet-800 px-3 py-1.5 rounded-lg hover:bg-violet-50 transition-colors">View</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {selectedClient && (
        <ClientDetailPanel
          client={selectedClient}
          students={getClientStudents(selectedClient.id)}
          booking={getClientBooking(selectedClient.id)}
          onClose={() => setSelectedClient(null)}
          onDeleted={() => setSelectedClient(null)}
        />
      )}
      {showAddModal && <AddClientModal onClose={() => setShowAddModal(false)} />}
    </div>
  );
};

export default Clients;