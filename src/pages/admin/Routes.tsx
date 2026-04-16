import React, { useEffect, useState, useMemo } from 'react';
import {
  collection, getDocs, onSnapshot, doc, setDoc, serverTimestamp, query, where,
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../context/AuthContext';
import type { RouteLog, Booking, Client, Driver, RouteAssignment } from '../../types';
import { format, startOfWeek } from 'date-fns';
import { CheckCircle, XCircle, MapPin, ChevronLeft, ChevronRight } from 'lucide-react';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const toDate = (val: Date | unknown): Date => {
  if (!val) return new Date(0);
  if (val instanceof Date) return val;
  if (typeof (val as { toDate?: () => Date }).toDate === 'function')
    return (val as { toDate: () => Date }).toDate();
  return new Date(val as string | number);
};

const AdminRoutes: React.FC = () => {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const [bookings, setBookings]       = useState<Booking[]>([]);
  const [clients, setClients]         = useState<Record<string, Client>>({});
  const [drivers, setDrivers]         = useState<Record<string, Driver>>({});
  const [assignments, setAssignments] = useState<RouteAssignment[]>([]);
  const [routeLogs, setRouteLogs]     = useState<RouteLog[]>([]);
  const [saving, setSaving]           = useState<string | null>(null);

  // Static data — loaded once on mount (bookings/clients/drivers/assignments
  // don't change while an admin is logging daily runs)
  useEffect(() => {
    const load = async () => {
      const [b, c, d, a] = await Promise.all([
        getDocs(collection(db, 'bookings')),
        getDocs(collection(db, 'clients')),
        getDocs(collection(db, 'drivers')),
        getDocs(collection(db, 'routeAssignments')),
      ]);
      setBookings(b.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Booking));
      const cm: Record<string, Client> = {};
      c.docs.forEach(doc => { cm[doc.id] = { id: doc.id, ...doc.data() } as Client; });
      setClients(cm);
      const dm: Record<string, Driver> = {};
      d.docs.forEach(doc => { dm[doc.id] = { id: doc.id, ...doc.data() } as Driver; });
      setDrivers(dm);
      setAssignments(a.docs.map(doc => ({ id: doc.id, ...doc.data() }) as RouteAssignment));
    };
    load();
  }, []);

  // Route logs: real-time but scoped to the selected date only
  // (avoids listening to the entire routeLogs collection)
  useEffect(() => {
    const q = query(
      collection(db, 'routeLogs'),
      where('date', '==', selectedDate),
    );
    const unsub = onSnapshot(q, snap => {
      setRouteLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() }) as RouteLog));
    });
    return unsub;
  }, [selectedDate]);

  const selectedDayName = useMemo(() => {
    const d = new Date(selectedDate + 'T00:00:00');
    return DAY_NAMES[d.getDay()];
  }, [selectedDate]);

  const scheduledBookings = useMemo(() =>
    bookings.filter(b =>
      b.status === 'active' &&
      (b.daysOfWeek || []).includes(selectedDayName),
    ),
    [bookings, selectedDayName],
  );

  const dateLogMap = useMemo(() => {
    const map: Record<string, RouteLog> = {};
    routeLogs.filter(l => l.date === selectedDate).forEach(l => { map[l.bookingId] = l; });
    return map;
  }, [routeLogs, selectedDate]);

  const getDriverForBooking = (bookingId: string): Driver | null => {
    const matched = assignments
      .filter(a => a.bookingId === bookingId)
      .sort((a, b) => toDate(b.weekStart).getTime() - toDate(a.weekStart).getTime());
    if (!matched.length) return null;
    return drivers[matched[0].driverId] || null;
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
      {
        bookingId,
        driverId: asn?.driverId ?? '',
        date: selectedDate,
        ran,
        confirmedBy: user.uid,
        confirmedAt: serverTimestamp(),
        notes: '',
      },
      { merge: true },
    );
    setSaving(null);
  };

  const navigateDate = (delta: number) => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    setSelectedDate(format(d, 'yyyy-MM-dd'));
  };

  const ranCount   = scheduledBookings.filter(b => dateLogMap[b.id]?.ran === true).length;
  const missedCount = scheduledBookings.filter(b => dateLogMap[b.id]?.ran === false).length;
  const pendingCount = scheduledBookings.length - ranCount - missedCount;

  return (
    <div>
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-8 py-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Daily Routes</h1>
          <p className="text-violet-100 text-sm">Log and manage run confirmations</p>
        </div>
        <div className="flex gap-4 text-center">
          <div><div className="text-2xl font-bold text-white">{ranCount}</div><div className="text-xs text-violet-200">Ran</div></div>
          <div><div className="text-2xl font-bold text-white">{missedCount}</div><div className="text-xs text-violet-200">Missed</div></div>
          <div><div className="text-2xl font-bold text-white">{pendingCount}</div><div className="text-xs text-violet-200">Pending</div></div>
        </div>
      </div>

      {/* Date nav */}
      <div className="px-8 py-3 bg-white border-b border-slate-200 flex items-center gap-3">
        <button
          onClick={() => navigateDate(-1)}
          className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <input
          type="date"
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
        <button
          onClick={() => navigateDate(1)}
          className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ChevronRight size={18} />
        </button>
        <span className="font-semibold text-slate-700">{selectedDayName}</span>
        <span className="text-slate-400 text-sm">
          {scheduledBookings.length} run{scheduledBookings.length !== 1 ? 's' : ''} scheduled
        </span>
        <button
          onClick={() => setSelectedDate(format(new Date(), 'yyyy-MM-dd'))}
          className="ml-2 text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-semibold px-3 py-1 rounded-lg transition-colors"
        >
          Today
        </button>
      </div>

      <div className="p-8">
        {scheduledBookings.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
            <MapPin size={40} className="mx-auto text-slate-300 mb-3" />
            <p className="text-slate-600 font-semibold">No routes scheduled for {selectedDayName}</p>
            <p className="text-slate-400 text-sm mt-1">
              Active bookings that include this day will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {scheduledBookings.map(booking => {
              const client  = clients[booking.clientId];
              const driver  = getDriverForBooking(booking.id);
              const log     = dateLogMap[booking.id];
              const isSaving = saving === booking.id;

              return (
                <div
                  key={booking.id}
                  className={`bg-white rounded-2xl border shadow-sm p-5 transition-all ${
                    log?.ran === true  ? 'border-emerald-200' :
                    log?.ran === false ? 'border-red-200' :
                    'border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-slate-800">{client?.name || 'Unknown client'}</span>
                        {driver ? (
                          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                            {driver.name}
                          </span>
                        ) : (
                          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                            No driver assigned
                          </span>
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
                            onClick={() => logRun(booking.id, !log.ran)}
                            disabled={isSaving}
                            className="text-xs text-slate-400 hover:text-slate-700 underline transition-colors disabled:opacity-40"
                          >
                            {isSaving
                              ? <span className="inline-block w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
                              : 'Override'
                            }
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() => logRun(booking.id, true)}
                            disabled={isSaving}
                            className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors disabled:opacity-60"
                          >
                            {isSaving
                              ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              : <CheckCircle size={15} />}
                            Ran
                          </button>
                          <button
                            onClick={() => logRun(booking.id, false)}
                            disabled={isSaving}
                            className="flex items-center gap-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors disabled:opacity-60"
                          >
                            <XCircle size={15} />
                            Missed
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {log && (
                    <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-400">
                      Confirmed by {log.confirmedBy === user?.uid ? 'you (admin)' : 'driver'} ·{' '}
                      {log.confirmedAt
                        ? format(toDate(log.confirmedAt), 'h:mm a')
                        : 'pending save'}
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

export default AdminRoutes;
