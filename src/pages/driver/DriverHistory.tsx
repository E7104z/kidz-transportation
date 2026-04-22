import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../context/AuthContext';
import type { RouteLog, Booking, Client, Student } from '../../types';
import { Calendar, CheckCircle, XCircle, Users } from 'lucide-react';
import { format, parseISO } from 'date-fns';

const DriverHistory: React.FC = () => {
  const { user } = useAuth();
  const [linkedId, setLinkedId] = useState('');
  const [logs,     setLogs]     = useState<RouteLog[]>([]);
  const [bookings, setBookings] = useState<Record<string, Booking>>({});
  const [clients,  setClients]  = useState<Record<string, Client>>({});
  const [students, setStudents] = useState<Record<string, Student>>({});
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const s = await getDoc(doc(db, 'users', user.uid));
      if (cancelled) return;
      const id = s.data()?.linkedId as string | undefined;
      if (id) setLinkedId(id);
      else    setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!linkedId) return;
    const unsubs: Array<() => void> = [];
    const todayStr = format(new Date(), 'yyyy-MM-dd');

    // past logs: everything before today, sorted desc, last 90
    try {
      unsubs.push(onSnapshot(
        query(
          collection(db, 'routeLogs'),
          where('driverId', '==', linkedId),
          where('date', '<', todayStr),
          orderBy('date', 'desc'),
          limit(90),
        ),
        snap => {
          setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() }) as RouteLog));
          setLoading(false);
        },
        err => {
          console.error('History query failed', err);
          setLoading(false);
        },
      ));
    } catch (e) {
      console.error(e);
      setLoading(false);
    }

    unsubs.push(onSnapshot(collection(db, 'bookings'), snap => {
      const m: Record<string, Booking> = {};
      snap.docs.forEach(d => { m[d.id] = { id: d.id, ...d.data() } as Booking; });
      setBookings(m);
    }));
    unsubs.push(onSnapshot(collection(db, 'clients'), snap => {
      const m: Record<string, Client> = {};
      snap.docs.forEach(d => { m[d.id] = { id: d.id, ...d.data() } as Client; });
      setClients(m);
    }));
    unsubs.push(onSnapshot(collection(db, 'students'), snap => {
      const m: Record<string, Student> = {};
      snap.docs.forEach(d => { m[d.id] = { id: d.id, ...d.data() } as Student; });
      setStudents(m);
    }));

    return () => unsubs.forEach(u => u());
  }, [linkedId]);

  const grouped = useMemo(() => {
    const byDate: Record<string, RouteLog[]> = {};
    logs.forEach(l => { (byDate[l.date] ||= []).push(l); });
    return Object.entries(byDate).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [logs]);

  const totals = useMemo(() => {
    const ran    = logs.filter(l => l.ran).length;
    const missed = logs.filter(l => l.ran === false).length;
    const students = logs.reduce((acc, l) => {
      const evts = (l.studentEvents ?? {}) as Record<string, { status: string }>;
      return acc + Object.values(evts).filter(e => e.status === 'dropped_off').length;
    }, 0);
    return { ran, missed, students };
  }, [logs]);

  return (
    <div className="p-5">
      <h1 className="text-xl font-bold text-slate-800 mb-4">Route History</h1>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <div className="bg-white rounded-xl border border-slate-200 p-3 text-center">
          <div className="text-2xl font-extrabold text-emerald-600">{totals.ran}</div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Routes Run</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3 text-center">
          <div className="text-2xl font-extrabold text-teal-600">{totals.students}</div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Kids Delivered</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3 text-center">
          <div className="text-2xl font-extrabold text-red-500">{totals.missed}</div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Missed</div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="bg-white rounded-xl border border-slate-200 h-20 animate-pulse" />)}
        </div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
          <Calendar size={36} className="mx-auto text-slate-300 mb-2" />
          <p className="text-slate-500 font-semibold">No past routes yet</p>
          <p className="text-slate-400 text-xs mt-1">Completed routes will appear here.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([date, items]) => (
            <div key={date}>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2 px-1">
                {format(parseISO(date), 'EEEE, MMM d, yyyy')}
              </div>
              <div className="space-y-2">
                {items.map(log => {
                  const booking = bookings[log.bookingId];
                  const client  = booking ? clients[booking.clientId] : null;
                  const evts    = (log.studentEvents ?? {}) as Record<string, { status: string }>;
                  const studentList = booking?.studentIds.map(sid => students[sid]).filter(Boolean) ?? [];
                  const dropped = studentList.filter(s => evts[s.id]?.status === 'dropped_off').length;
                  const absent  = studentList.filter(s => evts[s.id]?.status === 'absent').length;

                  return (
                    <div key={log.id} className={`bg-white rounded-xl border p-3 ${
                      log.ran === false ? 'border-red-200' : 'border-slate-200'
                    }`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-800 text-sm truncate">{client?.name ?? '—'}</div>
                          {studentList.length > 0 && (
                            <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
                              <Users size={11} /> {studentList.map(s => s.name).join(', ')}
                            </div>
                          )}
                        </div>
                        {log.ran === false ? (
                          <span className="text-[11px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <XCircle size={11} /> Missed
                          </span>
                        ) : (
                          <span className="text-[11px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle size={11} />
                            {studentList.length > 0 ? `${dropped}/${studentList.length - absent}` : 'Done'}
                          </span>
                        )}
                      </div>
                      {log.notes && (
                        <div className="mt-2 text-xs text-slate-500 italic border-l-2 border-slate-200 pl-2">
                          {log.notes}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DriverHistory;
