import { useEffect, useState, useMemo, useRef } from 'react';
import { doc, getDoc, collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../context/AuthContext';
import type { Booking, Student, RouteLog, Invoice, Client, DriverLocation, RouteAssignment, Driver, ContactRole, ContactPermissions } from '../types';
import { DEFAULT_PERMISSIONS } from '../types';
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
  /** driverId â†’ bookingId mapping (from routeAssignments) */
  driverBookingMap: Record<string, string>;
  /** driverId â†’ real-time GPS location */
  driverLocations: Record<string, DriverLocation>;
  /** driverId â†’ Driver doc (name, photoURL, etc.) */
  drivers: Record<string, Driver>;
  /** This contact's role for the linked client (primary by default). */
  contactRole: ContactRole;
  /** This contact's permissions — defaults to primary (full access). */
  permissions: ContactPermissions;
  /** Convenience flag: is this the primary contact? */
  isPrimary: boolean;
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
  const [drivers, setDrivers] = useState<Record<string, Driver>>({});
  const [contactRole, setContactRole] = useState<ContactRole>('primary');
  const [permissions, setPermissions] = useState<ContactPermissions>(DEFAULT_PERMISSIONS.primary);
  // Dedupe driver fetches across snapshot ticks + chunks to save Firestore reads
  const fetchedDriverIds = useRef<Set<string>>(new Set());

  const todayStr = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  // Fetch user doc â†’ linkedId â†’ subscribe to bookings, students, invoices
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

      // Look up clientAccess to determine this contact's role + permissions.
      // If no clientAccess doc exists, assume this is the primary parent
      // (legacy flow — users doc with linkedId is treated as full access).
      try {
        const accessSnap = await getDocs(query(
          collection(db, 'clientAccess'),
          where('uid', '==', user.uid),
          where('clientId', '==', linkedId),
        ));
        if (!cancelled && !accessSnap.empty) {
          const data = accessSnap.docs[0].data() as { role: ContactRole; permissions: ContactPermissions };
          setContactRole(data.role);
          setPermissions(data.permissions ?? DEFAULT_PERMISSIONS[data.role]);
        }
      } catch (err) {
        console.warn('[useParentData] clientAccess lookup failed:', err);
      }

      // Client record — live subscription so autoPay / paymentMethod changes
      // reflect immediately without a page refresh.
      unsubs.push(onSnapshot(doc(db, 'clients', linkedId), snap => {
        if (cancelled) return;
        if (snap.exists()) setClient({ id: snap.id, ...snap.data() } as Client);
      }));

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

  // Route assignments â†’ discover which drivers serve this parent's bookings.
  // Also fetch each driver's profile doc (one-shot getDoc, deduped) so the
  // parent portal can show their name + photo.
  useEffect(() => {
    if (bookings.length === 0) return;
    const ids = bookings.filter(b => b.status === 'active').map(b => b.id);
    if (ids.length === 0) return;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));

    // Each chunk's latest view of assignments â€” combined on every snapshot tick
    const perChunk: Array<Record<string, string>> = chunks.map(() => ({}));

    const unsubs = chunks.map((chunk, idx) =>
      onSnapshot(
        query(collection(db, 'routeAssignments'), where('bookingId', 'in', chunk)),
        async snap => {
          const chunkMap: Record<string, string> = {};
          const driverIdsInSnap: string[] = [];
          snap.docs.forEach(d => {
            const data = d.data() as RouteAssignment;
            chunkMap[data.driverId] = data.bookingId;
            driverIdsInSnap.push(data.driverId);
          });
          perChunk[idx] = chunkMap;

          const combined: Record<string, string> = {};
          perChunk.forEach(part => Object.assign(combined, part));
          setDriverBookingMap(combined);

          // Fetch only driver IDs we haven't already loaded
          const missing = Array.from(new Set(driverIdsInSnap))
            .filter(id => id && !fetchedDriverIds.current.has(id));
          if (missing.length === 0) return;
          missing.forEach(id => fetchedDriverIds.current.add(id));

          try {
            const docs = await Promise.all(
              missing.map(id => getDoc(doc(db, 'drivers', id)))
            );
            setDrivers(prev => {
              const next = { ...prev };
              docs.forEach((dSnap, i) => {
                const id = missing[i];
                if (dSnap.exists()) {
                  next[id] = { id: dSnap.id, ...dSnap.data() } as Driver;
                }
              });
              return next;
            });
          } catch (err) {
            console.warn('[useParentData] driver fetch failed:', err);
            missing.forEach(id => fetchedDriverIds.current.delete(id));
          }
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
        if (!snap.exists()) {
          setDriverLocations(prev => {
            const next = { ...prev };
            delete next[dId];
            return next;
          });
          return;
        }
        setDriverLocations(prev => ({
          ...prev,
          [dId]: { ...(snap.data() as DriverLocation), driverId: dId },
        }));
      })
    );
    return () => unsubs.forEach(u => u());
  }, [driverBookingMap]);

  return {
    loading,
    parentName,
    clientId,
    client,
    bookings,
    students,
    todayLogs,
    invoices,
    todayStr,
    driverBookingMap,
    driverLocations,
    drivers,
    contactRole,
    permissions,
    isPrimary: contactRole === 'primary',
  };
}
