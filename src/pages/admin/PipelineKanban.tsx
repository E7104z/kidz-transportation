import React, { useEffect, useState, useMemo } from 'react';
import { db } from '../../services/firebase';
import { collection, onSnapshot, doc, updateDoc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import BookingCard from '../../components/BookingCard';
import BookingDetailPanel from '../../components/BookingDetailPanel';
import type { Booking, Client, Student, BookingStatus } from '../../types';
import { DndContext, closestCenter, useDroppable } from '@dnd-kit/core';
import { Search, Inbox, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

// Column definitions
const COLUMNS: { key: BookingStatus; label: string; accent: string; badge: string }[] = [
  { key: 'new',           label: 'New Application',   accent: 'border-t-blue-500',    badge: 'bg-blue-100 text-blue-700' },
  { key: 'under_review',  label: 'Under Review',      accent: 'border-t-amber-500',   badge: 'bg-amber-100 text-amber-700' },
  { key: 'contract_sent', label: 'Contract Sent',     accent: 'border-t-purple-500',  badge: 'bg-purple-100 text-purple-700' },
  { key: 'active',        label: 'Active',            accent: 'border-t-emerald-500', badge: 'bg-emerald-100 text-emerald-700' },
  { key: 'paused',        label: 'Paused / Complete', accent: 'border-t-slate-400',   badge: 'bg-slate-100 text-slate-600' },
];


// Merged booking type
type MergedBooking = Booking & {
  client?: Client;
  students: Student[];
  orphaned?: boolean;
};

// Droppable column wrapper
const DroppableColumn: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`flex flex-col gap-3 p-3 overflow-y-auto flex-1 max-h-[calc(100vh-200px)] transition-colors rounded-b-2xl ${isOver ? 'bg-indigo-50' : ''}`}>
      {children}
    </div>
  );
};

const PipelineKanban: React.FC = () => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [clients, setClients] = useState<Record<string, Client>>({});
  const [students, setStudents] = useState<Record<string, Student>>({});
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [optimisticBookings, setOptimisticBookings] = useState<Record<string, BookingStatus>>({});
  const [loading, setLoading] = useState(true);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  // Firestore listeners
  useEffect(() => {
    let loadCount = 0;
    const checkLoaded = () => { loadCount++; if (loadCount >= 3) setLoading(false); };
    const unsubBookings = onSnapshot(collection(db, 'bookings'), snap => {
      setBookings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Booking));
      checkLoaded();
    });
    const unsubClients = onSnapshot(collection(db, 'clients'), snap => {
      const map: Record<string, Client> = {};
      snap.docs.forEach(doc => { map[doc.id] = { id: doc.id, ...doc.data() } as Client; });
      setClients(map);
      setClientsLoaded(true);
      checkLoaded();
    });
    const unsubStudents = onSnapshot(collection(db, 'students'), snap => {
      const map: Record<string, Student> = {};
      snap.docs.forEach(doc => { map[doc.id] = { id: doc.id, ...doc.data() } as Student; });
      setStudents(map);
      checkLoaded();
    });
    return () => {
      unsubBookings();
      unsubClients();
      unsubStudents();
    };
  }, []);

  // Merge bookings with client and students (flag orphans = missing client)
  const mergedBookings: MergedBooking[] = useMemo(() => {
    return bookings.map(b => ({
      ...b,
      status: optimisticBookings[b.id] || b.status,
      client: clients[b.clientId],
      students: b.studentIds.map(sid => students[sid]).filter(Boolean),
      orphaned: clientsLoaded && !clients[b.clientId],
    }));
  }, [bookings, clients, students, optimisticBookings, clientsLoaded]);

  // Orphaned bookings — their parent client doc no longer exists in Firestore
  const orphanedBookings = useMemo(
    () => mergedBookings.filter(b => b.orphaned),
    [mergedBookings],
  );

  // Bulk-cleanup orphans: cascade delete each orphan booking + its contracts,
  // routeAssignments, routeLogs. Also cleans up any stray students that
  // pointed at the (now-missing) client.
  const cleanupOrphans = async () => {
    if (orphanedBookings.length === 0) return;
    setCleaning(true);
    try {
      const refs: ReturnType<typeof doc>[] = [];
      const missingClientIds = new Set<string>();

      for (const b of orphanedBookings) {
        refs.push(doc(db, 'bookings', b.id));
        missingClientIds.add(b.clientId);
        const [contractsSnap, assignmentsSnap, logsSnap] = await Promise.all([
          getDocs(query(collection(db, 'contracts'),        where('bookingId', '==', b.id))),
          getDocs(query(collection(db, 'routeAssignments'), where('bookingId', '==', b.id))),
          getDocs(query(collection(db, 'routeLogs'),        where('bookingId', '==', b.id))),
        ]);
        contractsSnap.forEach(d => refs.push(d.ref));
        assignmentsSnap.forEach(d => refs.push(d.ref));
        logsSnap.forEach(d => refs.push(d.ref));
      }

      // Also clean up any students whose client no longer exists
      await Promise.all(
        Array.from(missingClientIds).map(async cid => {
          const sSnap = await getDocs(query(collection(db, 'students'), where('clientId', '==', cid)));
          sSnap.forEach(d => refs.push(d.ref));
        })
      );

      for (let i = 0; i < refs.length; i += 400) {
        const batch = writeBatch(db);
        refs.slice(i, i + 400).forEach(r => batch.delete(r));
        await batch.commit();
      }
      toast.success(`Cleaned up ${orphanedBookings.length} orphaned application${orphanedBookings.length === 1 ? '' : 's'}`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Cleanup failed');
    } finally {
      setCleaning(false);
    }
  };

  // Search filter
  const filteredBookings = useMemo(() => {
    if (!search.trim()) return mergedBookings;
    const q = search.trim().toLowerCase();
    return mergedBookings.filter(b => {
      const studentNames = b.students.map(s => s.name).join(' ').toLowerCase();
      const parentName = b.client?.name?.toLowerCase() || '';
      return studentNames.includes(q) || parentName.includes(q);
    });
  }, [mergedBookings, search]);

  // Group by status
  const bookingsByStatus: Record<BookingStatus, MergedBooking[]> = useMemo(() => {
    const map: Record<BookingStatus, MergedBooking[]> = {
      new: [],
      under_review: [],
      dry_run: [],
      meet_and_greet: [],
      contract_sent: [],
      active: [],
      paused: [],
      completed: [],
    };
    filteredBookings.forEach(b => {
      if (map[b.status]) map[b.status].push(b);
    });
    // Merge paused and completed for last column
    map.paused = [...(map.paused || []), ...(map.completed || [])];
    map.completed = [];
    return map;
  }, [filteredBookings]);

  // Drag and drop handlers
  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    if (!active || !over) return;
    const bookingId = active.id;
    const newStatus = over.id as BookingStatus;
    const booking = mergedBookings.find(b => b.id === bookingId);
    if (!booking || booking.status === newStatus) return;
    // Optimistically update
    setOptimisticBookings(prev => ({ ...prev, [bookingId]: newStatus }));
    try {
      await updateDoc(doc(db, 'bookings', bookingId), { status: newStatus });
      setOptimisticBookings(prev => {
        const copy = { ...prev };
        delete copy[bookingId];
        return copy;
      });
    } catch (err) {
      setOptimisticBookings(prev => {
        const copy = { ...prev };
        delete copy[bookingId];
        return copy;
      });
      // @ts-ignore
      import('react-hot-toast').then(({ default: toast }) => toast.error('Failed to update status.'));
    }
  };

  return (
    <div className="flex flex-col">
      {/* Header bar */}
      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-8 py-6 flex items-center justify-between sticky top-0 z-10">
        <div>
          <h1 className="text-2xl font-bold text-white">Pipeline</h1>
          <p className="text-sm text-indigo-200">Manage transportation applications</p>
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="Search by student or parent..."
            className="w-72 rounded-full border border-white/20 bg-white/10 text-white placeholder-indigo-200 pl-10 pr-4 py-2 text-sm focus:bg-white/20 focus:outline-none transition-colors"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60">
            <Search size={16} />
          </span>
        </div>
      </div>
      {/* Orphan cleanup banner */}
      {orphanedBookings.length > 0 && (
        <div className="mx-8 mt-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-amber-900">
              {orphanedBookings.length} orphaned application{orphanedBookings.length === 1 ? '' : 's'} found
            </div>
            <div className="text-xs text-amber-800 mt-0.5">
              These bookings have no matching client record (the client was deleted directly in Firestore). Cleaning up removes the orphan bookings, their contracts, route assignments, route logs, and any dangling students.
            </div>
          </div>
          <button
            onClick={cleanupOrphans}
            disabled={cleaning}
            className="rounded-lg bg-amber-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-amber-700 transition-colors disabled:opacity-60"
          >
            {cleaning ? 'Cleaning…' : 'Clean up'}
          </button>
        </div>
      )}
      {/* Kanban columns */}
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex gap-5 overflow-x-auto p-8">
          {COLUMNS.map((col) => {
            const bookingsInCol = col.key === 'paused'
              ? bookingsByStatus.paused
              : bookingsByStatus[col.key] || [];
            return (
              <div key={col.key} className={`w-72 flex-shrink-0 bg-white rounded-2xl shadow-sm border border-slate-200 border-t-4 ${col.accent} flex flex-col`}>
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-700">{col.label}</span>
                  <span className={`ml-2 rounded-full text-xs font-bold px-2 py-0.5 ${col.badge}`}>
                    {bookingsInCol.length}
                  </span>
                </div>
                <DroppableColumn id={col.key}>
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="bg-white rounded-xl border border-kidz-border p-4 animate-pulse">
                        <div className="h-4 bg-slate-200 rounded w-3/4 mb-2" />
                        <div className="h-3 bg-slate-200 rounded w-1/2 mb-2" />
                        <div className="h-3 bg-slate-200 rounded w-1/3 mb-3" />
                        <div className="flex justify-between">
                          <div className="flex gap-1">{Array.from({ length: 5 }).map((_, j) => <div key={j} className="h-5 w-5 bg-slate-200 rounded-full" />)}</div>
                          <div className="h-4 bg-slate-200 rounded w-16" />
                        </div>
                      </div>
                    ))
                  ) : bookingsInCol.length === 0 ? (
                    <div className="border-2 border-dashed border-kidz-border rounded-xl p-6 text-center text-kidz-textMuted text-sm">
                      <Inbox size={24} className="mx-auto mb-2" />
                      No applications
                    </div>
                  ) : (
                    bookingsInCol.map((b) => (
                      <BookingCard
                        key={b.id}
                        booking={b}
                        onSelect={() => setSelectedBookingId(b.id)}
                      />
                    ))
                  )}
                </DroppableColumn>
              </div>
            );
          })}
        </div>
      </DndContext>
      {/* Booking detail slide-over */}
      <BookingDetailPanel
        booking={mergedBookings.find(b => b.id === selectedBookingId) || null}
        open={!!selectedBookingId}
        onClose={() => setSelectedBookingId(null)}
      />
    </div>
  );
};

export default PipelineKanban;
