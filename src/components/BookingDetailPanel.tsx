import React, { useState, useEffect } from 'react';
import {
  doc,
  updateDoc,
  getDoc,
  getDocs,
  writeBatch,
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  limit,
} from 'firebase/firestore';
import { format } from 'date-fns';
import { db } from '../services/firebase';
import { computeWeeklyCharge } from '../utils/pricing';
import { generateAndSaveContract, queueContractEmail } from '../services/contractService';
import type { Contract, Booking, Client, Student } from '../types';
import toast from 'react-hot-toast';

const STATUS_OPTIONS = [
  { value: 'new', label: 'New Application' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'contract_sent', label: 'Contract Sent' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused / Completed' },
];

const BookingDetailPanel = ({ booking, open, onClose }: {
  booking: any;
  open: boolean;
  onClose: () => void;
}) => {
  const [mileage, setMileage] = useState(booking?.mileage || 0);
  const [savingRate, setSavingRate] = useState(false);
  const [notes, setNotes] = useState(booking?.notes || '');
  const [contract, setContract] = useState<Contract | null>(null);
  const [generating, setGenerating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setMileage(booking?.mileage || 0);
    setNotes(booking?.notes || '');
    setConfirmDelete(false);
  }, [booking]);

  // Subscribe to the most-recent contract for this booking
  useEffect(() => {
    if (!booking?.id) return;
    const q = query(
      collection(db, 'contracts'),
      where('bookingId', '==', booking.id),
      orderBy('generatedAt', 'desc'),
      limit(1)
    );
    const unsub = onSnapshot(q, snap => {
      if (snap.empty) {
        setContract(null);
      } else {
        const d = snap.docs[0];
        setContract({ id: d.id, ...d.data() } as Contract);
      }
    });
    return unsub;
  }, [booking?.id]);

  if (!booking) return null;

  const isRoundTrip = booking.transportationType === 'roundtrip';
  const daysPerWeek = booking.daysOfWeek?.length || 0;
  const numChildren = booking.studentIds?.length || 1;
  const pricing = computeWeeklyCharge(mileage, daysPerWeek, isRoundTrip, numChildren);

  const handleSaveRate = async () => {
    setSavingRate(true);
    try {
      await updateDoc(doc(db, 'bookings', booking.id), {
        mileage,
        weeklyRate: pricing.weekly,
        dailyRate: pricing.daily,
      });
      toast.success('Rate updated');
    } catch {
      toast.error('Failed to save rate');
    } finally {
      setSavingRate(false);
    }
  };

  const handleStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    try {
      await updateDoc(doc(db, 'bookings', booking.id), { status: e.target.value });
      toast.success('Status updated');
    } catch {
      toast.error('Failed to update status');
    }
  };

  const handleNotesBlur = async () => {
    if (notes !== booking.notes) {
      try {
        await updateDoc(doc(db, 'bookings', booking.id), { notes });
        toast.success('Notes saved');
      } catch {
        toast.error('Failed to save notes');
      }
    }
  };

  const handleFeeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      await updateDoc(doc(db, 'bookings', booking.id), { applicationFeePaid: e.target.checked });
      toast.success('Application fee updated');
    } catch {
      toast.error('Failed to update fee');
    }
  };

  const handleGenerateContract = async () => {
    setGenerating(true);
    try {
      const { contractId } = await generateAndSaveContract(
        booking as Booking,
        booking.client as Client,
        (booking.students ?? []) as Student[]
      );
      // Fetch the freshly-written contract doc so we can pass it to queueContractEmail
      const snap = await getDoc(doc(db, 'contracts', contractId));
      const newContract: Contract = { id: contractId, ...snap.data() } as Contract;
      await queueContractEmail(newContract, booking.client.email, booking.client.name);
      toast.success('Contract generated and queued for delivery ✓');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to generate contract');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      {/* Dark overlay */}
      {open && <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />}

      {/* Slide-over panel */}
      <div className={`fixed top-0 right-0 w-[480px] h-full bg-white shadow-2xl border-l border-kidz-border flex flex-col z-50 transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Header */}
        <div className="bg-kidz-navy px-6 py-4 flex items-center justify-between">
          <h2 className="text-white font-bold text-lg">{booking.students?.[0]?.name || 'Booking Details'}</h2>
          <span className={`rounded-full text-xs font-medium px-2 py-0.5 ${
            booking.status === 'new' ? 'bg-blue-100 text-blue-700' :
            booking.status === 'under_review' ? 'bg-amber-100 text-amber-700' :
            booking.status === 'contract_sent' ? 'bg-purple-100 text-purple-700' :
            booking.status === 'active' ? 'bg-green-100 text-green-700' :
            'bg-gray-100 text-gray-600'
          }`}>
            {STATUS_OPTIONS.find(o => o.value === booking.status)?.label}
          </span>
          <button onClick={onClose} className="text-white/70 hover:text-white text-2xl leading-none ml-3">×</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6 flex flex-col gap-6">

          {/* Student Info */}
          <div className="border-b border-kidz-border pb-6">
            <div className="text-xs font-semibold tracking-widest text-kidz-textMuted uppercase mb-3">Student Info</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {booking.students?.map((s: any, i: number) => (
                <React.Fragment key={i}>
                  <div>
                    <div className="text-xs text-kidz-textMuted">Name</div>
                    <div className="text-sm font-medium text-kidz-textPrimary">{s.name}</div>
                  </div>
                  <div>
                    <div className="text-xs text-kidz-textMuted">School</div>
                    <div className="text-sm font-medium text-kidz-textPrimary">{s.schoolName}</div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Parent Info */}
          <div className="border-b border-kidz-border pb-6">
            <div className="text-xs font-semibold tracking-widest text-kidz-textMuted uppercase mb-3">Parent / Guardian</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <div><div className="text-xs text-kidz-textMuted">Name</div><div className="text-sm font-medium text-kidz-textPrimary">{booking.client?.name}</div></div>
              <div><div className="text-xs text-kidz-textMuted">Phone</div><a href={`tel:${booking.client?.phone}`} className="text-sm font-medium text-kidz-blue hover:underline">{booking.client?.phone}</a></div>
              <div><div className="text-xs text-kidz-textMuted">Email</div><div className="text-sm font-medium text-kidz-textPrimary">{booking.client?.email}</div></div>
              <div><div className="text-xs text-kidz-textMuted">Address</div><div className="text-sm font-medium text-kidz-textPrimary">{booking.client?.address}</div></div>
            </div>
          </div>

          {/* Route Info */}
          <div className="border-b border-kidz-border pb-6">
            <div className="text-xs font-semibold tracking-widest text-kidz-textMuted uppercase mb-3">Route & Schedule</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <div><div className="text-xs text-kidz-textMuted">Pickup</div><div className="text-sm font-medium text-kidz-textPrimary">{booking.pickupAddress}</div></div>
              <div><div className="text-xs text-kidz-textMuted">Dropoff</div><div className="text-sm font-medium text-kidz-textPrimary">{booking.dropoffAddress}</div></div>
              <div><div className="text-xs text-kidz-textMuted">Type</div><div className="text-sm font-medium text-kidz-textPrimary">{booking.transportationType}</div></div>
              <div><div className="text-xs text-kidz-textMuted">Days</div><div className="text-sm font-medium text-kidz-textPrimary">{booking.daysOfWeek?.join(', ')}</div></div>
            </div>
          </div>

          {/* Pricing */}
          <div className="border-b border-kidz-border pb-6">
            <div className="text-xs font-semibold tracking-widest text-kidz-textMuted uppercase mb-3">Pricing</div>
            <div className="flex items-end gap-3 mb-4">
              <div>
                <label className="text-xs text-kidz-textMuted block mb-1">Mileage</label>
                <input type="number" step="0.1" className="border border-kidz-border rounded-lg px-3 py-2 w-24 text-sm focus:outline-none focus:ring-2 focus:ring-kidz-blue" value={mileage} onChange={e => setMileage(Number(e.target.value))} />
              </div>
              <button className="bg-kidz-blue text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-60" onClick={handleSaveRate} disabled={savingRate}>
                {savingRate ? 'Saving…' : 'Save Rate'}
              </button>
            </div>
            <div className="bg-kidz-blueLight border border-blue-200 rounded-xl p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xl font-bold text-kidz-navy">${pricing.weekly.toFixed(2)}</div>
                  <div className="text-xs text-kidz-textMuted">Weekly Rate</div>
                </div>
                <div>
                  <div className="text-xl font-bold text-kidz-navy">${pricing.daily.toFixed(2)}</div>
                  <div className="text-xs text-kidz-textMuted">Daily Rate</div>
                </div>
              </div>
            </div>
          </div>

          {/* Status */}
          <div className="border-b border-kidz-border pb-6">
            <div className="text-xs font-semibold tracking-widest text-kidz-textMuted uppercase mb-3">Status</div>
            <select className="border border-kidz-border rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-kidz-blue" value={booking.status} onChange={handleStatusChange}>
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Application Fee Toggle */}
          <div className="border-b border-kidz-border pb-6">
            <div className="text-xs font-semibold tracking-widest text-kidz-textMuted uppercase mb-3">Application Fee</div>
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input type="checkbox" className="sr-only" checked={!!booking.applicationFeePaid} onChange={handleFeeChange} />
                <div className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${booking.applicationFeePaid ? 'bg-kidz-green' : 'bg-slate-300'}`}>
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${booking.applicationFeePaid ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                </div>
              </div>
              <span className="text-sm text-kidz-textPrimary">{booking.applicationFeePaid ? 'Paid' : 'Not paid'}</span>
            </label>
          </div>

          {/* Notes */}
          <div className="border-b border-kidz-border pb-6">
            <div className="text-xs font-semibold tracking-widest text-kidz-textMuted uppercase mb-3">Notes</div>
            <textarea rows={3} className="w-full border border-kidz-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-kidz-blue" value={notes} onChange={e => setNotes(e.target.value)} onBlur={handleNotesBlur} />
          </div>

          {/* Contract */}
          <div className="border-b border-kidz-border pb-6">
            <div className="text-xs font-semibold tracking-widest text-kidz-textMuted uppercase mb-3">Contract</div>

            {/* Status chip + generated date */}
            <div className="flex items-center gap-2 mb-3">
              {contract ? (
                <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-green-100 text-green-700">
                  Generated
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-gray-100 text-gray-500">
                  Not Generated
                </span>
              )}
              {contract && contract.generatedAt && (
                <span className="text-xs text-kidz-textMuted">
                  {format((contract.generatedAt as any).toDate(), 'MMM d, yyyy h:mm a')}
                </span>
              )}
            </div>

            {/* Download link + emailed date */}
            {contract && (
              <div className="mb-3 flex flex-col gap-1">
                <a
                  href={contract.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-kidz-blue hover:underline font-medium"
                >
                  Download PDF ↗
                </a>
                {contract.sentAt && (
                  <span className="text-xs text-kidz-textMuted">
                    Emailed on {format((contract.sentAt as any).toDate(), 'MMM d, yyyy')}
                  </span>
                )}
              </div>
            )}

            {/* Generate / Re-generate button */}
            <div title={!booking.applicationFeePaid ? 'Application fee must be paid first' : undefined}>
              <button
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors inline-flex items-center gap-2 ${
                  booking.applicationFeePaid && !generating
                    ? 'bg-kidz-amber text-white hover:bg-amber-600'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
                disabled={!booking.applicationFeePaid || generating}
                onClick={handleGenerateContract}
              >
                {generating ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Generating...
                  </>
                ) : contract ? 'Re-generate Contract' : 'Generate Contract'}
              </button>
            </div>
          </div>

          {/* Delete Application */}
          <div className="pt-2">
            {!confirmDelete ? (
              <button
                className="w-full rounded-lg border border-red-200 text-red-600 px-4 py-2 text-sm font-medium hover:bg-red-50 transition-colors"
                onClick={() => setConfirmDelete(true)}
              >
                Delete Application
              </button>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-red-700 mb-3">Are you sure? This will permanently delete this booking, its contract, route assignments, and route logs.</p>
                <div className="flex gap-2">
                  <button
                    className="flex-1 rounded-lg bg-red-600 text-white px-4 py-2 text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-60"
                    disabled={deleting}
                    onClick={async () => {
                      setDeleting(true);
                      try {
                        // Cascade: collect every doc tied to this booking
                        const refs: ReturnType<typeof doc>[] = [];
                        refs.push(doc(db, 'bookings', booking.id));

                        const [contractsSnap, assignmentsSnap, logsSnap] = await Promise.all([
                          getDocs(query(collection(db, 'contracts'),        where('bookingId', '==', booking.id))),
                          getDocs(query(collection(db, 'routeAssignments'), where('bookingId', '==', booking.id))),
                          getDocs(query(collection(db, 'routeLogs'),        where('bookingId', '==', booking.id))),
                        ]);
                        contractsSnap.forEach(d => refs.push(d.ref));
                        assignmentsSnap.forEach(d => refs.push(d.ref));
                        logsSnap.forEach(d => refs.push(d.ref));

                        // Commit in chunks of 400 (batch limit is 500)
                        for (let i = 0; i < refs.length; i += 400) {
                          const batch = writeBatch(db);
                          refs.slice(i, i + 400).forEach(r => batch.delete(r));
                          await batch.commit();
                        }
                        toast.success('Application and related records deleted');
                        onClose();
                      } catch (err: any) {
                        toast.error(err?.message ?? 'Failed to delete');
                      } finally {
                        setDeleting(false);
                        setConfirmDelete(false);
                      }
                    }}
                  >
                    {deleting ? 'Deleting…' : 'Yes, Delete'}
                  </button>
                  <button
                    className="flex-1 rounded-lg border border-slate-200 text-slate-600 px-4 py-2 text-sm font-medium hover:bg-slate-50 transition-colors"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
};

export default BookingDetailPanel;
