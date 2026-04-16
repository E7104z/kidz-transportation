import { useEffect, useState, useMemo } from 'react';
import {
  collection, onSnapshot, query, where, getDocs, doc,
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { format, subDays, differenceInMinutes } from 'date-fns';
import type {
  Booking, Driver, Client, Student, RouteLog, RouteAssignment, DriverLocation, StudentEvent,
} from '../types';

// ── Alert types ───────────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface DispatchAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  bookingId?: string;
  driverId?: string;
  clientId?: string;
  timestamp: Date;
  isToday: boolean;
}

// ── Route status ──────────────────────────────────────────────────────────────

export type RouteStatus =
  | 'not_started'   // scheduled today, no log yet
  | 'in_progress'   // log exists, ran=true, not all dropped off
  | 'complete'      // all students dropped off
  | 'missed'        // ran=false
  | 'no_gps'        // driver GPS stale/missing
  | 'pending';      // scheduled but not yet time to start

export interface DispatchRoute {
  booking: Booking;
  client: Client | null;
  driver: Driver | null;
  driverId: string | null;
  log: RouteLog | null;
  location: DriverLocation | null;
  status: RouteStatus;
  studentEvents: Record<string, StudentEvent>;
  studentNames: string[];
  studentsTotal: number;
  studentsPickedUp: number;
  studentsDroppedOff: number;
  studentsAbsent: number;
  gpsAgeSeconds: number | null;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface DispatchData {
  loading: boolean;
  todayRoutes: DispatchRoute[];
  alerts: DispatchAlert[];
  driverLocations: Record<string, DriverLocation>;
  drivers: Record<string, Driver>;
  bookings: Booking[];
  clients: Record<string, Client>;
  assignments: RouteAssignment[];
  historyDays: number;
  setHistoryDays: (n: number) => void;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function now() { return new Date(); }

function gpsAgeSeconds(loc: DriverLocation | null): number | null {
  if (!loc?.updatedAt) return null;
  const ts = typeof (loc.updatedAt as any).toDate === 'function'
    ? (loc.updatedAt as any).toDate()
    : new Date(loc.updatedAt as any);
  return Math.floor((Date.now() - ts.getTime()) / 1000);
}

export function useDispatchData(): DispatchData {
  const [loading, setLoading]                 = useState(true);
  const [bookings, setBookings]               = useState<Booking[]>([]);
  const [clients, setClients]                 = useState<Record<string, Client>>({});
  const [drivers, setDrivers]                 = useState<Record<string, Driver>>({});
  const [students, setStudents]               = useState<Record<string, Student>>({});
  const [assignments, setAssignments]         = useState<RouteAssignment[]>([]);
  const [todayLogs, setTodayLogs]             = useState<Record<string, RouteLog>>({});
  const [historyLogs, setHistoryLogs]         = useState<RouteLog[]>([]);
  const [driverLocations, setDriverLocations] = useState<Record<string, DriverLocation>>({});
  const [historyDays, setHistoryDays]         = useState(7);

  const todayStr = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const todayDay = useMemo(() => DAY_NAMES[new Date().getDay()], []);

  // ── Static collections ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(collection(db, 'bookings'), snap => {
      if (cancelled) return;
      setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Booking));
      setLoading(false);
    }));
    unsubs.push(onSnapshot(collection(db, 'clients'), snap => {
      if (cancelled) return;
      const m: Record<string, Client> = {};
      snap.docs.forEach(d => { m[d.id] = { id: d.id, ...d.data() } as Client; });
      setClients(m);
    }));
    unsubs.push(onSnapshot(collection(db, 'drivers'), snap => {
      if (cancelled) return;
      const m: Record<string, Driver> = {};
      snap.docs.forEach(d => { m[d.id] = { id: d.id, ...d.data() } as Driver; });
      setDrivers(m);
    }));
    unsubs.push(onSnapshot(collection(db, 'students'), snap => {
      if (cancelled) return;
      const m: Record<string, Student> = {};
      snap.docs.forEach(d => { m[d.id] = { id: d.id, ...d.data() } as Student; });
      setStudents(m);
    }));
    unsubs.push(onSnapshot(collection(db, 'routeAssignments'), snap => {
      if (cancelled) return;
      setAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() }) as RouteAssignment));
    }));

    return () => { cancelled = true; unsubs.forEach(u => u()); };
  }, []);

  // ── Today's route logs ──────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'routeLogs'), where('date', '==', todayStr)),
      snap => {
        const m: Record<string, RouteLog> = {};
        snap.docs.forEach(d => { m[d.data().bookingId] = { id: d.id, ...d.data() } as RouteLog; });
        setTodayLogs(m);
      },
    );
    return unsub;
  }, [todayStr]);

  // ── History logs ────────────────────────────────────────────────────────
  useEffect(() => {
    const from = format(subDays(new Date(), historyDays), 'yyyy-MM-dd');
    getDocs(
      query(collection(db, 'routeLogs'), where('date', '>=', from), where('date', '<', todayStr)),
    ).then(snap => {
      setHistoryLogs(snap.docs.map(d => ({ id: d.id, ...d.data() }) as RouteLog));
    });
  }, [historyDays, todayStr]);

  // ── Driver locations ────────────────────────────────────────────────────
  useEffect(() => {
    const driverIds = Object.keys(drivers);
    if (driverIds.length === 0) return;
    const unsubs = driverIds.map(dId =>
      onSnapshot(
        doc(db, 'driverLocations', dId),
        (snap) => {
          if (!snap.exists()) return;
          setDriverLocations(prev => ({
            ...prev,
            [dId]: { ...(snap.data() as DriverLocation), driverId: dId },
          }));
        },
      )
    );
    return () => unsubs.forEach(u => u());
  }, [drivers]);

  // ── Build dispatche routes ──────────────────────────────────────────────
  const todayRoutes = useMemo<DispatchRoute[]>(() => {
    const activeToday = bookings.filter(b =>
      b.status === 'active' && (b.daysOfWeek ?? []).includes(todayDay),
    );

    return activeToday.map(booking => {
      // Find most recent assignment for this booking
      const asgn = assignments
        .filter(a => a.bookingId === booking.id)
        .sort((a, b) => {
          const ta = a.weekStart && typeof (a.weekStart as any).toDate === 'function'
            ? (a.weekStart as any).toDate().getTime() : 0;
          const tb = b.weekStart && typeof (b.weekStart as any).toDate === 'function'
            ? (b.weekStart as any).toDate().getTime() : 0;
          return tb - ta;
        })[0] ?? null;

      const driverId = asgn?.driverId ?? null;
      const driver   = driverId ? (drivers[driverId] ?? null) : null;
      const client   = clients[booking.clientId] ?? null;
      const log      = todayLogs[booking.id] ?? null;
      const location = driverId ? (driverLocations[driverId] ?? null) : null;

      const studentEvents: Record<string, StudentEvent> = log?.studentEvents ?? {};

      const studentNames = (booking.studentIds ?? []).map(sid => students[sid]?.name ?? '').filter(Boolean);
      const studentsTotal      = booking.studentIds?.length ?? 0;
      const studentsPickedUp   = Object.values(studentEvents).filter(e => e.status === 'picked_up').length;
      const studentsDroppedOff = Object.values(studentEvents).filter(e => e.status === 'dropped_off').length;
      const studentsAbsent     = Object.values(studentEvents).filter(e => e.status === 'absent' || e.status === 'no_show').length;

      // Determine status
      let status: RouteStatus = 'pending';
      if (log?.ran === false) {
        status = 'missed';
      } else if (log?.ran === true) {
        const nonAbsent = studentsTotal - studentsAbsent;
        status = nonAbsent > 0 && studentsDroppedOff >= nonAbsent ? 'complete' : 'in_progress';
      } else {
        // No log yet — check time
        const [startH, startM] = (booking.schoolStartTime ?? '08:00').split(':').map(Number);
        const scheduledMs = new Date().setHours(startH, startM, 0, 0);
        const minsLate = differenceInMinutes(now(), scheduledMs);
        if (minsLate >= 10) {
          status = 'not_started';
        } else if (minsLate >= -60) {
          status = 'pending';
        } else {
          status = 'pending';
        }
        // Check GPS freshness only for in-progress or overdue
        const age = gpsAgeSeconds(location);
        if (status === 'not_started' && age !== null && age > 180) {
          status = 'no_gps';
        }
      }

      return {
        booking, client, driver, driverId, log, location, status,
        studentEvents, studentNames, studentsTotal, studentsPickedUp,
        studentsDroppedOff, studentsAbsent,
        gpsAgeSeconds: gpsAgeSeconds(location),
      };
    });
  }, [bookings, assignments, clients, drivers, students, todayLogs, driverLocations, todayDay]);

  // ── Build alerts ────────────────────────────────────────────────────────
  const alerts = useMemo<DispatchAlert[]>(() => {
    const list: DispatchAlert[] = [];

    // Today's alerts
    todayRoutes.forEach(r => {
      const label = r.studentNames.join(', ') || r.booking.id;

      if (r.status === 'not_started') {
        list.push({
          id: `not_started_${r.booking.id}`,
          severity: 'critical',
          title: 'Route Not Started',
          body: `${label} — route is 10+ min late. Driver: ${r.driver?.name ?? 'unassigned'}`,
          bookingId: r.booking.id,
          driverId: r.driverId ?? undefined,
          clientId: r.booking.clientId,
          timestamp: new Date(),
          isToday: true,
        });
      }
      if (r.status === 'missed') {
        list.push({
          id: `missed_${r.booking.id}`,
          severity: 'critical',
          title: 'Run Missed',
          body: `${label} — driver marked this run as missed.`,
          bookingId: r.booking.id,
          driverId: r.driverId ?? undefined,
          clientId: r.booking.clientId,
          timestamp: new Date(),
          isToday: true,
        });
      }
      if (r.status === 'no_gps') {
        list.push({
          id: `no_gps_${r.booking.id}`,
          severity: 'warning',
          title: 'GPS Signal Lost',
          body: `${r.driver?.name ?? 'Driver'} GPS is offline. Last seen ${r.gpsAgeSeconds ? Math.round(r.gpsAgeSeconds / 60) + 'm ago' : 'unknown'}.`,
          bookingId: r.booking.id,
          driverId: r.driverId ?? undefined,
          timestamp: new Date(),
          isToday: true,
        });
      }

      // Student-level events
      (r.booking.studentIds ?? []).forEach(sid => {
        const ev = r.studentEvents[sid];
        if (!ev) return;
        const name = students[sid]?.name ?? 'Student';
        if (ev.status === 'absent') {
          list.push({
            id: `absent_${r.booking.id}_${sid}`,
            severity: 'warning',
            title: 'Student Absent',
            body: `${name} was marked absent today.`,
            bookingId: r.booking.id,
            clientId: r.booking.clientId,
            timestamp: ev.timestamp && typeof (ev.timestamp as any).toDate === 'function'
              ? (ev.timestamp as any).toDate() : new Date(),
            isToday: true,
          });
        }
        if (ev.status === 'no_show') {
          list.push({
            id: `no_show_${r.booking.id}_${sid}`,
            severity: 'critical',
            title: 'Student No-Show',
            body: `${name} was expected but did not board the van.`,
            bookingId: r.booking.id,
            clientId: r.booking.clientId,
            timestamp: ev.timestamp && typeof (ev.timestamp as any).toDate === 'function'
              ? (ev.timestamp as any).toDate() : new Date(),
            isToday: true,
          });
        }
      });

      if (r.status === 'complete') {
        list.push({
          id: `complete_${r.booking.id}`,
          severity: 'info',
          title: 'Route Complete',
          body: `${label} — all students dropped off.`,
          bookingId: r.booking.id,
          timestamp: new Date(),
          isToday: true,
        });
      }
    });

    // Historical alerts from past route logs
    historyLogs.forEach(log => {
      if (log.ran === false) {
        const booking = bookings.find(b => b.id === log.bookingId);
        const sids = booking?.studentIds ?? [];
        const names = sids.map(sid => students[sid]?.name ?? '').filter(Boolean).join(', ') || log.bookingId;
        list.push({
          id: `hist_missed_${log.id}`,
          severity: 'critical',
          title: 'Run Missed',
          body: `${names} — run missed on ${log.date}.`,
          bookingId: log.bookingId,
          driverId: log.driverId || undefined,
          timestamp: new Date(log.date + 'T12:00:00'),
          isToday: false,
        });
      }
      // Past absent / no-show
      if (log.studentEvents) {
        Object.entries(log.studentEvents).forEach(([sid, ev]) => {
          const studentName = students[sid]?.name;
          if (ev.status === 'absent' || ev.status === 'no_show') {
            list.push({
              id: `hist_${ev.status}_${log.id}_${sid}`,
              severity: ev.status === 'no_show' ? 'critical' : 'warning',
              title: ev.status === 'no_show' ? 'Student No-Show' : 'Student Absent',
              body: `${studentName ?? 'Student'} — ${ev.status === 'no_show' ? 'no-show' : 'absent'} on ${log.date}.`,
              bookingId: log.bookingId,
              timestamp: new Date(log.date + 'T08:00:00'),
              isToday: false,
            });
          }
        });
      }
    });

    // Sort: today's alerts first, then by time descending
    return list.sort((a, b) => {
      if (a.isToday && !b.isToday) return -1;
      if (!a.isToday && b.isToday) return 1;
      return b.timestamp.getTime() - a.timestamp.getTime();
    });
  }, [todayRoutes, historyLogs, bookings, students]);

  return {
    loading,
    todayRoutes,
    alerts,
    driverLocations,
    drivers,
    bookings,
    clients,
    assignments,
    historyDays,
    setHistoryDays,
  };
}
