import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  collection, getDocs,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../services/firebase';
import type { RouteAssignment, Driver, Booking, Client, RouteLog } from '../../types';
import PayStub from '../../components/payroll/PayStub';
import {
  format, addWeeks, addMonths, addYears,
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear,
  eachDayOfInterval, isWithinInterval,
} from 'date-fns';
import {
  DollarSign, CheckCircle, Check, ChevronLeft, ChevronRight, Printer,
  TrendingUp, TrendingDown, BarChart2, Zap, X,
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

// ── component ────────────────────────────────────────────────────────────────

const Payroll: React.FC = () => {
  const [tab,         setTab]         = useState<'payroll' | 'revenue'>('payroll');
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

  const [printStubDriver, setPrintStubDriver] = useState<Driver | null>(null);
  const [printAllStubs, setPrintAllStubs] = useState(false);

  // Stripe payout modal
  const [payoutModal, setPayoutModal] = useState<{
    driverId: string; driverName: string; pendingIds: string[]; defaultAmount: number;
  } | null>(null);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [issuingPayout, setIssuingPayout] = useState(false);

  // One-time fetch — payroll data is not live; re-fetch after mark-paid actions
  const loadData = useCallback(async () => {
    setLoading(true);
    const [a, d, b, c, l] = await Promise.all([
      getDocs(collection(db, 'routeAssignments')),
      getDocs(collection(db, 'drivers')),
      getDocs(collection(db, 'bookings')),
      getDocs(collection(db, 'clients')),
      getDocs(collection(db, 'routeLogs')),
    ]);
    setAssignments(a.docs.map(doc => ({ id: doc.id, ...doc.data() }) as RouteAssignment));
    setDrivers(d.docs.map(doc     => ({ id: doc.id, ...doc.data() }) as Driver));
    setBookings(b.docs.map(doc    => ({ id: doc.id, ...doc.data() }) as Booking));
    setClients(c.docs.map(doc     => ({ id: doc.id, ...doc.data() }) as Client));
    setRouteLogs(l.docs.map(doc   => ({ id: doc.id, ...doc.data() }) as RouteLog));
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleModeChange = (m: PeriodMode) => { setMode(m); setOffset(0); };

  const range = useMemo(() => buildRange(mode, offset), [mode, offset]);

  const periodDays = useMemo(
    () => eachDayOfInterval({ start: range.start, end: range.end }),
    [range],
  );

  // ── routeLog lookup ───────────────────────────────────────────────────────

  const logsByDate = useMemo(() => {
    const map: Record<string, RouteLog[]> = {};
    routeLogs.forEach(l => { (map[l.date] ??= []).push(l); });
    return map;
  }, [routeLogs]);

  const getLog = (bookingId: string, date: Date): RouteLog | undefined =>
    (logsByDate[fmt(date)] || []).find(l => l.bookingId === bookingId);

  // ── payroll calculations ──────────────────────────────────────────────────

  // Pending: always surface ALL outstanding assignments regardless of weekStart.
  // This ensures routes assigned in prior weeks but never marked paid always appear.
  const pendingAssignments = useMemo(
    () => assignments.filter(a => a.status === 'pending'),
    [assignments],
  );

  // Paid: only those whose paidDate falls within the selected period.
  const paidInPeriod = useMemo(() =>
    assignments.filter(a => {
      if (a.status !== 'paid') return false;
      const pd = a.paidDate ? toDate(a.paidDate) : null;
      return pd ? isWithinInterval(pd, { start: range.start, end: range.end }) : false;
    }),
    [assignments, range],
  );

  // Combined for driver cards: pending always visible, paid scoped to period.
  const periodAssignments = useMemo(
    () => [...pendingAssignments, ...paidInPeriod],
    [pendingAssignments, paidInPeriod],
  );

  const dailyRateFor = (a: RouteAssignment) =>
    a.daysWorked?.length ? a.weeklyPayout / a.daysWorked.length : 0;

  const actualPayForAssignment = (a: RouteAssignment): number => {
    const ws   = toDate(a.weekStart);
    const we   = endOfWeek(ws, { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: ws, end: we });
    const rate = dailyRateFor(a);
    return days.reduce((sum, day) => {
      if (!(a.daysWorked || []).includes(DAY_FULL[day.getDay()])) return sum;
      const log = getLog(a.bookingId, day);
      return sum + (log?.ran ? rate : 0);
    }, 0);
  };

  const byDriver = useMemo(() => {
    const map: Record<string, RouteAssignment[]> = {};
    periodAssignments.forEach(a => { (map[a.driverId] ??= []).push(a); });
    return map;
  }, [periodAssignments]);

  // Show ALL drivers always so Print Stub is accessible regardless of period activity.
  // Drivers without period assignments still appear with an empty assignment list.
  const driversInPeriod = useMemo(
    () => drivers,
    [drivers],
  );

  // Outstanding = ALL pending assignments, not scoped to the selected period.
  const totalOutstanding = useMemo(
    () => pendingAssignments.reduce((s, a) => s + (a.weeklyPayout || 0), 0),
    [pendingAssignments],
  );

  // Cloud Function callable — validates admin role + writes atomically server-side
  const markPaymentFn = httpsCallable<{ assignmentIds: string[] }, { marked: number }>(
    getFunctions(), 'markPayment'
  );

  const markPaid = async (id: string) => {
    setMarking(id);
    try {
      await markPaymentFn({ assignmentIds: [id] });
      // Update local state immediately so the UI reflects the change
      setAssignments(prev =>
        prev.map(a => a.id === id ? { ...a, status: 'paid' } : a)
      );
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
    routeLogs
      .filter(l => l.ran && isWithinInterval(new Date(l.date + 'T00:00:00'), interval))
      .forEach(l => {
        const booking = bookings.find(b => b.id === l.bookingId);
        if (!booking) return;
        const daysCount = booking.daysOfWeek?.length || 5;
        const dr        = booking.weeklyRate ? booking.weeklyRate / daysCount : (booking.dailyRate || 0);
        actual += dr;
        if (byClient[booking.clientId]) byClient[booking.clientId].actual += dr;
      });

    return { expected, actual, byClient: Object.values(byClient) };
  }, [bookings, clients, routeLogs, periodDays, range]);

  const variance = revenueStats.actual - revenueStats.expected;

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div className="print:bg-white">
      {/* Wrapper: hidden during stub print or print-all so only the PayStubs show */}
      <div className={(printStubDriver || printAllStubs) ? 'print:hidden' : ''}>
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-8 py-6 flex items-start justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-white">Payroll &amp; Revenue</h1>
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
          KIDZ Transportation — {tab === 'payroll' ? 'Payroll' : 'Revenue'} Report
        </h1>
        <p className="text-slate-500 text-sm">{range.label} · Printed {format(new Date(), 'MM/dd/yyyy h:mm a')}</p>
      </div>

      {/* Controls */}
      <div className="px-8 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center gap-4 print:hidden">
        <div className="flex rounded-xl bg-slate-100 p-1 gap-1">
          {(['payroll', 'revenue'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                tab === t ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t === 'payroll' ? 'Driver Pay' : 'Revenue'}
            </button>
          ))}
        </div>

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

        <button
          onClick={() => loadData()}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-800 border border-slate-300 hover:border-slate-400 px-3 py-1.5 rounded-lg transition-colors"
        >
          ↺ Refresh
        </button>
        <button
          onClick={() => { setPrintAllStubs(true); setTimeout(() => { window.print(); setPrintAllStubs(false); }, 100); }}
          className="ml-auto flex items-center gap-1.5 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white px-4 py-1.5 rounded-lg transition-colors shadow-sm"
        >
          <Printer size={15} /> Print All Pay Stubs
        </button>
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
                const diff     = actual - expected;

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

                              const aActual = actualPayForAssignment(a);
                              return (
                                <tr key={a.id} className="border-t border-slate-50">
                                  <td className="pr-4 py-2">
                                    <div className="font-medium text-slate-700 truncate max-w-[120px]">
                                      {client?.name || 'Unknown'}
                                    </div>
                                    <div className="text-slate-400 truncate max-w-[120px]">
                                      {booking?.pickupAddress || '—'}
                                    </div>
                                  </td>
                                  {periodDays.map(d => {
                                    const scheduled = (a.daysWorked || []).includes(DAY_FULL[d.getDay()]);
                                    const log = getLog(a.bookingId, d);
                                    return (
                                      <td key={fmt(d)} className="text-center py-2 px-1">
                                        {!scheduled ? (
                                          <span className="text-slate-200">—</span>
                                        ) : log?.ran === true ? (
                                          <span className="inline-flex items-center justify-center w-6 h-6 bg-emerald-100 text-emerald-600 rounded-full">✓</span>
                                        ) : log?.ran === false ? (
                                          <span className="inline-flex items-center justify-center w-6 h-6 bg-red-100 text-red-500 rounded-full">✗</span>
                                        ) : (
                                          <span className="inline-flex items-center justify-center w-6 h-6 bg-amber-50 text-amber-400 rounded-full text-[10px] font-bold">?</span>
                                        )}
                                      </td>
                                    );
                                  })}
                                  <td className="text-right py-2 pl-3">
                                    <div className="font-bold text-slate-700">${aActual.toFixed(2)}</div>
                                    <div className="text-slate-400">${(a.weeklyPayout || 0).toFixed(2)} exp</div>
                                  </td>
                                  <td className="py-2 pl-3 print:hidden">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Printer size={18} className="text-slate-600" /> Print Pay Stub
              </h2>
              <button onClick={() => setPrintStubDriver(null)} className="p-1.5 hover:bg-slate-100 rounded-lg">
                <X size={16} className="text-slate-500" />
              </button>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              Print a professional pay stub for <span className="font-semibold">{printStubDriver.name}</span>
            </p>
            <PayStub
              driver={printStubDriver}
              assignments={byDriver[printStubDriver.id] || []}
              bookings={bookings}
              clients={clients}
              periodLabel={range.label}
              periodStart={range.start}
              periodEnd={range.end}
              getLog={getLog}
              dailyRateFor={dailyRateFor}
              printedAt={new Date()}
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setPrintStubDriver(null)}
                className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl py-2.5 text-sm font-semibold transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => window.print()}
                className="flex-1 bg-slate-700 hover:bg-slate-800 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Printer size={14} /> Print Now
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
            assignments={byDriver[printStubDriver.id] || []}
            bookings={bookings}
            clients={clients}
            periodLabel={range.label}
            periodStart={range.start}
            periodEnd={range.end}
            getLog={getLog}
            dailyRateFor={dailyRateFor}
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
                assignments={byDriver[driver.id] || []}
                bookings={bookings}
                clients={clients}
                periodLabel={range.label}
                periodStart={range.start}
                periodEnd={range.end}
                getLog={getLog}
                dailyRateFor={dailyRateFor}
                printedAt={new Date()}
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
                    value: routeLogs.filter(l => l.ran && isWithinInterval(new Date(l.date + 'T00:00:00'), { start: range.start, end: range.end })).length,
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
    </div>
  );
};

export default Payroll;

