import React, { useEffect, useMemo, useState } from 'react';
import { Clock, Coffee, Play, Square, AlertTriangle } from 'lucide-react';
import { useDriverShift } from '../hooks/useDriverShift';

const HOS_WARN_MINUTES = 600;  // 10 h
const HOS_LIMIT_MINUTES = 660; // 11 h

interface Props {
  driverId: string;
}

function formatElapsed(startMs: number): string {
  const elapsed = Math.floor((Date.now() - startMs) / 1000);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const ShiftControls: React.FC<Props> = ({ driverId }) => {
  const { status, activeShift, activeBreak, clockIn, clockOut, startBreak, endBreak, loading } =
    useDriverShift(driverId);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (loading) return null;

  const elapsedLabel = activeShift
    ? formatElapsed(activeShift.clockInAt.toMillis())
    : null;

  const breakElapsed = activeBreak
    ? formatElapsed(activeBreak.startedAt.toMillis())
    : null;

  // Compute HOS warning live from elapsed time (tick forces re-eval every second)
  // so drivers see the warning while actively driving, not only after clocking out.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hos: 'at_limit' | 'approaching_limit' | null = useMemo(() => {
    if (!activeShift) return null;
    const elapsedMinutes = Math.floor((Date.now() - activeShift.clockInAt.toMillis()) / 60_000);
    const drivingMinutes = Math.max(0, elapsedMinutes - (activeShift.totalBreakMinutes ?? 0));
    if (drivingMinutes >= HOS_LIMIT_MINUTES) return 'at_limit';
    if (drivingMinutes >= HOS_WARN_MINUTES) return 'approaching_limit';
    return null;
  // tick is intentionally included to force re-computation every second
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeShift, tick]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-teal-600" />
          <span className="font-semibold text-slate-800 text-sm">Shift</span>
          {status === 'clocked_in' && (
            <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">
              Active {elapsedLabel}
            </span>
          )}
          {status === 'on_break' && (
            <span className="bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full">
              On Break {breakElapsed}
            </span>
          )}
          {status === 'none' && (
            <span className="bg-slate-100 text-slate-500 text-xs font-medium px-2 py-0.5 rounded-full">
              Off
            </span>
          )}
        </div>

        {hos && (
          <div className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg ${
            hos === 'at_limit'
              ? 'bg-red-50 text-red-700'
              : 'bg-amber-50 text-amber-700'
          }`}>
            <AlertTriangle size={12} />
            {hos === 'at_limit' ? 'HOS limit reached' : 'HOS approaching limit'}
          </div>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        {status === 'none' && (
          <button
            onClick={clockIn}
            className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Play size={13} /> Clock In
          </button>
        )}

        {status === 'clocked_in' && (
          <>
            <button
              onClick={() => startBreak('rest')}
              className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
            >
              <Coffee size={13} /> Break
            </button>
            <button
              onClick={clockOut}
              className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
            >
              <Square size={13} /> Clock Out
            </button>
          </>
        )}

        {status === 'on_break' && (
          <button
            onClick={endBreak}
            className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Play size={13} /> End Break
          </button>
        )}
      </div>

      {/* Invisible render dep on tick to keep timers updating */}
      <span className="sr-only">{tick}</span>
    </div>
  );
};

export default ShiftControls;
