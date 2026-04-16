import React, { useMemo } from 'react';
import { useParentContext } from '../../context/ParentDataContext';
import type { StudentEvent } from '../../types';
import { format } from 'date-fns';
import {
  Navigation, MapPin, Clock, CheckCircle, Clock2, UserCheck,
  UserX, XCircle, Bus, RefreshCw, Phone, Satellite,
} from 'lucide-react';
import DriverMapView from '../../components/DriverMapView';

const EVENT_DISPLAY: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  picked_up:   { label: 'Picked Up',   color: 'text-amber-700',   bg: 'bg-amber-50',   icon: UserCheck },
  dropped_off: { label: 'Dropped Off', color: 'text-emerald-700', bg: 'bg-emerald-50', icon: CheckCircle },
  absent:      { label: 'Absent',      color: 'text-red-600',     bg: 'bg-red-50',     icon: UserX },
  no_show:     { label: 'No Show',     color: 'text-red-700',     bg: 'bg-red-50',     icon: XCircle },
};

const LiveTracking: React.FC = () => {
  const { loading, bookings, students, todayLogs, driverLocations } = useParentContext();

  const activeBookings = bookings.filter(b => b.status === 'active');

  // Collect driver locations as array for the map
  const driverLocationsList = useMemo(() => Object.values(driverLocations), [driverLocations]);

  // Calculate "last updated" for freshness indicator
  const lastUpdated = useMemo(() => {
    const locs = Object.values(driverLocations);
    if (locs.length === 0) return null;
    const latest = locs.reduce((best, loc) => {
      const ts = loc.updatedAt && typeof (loc.updatedAt as any).toDate === 'function'
        ? (loc.updatedAt as any).toDate().getTime()
        : 0;
      return ts > best ? ts : best;
    }, 0);
    if (!latest) return null;
    const secsAgo = Math.round((Date.now() - latest) / 1000);
    if (secsAgo < 10) return 'Just now';
    if (secsAgo < 60) return `${secsAgo}s ago`;
    if (secsAgo < 3600) return `${Math.round(secsAgo / 60)}m ago`;
    return 'Stale';
  }, [driverLocations]);

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 animate-pulse h-48" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Live Tracking</h1>
          <p className="text-slate-500 text-sm mt-1">{format(new Date(), 'EEEE, MMMM d')} &middot; Real-time activity</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          {driverLocationsList.length > 0 ? (
            <>
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-emerald-600 font-medium">GPS Active</span>
              {lastUpdated && <span>&middot; {lastUpdated}</span>}
            </>
          ) : (
            <>
              <RefreshCw size={12} className="animate-spin-slow" />
              Live updates
            </>
          )}
        </div>
      </div>

      {/* ── Real-time map ── */}
      {driverLocationsList.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Satellite size={14} className="text-blue-600" />
            <span className="text-sm font-semibold text-slate-700">Driver Location</span>
          </div>
          <DriverMapView
            driverLocations={driverLocationsList}
            height="280px"
          />
        </div>
      )}

      {activeBookings.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <Navigation size={40} className="mx-auto text-slate-200 mb-3" />
          <p className="text-slate-500 font-medium">No active services to track</p>
          <p className="text-slate-400 text-sm mt-1">Tracking will appear here once you have an active booking.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {activeBookings.map(b => {
            const log = todayLogs[b.id];
            const events = log?.studentEvents ?? {};
            const names = b.studentIds.map(sid => students[sid]?.name).filter(Boolean);

            // Progress state
            const total = b.studentIds.length;
            let completed = 0;
            b.studentIds.forEach(sid => {
              const ev = events[sid] as StudentEvent | undefined;
              if (ev?.status === 'dropped_off') completed++;
            });
            const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

            return (
              <div key={b.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Route header */}
                <div className="px-5 py-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-slate-100">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                        <Bus size={20} className="text-white" />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800">{names.join(', ')}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                          <MapPin size={10} className="text-emerald-500" /> {b.pickupAddress?.split(',')[0]}
                          <span className="text-slate-300 mx-0.5">→</span>
                          <MapPin size={10} className="text-red-400" /> {b.dropoffAddress?.split(',')[0]}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500 flex items-center gap-1">
                        <Clock size={10} /> {b.schoolStartTime} – {b.schoolEndTime}
                      </div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  {log && log.ran !== false && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-slate-500">Route Progress</span>
                        <span className="font-semibold text-slate-700">{pct}%</span>
                      </div>
                      <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Student events */}
                <div className="p-4">
                  {!log ? (
                    <div className="flex items-center gap-3 px-4 py-4 bg-slate-50 rounded-xl">
                      <Clock2 size={20} className="text-slate-300" />
                      <div>
                        <div className="text-sm font-medium text-slate-600">Route has not started yet</div>
                        <div className="text-xs text-slate-400 mt-0.5">Activity will appear here once the driver begins the route.</div>
                      </div>
                    </div>
                  ) : log.ran === false ? (
                    <div className="flex items-center gap-3 px-4 py-4 bg-red-50 rounded-xl border border-red-100">
                      <XCircle size={20} className="text-red-500" />
                      <div>
                        <div className="text-sm font-medium text-red-700">Route was missed today</div>
                        <div className="text-xs text-red-500 mt-0.5 flex items-center gap-1">
                          <Phone size={10} /> Please call (314) 425-9668 for assistance
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {/* Timeline */}
                      {b.studentIds.map((sid, idx) => {
                        const s = students[sid];
                        const ev = events[sid] as StudentEvent | undefined;
                        const display = ev ? EVENT_DISPLAY[ev.status] : null;
                        const EventIcon = display?.icon || Clock2;
                        const isLast = idx === b.studentIds.length - 1;

                        return (
                          <div key={sid} className="flex items-start gap-3">
                            {/* Timeline line */}
                            <div className="flex flex-col items-center">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                                display ? display.bg : 'bg-slate-100'
                              }`}>
                                <EventIcon size={14} className={display ? display.color : 'text-slate-400'} />
                              </div>
                              {!isLast && <div className="w-px h-6 bg-slate-200 mt-1" />}
                            </div>

                            {/* Content */}
                            <div className={`flex-1 rounded-xl px-4 py-3 ${display ? display.bg : 'bg-slate-50'}`}>
                              <div className="flex items-center justify-between">
                                <div className="font-medium text-sm text-slate-800">
                                  {s?.name || 'Student'}
                                </div>
                                {ev?.timestamp && typeof (ev.timestamp as any).toDate === 'function' && (
                                  <span className="text-xs text-slate-400">
                                    {format((ev.timestamp as any).toDate(), 'h:mm a')}
                                  </span>
                                )}
                              </div>
                              <div className={`text-xs mt-0.5 ${display ? display.color : 'text-slate-400'}`}>
                                {display ? display.label : 'Waiting for pickup…'}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Log footer */}
                {log && log.notes && (
                  <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 text-xs text-slate-500">
                    <span className="font-medium">Driver note:</span> {log.notes}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Help banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl px-5 py-4 flex items-start gap-3">
        <Phone size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold text-blue-800 text-sm">Need help?</div>
          <div className="text-xs text-blue-600 mt-0.5">
            If your child has not been picked up by the expected time, please call us at{' '}
            <a href="tel:+13144259668" className="font-semibold underline">(314) 425-9668</a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveTracking;
