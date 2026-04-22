import React, { useEffect, useState, useMemo } from 'react';
import { doc, getDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../context/AuthContext';
import type { Booking, Student, RouteLog, StudentEvent, RouteAssignment, Driver } from '../../types';
import { Bus, MapPin, Clock, Calendar, LogOut, CheckCircle, Clock2, FileText, Activity, PauseCircle, UserCheck, UserX, XCircle, User } from 'lucide-react';
import { signOut } from '../../services/authService';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

const STATUS_INFO: Record<string, { label: string; color: string; icon: React.ElementType; desc: string }> = {
  new:           { label: 'Under Review',    color: 'bg-blue-100 text-blue-700',    icon: Clock2,       desc: 'Your application has been received and is being reviewed.' },
  under_review:  { label: 'Under Review',    color: 'bg-amber-100 text-amber-700',  icon: Clock2,       desc: 'Our team is reviewing your application.' },
  contract_sent: { label: 'Contract Sent',   color: 'bg-purple-100 text-purple-700',icon: FileText,     desc: 'Please check your email for the service contract to sign.' },
  active:        { label: 'Active',          color: 'bg-emerald-100 text-emerald-700', icon: Activity,  desc: 'Your transportation service is active.' },
  paused:        { label: 'Paused',          color: 'bg-slate-100 text-slate-600',  icon: PauseCircle,  desc: 'Your service is temporarily paused.' },
  completed:     { label: 'Completed',       color: 'bg-slate-100 text-slate-500',  icon: CheckCircle,  desc: 'Your service has been completed.' },
};

const TRANSPORT_LABELS: Record<string, string> = {
  roundtrip: 'Roundtrip',
  am_only:   'AM Only',
  pm_only:   'PM Only',
  midday:    'Midday',
};

const ParentStatus: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [students, setStudents] = useState<Record<string, Student>>({});
  const [loading, setLoading] = useState(true);
  const [parentName, setParentName] = useState('');
  const [todayLogs, setTodayLogs] = useState<Record<string, RouteLog>>({});
  const [assignments, setAssignments] = useState<RouteAssignment[]>([]);
  const [drivers, setDrivers] = useState<Record<string, Driver>>({});

  const todayStr = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let unsubBookings: (() => void) | null = null;
    let unsubStudents: (() => void) | null = null;

    getDoc(doc(db, 'users', user.uid)).then(userSnap => {
      if (cancelled) return;
      const linkedId = userSnap.data()?.linkedId as string | undefined;
      setParentName(userSnap.data()?.name || user.displayName || user.email || 'Parent');
      if (!linkedId) { setLoading(false); return; }

      unsubBookings = onSnapshot(
        query(collection(db, 'bookings'), where('clientId', '==', linkedId)),
        snap => {
          if (cancelled) return;
          setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Booking));
          setLoading(false);
        }
      );
      unsubStudents = onSnapshot(collection(db, 'students'), snap => {
        if (cancelled) return;
        const map: Record<string, Student> = {};
        snap.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() } as Student; });
        setStudents(map);
      });
    });

    return () => {
      cancelled = true;
      unsubBookings?.();
      unsubStudents?.();
    };
  }, [user]);

  // Subscribe to today's route logs for all parent bookings
  useEffect(() => {
    if (bookings.length === 0) return;
    const ids = bookings.map(b => b.id);
    // Firestore 'in' supports up to 30 values
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    const unsubs = chunks.map(chunk =>
      onSnapshot(
        query(collection(db, 'routeLogs'), where('date', '==', todayStr), where('bookingId', 'in', chunk)),
        snap => setTodayLogs(prev => {
          const next = { ...prev };
          snap.docs.forEach(d => { next[d.data().bookingId] = { id: d.id, ...d.data() } as RouteLog; });
          return next;
        }),
      )
    );
    return () => unsubs.forEach(u => u());
  }, [bookings, todayStr]);

  // Subscribe to route assignments for all parent bookings + all drivers (small collection)
  useEffect(() => {
    if (bookings.length === 0) return;
    const ids = bookings.map(b => b.id);
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    const unsubs = chunks.map(chunk =>
      onSnapshot(
        query(collection(db, 'routeAssignments'), where('bookingId', 'in', chunk)),
        snap => setAssignments(prev => {
          // Replace all assignments that match this chunk's bookingIds with fresh ones
          const next = prev.filter(a => !chunk.includes(a.bookingId));
          snap.docs.forEach(d => next.push({ id: d.id, ...d.data() } as RouteAssignment));
          return next;
        }),
      )
    );
    const unsubDrivers = onSnapshot(collection(db, 'drivers'), snap => {
      const map: Record<string, Driver> = {};
      snap.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() } as Driver; });
      setDrivers(map);
    });
    return () => { unsubs.forEach(u => u()); unsubDrivers(); };
  }, [bookings]);

  const driverForBooking = (bookingId: string): Driver | null => {
    const a = assignments.find(x => x.bookingId === bookingId);
    return a ? drivers[a.driverId] ?? null : null;
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-400 rounded-xl flex items-center justify-center">
            <Bus size={20} className="text-indigo-900" />
          </div>
          <div>
            <div className="text-white font-bold text-lg leading-tight">KIDZ Transportation</div>
            <div className="text-blue-100 text-xs">Parent Portal — {parentName}</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 bg-white/20 hover:bg-white/30 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          <LogOut size={14} />
          Logout
        </button>
      </div>

      <div className="p-6">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Your Transportation Applications</h2>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 animate-pulse h-40" />
            ))}
          </div>
        ) : bookings.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
            <Calendar size={40} className="mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500 font-medium">No applications found</p>
            <p className="text-slate-400 text-sm mt-1">Submit an application at <a href="/apply" className="text-blue-600 underline">/apply</a>.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {bookings.map(b => {
              const info = STATUS_INFO[b.status] || { label: b.status, color: 'bg-slate-100 text-slate-600', icon: Clock2, desc: '' };
              const StatusIcon = info.icon;
              const studentNames = b.studentIds.map(sid => students[sid]?.name).filter(Boolean).join(', ');
              const log    = todayLogs[b.id];
              const events = log?.studentEvents ?? {};

              return (
                <div key={b.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  {/* Status banner */}
                  <div className={`px-5 py-3 flex items-center gap-3 ${info.color}`}>
                    <StatusIcon size={18} />
                    <div>
                      <div className="font-semibold text-sm">{info.label}</div>
                      <div className="text-xs opacity-80">{info.desc}</div>
                    </div>
                  </div>

                  <div className="p-5">
                    {/* Students */}
                    <div className="font-semibold text-slate-800 mb-3">
                      {studentNames || 'Students loading…'}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-start gap-2 text-xs text-slate-600">
                        <MapPin size={13} className="text-slate-400 mt-0.5 flex-shrink-0" />
                        <div><span className="font-medium">Pickup:</span> {b.pickupAddress || '—'}</div>
                      </div>
                      <div className="flex items-start gap-2 text-xs text-slate-600">
                        <MapPin size={13} className="text-indigo-500 mt-0.5 flex-shrink-0" />
                        <div><span className="font-medium">Drop-off:</span> {b.dropoffAddress || '—'}</div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-600">
                        <Clock size={13} className="text-slate-400 flex-shrink-0" />
                        {b.schoolStartTime || '—'} start · {b.schoolEndTime || '—'} end
                      </div>
                    </div>

                    {/* Driver */}
                    {(() => {
                      const drv = driverForBooking(b.id);
                      if (!drv) return null;
                      return (
                        <div className="mt-3 flex items-center gap-2 text-xs bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
                          <div className="w-7 h-7 bg-teal-600 rounded-full flex items-center justify-center text-white font-semibold text-xs shrink-0">
                            {drv.name?.charAt(0)?.toUpperCase() || <User size={12} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] font-semibold text-teal-700 uppercase tracking-wide">Driver</div>
                            <div className="font-medium text-slate-800 truncate">{drv.name}</div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Today's activity — only show for active bookings */}
                    {b.status === 'active' && (log || true) && (
                      <div className="mt-4 pt-3 border-t border-slate-100">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Activity size={13} className="text-teal-500" />
                          <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Today's Activity</span>
                          <span className="text-xs text-slate-400 ml-auto">{format(new Date(), 'MMM d')}</span>
                        </div>
                        {!log ? (
                          <p className="text-xs text-slate-400">Route has not started yet.</p>
                        ) : log.ran === false ? (
                          <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">
                            <XCircle size={13} /> Route was missed today. Please call (314) 425-9668.
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {b.studentIds.map(sid => {
                              const s  = students[sid];
                              const ev = events[sid] as StudentEvent | undefined;
                              if (!s) return null;
                              return (
                                <div key={sid} className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg ${
                                  ev?.status === 'dropped_off' ? 'bg-emerald-50 text-emerald-800' :
                                  ev?.status === 'picked_up'   ? 'bg-amber-50 text-amber-800' :
                                  ev?.status === 'absent'      ? 'bg-slate-100 text-slate-500' :
                                  'bg-slate-50 text-slate-500'
                                }`}>
                                  <span className="font-medium">{s.name}</span>
                                  <span className="flex items-center gap-1">
                                    {ev?.status === 'picked_up'   && <><UserCheck size={12} /> Picked up</>}
                                    {ev?.status === 'dropped_off' && <><CheckCircle size={12} /> Dropped off</>}
                                    {ev?.status === 'absent'      && <><UserX size={12} /> Absent</>}
                                    {!ev && <><Clock2 size={12} /> Waiting</>}
                                    {ev?.timestamp && typeof (ev.timestamp as any).toDate === 'function' && (
                                      <span className="text-slate-400 ml-1">
                                        {format((ev.timestamp as any).toDate(), 'h:mm a')}
                                      </span>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-slate-100">
                      <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                        {TRANSPORT_LABELS[b.transportationType] || b.transportationType}
                      </span>
                      {b.daysOfWeek?.map(day => (
                        <span key={day} className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">{day.slice(0, 2)}</span>
                      ))}
                      {b.weeklyRate > 0 && (
                        <span className="ml-auto text-sm font-bold text-amber-600">${b.weeklyRate.toFixed(2)}/wk</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ParentStatus;
