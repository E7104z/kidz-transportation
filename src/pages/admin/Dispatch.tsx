import React, { useEffect, useMemo, useRef, useState } from 'react';
import { format, startOfWeek } from 'date-fns';
import {
  AlertTriangle, CheckCircle, XCircle, Wifi, WifiOff,
  Bus, Phone, MapPin, Clock, RefreshCw, Bell, BellOff,
  Satellite, History, CalendarDays, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../context/AuthContext';
import { useDispatchData } from '../../hooks/useDispatchData';
import type { DispatchAlert, DispatchRoute } from '../../hooks/useDispatchData';
import DriverMapView from '../../components/DriverMapView';
import type { Booking, Client, Driver, DriverLocation, RouteAssignment, RouteLog } from '../../types';

// ── helpers ───────────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, { bg: string; border: string; icon: React.ElementType; iconColor: string; label: string }> = {
  critical: { bg: 'bg-red-50',    border: 'border-red-200',   icon: XCircle,       iconColor: 'text-red-500',    label: 'Critical' },
  warning:  { bg: 'bg-amber-50',  border: 'border-amber-200', icon: AlertTriangle, iconColor: 'text-amber-500',  label: 'Warning'  },
  info:     { bg: 'bg-emerald-50',border: 'border-emerald-200',icon: CheckCircle,  iconColor: 'text-emerald-500',label: 'Info'     },
};

const STATUS_STYLES: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  not_started: { label: 'NOT STARTED', bg: 'bg-red-100',    text: 'text-red-700',    dot: 'bg-red-500' },
  in_progress: { label: 'IN PROGRESS', bg: 'bg-blue-100',   text: 'text-blue-700',   dot: 'bg-blue-500 animate-pulse' },
  complete:    { label: 'COMPLETE',    bg: 'bg-emerald-100', text: 'text-emerald-700',dot: 'bg-emerald-500' },
  missed:      { label: 'MISSED',      bg: 'bg-red-100',    text: 'text-red-800',    dot: 'bg-red-600' },
  no_gps:      { label: 'GPS LOST',    bg: 'bg-amber-100',  text: 'text-amber-700',  dot: 'bg-amber-500 animate-pulse' },
  pending:     { label: 'PENDING',     bg: 'bg-slate-100',  text: 'text-slate-500',  dot: 'bg-slate-400' },
};

function fmtAge(secs: number | null): string {
  if (secs === null) return '–';
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)}m ago`;
}

// ── Alert feed item ───────────────────────────────────────────────────────────

const AlertItem: React.FC<{ alert: DispatchAlert; drivers: Record<string, any>; clients: Record<string, any> }> = ({ alert, drivers, clients }) => {
  const s = SEVERITY_STYLES[alert.severity];
  const Icon = s.icon;
  const driver = alert.driverId ? drivers[alert.driverId] : null;
  const client = alert.clientId ? clients[alert.clientId] : null;

  return (
    <div className={`rounded-xl border p-3 ${s.bg} ${s.border}`}>
      <div className="flex items-start gap-2.5">
        <Icon size={16} className={`${s.iconColor} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-xs font-bold uppercase tracking-wide ${s.iconColor}`}>{s.label}</span>
            <span className="text-xs text-slate-400 flex-shrink-0">
              {alert.isToday
                ? format(alert.timestamp, 'h:mm a')
                : format(alert.timestamp, 'MMM d')}
            </span>
          </div>
          <div className="text-sm font-semibold text-slate-800 mt-0.5">{alert.title}</div>
          <div className="text-xs text-slate-600 mt-0.5">{alert.body}</div>
          {/* Quick contact links */}
          {(driver?.phone || client?.phone) && (
            <div className="flex gap-3 mt-2">
              {driver?.phone && (
                <a href={`tel:${driver.phone}`} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
                  <Phone size={11} /> Driver
                </a>
              )}
              {client?.phone && (
                <a href={`tel:${client.phone}`} className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-800 font-medium">
                  <Phone size={11} /> Parent
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Route card ────────────────────────────────────────────────────────────────

const RouteCard: React.FC<{ route: DispatchRoute; isSelected: boolean; onClick: () => void }> = ({ route, isSelected, onClick }) => {
  const st = STATUS_STYLES[route.status] ?? STATUS_STYLES.pending;
  const r = route;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-3.5 transition-all duration-150 ${
        isSelected ? 'border-indigo-400 shadow-md ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
      } bg-white`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${st.dot}`} />
          <span className="text-sm font-semibold text-slate-800 truncate">
            {r.studentNames.length > 0 ? r.studentNames.join(', ') : '(no students)'}
          </span>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${st.bg} ${st.text}`}>
          {st.label}
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Bus size={11} /> {r.driver?.name ?? <span className="text-amber-600 font-medium">No driver</span>}
          {r.location && r.gpsAgeSeconds !== null && r.gpsAgeSeconds < 60 && (
            <span className="ml-1 text-emerald-600 flex items-center gap-0.5"><Wifi size={9} /> GPS live</span>
          )}
          {r.gpsAgeSeconds !== null && r.gpsAgeSeconds >= 60 && (
            <span className="ml-1 text-amber-500 flex items-center gap-0.5"><WifiOff size={9} /> {fmtAge(r.gpsAgeSeconds)}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Clock size={11} /> {r.booking.schoolStartTime} – {r.booking.schoolEndTime}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400 truncate">
          <MapPin size={11} /> {r.booking.pickupAddress?.split(',')[0]}
        </div>
      </div>

      {/* Student progress pills */}
      {r.log?.ran === true && r.studentsTotal > 0 && (
        <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-slate-100 text-xs">
          <span className="text-amber-600 font-medium">{r.studentsPickedUp} picked up</span>
          <span className="text-slate-300">·</span>
          <span className="text-emerald-600 font-medium">{r.studentsDroppedOff} dropped off</span>
          {r.studentsAbsent > 0 && (
            <>
              <span className="text-slate-300">·</span>
              <span className="text-red-500 font-medium">{r.studentsAbsent} absent</span>
            </>
          )}
        </div>
      )}

      {/* Quick call links */}
      {(r.driver?.phone || r.client?.phone) && (
        <div className="flex gap-3 mt-2 pt-2 border-t border-slate-100">
          {r.driver?.phone && (
            <a
              href={`tel:${r.driver.phone}`}
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              <Phone size={11} /> Driver
            </a>
          )}
          {r.client?.phone && (
            <a
              href={`tel:${r.client.phone}`}
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-800 font-medium"
            >
              <Phone size={11} /> Parent
            </a>
          )}
        </div>
      )}
    </button>
  );
};

// ── Route panel helpers ───────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const toDate = (val: unknown): Date => {
  if (!val) return new Date(0);
  if (val instanceof Date) return val;
  if (typeof (val as { toDate?: () => Date }).toDate === 'function')
    return (val as { toDate: () => Date }).toDate();
  return new Date(val as string | number);
};

// ── Routes panel (admin log editor, embedded in Dispatch) ─────────────────────

const RoutesPanel: React.FC<{
  bookings: Booking[];
  clients: Record<string, Client>;
  drivers: Record<string, Driver>;
  assignments: RouteAssignment[];
}> = ({ bookings, clients, drivers, assignments }) => {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [routeLogs, setRouteLogs]       = useState<RouteLog[]>([]);
  const [saving, setSaving]             = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'routeLogs'), where('date', '==', selectedDate)),
      snap => setRouteLogs(snap.docs.map(d => ({ id: d.id, ...d.data() }) as RouteLog)),
    );
  }, [selectedDate]);

  const selectedDayName = useMemo(() => DAY_NAMES[new Date(selectedDate + 'T00:00:00').getDay()], [selectedDate]);

  const scheduledBookings = useMemo(() =>
    bookings.filter(b => b.status === 'active' && (b.daysOfWeek ?? []).includes(selectedDayName)),
    [bookings, selectedDayName],
  );

  const dateLogMap = useMemo(() => {
    const map: Record<string, RouteLog> = {};
    routeLogs.forEach(l => { map[l.bookingId] = l; });
    return map;
  }, [routeLogs]);

  const getDriverForBooking = (bookingId: string): Driver | null => {
    const matched = assignments
      .filter(a => a.bookingId === bookingId)
      .sort((a, b) => toDate(b.weekStart).getTime() - toDate(a.weekStart).getTime());
    return matched.length ? (drivers[matched[0].driverId] ?? null) : null;
  };

  const getAssignmentForBooking = (bookingId: string): RouteAssignment | null => {
    const selDate = new Date(selectedDate + 'T00:00:00');
    const weekMon = startOfWeek(selDate, { weekStartsOn: 1 });
    return (
      assignments.find(a => {
        if (a.bookingId !== bookingId) return false;
        const ws = toDate(a.weekStart);
        return ws >= weekMon && ws <= selDate;
      }) ??
      assignments
        .filter(a => a.bookingId === bookingId)
        .sort((a, b) => toDate(b.weekStart).getTime() - toDate(a.weekStart).getTime())[0] ??
      null
    );
  };

  const logRun = async (bookingId: string, ran: boolean) => {
    if (!user) return;
    const asn = getAssignmentForBooking(bookingId);
    setSaving(bookingId);
    await setDoc(
      doc(db, 'routeLogs', `${bookingId}_${selectedDate}`),
      { bookingId, driverId: asn?.driverId ?? '', date: selectedDate, ran, confirmedBy: user.uid, confirmedAt: serverTimestamp(), notes: '' },
      { merge: true },
    );
    setSaving(null);
  };

  const navigateDate = (delta: number) => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    setSelectedDate(format(d, 'yyyy-MM-dd'));
  };

  const ranCount     = scheduledBookings.filter(b => dateLogMap[b.id]?.ran === true).length;
  const missedCount  = scheduledBookings.filter(b => dateLogMap[b.id]?.ran === false).length;
  const pendingCount = scheduledBookings.length - ranCount - missedCount;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Date nav + stats */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <button onClick={() => navigateDate(-1)} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <ChevronLeft size={18} />
          </button>
          <input
            type="date" value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <button onClick={() => navigateDate(1)} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <ChevronRight size={18} />
          </button>
          <span className="font-semibold text-slate-700">{selectedDayName}</span>
          <button
            onClick={() => setSelectedDate(format(new Date(), 'yyyy-MM-dd'))}
            className="text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-semibold px-3 py-1 rounded-lg transition-colors"
          >
            Today
          </button>
        </div>
        <div className="flex gap-4 text-xs text-slate-500">
          <span><span className="font-bold text-emerald-600">{ranCount}</span> Ran</span>
          <span><span className="font-bold text-red-500">{missedCount}</span> Missed</span>
          <span><span className="font-bold text-slate-400">{pendingCount}</span> Pending</span>
          <span className="text-slate-300">·</span>
          <span>{scheduledBookings.length} scheduled</span>
        </div>
      </div>

      {/* Booking list */}
      <div className="flex-1 overflow-y-auto p-4">
        {scheduledBookings.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
            <MapPin size={40} className="mx-auto text-slate-300 mb-3" />
            <p className="text-slate-600 font-semibold">No routes scheduled for {selectedDayName}</p>
            <p className="text-slate-400 text-sm mt-1">Active bookings that include this day will appear here.</p>
          </div>
        ) : (
          <div className="space-y-3 max-w-2xl mx-auto">
            {scheduledBookings.map(booking => {
              const client   = clients[booking.clientId];
              const driver   = getDriverForBooking(booking.id);
              const log      = dateLogMap[booking.id];
              const isSaving = saving === booking.id;
              return (
                <div
                  key={booking.id}
                  className={`bg-white rounded-2xl border shadow-sm p-5 transition-all ${
                    log?.ran === true ? 'border-emerald-200' : log?.ran === false ? 'border-red-200' : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-slate-800">{client?.name || 'Unknown client'}</span>
                        {driver ? (
                          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">{driver.name}</span>
                        ) : (
                          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">No driver assigned</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 space-y-0.5">
                        <div className="truncate">{booking.pickupAddress} → {booking.dropoffAddress}</div>
                        <div>
                          {booking.schoolStartTime || '—'} – {booking.schoolEndTime || '—'}
                          {booking.dailyRate ? ` · $${booking.dailyRate.toFixed(2)}/day` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {log ? (
                        <div className="flex items-center gap-2">
                          <span className={`flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg ${
                            log.ran ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {log.ran ? <CheckCircle size={15} /> : <XCircle size={15} />}
                            {log.ran ? 'Ran' : 'Missed'}
                          </span>
                          <button
                            onClick={() => logRun(booking.id, !log.ran)} disabled={isSaving}
                            className="text-xs text-slate-400 hover:text-slate-700 underline transition-colors disabled:opacity-40"
                          >
                            {isSaving
                              ? <span className="inline-block w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
                              : 'Override'}
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() => logRun(booking.id, true)} disabled={isSaving}
                            className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors disabled:opacity-60"
                          >
                            {isSaving
                              ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              : <CheckCircle size={15} />}
                            Ran
                          </button>
                          <button
                            onClick={() => logRun(booking.id, false)} disabled={isSaving}
                            className="flex items-center gap-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors disabled:opacity-60"
                          >
                            <XCircle size={15} /> Missed
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {log && (
                    <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                      {log.ran === true && log.studentEvents && (() => {
                        const evts    = Object.values(log.studentEvents as Record<string, any>);
                        const picked  = evts.filter(e => e.status === 'picked_up').length;
                        const dropped = evts.filter(e => e.status === 'dropped_off').length;
                        const absent  = evts.filter(e => e.status === 'absent').length;
                        if (evts.length === 0) return null;
                        return (
                          <>
                            {picked  > 0 && <span className="text-amber-600 font-medium">{picked} on board</span>}
                            {dropped > 0 && <span className="text-emerald-600 font-medium">{dropped} dropped off</span>}
                            {absent  > 0 && <span className="text-red-500 font-medium">{absent} absent</span>}
                          </>
                        );
                      })()}
                      <span>
                        Confirmed by {log.confirmedBy === user?.uid ? 'you (admin)' : 'driver'} ·{' '}
                        {log.confirmedAt ? format(toDate(log.confirmedAt), 'h:mm a') : 'pending save'}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = 'board' | 'map' | 'alerts' | 'routes';

const Dispatch: React.FC = () => {
  const { loading, todayRoutes, alerts, driverLocations, drivers, historyDays, setHistoryDays,
          bookings, clients, assignments } = useDispatchData();
  const [selectedRouteId, setSelectedRouteId]   = useState<string | null>(null);
  const [activeTab, setActiveTab]               = useState<Tab>('board');
  const [desktopView, setDesktopView]           = useState<'live' | 'routes'>('live');
  const [notifAllowed, setNotifAllowed]         = useState<boolean>(false);
  const notifiedIds = useRef<Set<string>>(new Set());
  const [tick, setTick] = useState(0);

  // Re-compute time-based alerts every 30 seconds
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Browser notification permission
  useEffect(() => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') { setNotifAllowed(true); return; }
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(p => setNotifAllowed(p === 'granted'));
    }
  }, []);

  // Fire browser notifications for new critical alerts
  useEffect(() => {
    if (!notifAllowed) return;
    alerts.filter(a => a.isToday && a.severity === 'critical').forEach(a => {
      if (notifiedIds.current.has(a.id)) return;
      notifiedIds.current.add(a.id);
      new Notification(`🚨 ${a.title}`, {
        body: a.body,
        icon: '/icons/icon-192.png',
        tag: a.id,
        requireInteraction: true,
      });
    });
  }, [alerts, notifAllowed, tick]);

  const todayStr = format(new Date(), 'EEEE, MMMM d');

  const criticalCount = alerts.filter(a => a.isToday && a.severity === 'critical').length;
  const warningCount  = alerts.filter(a => a.isToday && a.severity === 'warning').length;

  // Only show GPS pings updated in the last 15 minutes — filters out stale/abandoned sessions
  const STALE_MS = 15 * 60 * 1000;
  const driverLocationsList = useMemo(
    () => (Object.values(driverLocations) as DriverLocation[]).filter(loc => {
      const millis = (loc.updatedAt as any)?.toMillis?.() ?? 0;
      return Date.now() - millis < STALE_MS;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [driverLocations, tick],
  );

  const selectedRoute = todayRoutes.find(r => r.booking.id === selectedRouteId) ?? null;

  // For map: show only selected driver's location if a route is selected
  const mapLocations = selectedRoute?.driverId
    ? driverLocationsList.filter(d => d.driverId === selectedRoute.driverId)
    : driverLocationsList;

  if (loading) {
    return (
      <div className="p-8 space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-24 bg-white rounded-2xl border border-slate-200 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* ── Header ── */}
      <div className="bg-gradient-to-r from-indigo-700 to-violet-700 px-5 py-4 flex-shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">Dispatch Control</h1>
            <p className="text-indigo-200 text-xs mt-0.5">{todayStr} · Live operational view</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Summary badges */}
            {criticalCount > 0 && (
              <span className="flex items-center gap-1.5 bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded-full animate-pulse">
                <XCircle size={13} /> {criticalCount} Critical
              </span>
            )}
            {warningCount > 0 && (
              <span className="flex items-center gap-1.5 bg-amber-400 text-amber-900 text-xs font-bold px-3 py-1.5 rounded-full">
                <AlertTriangle size={13} /> {warningCount} Warning
              </span>
            )}
            {criticalCount === 0 && warningCount === 0 && (
              <span className="flex items-center gap-1.5 bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-full">
                <CheckCircle size={13} /> All Clear
              </span>
            )}
            {/* Notification toggle */}
            <button
              onClick={() => {
                if (notifAllowed) { setNotifAllowed(false); }
                else { Notification.requestPermission().then(p => setNotifAllowed(p === 'granted')); }
              }}
              title={notifAllowed ? 'Notifications on' : 'Enable notifications'}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              {notifAllowed ? <Bell size={16} /> : <BellOff size={16} />}
            </button>
            {/* Live pulse */}
            <div className="flex items-center gap-1.5 text-xs text-indigo-200">
              <RefreshCw size={11} className="animate-spin-slow" /> Live
            </div>
          </div>
        </div>

        {/* Stat row */}
        <div className="flex gap-4 mt-3 text-xs text-indigo-100">
          <span><span className="font-bold text-white">{todayRoutes.length}</span> routes today</span>
          <span><span className="font-bold text-white">{todayRoutes.filter(r => r.status === 'in_progress').length}</span> in progress</span>
          <span><span className="font-bold text-white">{todayRoutes.filter(r => r.status === 'complete').length}</span> complete</span>
          <span><span className="font-bold text-white">{driverLocationsList.length}</span> GPS active</span>
        </div>
      </div>

      {/* ── Desktop view toggle ── */}
      <div className="hidden lg:flex border-b border-slate-200 bg-white px-5 flex-shrink-0">
        {([['live', 'Live Ops'], ['routes', 'Route Log']] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setDesktopView(v)}
            className={`py-2.5 px-4 text-sm font-medium border-b-2 transition-colors ${
              desktopView === v
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Mobile tab bar ── */}
      <div className="lg:hidden flex border-b border-slate-200 bg-white flex-shrink-0">
        {([['board', Bus, 'Run Board'], ['map', Satellite, 'Map'], ['alerts', AlertTriangle, 'Alerts'], ['routes', CalendarDays, 'Log']] as const).map(([tab, Icon, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors relative ${
              activeTab === tab ? 'text-indigo-600' : 'text-slate-500'
            }`}
          >
            <Icon size={18} />
            {label}
            {tab === 'alerts' && criticalCount > 0 && (
              <span className="absolute top-1.5 right-1/4 w-2 h-2 bg-red-500 rounded-full" />
            )}
            {activeTab === tab && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />}
          </button>
        ))}
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Route Log panel ── */}
        <div className={`${activeTab === 'routes' ? 'flex' : 'hidden'} ${desktopView === 'routes' ? 'lg:flex' : 'lg:hidden'} flex-col flex-1 overflow-hidden`}>
          <RoutesPanel bookings={bookings} clients={clients} drivers={drivers} assignments={assignments} />
        </div>

        {/* ── LEFT: Run board ── */}
        <div className={`${activeTab === 'board' ? 'flex' : 'hidden'} ${desktopView === 'live' ? 'lg:flex' : 'lg:hidden'} flex-col w-full lg:w-80 xl:w-96 border-r border-slate-200 bg-slate-50 flex-shrink-0`}>
          <div className="px-4 py-3 border-b border-slate-200 bg-white flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Bus size={15} className="text-indigo-500" />
              Today's Routes
            </div>
            <span className="text-xs text-slate-400">{todayRoutes.length} scheduled</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {todayRoutes.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <Bus size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No routes scheduled today</p>
              </div>
            ) : (
              todayRoutes.map(route => (
                <RouteCard
                  key={route.booking.id}
                  route={route}
                  isSelected={selectedRouteId === route.booking.id}
                  onClick={() => setSelectedRouteId(prev => prev === route.booking.id ? null : route.booking.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── CENTER + RIGHT ── */}
        <div className={`${activeTab !== 'board' && activeTab !== 'routes' ? 'flex' : 'hidden'} ${desktopView === 'live' ? 'lg:flex' : 'lg:hidden'} flex-col flex-1 overflow-hidden`}>

          {/* Map section */}
          <div className={`${activeTab === 'map' ? 'flex' : 'hidden'} lg:flex flex-col flex-1 lg:flex-none lg:h-1/2 border-b border-slate-200`}>
            <div className="px-4 py-2.5 bg-white border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Satellite size={15} className="text-blue-500" />
                {selectedRoute ? `${selectedRoute.studentNames[0] ?? 'Route'} — Driver Location` : 'All Driver Locations'}
              </div>
              {driverLocationsList.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                  {driverLocationsList.length} GPS active
                </span>
              )}
            </div>
            <div className="flex-1 min-h-0">
              {driverLocationsList.length > 0 ? (
                <DriverMapView driverLocations={mapLocations} height="100%" />
              ) : (
                <div className="h-full flex flex-col items-center justify-center bg-slate-50 text-slate-400">
                  <WifiOff size={32} className="mb-2 opacity-40" />
                  <p className="text-sm font-medium">No drivers online</p>
                  <p className="text-xs mt-1">GPS appears once drivers open their dashboard</p>
                </div>
              )}
            </div>
          </div>

          {/* Alert feed */}
          <div className={`${activeTab === 'alerts' ? 'flex' : 'hidden'} lg:flex flex-col flex-1 lg:h-1/2 overflow-hidden`}>
            <div className="px-4 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <AlertTriangle size={15} className="text-amber-500" />
                Alert Feed
                {criticalCount > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{criticalCount}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <History size={13} className="text-slate-400" />
                <select
                  value={historyDays}
                  onChange={e => setHistoryDays(Number(e.target.value))}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1 text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                >
                  <option value={3}>Last 3 days</option>
                  <option value={7}>Last 7 days</option>
                  <option value={14}>Last 14 days</option>
                  <option value={30}>Last 30 days</option>
                </select>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {alerts.length === 0 ? (
                <div className="text-center py-10 text-slate-400">
                  <CheckCircle size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm font-medium">No alerts</p>
                  <p className="text-xs mt-1">All routes running smoothly</p>
                </div>
              ) : (
                <>
                  {/* Today section */}
                  {alerts.some(a => a.isToday) && (
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1 mb-1">Today</div>
                  )}
                  {alerts.filter(a => a.isToday).map(alert => (
                    <AlertItem key={alert.id} alert={alert} drivers={drivers} clients={clients} />
                  ))}
                  {/* History section */}
                  {alerts.some(a => !a.isToday) && (
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1 mt-3 mb-1">History</div>
                  )}
                  {alerts.filter(a => !a.isToday).map(alert => (
                    <AlertItem key={alert.id} alert={alert} drivers={drivers} clients={clients} />
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dispatch;
