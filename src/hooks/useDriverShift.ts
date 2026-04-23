/**
 * useDriverShift — manages clock-in / clock-out / break for a driver.
 * Reads/writes to `driverShifts` and `driverBreaks` collections.
 */
import { useState, useEffect } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../services/firebase';
import type { DriverShift, DriverBreak, ShiftStatus } from '../types';

interface UseDriverShiftReturn {
  activeShift: DriverShift | null;
  activeBreak: DriverBreak | null;
  status: ShiftStatus | 'none';
  clockIn: () => Promise<void>;
  clockOut: () => Promise<void>;
  startBreak: (reason?: DriverBreak['reason']) => Promise<void>;
  endBreak: () => Promise<void>;
  loading: boolean;
}

// HOS (Hours of Service) warning thresholds
const HOS_WARN_MINUTES = 600; // 10h
const HOS_LIMIT_MINUTES = 660; // 11h

export function useDriverShift(driverId: string | null): UseDriverShiftReturn {
  const [activeShift, setActiveShift] = useState<DriverShift | null>(null);
  const [activeBreak, setActiveBreak] = useState<DriverBreak | null>(null);
  const [loading, setLoading]         = useState(true);

  // Subscribe to the driver's most recent open shift
  useEffect(() => {
    if (!driverId) { setLoading(false); return; }
    const q = query(
      collection(db, 'driverShifts'),
      where('driverId', '==', driverId),
      where('status', 'in', ['clocked_in', 'on_break']),
      orderBy('clockInAt', 'desc'),
      limit(1),
    );
    const unsub = onSnapshot(q, snap => {
      setActiveShift(snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as DriverShift));
      setLoading(false);
    });
    return unsub;
  }, [driverId]);

  // Subscribe to the active break on the current shift
  useEffect(() => {
    if (!activeShift) { setActiveBreak(null); return; }
    const q = query(
      collection(db, 'driverBreaks'),
      where('shiftId', '==', activeShift.id),
      where('endedAt', '==', null),
      limit(1),
    );
    const unsub = onSnapshot(q, snap => {
      setActiveBreak(snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as DriverBreak));
    });
    return unsub;
  }, [activeShift]);

  const status: ShiftStatus | 'none' = activeShift?.status ?? 'none';

  const clockIn = async () => {
    if (!driverId || activeShift) return;
    await addDoc(collection(db, 'driverShifts'), {
      driverId,
      clockInAt: serverTimestamp(),
      status: 'clocked_in' satisfies ShiftStatus,
      totalBreakMinutes: 0,
      totalDrivingMinutes: 0,
      hoursOfServiceWarning: null,
    });
  };

  const clockOut = async () => {
    if (!driverId || !activeShift) return;
    const now = Timestamp.now();
    const clockInMs = activeShift.clockInAt.toMillis();
    const elapsedMinutes = Math.round((now.toMillis() - clockInMs) / 60_000);
    const drivingMinutes = elapsedMinutes - activeShift.totalBreakMinutes;
    const hosWarning: DriverShift['hoursOfServiceWarning'] =
      drivingMinutes >= HOS_LIMIT_MINUTES ? 'at_limit' :
      drivingMinutes >= HOS_WARN_MINUTES  ? 'approaching_limit' : null;
    await updateDoc(doc(db, 'driverShifts', activeShift.id), {
      clockOutAt: serverTimestamp(),
      status: 'clocked_out' satisfies ShiftStatus,
      totalDrivingMinutes: drivingMinutes,
      hoursOfServiceWarning: hosWarning,
    });
  };

  const startBreak = async (reason: DriverBreak['reason'] = 'rest') => {
    if (!driverId || !activeShift || activeBreak) return;
    await Promise.all([
      addDoc(collection(db, 'driverBreaks'), {
        shiftId: activeShift.id,
        driverId,
        startedAt: serverTimestamp(),
        endedAt: null,
        durationMinutes: null,
        reason,
      }),
      updateDoc(doc(db, 'driverShifts', activeShift.id), {
        status: 'on_break' satisfies ShiftStatus,
      }),
    ]);
  };

  const endBreak = async () => {
    if (!driverId || !activeShift || !activeBreak) return;
    const now      = Timestamp.now();
    const duration = Math.round((now.toMillis() - activeBreak.startedAt.toMillis()) / 60_000);
    await Promise.all([
      updateDoc(doc(db, 'driverBreaks', activeBreak.id), {
        endedAt: serverTimestamp(),
        durationMinutes: duration,
      }),
      updateDoc(doc(db, 'driverShifts', activeShift.id), {
        status: 'clocked_in' satisfies ShiftStatus,
        totalBreakMinutes: activeShift.totalBreakMinutes + duration,
      }),
    ]);
  };

  return { activeShift, activeBreak, status, clockIn, clockOut, startBreak, endBreak, loading };
}
