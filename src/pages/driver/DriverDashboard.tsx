import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  doc, getDoc, getDocs, collection, query, where, onSnapshot, setDoc, deleteDoc, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../context/AuthContext';
import type {
  RouteAssignment, Booking, Client, Student, RouteLog, StudentEvent, StudentEventType,
} from '../../types';
import {
  MapPin, Clock, Calendar, CheckCircle, XCircle,
  UserCheck, UserX, Navigation, PhoneCall, AlertCircle, ChevronDown,
  ChevronUp, Wifi, WifiOff, FileText, Bell,
} from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { createNotification } from '../../services/notifications';
import ShiftControls from '../../components/ShiftControls';
import IncidentForm from '../../components/IncidentForm';

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return phone;
}

// ── GPS hook ──────────────────────────────────────────────────────────────────
// Resilient GPS: auto-retries on signal loss, heartbeat watchdog every 20s,
// screen wake lock to prevent sleep, restarts when app returns to foreground.

function useDriverGPS(driverId: string | null, active: boolean) {
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [gpsError, setGpsError]     = useState<string | null>(null);
  const watchRef     = useRef<number | null>(null);
  const retryRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const lastWrittenPosRef = useRef<{ lat: number; lng: number } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wakeLockRef  = useRef<any>(null);
  const restartRef   = useRef<() => void>(() => {});

  useEffect(() => {
    if (!driverId || !active) {
      // Tear down everything when manually disabled
      if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
      if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => {}); wakeLockRef.current = null; }
      // Remove Firestore doc so admin/parent maps update immediately
      if (driverId) { deleteDoc(doc(db, 'driverLocations', driverId)).catch(() => {}); }
      setGpsEnabled(false);
      setGpsError(null);
      return;
    }
    if (!navigator.geolocation) { setGpsError('GPS not supported on this device'); return; }

    const id = driverId;

    function startWatch() {
      // Clear any existing watch + pending retry before starting fresh
      if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }

      lastUpdateRef.current = Date.now(); // baseline so heartbeat doesn't fire immediately

      watchRef.current = navigator.geolocation.watchPosition(
        pos => {
          setGpsEnabled(true);
          setGpsError(null);

          // Battery throttle: skip Firestore write if <10 s elapsed AND moved <15 m
          const now = Date.now();
          const elapsed = now - lastUpdateRef.current;
          const last = lastWrittenPosRef.current;
          const distMoved = last
            ? (() => {
                const R = 6_371_000;
                const dLat = ((pos.coords.latitude  - last.lat) * Math.PI) / 180;
                const dLng = ((pos.coords.longitude - last.lng) * Math.PI) / 180;
                return R * Math.sqrt(dLat * dLat + Math.cos((last.lat * Math.PI) / 180) * Math.cos((pos.coords.latitude * Math.PI) / 180) * dLng * dLng);
              })()
            : Infinity;
          if (elapsed < 10_000 && distMoved < 15) return;

          lastUpdateRef.current = now;
          lastWrittenPosRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setDoc(doc(db, 'driverLocations', id), {
            driverId: id,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            heading: pos.coords.heading ?? null,
            speed: pos.coords.speed != null ? pos.coords.speed * 3.6 : null,
            updatedAt: serverTimestamp(),
          }, { merge: true }).catch(() => {});
        },
        err => {
          setGpsEnabled(false);
          if (err.code === 1) {
            // Permission denied — user must act, can't auto-recover
            setGpsError('Location access denied — tap Allow to share location');
          } else {
            // Timeout or unavailable — auto-retry in 5s
            setGpsError('GPS signal weak — retrying in 5s…');
            if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
            retryRef.current = setTimeout(startWatch, 5000);
          }
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
      );
    }

    restartRef.current = startWatch;
    startWatch();

    // Wake lock — keeps screen on while driver is active so GPS isn't throttled
    const requestWakeLock = async () => {
      if ('wakeLock' in navigator) {
        try { wakeLockRef.current = await (navigator as any).wakeLock.request('screen'); } catch {}
      }
    };
    requestWakeLock();

    // Heartbeat: if no GPS update in 40s, restart the watch
    heartbeatRef.current = setInterval(() => {
      if (Date.now() - lastUpdateRef.current > 40_000) {
        setGpsError('GPS signal lost — reconnecting…');
        startWatch();
      }
    }, 20_000);

    // Restart when driver switches back to this tab/app after backgrounding
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        restartRef.current();
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
      if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => {}); wakeLockRef.current = null; }
      document.removeEventListener('visibilitychange', onVisible);
      setGpsEnabled(false);
    };
  }, [driverId, active]);

  return { gpsEnabled, gpsError };
}

// ── notification helper ───────────────────────────────────────────────────────

async function notifyClient(
  clientId: string,
  payload: { title: string; body: string; bookingId?: string; studentId?: string },
) {
  const q   = query(collection(db, 'users'), where('linkedId', '==', clientId));
  const snap = await getDocs(q);
  await Promise.all(
    snap.docs.map(d =>
      createNotification({
        recipientUid: d.id,
        audience:     'parent',
        type:         'route_update',
        title:        payload.title,
        body:         payload.body,
        bookingId:    payload.bookingId,
        studentId:    payload.studentId,
        clientId,
      }),
    ),
  );
}

// ── component ─────────────────────────────────────────────────────────────────

const DriverDashboard: React.FC = () => {
  const { user } = useAuth();

  const [assignments, setAssignments] = useState<RouteAssignment[]>([]);
  const [bookings,    setBookings]    = useState<Record<string, Booking>>({});
  const [clients,     setClients]     = useState<Record<string, Client>>({});
  const [students,    setStudents]    = useState<Record<string, Student>>({});
  const [todayLogs,   setTodayLogs]   = useState<RouteLog[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [linkedId,    setLinkedId]    = useState('');
  const [expandedRoute,   setExpandedRoute]   = useState<string | null>(null);
  const [savingEvent,     setSavingEvent]     = useState<string | null>(null);
  const [gpsActive,       setGpsActive]       = useState(true);
  const [isOnline,         setIsOnline]         = useState(navigator.onLine);
  const [noteDrafts,      setNoteDrafts]      = useState<Record<string, string>>({});
  const [savingNote,      setSavingNote]      = useState<string | null>(null);
  const [showIncident,    setShowIncident]    = useState(false);

  const todayStr     = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const todayDayName = useMemo(() => format(new Date(), 'EEEE'), []);

  // ── online/offline status ─────────────────────────────────────────────────
  useEffect(() => {
    const goOnline  = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const { gpsEnabled, gpsError } = useDriverGPS(linkedId || null, gpsActive);

  // ── subscriptions ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const unsubs: Array<() => void> = [];

    getDoc(doc(db, 'users', user.uid)).then(userSnap => {
      if (cancelled) return;
      const id = userSnap.data()?.linkedId as string | undefined;
      if (!id) { setLoading(false); return; }
      setLinkedId(id);

      unsubs.push(onSnapshot(
        query(collection(db, 'routeAssignments'), where('driverId', '==', id)),
        snap => { if (!cancelled) { setAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() }) as RouteAssignment)); setLoading(false); } }
      ));
      unsubs.push(onSnapshot(collection(db, 'bookings'), snap => {
        if (cancelled) return;
        const map: Record<string, Booking> = {};
        snap.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() } as Booking; });
        setBookings(map);
      }));
      unsubs.push(onSnapshot(collection(db, 'clients'), snap => {
        if (cancelled) return;
        const map: Record<string, Client> = {};
        snap.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() } as Client; });
        setClients(map);
      }));
      unsubs.push(onSnapshot(collection(db, 'students'), snap => {
        if (cancelled) return;
        const map: Record<string, Student> = {};
        snap.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() } as Student; });
        setStudents(map);
      }));
    });

    return () => { cancelled = true; unsubs.forEach(u => u()); };
  }, [user]);

  useEffect(() => {
    if (!linkedId) return;
    return onSnapshot(
      query(collection(db, 'routeLogs'), where('date', '==', todayStr), where('driverId', '==', linkedId)),
      snap => setTodayLogs(snap.docs.map(d => ({ id: d.id, ...d.data() }) as RouteLog)),
    );
  }, [linkedId, todayStr]);

  // ── derived ───────────────────────────────────────────────────────────────

  const todayAssignments = useMemo(
    () => assignments.filter(a => (a.daysWorked || []).includes(todayDayName)),
    [assignments, todayDayName],
  );

  const todayLogMap = useMemo(() => {
    const map: Record<string, RouteLog> = {};
    todayLogs.forEach(l => { map[l.bookingId] = l; });
    return map;
  }, [todayLogs]);

  // True when every route today is either missed or all non-absent students dropped off
  const allDoneToday = useMemo(() => {
    if (todayAssignments.length === 0) return false;
    return todayAssignments.every(a => {
      const log = todayLogMap[a.bookingId];
      if (log?.ran === false) return true; // missed = done
      const booking = bookings[a.bookingId];
      if (!booking) return false;
      const sids = booking.studentIds ?? [];
      if (sids.length === 0) return log?.ran === true;
      const evts = (log?.studentEvents ?? {}) as Record<string, { status: string }>;
      const absent  = sids.filter(sid => evts[sid]?.status === 'absent').length;
      const dropped = sids.filter(sid => evts[sid]?.status === 'dropped_off').length;
      return dropped >= (sids.length - absent);
    });
  }, [todayAssignments, bookings, todayLogMap]);

  // True when any route has students picked up but not yet dropped off
  const routeInProgress = useMemo(() => {
    return todayAssignments.some(a => {
      const log = todayLogMap[a.bookingId];
      if (!log || log.ran === false) return false;
      const booking = bookings[a.bookingId];
      if (!booking) return false;
      const sids = booking.studentIds ?? [];
      const evts = (log.studentEvents ?? {}) as Record<string, { status: string }>;
      const pickedUp = sids.filter(sid => evts[sid]?.status === 'picked_up').length;
      return pickedUp > 0;
    });
  }, [todayAssignments, bookings, todayLogMap]);

  // Remove GPS location from Firestore once all routes are done — stops showing on Dispatch map
  useEffect(() => {
    if (!linkedId || !allDoneToday || todayAssignments.length === 0) return;
    deleteDoc(doc(db, 'driverLocations', linkedId)).catch(() => {});
  }, [allDoneToday, linkedId, todayAssignments.length]);

  // ── actions ───────────────────────────────────────────────────────────────

  const getCoords = (): Promise<{ lat: number; lng: number } | null> =>
    new Promise(resolve => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000 },
      );
    });

  const logStudentEvent = async (bookingId: string, studentId: string, eventType: StudentEventType) => {
    if (!user || !linkedId) return;
    const key = `${bookingId}_${studentId}`;
    setSavingEvent(key);
    try {
      const coords  = await getCoords();
      const logId   = `${bookingId}_${todayStr}`;
      const event: StudentEvent = { status: eventType, timestamp: serverTimestamp() as any, ...(coords ?? {}) };

      await setDoc(doc(db, 'routeLogs', logId), {
        bookingId, driverId: linkedId, date: todayStr, ran: true,
        confirmedBy: user.uid, confirmedAt: serverTimestamp(), notes: '',
        studentEvents: { [studentId]: event },
      }, { merge: true });

      const booking = bookings[bookingId];
      const student = students[studentId];

      if (booking?.clientId && student) {
        const timeStr = format(new Date(), 'h:mm a');
        const notifBody =
          eventType === 'picked_up'   ? `${student.name} was picked up at ${timeStr}. Have a great day!` :
          eventType === 'dropped_off' ? `${student.name} was dropped off at ${timeStr}.` :
          eventType === 'absent'      ? `${student.name} was marked absent for today's route.` : '';
        if (notifBody) {
          const title =
            eventType === 'picked_up'   ? 'Student Picked Up' :
            eventType === 'dropped_off' ? 'Student Dropped Off' : 'Student Absent';
          await notifyClient(booking.clientId, { title, body: notifBody, bookingId, studentId });
        }
      }

      if ((eventType === 'picked_up' || eventType === 'dropped_off') && booking) {
        const field = eventType === 'picked_up' ? 'lastPickupAt' : 'lastDropoffAt';
        await updateDoc(doc(db, 'bookings', bookingId), { [field]: serverTimestamp(), lastEventStudentId: studentId });
      }

      toast.success(
        eventType === 'picked_up'   ? `\u2713 ${students[studentId]?.name ?? 'Student'} picked up` :
        eventType === 'dropped_off' ? `\u2713 ${students[studentId]?.name ?? 'Student'} dropped off` :
        `Marked ${eventType.replace('_', ' ')}`,
      );
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save');
    } finally {
      setSavingEvent(null);
    }
  };

  const markRouteComplete = async (bookingId: string) => {
    if (!user || !linkedId) return;
    try {
      await setDoc(doc(db, 'routeLogs', `${bookingId}_${todayStr}`), {
        bookingId, driverId: linkedId, date: todayStr, ran: true,
        confirmedBy: user.uid, confirmedAt: serverTimestamp(), notes: '',
      }, { merge: true });
      toast.success('Route marked complete ✓');
    } catch { toast.error('Failed to mark complete'); }
  };

  const markRouteMissed = async (bookingId: string) => {
    if (!user || !linkedId) return;
    const booking = bookings[bookingId];
    try {
      await setDoc(doc(db, 'routeLogs', `${bookingId}_${todayStr}`), {
        bookingId, driverId: linkedId, date: todayStr, ran: false,
        confirmedBy: user.uid, confirmedAt: serverTimestamp(), notes: '',
      }, { merge: true });
      if (booking?.clientId) {
        await notifyClient(booking.clientId, {
          title:     'Route Missed',
          body:      `Today's route was missed. Please contact us at (314) 425-9668.`,
          bookingId,
        });
      }
      toast.success('Route marked as missed');
    } catch { toast.error('Failed to mark missed'); }
  };

  const notifyNearby = async (bookingId: string) => {
    const booking = bookings[bookingId];
    if (!booking?.clientId) { toast.error('No client on file'); return; }
    await notifyClient(booking.clientId, {
      title:     'Driver Nearby',
      body:      'Your driver is approximately 10 minutes away. Please have your student(s) ready.',
      bookingId,
    });
    toast.success('Parent notified \u2014 driver nearby');
  };

  const toggleGps = () => {
    if (gpsActive && routeInProgress) {
      toast.error('Cannot stop GPS while a route is in progress');
      return;
    }
    setGpsActive(v => !v);
    toast(gpsActive ? 'GPS stopped — location hidden from dispatch' : 'GPS started — sharing location', { icon: gpsActive ? '📍' : '🛰️' });
  };

  const saveRouteNotes = async (bookingId: string) => {
    if (!user || !linkedId) return;
    const notes = noteDrafts[bookingId] ?? '';
    setSavingNote(bookingId);
    try {
      await setDoc(doc(db, 'routeLogs', `${bookingId}_${todayStr}`), {
        bookingId, driverId: linkedId, date: todayStr,
        confirmedBy: user.uid, confirmedAt: serverTimestamp(), notes,
      }, { merge: true });
      toast.success('Note saved');
    } catch {
      toast.error('Failed to save note');
    } finally {
      setSavingNote(null);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────

  // Compute today totals for hero stats
  const totals = (() => {
    let routesDone = 0;
    let studentsOnBoard = 0;
    let studentsRemaining = 0;
    let studentsTotal = 0;
    todayAssignments.forEach(a => {
      const log = todayLogMap[a.bookingId];
      const booking = bookings[a.bookingId];
      const sids = booking?.studentIds ?? [];
      const evts = (log?.studentEvents ?? {}) as Record<string, { status: string }>;
      const absent  = sids.filter(sid => evts[sid]?.status === 'absent').length;
      const pickedUp = sids.filter(sid => evts[sid]?.status === 'picked_up').length;
      const dropped  = sids.filter(sid => evts[sid]?.status === 'dropped_off').length;
      studentsTotal   += sids.length;
      studentsOnBoard += pickedUp;
      studentsRemaining += Math.max(0, sids.length - absent - dropped);
      if (log?.ran === false) routesDone++;
      else if (sids.length === 0 && log?.ran === true) routesDone++;
      else if (sids.length > 0 && dropped >= (sids.length - absent)) routesDone++;
    });
    return { routesDone, routesTotal: todayAssignments.length, studentsOnBoard, studentsRemaining, studentsTotal };
  })();

  return (
    <div>
      {!isOnline && (
        <div className="bg-amber-500 text-white text-xs font-semibold text-center py-2 px-4">
          You are offline — actions will sync when connection is restored
        </div>
      )}
      {/* Stats hero */}
      <div className="px-5 pt-5 pb-3">
        <div className="bg-gradient-to-br from-teal-600 to-emerald-600 rounded-2xl shadow-lg p-5 text-white">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="text-teal-50 text-xs font-semibold uppercase tracking-widest flex items-center gap-1.5">
                <Calendar size={12} /> Today
              </div>
              <div className="text-white font-bold text-lg leading-tight mt-0.5">
                {format(new Date(), 'EEEE, MMM d')}
              </div>
            </div>
            <button
              onClick={toggleGps}
              title={gpsActive ? (gpsEnabled ? 'GPS active — tap to stop' : 'Acquiring GPS…') : 'GPS stopped — tap to start'}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full font-medium border transition-colors ${
                gpsActive && gpsEnabled
                  ? 'bg-emerald-400/25 text-white border-emerald-300/40 hover:bg-emerald-400/40'
                  : gpsActive
                  ? 'bg-amber-400/25 text-white border-amber-300/40 hover:bg-amber-400/40'
                  : 'bg-white/10 text-white/70 border-white/10 hover:bg-white/20 hover:text-white'
              }`}>
              {gpsActive ? <Wifi size={13} /> : <WifiOff size={13} />}
              <span>{gpsActive ? (gpsEnabled ? 'GPS On' : 'GPS…') : 'GPS Off'}</span>
            </button>
            <button
              onClick={() => setShowIncident(true)}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full font-medium border bg-red-500/25 text-white border-red-300/40 hover:bg-red-500/40 transition-colors"
            >
              <AlertCircle size={13} />
              <span>Incident</span>
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/15 rounded-xl p-3 text-center backdrop-blur">
              <div className="text-2xl font-extrabold leading-none">{totals.routesDone}<span className="text-sm font-semibold text-white/60">/{totals.routesTotal}</span></div>
              <div className="text-[10px] font-semibold text-white/75 uppercase tracking-widest mt-1">Routes</div>
            </div>
            <div className="bg-white/15 rounded-xl p-3 text-center backdrop-blur">
              <div className="text-2xl font-extrabold leading-none">{totals.studentsOnBoard}</div>
              <div className="text-[10px] font-semibold text-white/75 uppercase tracking-widest mt-1">On Board</div>
            </div>
            <div className="bg-white/15 rounded-xl p-3 text-center backdrop-blur">
              <div className="text-2xl font-extrabold leading-none">{totals.studentsRemaining}</div>
              <div className="text-[10px] font-semibold text-white/75 uppercase tracking-widest mt-1">Remaining</div>
            </div>
          </div>
        </div>
      </div>

      {gpsActive && gpsError && (
        <div className="mx-5 mt-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs text-amber-800">
          <AlertCircle size={14} className="flex-shrink-0" />
          {gpsError} — tap Allow Location if prompted
        </div>
      )}

      <div className="px-5 pt-2 pb-5">
        {linkedId && <ShiftControls driverId={linkedId} />}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 animate-pulse h-32" />)}
          </div>
        ) : todayAssignments.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
            <Calendar size={40} className="mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500 font-semibold">No routes today</p>
            <p className="text-slate-400 text-sm mt-1">Check back on your scheduled days.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {todayAssignments.map(a => {
              const booking     = bookings[a.bookingId];
              const client      = booking ? clients[booking.clientId] : null;
              const log         = todayLogMap[a.bookingId];
              const studentList = booking?.studentIds.map(sid => students[sid]).filter(Boolean) ?? [];
              const isExpanded  = expandedRoute === a.id;
              const events      = log?.studentEvents ?? {};
              const pickedUp    = studentList.filter(s => events[s.id]?.status === 'picked_up').length;
              const droppedOff  = studentList.filter(s => events[s.id]?.status === 'dropped_off').length;
              const allDone     = studentList.length > 0 && droppedOff === studentList.length;
              const routeMissed = log?.ran === false;

              return (
                <div key={a.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${
                  allDone ? 'border-emerald-300' : routeMissed ? 'border-red-200' : pickedUp > 0 ? 'border-amber-300' : 'border-slate-200'
                }`}>
                  {/* Route header */}
                  <button className="w-full text-left p-4" onClick={() => setExpandedRoute(isExpanded ? null : a.id)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-800 text-base truncate">{client?.name ?? 'Loading\u2026'}</div>
                        <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
                          <MapPin size={11} className="flex-shrink-0" />
                          <span className="truncate">{booking?.pickupAddress ?? '\u2014'}</span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
                          <Clock size={11} className="flex-shrink-0" />
                          {booking?.schoolStartTime ?? '\u2014'}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        {allDone && <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Complete \u2713</span>}
                        {routeMissed && <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Missed</span>}
                        {!allDone && !routeMissed && pickedUp > 0 && (
                          <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{pickedUp}/{studentList.length} on board</span>
                        )}
                        {!allDone && !routeMissed && pickedUp === 0 && studentList.length > 0 && (
                          <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{studentList.length} student{studentList.length !== 1 ? 's' : ''}</span>
                        )}
                        {isExpanded ? <ChevronUp size={16} className="text-slate-400 mt-1" /> : <ChevronDown size={16} className="text-slate-400 mt-1" />}
                      </div>
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-4">
                      {/* Navigation buttons */}
                      <div className="grid grid-cols-2 gap-2">
                        <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(booking?.pickupAddress ?? '')}`}
                          target="_blank" rel="noopener noreferrer"
                          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-3 rounded-xl shadow-sm transition-colors">
                          <Navigation size={16} /> Pickup
                        </a>
                        <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(booking?.dropoffAddress ?? '')}`}
                          target="_blank" rel="noopener noreferrer"
                          className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold py-3 rounded-xl shadow-sm transition-colors">
                          <Navigation size={16} /> Drop-off
                        </a>
                      </div>

                      <div className="bg-slate-50 rounded-xl p-3 space-y-1 text-xs text-slate-600">
                        <div><span className="font-semibold text-slate-400 uppercase tracking-widest text-[10px]">Pickup:</span> {booking?.pickupAddress ?? '—'}</div>
                        <div><span className="font-semibold text-slate-400 uppercase tracking-widest text-[10px]">Drop-off:</span> {booking?.dropoffAddress ?? '—'}</div>
                      </div>

                      {/* Per-student tap cards */}
                      {studentList.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Students</div>
                          <div className="space-y-2">
                            {studentList.map(s => {
                              const ev     = events[s.id] as StudentEvent | undefined;
                              const saving = savingEvent === `${a.bookingId}_${s.id}`;
                              return (
                                <div key={s.id} className={`rounded-xl border-2 p-4 ${
                                  ev?.status === 'dropped_off' ? 'bg-emerald-50 border-emerald-300' :
                                  ev?.status === 'picked_up'   ? 'bg-amber-50 border-amber-300' :
                                  ev?.status === 'absent'      ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-200'
                                }`}>
                                  <div className="flex items-start justify-between gap-2 mb-3">
                                    <div className="min-w-0">
                                      <div className="font-bold text-slate-800 text-base leading-tight">{s.name}</div>
                                      {s.grade && <div className="text-xs text-slate-500 mt-0.5">Grade {s.grade}</div>}
                                      {s.allergies && (
                                        <div className="text-xs text-rose-600 font-semibold mt-1">⚠ {s.allergies}</div>
                                      )}
                                    </div>
                                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                      {ev && (
                                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                                          ev.status === 'dropped_off' ? 'bg-emerald-200 text-emerald-800' :
                                          ev.status === 'picked_up'   ? 'bg-amber-200 text-amber-800' : 'bg-slate-200 text-slate-600'
                                        }`}>{ev.status.replace('_', ' ')}</span>
                                      )}
                                      {client?.phone && (
                                        <a href={`tel:${fmtPhone(client.phone)}`}
                                          className="flex items-center gap-1 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg">
                                          <PhoneCall size={12} /> Call
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex gap-2 flex-wrap">
                                    {(!ev || ev.status === 'absent') && (
                                      <button disabled={saving}
                                        onClick={() => logStudentEvent(a.bookingId, s.id, 'picked_up')}
                                        className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-bold px-3 py-3 rounded-xl transition-colors disabled:opacity-60 flex-1 justify-center min-h-[46px]">
                                        {saving ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <UserCheck size={16} />}
                                        Picked Up
                                      </button>
                                    )}
                                    {ev?.status === 'picked_up' && (
                                      <button disabled={saving}
                                        onClick={() => logStudentEvent(a.bookingId, s.id, 'dropped_off')}
                                        className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white text-sm font-bold px-3 py-3 rounded-xl transition-colors disabled:opacity-60 flex-1 justify-center min-h-[46px]">
                                        {saving ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <CheckCircle size={16} />}
                                        Dropped Off
                                      </button>
                                    )}
                                    {!ev && (
                                      <button disabled={saving}
                                        onClick={() => logStudentEvent(a.bookingId, s.id, 'absent')}
                                        className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-bold px-3 py-3 rounded-xl transition-colors disabled:opacity-60 flex-1 justify-center min-h-[46px]">
                                        <UserX size={15} /> Absent
                                      </button>
                                    )}
                                    {ev?.status === 'dropped_off' && (
                                      <span className="flex items-center gap-1.5 bg-emerald-100 text-emerald-700 text-sm font-bold px-3 py-3 rounded-xl flex-1 justify-center min-h-[46px]">
                                        <CheckCircle size={16} /> Complete
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Route notes */}
                      <div>
                        <label className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
                          <FileText size={12} /> Notes for this route
                        </label>
                        <textarea
                          value={noteDrafts[a.bookingId] ?? log?.notes ?? ''}
                          onChange={e => setNoteDrafts(d => ({ ...d, [a.bookingId]: e.target.value }))}
                          placeholder="e.g. Gate code changed, road closed, parent request…"
                          rows={2}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none"
                        />
                        <div className="flex justify-end mt-1">
                          <button
                            type="button"
                            disabled={savingNote === a.bookingId}
                            onClick={() => saveRouteNotes(a.bookingId)}
                            className="text-xs font-semibold text-teal-600 hover:text-teal-700 disabled:opacity-60">
                            {savingNote === a.bookingId ? 'Saving…' : 'Save note'}
                          </button>
                        </div>
                      </div>

                      {/* Action row */}
                      <div className="flex gap-2 flex-wrap pt-1">
                        <button onClick={() => notifyNearby(a.bookingId)}
                          className="flex items-center gap-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                          <Bell size={13} /> Notify "On the Way"
                        </button>
                        {studentList.length === 0 && !log?.ran && !routeMissed && (
                          <button onClick={() => markRouteComplete(a.bookingId)}
                            className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors">
                            <CheckCircle size={13} /> Complete Route
                          </button>
                        )}
                        {!routeMissed && (
                          <button onClick={() => markRouteMissed(a.bookingId)}
                            className="flex items-center gap-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                            <XCircle size={13} /> Mark Missed
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Other scheduled routes (non-today) */}
        {assignments.filter(a => !(a.daysWorked || []).includes(todayDayName)).length > 0 && (
          <div className="mt-8">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">All Assigned Routes</h2>
            <div className="space-y-2">
              {assignments.filter(a => !(a.daysWorked || []).includes(todayDayName)).map(a => {
                const booking = bookings[a.bookingId];
                const client  = booking ? clients[booking.clientId] : null;
                return (
                  <div key={a.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-700">{client?.name ?? '\u2014'}</div>
                      <div className="text-xs text-slate-400">{(a.daysWorked || []).join(', ') || 'No days set'}</div>
                    </div>
                    <div className="text-xs text-slate-400">{booking?.pickupAddress?.split(',')[0] ?? '\u2014'}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>

    {/* Incident report bottom sheet */}
    {showIncident && (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div className="absolute inset-0 bg-black/40" onClick={() => setShowIncident(false)} />
        <div className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
          <IncidentForm
            driverId={linkedId || undefined}
            onClose={() => setShowIncident(false)}
          />
        </div>
      </div>
    )}
  </div>
};

export default DriverDashboard;
