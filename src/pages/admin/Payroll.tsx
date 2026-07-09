import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  collection, getDocs, onSnapshot, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../services/firebase';
import type { RouteAssignment, Driver, Booking, Client, RouteLog, W2PayStub } from '../../types';
import PayStub from '../../components/payroll/PayStub';
import W2PayStubForm from '../../features/payroll/W2PayStubForm';
import W2PayStubPDF from '../../features/payroll/W2PayStubPDF';
import { pdf } from '@react-pdf/renderer';
import {
  getW2PayStubs,
  deleteW2PayStub,
} from '../../services/w2PayStubService';
import {
  format, addDays, addWeeks, addMonths, addYears,
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear,
  eachDayOfInterval, isWithinInterval,
} from 'date-fns';
import {
  DollarSign, CheckCircle, Check, ChevronLeft, ChevronRight, Printer,
  TrendingUp, TrendingDown, BarChart2, Zap, X, FileText, Trash2, AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ── helpers ─────────────────────────────────────────────────────────────────

import { toDate, DAY_ABBR, DAY_NAMES } from '../../utils/dates';

const fmt  = (d: Date) => format(d, 'yyyy-MM-dd');
const fmtD = (d: Date) => format(d, 'MMM d');

// ── period types ─────────────────────────────────────────────────────────────

type PeriodMode = 'week' | 'month' | 'year';
interface PeriodRange { start: Date; end: Date; label: string }

function buildRange(mode: PeriodMode, offset: number): PeriodRange {
  const base = new Date();
  if (mode === 'week') {
    const ref   = addWeeks(base, offset);
    const start = startOfWeek(ref, { weekStartsOn: 1 });
    const end   = endOfWeek(ref,   { weekStartsOn: 1 });
    return {
      start, end,
      label: offset === 0 ? 'This Week'
           : offset === -1 ? 'Last Week'
           : `Week of ${fmtD(start)}`,
    };
  }
  if (mode === 'month') {
    const ref = addMonths(base, offset);
    return { start: startOfMonth(ref), end: endOfMonth(ref), label: format(ref, 'MMMM yyyy') };
  }
  const ref = addYears(base, offset);
  return { start: startOfYear(ref), end: endOfYear(ref), label: format(ref, 'yyyy') };
}

const DAY_FULL = DAY_NAMES;

// ── W-2 helpers ──────────────────────────────────────────────────────────────

function fmtDollar(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

// ── component ────────────────────────────────────────────────────────────────

const Payroll: React.FC = () => {
  const [tab,         setTab]         = useState<'payroll' | 'revenue' | 'w2'>('payroll');
  const [mode,        setMode]        = useState<PeriodMode>('week');
  const [offset,      setOffset]      = useState(0);
  const [revenueView, setRevenueView] = useState<'client' | 'summary'>('summary');

  const [assignments, setAssignments] = useState<RouteAssignment[]>([]);
  const [drivers,     setDrivers]     = useState<Driver[]>([]);
  const [bookings,    setBookings]    = useState<Booking[]>([]);
  const [clients,     setClients]     = useState<Client[]>([]);
  const [routeLogs,   setRouteLogs]   = useState<RouteLog[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [marking,     setMarking]     = useState<string | null>(null);
  const [renewing,    setRenewing]    = useState<string | null>(null); // bookingId being renewed

  const [printStubDriver, setPrintStubDriver] = useState<Driver | null>(null);
  const [printAllStubs, setPrintAllStubs] = useState(false);

  // Stripe payout modal
  const [payoutModal, setPayoutModal] = useState<{
    driverId: string; driverName: string; pendingIds: string[]; defaultAmount: number;
  } | null>(null);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [issuingPayout, setIssuingPayout] = useState(false);

  // ── W-2 state ─────────────────────────────────────────────────────────────

  const [showW2Form, setShowW2Form] = useState(false);
  const [w2Stubs, setW2Stubs] = useState<W2PayStub[]>([]);
  const [w2Loading, setW2Loading] = useState(false);
  const [deletingW2, setDeletingW2] = useState<string | null>(null);

  const loadW2Stubs = useCallback(async () => {
    setW2Loading(true);
    try {
      const stubs = await getW2PayStubs();
      setW2Stubs(stubs);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to load W-2 stubs');
    } finally {
      setW2Loading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'w2') {
      loadW2Stubs();
    }
  }, [tab, loadW2Stubs]);

  const handleW2Saved = useCallback(() => {
    setShowW2Form(false);
    loadW2Stubs();
  }, [loadW2Stubs]);

  const handleDeleteW2 = useCallback(async (id: string) => {
    if (!window.confirm('Delete this W-2 pay stub? This cannot be undone.')) return;
    setDeletingW2(id);
    try {
      await deleteW2PayStub(id);
      toast.success('W-2 pay stub deleted');
      await loadW2Stubs();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to delete W-2 stub');
    } finally {
      setDeletingW2(null);
    }
  }, [loadW2Stubs]);

  const handleDownloadW2PDF = useCallback(async (stub: W2PayStub) => {
    try {
      const blob = await pdf(<W2PayStubPDF stub={stub} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `W2-PayStub-${stub.checkDate}-${stub.employeeName.replace(/\s+/g, '-')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('PDF downloaded');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to generate PDF');
    }
  }, []);

  // ── (end W-2 state) ───────────────────────────────────────────────────────

  // Real-time listeners for all core collections — new clients/bookings/assignments
  // appear automatically without needing a manual refresh.
  const loadRouteLogs = useCallback(async () => {
    const snap = await getDocs(collection(db, 'routeLogs'));
    setRouteLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() }) as RouteLog));
  }, []);

  // Combined refresh for the Refresh button — only routeLogs need a manual reload
  // since the other collections are kept live via onSnapshot.
  const loadData = useCallback(() => { loadRouteLogs(); }, [loadRouteLogs]);

  useEffect(() => {
    let resolved = 0;
    const tryDone = () => { resolved++; if (resolved >= 4) setLoading(false); };

    const unsubs = [
      onSnapshot(collection(db, 'routeAssignments'), snap => {
        setAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() }) as RouteAssignment));
        tryDone();
      }),
      onSnapshot(collection(db, 'drivers'), snap => {
        setDrivers(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Driver));
        tryDone();
      }),
      onSnapshot(collection(db, 'bookings'), snap => {
        setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Booking));
        tryDone();
      }),
      onSnapshot(collection(db, 'clients'), snap => {
        setClients(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Client));
        tryDone();
      }),
    ];

    // Route logs are large — load once on mount, refresh manually via button
    loadRouteLogs();

    return () => unsubs.forEach(u => u());
  }, [loadRouteLogs]);

  // ── derived state ──────────────────────────────────────────────────────────

  const range = useMemo<PeriodRange>(
    () => buildRange(mode, offset),
    [mode, offset],
  );

  const periodDays = useMemo(
    () => eachDayOfInterval({ start: range.start, end: range.end }),
    [range],
  );

  const handleModeChange = useCallback((m: PeriodMode) => {
    setMode(m); setOffset(0);
  }, []);

  // Only drivers who have route-assignments in the period
  const driversInPeriod = useMemo(() => {
    const driverIds = new Set(
      assignments
        .filter(a => isWithinInterval(toDate(a.weekStart), { start: range.start, end: range.end }))
        .map(a => a.driverId)
    );
    return drivers.filter(d => driverIds.has(d.id));
  }, [assignments, drivers, range]);

  // Group assignments by driver PERIOD-WIDE (not per-week).
  const byDriver = useMemo<Record<string, RouteAssignment[]>>(() => {
    const m: Record<string, RouteAssignment[]> = {};
    for (const d of driversInPeriod) {
      const driverAssignments = assignments.filter(a => {
        if (a.driverId !== d.id) return false;
        if (mode === 'week') {
          // Weekly view: include assignments whose weekStart falls within the period
          return isWithinInterval(toDate(a.weekStart), { start: range.start, end: range.end });
        }
        // Month/Year: filter by weekStart within the period
        return isWithinInterval(toDate(a.weekStart), { start: range.start, end: range.end });
      });
      if (driverAssignments.length > 0) {
        m[d.id] = driverAssignments;
      }
    }
    return m;
  }, [assignments, driversInPeriod, mode, range]);

  const totalOutstanding = useMemo(() => {
    const ids = Object.values(byDriver).flat().filter(a => a.status === 'pending');
    return ids.reduce((s, a) => s + (a.weeklyPayout || 0), 0);
  }, [byDriver]);

  // ── Unassigned / carry-over active routes ─────────────────────────────────

  // bookingIds that have at least one assignment (any week, any driver)
  const everAssignedBookingIds = useMemo(
    () => new Set(assignments.map(a => a.bookingId)),
    [assignments],
  );

  // bookingIds that have an assignment specifically in the current period
  const inPeriodBookingIds = useMemo(
    () => new Set(
      assignments
        .filter(a => isWithinInterval(toDate(a.weekStart), { start: range.start, end: range.end }))
        .map(a => a.bookingId)
    ),
    [assignments, range],
  );

  // Active bookings that have NEVER been assigned to any driver
  const neverAssignedRoutes = useMemo(
    () => bookings.filter(b => b.status === 'active' && !everAssignedBookingIds.has(b.id)),
    [bookings, everAssignedBookingIds],
  );

  // Active bookings that have been assigned before but have NO assignment in the
  // current period (recurring routes whose assignment wasn't renewed this period)
  const carryOverRoutes = useMemo(() => {
    const eligible = bookings.filter(
      b => b.status === 'active' && everAssignedBookingIds.has(b.id) && !inPeriodBookingIds.has(b.id)
    );
    return eligible.map(b => {
      // Find the most recent assignment for this booking
      const latest = assignments
        .filter(a => a.bookingId === b.id)
        .sort((x, y) => toDate(y.weekStart).getTime() - toDate(x.weekStart).getTime())[0];
      const driver = drivers.find(d => d.id === latest?.driverId) || null;
      return { booking: b, assignment: latest, driver };
    });
  }, [bookings, assignments, drivers, everAssignedBookingIds, inPeriodBookingIds]);

  // Actual pay factoring in multi-driver split (routeAssignments with routeCompletedBy)
  const actualPayForAssignment = useCallback((a: RouteAssignment): number => {
    const payout = a.weeklyPayout || 0;
    if (a.status === 'paid') return payout;
    // If route was completed by another driver, this assignment contributes 0
    if ((a as any).routeCompletedBy && (a as any).routeCompletedBy !== a.driverId) return 0;
    // Check route logs: only count days where the driver actually ran
    const weekStart = toDate(a.weekStart);
    const weekEnd = addWeeks(weekStart, 1);
    const logsThisWeek = routeLogs.filter(
      l => l.bookingId === a.bookingId &&
           l.ran &&
           isWithinInterval(new Date(l.date + 'T00:00:00'), { start: weekStart, end: weekEnd })
    );
    if (logsThisWeek.length === 0) return 0;
    const daysCount = bookings.find(b => b.id === a.bookingId)?.daysOfWeek?.length || 5;
    const dailyRate = payout / daysCount;
    return Math.min(payout, dailyRate * logsThisWeek.length);
  }, [routeLogs, bookings]);

  // Resolve a driver's assignments for the PayStub: override each assignment's
  // weeklyPayout with the actual pay (prorated from route logs) so the stub's
  // gross pay reflects real runs instead of the stale stored full-week amount.
  const resolvedAssignmentsFor = useCallback(
    (driverId: string): RouteAssignment[] =>
      (byDriver[driverId] || []).map(a => ({
        ...a,
        weeklyPayout: actualPayForAssignment(a),
      })),
    [byDriver, actualPayForAssignment],
  );

  // ── actions ────────────────────────────────────────────────────────────────

  // Create a new period assignment for a carry-over route (same driver, current period)
  const renewAssignment = useCallback(async (booking: Booking, lastDriver: Driver) => {
    setRenewing(booking.id);
    try {
      await addDoc(collection(db, 'routeAssignments'), {
        driverId: lastDriver.id,
        bookingId: booking.id,
        weekStart: range.start,
        daysWorked: booking.daysOfWeek || [],
        weeklyPayout: (booking.weeklyRate || 0) * ((lastDriver.payoutSplit ?? 70) / 100),
        status: 'pending',
        paidDate: null,
        createdAt: serverTimestamp(),
      });
      toast.success(`Assignment renewed for ${lastDriver.name}`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to renew assignment');
    } finally {
      setRenewing(null);
    }
  }, [range.start]);

  const markPaymentFn = useCallback(
    async (args: { assignmentIds: string[] }) => {
      const markFn = httpsCallable<{ assignmentIds: string[] }, { success: boolean }>(
        getFunctions(), 'markPayment'
      );
      return markFn(args);
    },
    [],
  );

  const markPaid = async (assignmentId: string) => {
    setMarking(assignmentId);
    try {
      await markPaymentFn({ assignmentIds: [assignmentId] });
      setAssignments(prev =>
        prev.map(a => a.id === assignmentId ? { ...a, status: 'paid' } : a)
      );
      toast.success('Marked as paid');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to mark as paid');
    } finally {
      setMarking(null);
    }
  };

  const markAllPaid = async (driverId: string) => {
    const pendingIds = (byDriver[driverId] || [])
      .filter(a => a.status === 'pending')
      .map(a => a.id);
    if (!pendingIds.length) return;
    setMarking('batch');
    try {
      await markPaymentFn({ assignmentIds: pendingIds });
      setAssignments(prev =>
        prev.map(a => pendingIds.includes(a.id) ? { ...a, status: 'paid' } : a)
      );
    } finally {
      setMarking(null);
    }
  };

  // ── periodAssignments (for all-pending lookup) ─────────────────────────────

  const periodAssignments = useMemo(
    () => Object.values(byDriver).flat(),
    [byDriver],
  );

  const allPendingInPeriod = useMemo(
    () => periodAssignments.filter(a => a.status === 'pending'),
    [periodAssignments],
  );

  const markAllPeriodPaid = async () => {
    const ids = allPendingInPeriod.map(a => a.id);
    if (!ids.length) return;
    setMarking('batch-all');
    try {
      // Batch in chunks of 245 (server limit)
      for (let i = 0; i < ids.length; i += 245) {
        await markPaymentFn({ assignmentIds: ids.slice(i, i + 245) });
      }
      setAssignments(prev =>
        prev.map(a => ids.includes(a.id) ? { ...a, status: 'paid' } : a)
      );
    } finally {
      setMarking(null);
    }
  };

  // ── Stripe payout ────────────────────────────────────────────────────────

  const openPayoutModal = (driver: Driver) => {
    const pendingIds = (byDriver[driver.id] || [])
      .filter(a => a.status === 'pending')
      .map(a => a.id);
    const total = (byDriver[driver.id] || [])
      .filter(a => a.status === 'pending')
      .reduce((s, a) => s + (a.weeklyPayout || 0), 0);
    setPayoutModal({ driverId: driver.id, driverName: driver.name, pendingIds, defaultAmount: total });
    setPayoutAmount(total.toFixed(2));
  };

  const issueStripePayout = async () => {
    if (!payoutModal) return;
    const cents = Math.round(parseFloat(payoutAmount) * 100);
    if (!cents || cents <= 0) { toast.error('Enter a valid amount'); return; }
    setIssuingPayout(true);
    try {
      const payoutFn = httpsCallable<{ driverId: string; amountCents: number }, { success: boolean }>(
        getFunctions(), 'issueDriverPayout'
      );
      await payoutFn({ driverId: payoutModal.driverId, amountCents: cents });
      // Also mark the assignments as paid in Firestore
      if (payoutModal.pendingIds.length > 0) {
        await markPaymentFn({ assignmentIds: payoutModal.pendingIds });
        setAssignments(prev =>
          prev.map(a => payoutModal.pendingIds.includes(a.id) ? { ...a, status: 'paid' } : a)
        );
      }
      toast.success(`$${(cents / 100).toFixed(2)} payout sent to ${payoutModal.driverName}`);
      setPayoutModal(null);
    } catch (err: any) {
      toast.error(err?.message ?? 'Payout failed');
    } finally {
      setIssuingPayout(false);
    }
  };

  // ── revenue calculations ──────────────────────────────────────────────────

  const revenueStats = useMemo(() => {
    const interval = { start: range.start, end: range.end };
    let expected = 0;
    let confirmedRuns = 0;
    const byClient: Record<string, { name: string; expected: number; actual: number }> = {};

    bookings
      .filter(b => b.status === 'active')
      .forEach(b => {
        const cName     = clients.find(c => c.id === b.clientId)?.name || 'Unknown';
        // weeklyRate is the source of truth (client page edits always update it).
        const daysCount = b.daysOfWeek?.length || 5;
        const dr        = b.weeklyRate ? b.weeklyRate / daysCount : (b.dailyRate || 0);
        const days      = periodDays.filter(d => (b.daysOfWeek || []).includes(DAY_FULL[d.getDay()]));
        const exp       = days.length * dr;
        expected += exp;
        (byClient[b.clientId] ??= { name: cName, expected: 0, actual: 0 }).expected += exp;
      });

    let actual = 0;

    // Primary source: route logs confirmed as ran
    const countedKeys = new Set<string>(); // "bookingId:YYYY-MM-DD"
    routeLogs
      .filter(l => l.ran && isWithinInterval(new Date(l.date + 'T00:00:00'), interval))
      .forEach(l => {
        const booking = bookings.find(b => b.id === l.bookingId);
        if (!booking) return;
        const daysCount = booking.daysOfWeek?.length || 5;
        const dr        = booking.weeklyRate ? booking.weeklyRate / daysCount : (booking.dailyRate || 0);
        actual += dr;
        confirmedRuns += 1;
        countedKeys.add(`${l.bookingId}:${l.date}`);
        if (byClient[booking.clientId]) byClient[booking.clientId].actual += dr;
      });

    // Secondary source: paid assignments without matching route logs.
    // Handles the case where admin marks payment manually without driver route log entries.
    assignments
      .filter(a => a.status === 'paid' && isWithinInterval(toDate(a.weekStart), interval))
      .forEach(a => {
        const booking = bookings.find(b => b.id === a.bookingId);
        if (!booking) return;
        const daysCount = booking.daysOfWeek?.length || 5;
        const dr        = booking.weeklyRate ? booking.weeklyRate / daysCount : (booking.dailyRate || 0);
        const workedDays = a.daysWorked?.length ? a.daysWorked : (booking.daysOfWeek || []);
        const weekMonday = startOfWeek(toDate(a.weekStart), { weekStartsOn: 1 });

        workedDays.forEach(dayName => {
          // Calculate the date for this day within the assignment's Mon-based week
          const dayIndex = (DAY_FULL as readonly string[]).indexOf(dayName);
          if (dayIndex < 0) return;
          const offset  = (dayIndex - 1 + 7) % 7; // days since Monday
          const dayDate = addDays(weekMonday, offset);
          const dateStr = fmt(dayDate);
          const key     = `${a.bookingId}:${dateStr}`;

          // Only count if not already covered by a route log
          if (!countedKeys.has(key)) {
            actual += dr;
            confirmedRuns += 1;
            countedKeys.add(key);
            if (byClient[booking.clientId]) byClient[booking.clientId].actual += dr;
          }
        });
      });

    return { expected, actual, confirmedRuns, byClient: Object.values(byClient) };
  }, [bookings, clients, routeLogs, assignments, periodDays, range]);

  const variance = revenueStats.actual - revenueStats.expected;

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div className="print:bg-white">
      {/* Wrapper: hidden during stub print or print-all so only the PayStubs show */}
      <div className={(printStubDriver || printAllStubs) ? 'print:hidden' : ''}>
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-8 py-6 flex items-start justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-white">Payroll & Revenue</h1>
          <p className="text-amber-100 text-sm">Driver pay · business income · period reports</p>
        </div>
        {totalOutstanding > 0 && (
          <div className="text-right flex items-center gap-4">
            <div>
              <div className="text-xs text-amber-100 uppercase tracking-wide">Outstanding</div>
              <div className="text-2xl font-bold text-white">${totalOutstanding.toFixed(2)}</div>
            </div>
            <button
              onClick={markAllPeriodPaid}
              disabled={marking === 'batch-all'}
              className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-60"
            >
              {marking === 'batch-all'
                ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <DollarSign size={15} />}
              Pay All Drivers
            </button>
          </div>
        )}
      </div>

      {/* Print-only header (only for global print, not stub/print-all print) */}
      <div className={(printStubDriver || printAllStubs) ? 'hidden' : 'hidden print:block px-8 pt-6 pb-2 border-b border-slate-300'}>
        <h1 className="text-xl font-bold text-slate-800">
          KIDZ Transportation — {tab === 'payroll' ? 'Payroll' : tab === 'revenue' ? 'Revenue' : 'W-2'} Report
        </h1>
        <p className="text-slate-500 text-sm">{range.label} · Printed {format(new Date(), 'MM/dd/yyyy h:mm a')}</p>
      </div>

      {/* Controls */}
      <div className="px-8 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center gap-4 print:hidden">
        <div className="flex rounded-xl bg-slate-100 p-1 gap-1">
          {(['payroll', 'revenue', 'w2'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                tab === t ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t === 'payroll' ? 'Driver Pay' : t === 'revenue' ? 'Revenue' : 'W-2 Stubs'}
            </button>
          ))}
        </div>

        {tab !== 'w2' && (
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
            {(['week', 'month', 'year'] as const).map(m => (
              <button key={m} onClick={() => handleModeChange(m)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                  mode === m ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {tab !== 'w2' && (
          <div className="flex items-center gap-1">
            <button onClick={() => setOffset(o => o - 1)} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
              <ChevronLeft size={17} />
            </button>
            <span className="text-sm font-semibold text-slate-700 min-w-[130px] text-center">{range.label}</span>
            <button onClick={() => setOffset(o => o + 1)} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
              <ChevronRight size={17} />
            </button>
            {offset !== 0 && (
              <button onClick={() => setOffset(0)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium ml-1">
                Current
              </button>
            )}
          </div>
        )}

        <button
          onClick={() => loadData()}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-800 border border-slate-300 hover:border-slate-400 px-3 py-1.5 rounded-lg transition-colors"
        >
          ↺ Refresh
        </button>
        {tab !== 'w2' && (
          <button
            onClick={() => { setPrintAllStubs(true); setTimeout(() => { window.print(); setPrintAllStubs(false); }, 100); }}
            className="ml-auto flex items-center gap-1.5 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white px-4 py-1.5 rounded-lg transition-colors shadow-sm"
          >
            <Printer size={15} /> Print All Pay Stubs
          </button>
        )}
      </div>

      {/* ── PAYROLL TAB ──────────────────────────────────────────────────── */}
      {tab === 'payroll' && (
        <div className="p-8">
          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 animate-pulse h-36" />
              ))}
            </div>
          ) : driversInPeriod.length === 0 ? (
            <div className="text-center py-24">
              <DollarSign size={48} className="mx-auto text-slate-300 mb-4" />
              <p className="text-slate-600 font-semibold">No drivers found</p>
              <p className="text-slate-400 text-sm mt-1">Add drivers to see payroll entries here.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {driversInPeriod.map(driver => {
                const dAssignments = byDriver[driver.id] || [];
                const expected = dAssignments.reduce((s, a) => s + (a.weeklyPayout || 0), 0);
                const actual   = dAssignments.reduce((s, a) => s + actualPayForAssignment(a), 0);
                const diff     = 0; // With weeklyPayout as source of truth, expected === actual

                return (
                  <div key={driver.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden print:break-inside-avoid">
                    {/* Driver header */}
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center text-amber-700 font-bold text-lg">
                          {driver.name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-800">{driver.name}</div>
                          <div className="text-xs text-slate-500">
                            {dAssignments.length} assignment{dAssignments.length !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-5">
                        <div className="text-center">
                          <div className="text-xs text-slate-400 uppercase tracking-wide">Expected</div>
                          <div className="text-base font-bold text-slate-700">${expected.toFixed(2)}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-slate-400 uppercase tracking-wide">Actual</div>
                          <div className="text-base font-bold text-emerald-600">${actual.toFixed(2)}</div>
                        </div>
                        {diff !== 0 && (
                          <div className="text-center">
                            <div className="text-xs text-slate-400 uppercase tracking-wide">Variance</div>
                            <div className={`text-base font-bold ${diff < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                              {diff < 0 ? '−' : '+'}${Math.abs(diff).toFixed(2)}
                            </div>
                          </div>
                        )}
                        {(byDriver[driver.id] || []).filter(a => a.status === 'pending').length > 1 && (
                          <button
                            onClick={() => markAllPaid(driver.id)}
                            className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors print:hidden"
                          >
                            <Check size={12} /> Mark Paid
                          </button>
                        )}
                        {driver.stripeConnectPayoutsEnabled &&
                          (byDriver[driver.id] || []).some(a => a.status === 'pending') && (
                          <button
                            onClick={() => openPayoutModal(driver)}
                            className="flex items-center gap-1 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors print:hidden"
                          >
                            <Zap size={12} /> Stripe Payout
                          </button>
                        )}
                        <button
                          onClick={() => setPrintStubDriver(driver)}
                          className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors print:hidden shadow-sm"
                        >
                          <Printer size={12} /> Print Stub
                        </button>
                      </div>
                    </div>

                    {/* Week grid */}
                    {mode === 'week' && (
                      <div className="px-6 py-4 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr>
                              <th className="text-left pr-4 pb-2 text-slate-400 font-medium w-32">Route</th>
                              {periodDays.map(d => (
                                <th key={fmt(d)} className="pb-2 text-center text-slate-400 font-medium px-1 min-w-[38px]">
                                  {DAY_ABBR[d.getDay()]}
                                  <div className="text-[10px] text-slate-300">{format(d, 'd')}</div>
                                </th>
                              ))}
                              <th className="pb-2 text-right text-slate-400 font-medium pl-3">Pay</th>
                              <th className="pb-2 pl-3 print:hidden" />
                            </tr>
                          </thead>
                          <tbody>
                            {dAssignments.map(a => {
                              const booking    = bookings.find(b => b.id === a.bookingId);
                              const client     = booking ? clients.find(c => c.id === booking.clientId) : null;
                              const aWeekStart = toDate(a.weekStart);
                              const aMonday    = fmt(startOfWeek(aWeekStart, { weekStartsOn: 1 }));
                              const isThisWeek = aMonday === fmt(range.start);

                              // Pending from a different week → compact "past due" row (no day grid)
                              if (!isThisWeek) {
                                return (
                                  <tr key={a.id} className="border-t border-slate-50 bg-amber-50/40">
                                    <td className="pr-4 py-2.5">
                                      <div className="font-medium text-slate-700 truncate max-w-[120px]">
                                        {client?.name || 'Unknown'}
                                      </div>
                                      <div className="text-[10px] text-amber-600 font-semibold mt-0.5">
                                        Wk of {format(startOfWeek(aWeekStart, { weekStartsOn: 1 }), 'MMM d')}
                                      </div>
                                    </td>
                                    <td colSpan={periodDays.length} className="py-2.5 px-2">
                                      <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full font-medium">
                                        Past due · {(a.daysWorked || []).map(d => d.slice(0, 2)).join(', ')}
                                      </span>
                                    </td>
                                    <td className="text-right py-2.5 pl-3 whitespace-nowrap">
                                      <div className="font-bold text-slate-700">${(a.weeklyPayout || 0).toFixed(2)}</div>
                                      <div className="text-[10px] text-slate-400">weekly</div>
                                    </td>
                                    <td className="py-2.5 pl-3 print:hidden">
                                      {a.status === 'paid' ? (
                                        <span className="flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                                          <CheckCircle size={11} /> Paid
                                        </span>
                                      ) : (
                                        <button
                                          onClick={() => markPaid(a.id)}
                                          disabled={marking === a.id}
                                          className="flex items-center gap-1 text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-semibold transition-colors disabled:opacity-60 whitespace-nowrap"
                                        >
                                          {marking === a.id
                                            ? <span className="w-3 h-3 border border-amber-700 border-t-transparent rounded-full animate-spin" />
                                            : <Check size={11} />}
                                          Mark Paid
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              }

                              const aDays = a.daysWorked || [];
                              return (
                                <tr key={a.id} className="border-t border-slate-50">
                                  <td className="pr-4 py-2.5">
                                    <div className="font-medium text-slate-700 truncate max-w-[120px]">
                                      {client?.name || 'Unknown'}
                                    </div>
                                  </td>
                                  {periodDays.map(d => {
                                    const dayName = DAY_FULL[d.getDay()];
                                    const worked = aDays.includes(dayName);
                                    return (
                                      <td key={fmt(d)} className="text-center py-2.5 px-1">
                                        {worked ? (
                                          <CheckCircle size={14} className="mx-auto text-emerald-500" />
                                        ) : (
                                          <span className="text-slate-300">—</span>
                                        )}
                                      </td>
                                    );
                                  })}
                                  <td className="text-right py-2.5 pl-3 whitespace-nowrap">
                                    <div className="font-bold text-slate-700">${(a.weeklyPayout || 0).toFixed(2)}</div>
                                  </td>
                                  <td className="py-2.5 pl-3 print:hidden">
                                    {a.status === 'paid' ? (
                                      <span className="flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                                        <CheckCircle size={11} /> Paid
                                      </span>
                                    ) : (
                                      <button
                                        onClick={() => markPaid(a.id)}
                                        disabled={marking === a.id}
                                        className="flex items-center gap-1 text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-semibold transition-colors disabled:opacity-60 whitespace-nowrap"
                                      >
                                        {marking === a.id
                                          ? <span className="w-3 h-3 border border-amber-700 border-t-transparent rounded-full animate-spin" />
                                          : <Check size={11} />}
                                        Mark Paid
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Month / Year: simple list */}
                    {mode !== 'week' && (
                      <div className="divide-y divide-slate-50">
                        {dAssignments.map(a => {
                          const booking = bookings.find(b => b.id === a.bookingId);
                          const client  = booking ? clients.find(c => c.id === booking.clientId) : null;
                          return (
                            <div key={a.id} className="px-6 py-3.5 flex items-center justify-between gap-4">
                              <div>
                                <div className="text-sm font-medium text-slate-700">{client?.name || 'Unknown'}</div>
                                <div className="text-xs text-slate-400">
                                  {format(toDate(a.weekStart), 'MMM d')} · {a.daysWorked?.join(', ') || '—'}
                                </div>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                <div className="text-sm font-bold text-slate-800">${(a.weeklyPayout || 0).toFixed(2)}</div>
                                {a.status === 'paid' ? (
                                  <span className="flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full font-medium">
                                    <CheckCircle size={11} /> Paid
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => markPaid(a.id)}
                                    disabled={marking === a.id}
                                    className="flex items-center gap-1 text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 px-2.5 py-1 rounded-full font-semibold transition-colors disabled:opacity-60"
                                  >
                                    {marking === a.id
                                      ? <span className="w-3 h-3 border border-amber-700 border-t-transparent rounded-full animate-spin" />
                                      : <Check size={11} />}
                                    Mark Paid
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Unassigned & carry-over active routes ──────────────────────── */}
          {!loading && (neverAssignedRoutes.length > 0 || carryOverRoutes.length > 0) && (
            <div className="mt-6 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle size={15} className="text-amber-500" />
                <h3 className="text-sm font-bold text-slate-700">Active Routes Without This Period's Assignment</h3>
              </div>

              {/* Never-assigned routes */}
              {neverAssignedRoutes.map(b => {
                const client = clients.find(c => c.id === b.clientId);
                const daysCount = b.daysOfWeek?.length || 5;
                const dr = b.weeklyRate ? b.weeklyRate / daysCount : (b.dailyRate || 0);
                const periodExpected = periodDays.filter(d => (b.daysOfWeek || []).includes(DAY_FULL[d.getDay()])).length * dr;
                return (
                  <div key={b.id} className="bg-white border border-amber-200 rounded-2xl px-5 py-4 flex items-center justify-between gap-4 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-amber-100 rounded-full flex items-center justify-center text-amber-600 font-bold text-sm flex-shrink-0">
                        {(client?.name || '?').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800">{client?.name || 'Unknown Client'}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {b.daysOfWeek?.join(', ') || 'No days set'} · ${b.weeklyRate?.toFixed(2) || '0.00'}/wk
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <div className="text-right">
                        <div className="text-xs text-slate-400 uppercase tracking-wide">Period Expected</div>
                        <div className="text-sm font-bold text-slate-700">${periodExpected.toFixed(2)}</div>
                      </div>
                      <span className="text-xs bg-red-100 text-red-700 px-2.5 py-1 rounded-full font-semibold whitespace-nowrap">
                        No Driver Assigned
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* Carry-over routes (assigned before, not renewed this period) */}
              {carryOverRoutes.map(({ booking: b, assignment: a, driver }) => {
                const client = clients.find(c => c.id === b.clientId);
                const daysCount = b.daysOfWeek?.length || 5;
                const dr = b.weeklyRate ? b.weeklyRate / daysCount : (b.dailyRate || 0);
                const periodExpected = periodDays.filter(d => (b.daysOfWeek || []).includes(DAY_FULL[d.getDay()])).length * dr;
                const isRenewing = renewing === b.id;
                return (
                  <div key={b.id} className="bg-white border border-slate-200 rounded-2xl px-5 py-4 flex items-center justify-between gap-4 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 font-bold text-sm flex-shrink-0">
                        {(client?.name || '?').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800">{client?.name || 'Unknown Client'}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {b.daysOfWeek?.join(', ') || 'No days set'} · ${b.weeklyRate?.toFixed(2) || '0.00'}/wk
                          {driver && <span className="ml-2 text-indigo-600">· {driver.name}</span>}
                          {a && <span className="ml-1 text-slate-400">(last: {format(toDate(a.weekStart), 'MMM d')})</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <div className="text-xs text-slate-400 uppercase tracking-wide">Period Expected</div>
                        <div className="text-sm font-bold text-slate-700">${periodExpected.toFixed(2)}</div>
                      </div>
                      {driver ? (
                        <button
                          onClick={() => renewAssignment(b, driver)}
                          disabled={isRenewing}
                          className="flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors disabled:opacity-60 whitespace-nowrap"
                        >
                          {isRenewing
                            ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            : <Check size={12} />}
                          {isRenewing ? 'Renewing…' : `Renew — ${driver.name}`}
                        </button>
                      ) : (
                        <span className="text-xs bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full font-semibold whitespace-nowrap">
                          No Period Assignment
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {tab === 'w2' && (
        <div className="p-8">
          {/* Actions bar */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold text-slate-800">W-2 Employee Pay Stubs</h2>
              <p className="text-sm text-slate-500 mt-0.5">Manage pay stubs for W-2 employees (Kara Noland)</p>
            </div>
            <button
              onClick={() => setShowW2Form(true)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-sm"
            >
              <FileText size={16} /> Create W-2 Pay Stub
            </button>
          </div>

          {/* Stubs table */}
          {w2Loading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse h-16" />
              ))}
            </div>
          ) : w2Stubs.length === 0 ? (
            <div className="text-center py-24">
              <FileText size={48} className="mx-auto text-slate-300 mb-4" />
              <p className="text-slate-600 font-semibold">No W-2 pay stubs yet</p>
              <p className="text-slate-400 text-sm mt-1">Create your first W-2 pay stub using the button above.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Check Date</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Pay Period</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Employee</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Gross</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Net Pay</th>
                    <th className="text-center px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {w2Stubs.map(stub => (
                    <tr key={stub.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-3.5 font-medium text-slate-700">
                        {format(new Date(stub.checkDate + 'T00:00:00'), 'MM/dd/yyyy')}
                      </td>
                      <td className="px-6 py-3.5 text-slate-600">
                        {format(new Date(stub.payPeriodStart + 'T00:00:00'), 'MM/dd/yy')} – {format(new Date(stub.payPeriodEnd + 'T00:00:00'), 'MM/dd/yy')}
                      </td>
                      <td className="px-6 py-3.5 text-slate-700">{stub.employeeName}</td>
                      <td className="px-6 py-3.5 text-right text-slate-700 font-medium">{fmtDollar(stub.grossSalary)}</td>
                      <td className="px-6 py-3.5 text-right text-emerald-600 font-semibold">{fmtDollar(stub.netPay)}</td>
                      <td className="px-6 py-3.5">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleDownloadW2PDF(stub)}
                            className="flex items-center gap-1 text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-2.5 py-1.5 rounded-lg font-semibold transition-colors"
                          >
                            <Printer size={12} /> Print / PDF
                          </button>
                          <button
                            onClick={() => handleDeleteW2(stub.id)}
                            disabled={deletingW2 === stub.id}
                            className="flex items-center gap-1 text-xs bg-red-50 hover:bg-red-100 text-red-600 px-2.5 py-1.5 rounded-lg font-semibold transition-colors disabled:opacity-60"
                          >
                            {deletingW2 === stub.id
                              ? <span className="w-3 h-3 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                              : <Trash2 size={12} />}
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      </div>{/* end print:hidden wrapper */}

      {/* ── STRIPE PAYOUT MODAL ─────────────────────────────────────────── */}
      {payoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Zap size={18} className="text-violet-600" /> Stripe Payout
              </h2>
              <button onClick={() => setPayoutModal(null)} className="p-1.5 hover:bg-slate-100 rounded-lg">
                <X size={16} className="text-slate-500" />
              </button>
            </div>
            <p className="text-sm text-slate-600 mb-1">
              Sending to <span className="font-semibold">{payoutModal.driverName}</span>
            </p>
            <p className="text-xs text-slate-400 mb-4">
              Funds transfer via Stripe Connect · pending assignments will be marked paid
            </p>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              Amount ($)
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={payoutAmount}
              onChange={e => setPayoutAmount(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setPayoutModal(null)}
                className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl py-2.5 text-sm font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={issueStripePayout}
                disabled={issuingPayout}
                className="flex-1 bg-violet-600 hover:bg-violet-700 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
              >
                {issuingPayout
                  ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Zap size={14} />}
                {issuingPayout ? 'Sending…' : `Send $${payoutAmount}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PRINT STUB MODAL ────────────────────────────────────────────── */}
      {printStubDriver && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden"
          onClick={() => setPrintStubDriver(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-4xl flex flex-col"
            style={{ maxHeight: '90vh' }}
            onClick={e => e.stopPropagation()}
            onKeyDown={undefined}
          >
            {/* Sticky header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-slate-200 flex-shrink-0">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Printer size={18} className="text-slate-600" /> Pay Stub Preview
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-800 text-white rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors"
                >
                  <Printer size={14} /> Print
                </button>
                <button
                  onClick={() => setPrintStubDriver(null)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg"
                  title="Close (Esc)"
                >
                  <X size={18} className="text-slate-500" />
                </button>
              </div>
            </div>
            {/* Scrollable content */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
              <PayStub
                driver={printStubDriver}
                assignments={resolvedAssignmentsFor(printStubDriver.id)}
                bookings={bookings}
                clients={clients}
                periodLabel={range.label}
                periodStart={range.start}
                periodEnd={range.end}
                printedAt={new Date()}
                preview
              />
            </div>
            {/* Sticky footer */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 flex-shrink-0 bg-slate-50 rounded-b-2xl">
              <span className="text-xs text-slate-400">Press <kbd className="px-1.5 py-0.5 bg-slate-200 rounded text-xs font-mono">Esc</kbd> or click outside to close</span>
              <button
                onClick={() => setPrintStubDriver(null)}
                className="border border-slate-200 text-slate-600 hover:bg-white rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print-only full-page PayStub */}
      {printStubDriver && (
        <div className="hidden print:block p-8">
          <PayStub
            driver={printStubDriver}
            assignments={resolvedAssignmentsFor(printStubDriver.id)}
            bookings={bookings}
            clients={clients}
            periodLabel={range.label}
            periodStart={range.start}
            periodEnd={range.end}
            printedAt={new Date()}
          />
        </div>
      )}

      {/* Print-only ALL driver PayStubs (when "Print All Pay Stubs" clicked) */}
      {printAllStubs && (
        <div className="hidden print:block">
          {driversInPeriod.map((driver, idx) => (
            <div key={driver.id} className={idx > 0 ? 'print:break-before-page' : ''}>
              <PayStub
                driver={driver}
                assignments={resolvedAssignmentsFor(driver.id)}
                bookings={bookings}
                clients={clients}
                periodLabel={range.label}
                periodStart={range.start}
                periodEnd={range.end}
                printedAt={new Date()}
                printMode="batch"
              />
            </div>
          ))}
        </div>
      )}

      {/* ── REVENUE TAB ──────────────────────────────────────────────────── */}
      {tab === 'revenue' && (
        <div className="p-8">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <BarChart2 size={16} className="text-indigo-500" />
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Expected</span>
              </div>
              <div className="text-2xl font-bold text-slate-800">${revenueStats.expected.toFixed(2)}</div>
              <div className="text-xs text-slate-400 mt-1">Based on active bookings</div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={16} className="text-emerald-500" />
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Actual</span>
              </div>
              <div className="text-2xl font-bold text-emerald-600">${revenueStats.actual.toFixed(2)}</div>
              <div className="text-xs text-slate-400 mt-1">From confirmed runs</div>
            </div>
            <div className={`bg-white rounded-2xl border p-5 shadow-sm ${variance < 0 ? 'border-red-200' : 'border-emerald-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown size={16} className={variance < 0 ? 'text-red-400' : 'text-emerald-400'} />
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Variance</span>
              </div>
              <div className={`text-2xl font-bold ${variance < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                {variance < 0 ? '−' : '+'}${Math.abs(variance).toFixed(2)}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                {revenueStats.expected > 0
                  ? `${((revenueStats.actual / revenueStats.expected) * 100).toFixed(1)}% collected`
                  : 'No expected revenue'}
              </div>
            </div>
          </div>

          {/* View toggle */}
          <div className="flex items-center justify-between mb-4 print:hidden">
            <div className="flex rounded-xl bg-slate-100 p-1 gap-1">
              {(['summary', 'client'] as const).map(v => (
                <button key={v} onClick={() => setRevenueView(v)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all capitalize ${
                    revenueView === v ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {v === 'client' ? 'By Client' : 'Summary'}
                </button>
              ))}
            </div>
          </div>

          {/* By-client table */}
          {revenueView === 'client' && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Client</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Expected</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actual</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {revenueStats.byClient.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-10 text-center text-slate-400">
                        No active bookings in this period
                      </td>
                    </tr>
                  ) : (
                    revenueStats.byClient
                      .sort((a, b) => b.expected - a.expected)
                      .map((row, i) => {
                        const pct = row.expected > 0 ? (row.actual / row.expected * 100) : 0;
                        return (
                          <tr key={i}>
                            <td className="px-6 py-3 font-medium text-slate-700">{row.name}</td>
                            <td className="px-6 py-3 text-right text-slate-600">${row.expected.toFixed(2)}</td>
                            <td className="px-6 py-3 text-right font-semibold text-emerald-600">${row.actual.toFixed(2)}</td>
                            <td className="px-6 py-3 text-right">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                pct >= 90 ? 'bg-emerald-100 text-emerald-700' :
                                pct >= 60 ? 'bg-amber-100 text-amber-700' :
                                'bg-red-100 text-red-600'
                              }`}>
                                {pct.toFixed(0)}%
                              </span>
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold">
                    <td className="px-6 py-3 text-slate-700">Total</td>
                    <td className="px-6 py-3 text-right text-slate-700">${revenueStats.expected.toFixed(2)}</td>
                    <td className="px-6 py-3 text-right text-emerald-600">${revenueStats.actual.toFixed(2)}</td>
                    <td className="px-6 py-3 text-right text-slate-500">
                      {revenueStats.expected > 0
                        ? `${(revenueStats.actual / revenueStats.expected * 100).toFixed(0)}%`
                        : '—'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Summary view */}
          {revenueView === 'summary' && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Business Summary — {range.label}</h3>
              <div className="space-y-3">
                {[
                  { label: 'Active bookings', value: bookings.filter(b => b.status === 'active').length, color: 'text-slate-800' },
                  {
                    label: 'Confirmed runs (ran)',
                    value: revenueStats.confirmedRuns,
                    color: 'text-emerald-600',
                  },
                  {
                    label: 'Missed runs',
                    value: routeLogs.filter(l => !l.ran && isWithinInterval(new Date(l.date + 'T00:00:00'), { start: range.start, end: range.end })).length,
                    color: 'text-red-500',
                  },
                  { label: 'Expected revenue',          value: `$${revenueStats.expected.toFixed(2)}`,            color: 'text-slate-800' },
                  { label: 'Actual revenue',            value: `$${revenueStats.actual.toFixed(2)}`,              color: 'text-emerald-600' },
                  { label: 'Driver cost (70% of actual)', value: `$${(revenueStats.actual * 0.70).toFixed(2)}`,   color: 'text-amber-600' },
                  { label: 'Net to business (30%)',      value: `$${(revenueStats.actual * 0.30).toFixed(2)}`,   color: 'text-violet-700' },
                ].map(row => (
                  <div key={row.label} className="flex justify-between items-center py-2 border-b border-slate-100">
                    <span className="text-sm text-slate-600">{row.label}</span>
                    <span className={`font-semibold ${row.color}`}>{row.value}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm font-semibold text-slate-700">Variance</span>
                  <span className={`font-bold text-lg ${variance < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                    {variance < 0 ? '−' : '+'}${Math.abs(variance).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── W-2 FORM MODAL ────────────────────────────────────────────────── */}
      {showW2Form && (
        <W2PayStubForm
          open={showW2Form}
          onSaved={handleW2Saved}
          onClose={() => setShowW2Form(false)}
          existingStubs={w2Stubs}
        />
      )}
    </div>
  );
};

export default Payroll;