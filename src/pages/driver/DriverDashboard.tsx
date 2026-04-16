import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  doc, getDoc, collection, query, where, onSnapshot, setDoc, serverTimestamp, addDoc, updateDoc,
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../context/AuthContext';
import type {
  RouteAssignment, Booking, Client, Student, RouteLog, StudentEvent, StudentEventType,
} from '../../types';
import {
  Bus, MapPin, Clock, Calendar, LogOut, CheckCircle, XCircle,
  UserCheck, UserX, Navigation, PhoneCall, AlertCircle, ChevronDown,
  ChevronUp, Wifi, WifiOff,
} from 'lucide-react';
import { signOut } from '../../services/authService';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return phone;
}

// ── GPS hook ──────────────────────────────────────────────────────────────────

function useDriverGPS(driverId: string | null) {
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [gpsError, setGpsError]     = useState<string | null>(null);
  const watchRef = useRef<number | null>(null);

  const startTracking = useCallback(() => {
    if (!driverId) return;
    if (!navigator.geolocation) { setGpsError('GPS not supported on this device'); return; }
    watchRef.current = navigator.geolocation.watchPosition(
      pos => {
        setGpsEnabled(true);
        setGpsError(null);
        setDoc(doc(db, 'driverLocations', driverId), {
          driverId,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading ?? null,
          speed: pos.coords.speed != null ? pos.coords.speed * 3.6 : null,
          updatedAt: serverTimestamp(),
        }, { merge: true }).catch(() => {});
      },
      err => {
        setGpsEnabled(false);
        setGpsError(err.code === 1 ? 'Location access denied' : 'GPS unavailable');
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );
  }, [driverId]);

  const stopTracking = useCallback(() => {
    if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
    setGpsEnabled(false);
  }, []);

  useEffect(() => { if (driverId) startTracking(); return stopTracking; }, [driverId, startTracking, stopTracking]);

  return { gpsEnabled, gpsError };
}

// ── SMS helper ────────────────────────────────────────────────────────────────

async function queueSms(to: string, body: string, meta?: { bookingId?: string; studentId?: string; event?: string }) {
  if (!to) return;
  await addDoc(collection(db, 'smsQueue'), { to: fmtPhone(to), body, ...meta, status: 'pending', createdAt: serverTimestamp() });
}

// ── component ─────────────────────────────────────────────────────────────────

const DriverDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate  = useNavigate();

  const [assignments, setAssignments] = useState<RouteAssignment[]>([]);
  const [bookings,    setBookings]    = useState<Record<string, Booking>>({});
  const [clients,     setClients]     = useState<Record<string, Client>>({});
  const [students,    setStudents]    = useState<Record<string, Student>>({});
  const [todayLogs,   setTodayLogs]   = useState<RouteLog[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [driverName,  setDriverName]  = useState('');
  const [linkedId,    setLinkedId]    = useState('');
  const [expandedRoute,   setExpandedRoute]   = useState<string | null>(null);
  const [savingEvent,     setSavingEvent]     = useState<string | null>(null);

  const todayStr     = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const todayDayName = useMemo(() => format(new Date(), 'EEEE'), []);

  const { gpsEnabled, gpsError } = useDriverGPS(linkedId || null);

  // ── subscriptions ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const unsubs: Array<() => void> = [];

    getDoc(doc(db, 'users', user.uid)).then(userSnap => {
      if (cancelled) return;
      const id = userSnap.data()?.linkedId as string | undefined;
      setDriverName(userSnap.data()?.name || user.email || 'Driver');
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
      const client  = booking ? clients[booking.clientId] : null;
      const student = students[studentId];

      if (client?.phone && student) {
        const timeStr = format(new Date(), 'h:mm a');
        const body =
          eventType === 'picked_up'   ? `KIDZ Transportation: ${student.name} was picked up at ${timeStr}. Have a great day!` :
          eventType === 'dropped_off' ? `KIDZ Transportation: ${student.name} was dropped off at ${timeStr}.` :
          eventType === 'absent'      ? `KIDZ Transportation: ${student.name} was marked absent for today's route.` : '';
        if (body) await queueSms(client.phone, body, { bookingId, studentId, event: eventType });
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
    const client  = booking ? clients[booking.clientId] : null;
    try {
      await setDoc(doc(db, 'routeLogs', `${bookingId}_${todayStr}`), {
        bookingId, driverId: linkedId, date: todayStr, ran: false,
        confirmedBy: user.uid, confirmedAt: serverTimestamp(), notes: '',
      }, { merge: true });
      if (client?.phone) {
        await queueSms(client.phone,
          `KIDZ Transportation: Today's route for your student(s) was missed. Please contact us at (314) 425-9668.`,
          { bookingId, event: 'run_missed' },
        );
      }
      toast.success('Route marked as missed');
    } catch { toast.error('Failed to mark missed'); }
  };

  const notifyNearby = async (bookingId: string) => {
    const booking = bookings[bookingId];
    const client  = booking ? clients[booking.clientId] : null;
    if (!client?.phone) { toast.error('No phone number on file'); return; }
    await queueSms(client.phone,
      `KIDZ Transportation: Your driver is approximately 10 minutes away. Please have your student(s) ready.`,
      { bookingId, event: 'driver_nearby' },
    );
    toast.success('Parent notified \u2014 driver nearby');
  };

  const handleLogout = async () => { await signOut(); navigate('/login', { replace: true }); };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-100 pb-10">
      {/* Header */}
      <div className="bg-gradient-to-r from-teal-600 to-emerald-600 px-5 py-4 flex items-center justify-between sticky top-0 z-10 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-amber-400 rounded-xl flex items-center justify-center flex-shrink-0">
            <Bus size={18} className="text-teal-900" />
          </div>
          <div>
            <div className="text-white font-bold leading-tight">KIDZ Transportation</div>
            <div className="text-teal-100 text-xs">Driver — {driverName}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div title={gpsError ?? (gpsEnabled ? 'Location sharing on' : 'Location off')}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${gpsEnabled ? 'bg-white/20 text-white' : 'bg-white/10 text-white/50'}`}>
            {gpsEnabled ? <Wifi size={12} /> : <WifiOff size={12} />}
            <span className="hidden sm:inline">{gpsEnabled ? 'GPS' : 'No GPS'}</span>
          </div>
          <button onClick={handleLogout}
            className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
            <LogOut size={13} /> Logout
          </button>
        </div>
      </div>

      {gpsError && (
        <div className="mx-5 mt-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs text-amber-800">
          <AlertCircle size={14} className="flex-shrink-0" />
          {gpsError} — tap Allow Location if prompted
        </div>
      )}

      <div className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Calendar size={14} className="text-teal-600" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
            {format(new Date(), 'EEEE, MMMM d, yyyy')}
          </span>
        </div>

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
                      {/* Address + nav */}
                      <div className="bg-slate-50 rounded-xl p-3 space-y-2">
                        <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">Route</div>
                        <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(booking?.pickupAddress ?? '')}`}
                          target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-blue-600 hover:underline font-medium">
                          <Navigation size={14} /> Navigate to pickup
                        </a>
                        <div className="text-xs text-slate-500"><span className="font-medium">Drop-off:</span> {booking?.dropoffAddress ?? '\u2014'}</div>
                        {client?.phone && (
                          <a href={`tel:${client.phone}`} className="flex items-center gap-2 text-sm text-teal-600 hover:underline font-medium">
                            <PhoneCall size={14} /> {client.phone}
                          </a>
                        )}
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
                                <div key={s.id} className={`rounded-xl border p-3 ${
                                  ev?.status === 'dropped_off' ? 'bg-emerald-50 border-emerald-200' :
                                  ev?.status === 'picked_up'   ? 'bg-amber-50 border-amber-200' :
                                  ev?.status === 'absent'      ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-200'
                                }`}>
                                  <div className="flex items-center justify-between mb-2">
                                    <div>
                                      <div className="font-semibold text-slate-800 text-sm">{s.name}</div>
                                      {s.allergies && (
                                        <div className="text-xs text-rose-600 font-medium">\u26a0 {s.allergies}</div>
                                      )}
                                    </div>
                                    {ev && (
                                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                        ev.status === 'dropped_off' ? 'bg-emerald-200 text-emerald-800' :
                                        ev.status === 'picked_up'   ? 'bg-amber-200 text-amber-800' : 'bg-slate-200 text-slate-600'
                                      }`}>{ev.status.replace('_', ' ')}</span>
                                    )}
                                  </div>
                                  <div className="flex gap-2 flex-wrap">
                                    {(!ev || ev.status === 'absent') && (
                                      <button disabled={saving}
                                        onClick={() => logStudentEvent(a.bookingId, s.id, 'picked_up')}
                                        className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors disabled:opacity-60 flex-1 justify-center">
                                        {saving ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <UserCheck size={13} />}
                                        Picked Up
                                      </button>
                                    )}
                                    {ev?.status === 'picked_up' && (
                                      <button disabled={saving}
                                        onClick={() => logStudentEvent(a.bookingId, s.id, 'dropped_off')}
                                        className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors disabled:opacity-60 flex-1 justify-center">
                                        {saving ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <CheckCircle size={13} />}
                                        Dropped Off
                                      </button>
                                    )}
                                    {!ev && (
                                      <button disabled={saving}
                                        onClick={() => logStudentEvent(a.bookingId, s.id, 'absent')}
                                        className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold px-3 py-2 rounded-lg transition-colors disabled:opacity-60 flex-1 justify-center">
                                        <UserX size={13} /> Absent
                                      </button>
                                    )}
                                    {ev?.status === 'dropped_off' && (
                                      <span className="flex items-center gap-1.5 bg-emerald-100 text-emerald-700 text-xs font-bold px-3 py-2 rounded-lg flex-1 justify-center">
                                        <CheckCircle size={13} /> Complete
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Action row */}
                      <div className="flex gap-2 flex-wrap pt-1">
                        <button onClick={() => notifyNearby(a.bookingId)}
                          className="flex items-center gap-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                          <PhoneCall size={13} /> Notify "On the Way"
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
  );
};

export default DriverDashboard;
