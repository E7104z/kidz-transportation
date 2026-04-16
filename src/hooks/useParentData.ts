import { useEffect, useState, useMemo } from 'react';
import { doc, getDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../context/AuthContext';
import type { Booking, Student, RouteLog, Invoice, Client, DriverLocation, RouteAssignment } from '../types';
import { format } from 'date-fns';

export interface ParentData {
  loading: boolean;
  parentName: string;
  clientId: string | null;
  client: Client | null;
  bookings: Booking[];
  students: Record<string, Student>;
  todayLogs: Record<string, RouteLog>;
  invoices: Invoice[];
  todayStr: string;
  /** driverId → bookingId mapping (from routeAssignments) */
  driverBookingMap: Record<string, string>;
  /** driverId → real-time GPS location */
  driverLocations: Record<string, DriverLocation>;
}

export function useParentData(): ParentData {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [parentName, setParentName] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [students, setStudents] = useState<Record<string, Student>>({});
  const [todayLogs, setTodayLogs] = useState<Record<string, RouteLog>>({});
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [driverBookingMap, setDriverBookingMap] = useState<Record<string, string>>({});
  const [driverLocations, setDriverLocations] = useState<Record<string, DriverLocation>>({});

  const todayStr = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  // Fetch user doc → linkedId → subscribe to bookings, students, invoices
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const unsubs: (() => void)[] = [];

    (async () => {
      const userSnap = await getDoc(doc(db, 'users', user.uid));
      if (cancelled) return;

      const linkedId = userSnap.data()?.linkedId as string | undefined;
      setParentName(userSnap.data()?.name || user.displayName || user.email || 'Parent');
      if (!linkedId) { setLoading(false); return; }
      setClientId(linkedId);

      // Client record
      const clientSnap = await getDoc(doc(db, 'clients', linkedId));
      if (clientSnap.exists()) {
        setClient({ id: clientSnap.id, ...clientSnap.data() } as Client);
      }

      // Bookings
      unsubs.push(onSnapshot(
        query(collection(db, 'bookings'), where('clientId', '==', linkedId)),
        snap => {
          if (cancelled) return;
          setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Booking));
          setLoading(false);
        }
      ));

      // Students belonging to this client
      unsubs.push(onSnapshot(
        query(collection(db, 'students'), where('clientId', '==', linkedId)),
        snap => {
          if (cancelled) return;
          const map: Record<string, Student> = {};
          snap.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() } as Student; });
          setStudents(map);
        }
      ));

      // Invoices
      unsubs.push(onSnapshot(
        query(collection(db, 'invoices'), where('clientId', '==', linkedId)),
        snap => {
          if (cancelled) return;
          setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Invoice));
        }
      ));
    })();

    return () => { cancelled = true; unsubs.forEach(u => u()); };
  }, [user]);

  // Today's route logs
  useEffect(() => {
    if (bookings.length === 0) return;
    const ids = bookings.map(b => b.id);
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

  // Route assignments → discover which drivers serve this parent's bookings
  useEffect(() => {
    if (bookings.length === 0) return;
    const ids = bookings.filter(b => b.status === 'active').map(b => b.id);
    if (ids.length === 0) return;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));

    const unsubs = chunks.map(chunk =>
      onSnapshot(
        query(collection(db, 'routeAssignments'), where('bookingId', 'in', chunk)),
        snap => {
          const map: Record<string, string> = {};
          snap.docs.forEach(d => {
            const data = d.data() as RouteAssignment;
            // Keep the most recent assignment per booking (latest wins)
            map[data.driverId] = data.bookingId;
          });
          setDriverBookingMap(map);
        },
      )
    );
    return () => unsubs.forEach(u => u());
  }, [bookings]);

  // Real-time driver locations
  useEffect(() => {
    const driverIds = Object.keys(driverBookingMap);
    if (driverIds.length === 0) { setDriverLocations({}); return; }

    const unsubs = driverIds.map(dId =>
      onSnapshot(doc(db, 'driverLocations', dId), snap => {
        if (!snap.exists()) return;
        setDriverLocations(prev => ({
          ...prev,
          [dId]: { ...(snap.data() as DriverLocation), driverId: dId },
        }));
      })
    );
    return () => unsubs.forEach(u => u());
  }, [driverBookingMap]);

  return { loading, parentName, clientId, client, bookings, students, todayLogs, invoices, todayStr, driverBookingMap, driverLocations };
}
