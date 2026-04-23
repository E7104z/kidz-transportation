import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parse } from 'date-fns';
import {
  ChevronLeft, ChevronRight, MapPin, CheckCircle, Clock, Bus,
  UserCheck, Navigation, Phone,
} from 'lucide-react';
import { useParentContext } from '../../context/ParentDataContext';
import { useETACalculation } from '../../hooks/useETACalculation';
import DriverMapView from '../../components/DriverMapView';
import { loadGoogleMaps } from '../../services/placeService';
import type { Booking, RouteLog, Driver, DriverLocation, Student, StudentEvent } from '../../types';

// â”€â”€â”€ Utilities â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function haversineDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatTime12h(hhmm: string | null | undefined): string {
  if (!hhmm) return 'â€”';
  try {
    return format(parse(hhmm, 'HH:mm', new Date()), 'h:mm a');
  } catch {
    return hhmm;
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Geocode cache: module-memory + localStorage so we only call Google's Geocoder
// once per unique address across the entire session (and across reloads).
type LatLng = { lat: number; lng: number };
const GEOCODE_CACHE_KEY = 'kidz.geocode.v1';
const geocodeMemory = new Map<string, LatLng>();

(() => {
  try {
    const raw = localStorage.getItem(GEOCODE_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, LatLng>;
    Object.entries(parsed).forEach(([k, v]) => geocodeMemory.set(k, v));
  } catch {
    // ignore â€” cache is best-effort
  }
})();

function persistGeocodeCache() {
  try {
    const obj: Record<string, LatLng> = {};
    geocodeMemory.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

async function geocodeAddress(address: string): Promise<LatLng | null> {
  const key = address.trim().toLowerCase();
  if (!key) return null;
  if (geocodeMemory.has(key)) return geocodeMemory.get(key)!;

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!apiKey) return null;

  try {
    await loadGoogleMaps(apiKey);
    const google = (window as any).google;
    if (!google?.maps?.Geocoder) return null;
    const geocoder = new google.maps.Geocoder();
    const result: any = await new Promise((resolve, reject) => {
      geocoder.geocode({ address }, (res: any, status: any) => {
        if (status === 'OK' && res && res.length > 0) resolve(res);
        else reject(new Error(`Geocode status: ${status}`));
      });
    });
    const loc = result[0]?.geometry?.location;
    if (!loc) return null;
    const latLng: LatLng = { lat: loc.lat(), lng: loc.lng() };
    geocodeMemory.set(key, latLng);
    persistGeocodeCache();
    return latLng;
  } catch {
    return null;
  }
}

// â”€â”€â”€ Status banner resolution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type StatusTone = 'green' | 'amber' | 'slate';
interface StatusBanner {
  tone: StatusTone;
  label: string;
}

function resolveStatus(args: {
  booking: Booking;
  log: RouteLog | null;
  driverLocation: DriverLocation | null;
  dropoffLatLng: LatLng | null;
}): StatusBanner {
  const { booking, log, driverLocation, dropoffLatLng } = args;
  const events = (log?.studentEvents ?? {}) as Record<string, StudentEvent>;

  const anyPickedUp = booking.studentIds.some(sid => events[sid]?.status === 'picked_up');
  const allDroppedOff = booking.studentIds.length > 0 &&
    booking.studentIds.every(sid => events[sid]?.status === 'dropped_off');

  if (anyPickedUp && driverLocation && dropoffLatLng) {
    const miles = haversineDistanceMiles(
      driverLocation.lat, driverLocation.lng,
      dropoffLatLng.lat, dropoffLatLng.lng,
    );
    if (miles <= 0.3) return { tone: 'green', label: 'Driver arriving at destination' };
  }
  if (anyPickedUp) return { tone: 'green', label: 'Driver en route' };
  if (allDroppedOff) return { tone: 'slate', label: 'Route complete' };
  if (log && log.ran === true) return { tone: 'amber', label: 'Route in progress' };
  return { tone: 'slate', label: 'Waiting for driver' };
}

function bannerClasses(tone: StatusTone): string {
  switch (tone) {
    case 'green': return 'bg-emerald-500 text-white';
    case 'amber': return 'bg-amber-500 text-white';
    case 'slate':
    default: return 'bg-slate-500 text-white';
  }
}

// â”€â”€â”€ RouteTrackingCard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface RouteTrackingCardProps {
  booking: Booking;
  log: RouteLog | null;
  driver: Driver | null;
  driverLocation: DriverLocation | null;
  students: Record<string, Student>;
}

const RouteTrackingCard = (props: RouteTrackingCardProps) => {
  const { booking, log, driver, driverLocation, students } = props;
  const navigate = useNavigate();
  const events = (log?.studentEvents ?? {}) as Record<string, StudentEvent>;

  const [dropoffLatLng, setDropoffLatLng] = useState<LatLng | null>(null);
  const [pickupOpen, setPickupOpen] = useState(true);
  const [dropoffOpen, setDropoffOpen] = useState(true);

  // Geocode dropoff once per unique address (cached module-wide)
  useEffect(() => {
    if (!booking.dropoffAddress) { setDropoffLatLng(null); return; }
    let cancelled = false;
    geocodeAddress(booking.dropoffAddress).then(res => {
      if (!cancelled) setDropoffLatLng(res);
    });
    return () => { cancelled = true; };
  }, [booking.dropoffAddress]);

  // Privacy + cost gate: only compute ETA and show driver GPS when at least
  // one of this booking's students is currently in the vehicle.
  const anyPickedUp = useMemo(
    () => booking.studentIds.some(sid => events[sid]?.status === 'picked_up'),
    [booking.studentIds, events],
  );

  const etaDriverLat = anyPickedUp && driverLocation ? driverLocation.lat : null;
  const etaDriverLng = anyPickedUp && driverLocation ? driverLocation.lng : null;

  const { delayMinutes, etaString } = useETACalculation(
    etaDriverLat,
    etaDriverLng,
    booking.dropoffAddress,
    booking.schoolEndTime,
  );

  const status = useMemo(
    () => resolveStatus({ booking, log, driverLocation: anyPickedUp ? driverLocation : null, dropoffLatLng }),
    [booking, log, driverLocation, anyPickedUp, dropoffLatLng],
  );

  // Pickup actual time = earliest picked_up event timestamp
  const pickupActual = useMemo(() => {
    const times: number[] = [];
    Object.values(events).forEach(ev => {
      if (ev?.status === 'picked_up' && ev.timestamp && typeof (ev.timestamp as any).toDate === 'function') {
        times.push((ev.timestamp as any).toDate().getTime());
      }
    });
    if (times.length === 0) return null;
    return format(new Date(Math.min(...times)), 'h:mm a');
  }, [events]);

  const schoolNames = useMemo(() => {
    const s = new Set<string>();
    booking.studentIds.forEach(sid => {
      const name = students[sid]?.schoolName;
      if (name) s.add(name);
    });
    return Array.from(s);
  }, [booking.studentIds, students]);

  const today = new Date();
  const shortId = booking.id.slice(-6).toUpperCase();

  const mapDriverLocations = anyPickedUp && driverLocation ? [driverLocation] : [];
  const dropoffMarker = dropoffLatLng
    ? { lat: dropoffLatLng.lat, lng: dropoffLatLng.lng, label: booking.dropoffAddress }
    : undefined;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header: back chevron + today's date */}
      <div className="flex items-center justify-between px-4 pt-4">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-slate-600 hover:bg-slate-100 transition"
          aria-label="Go back"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="text-sm font-medium text-slate-600">
          Today, {format(today, 'MMMM d, yyyy')}
        </div>
        <div className="w-9" />
      </div>

      {/* Driver row */}
      <div className="flex flex-col items-center px-4 py-6">
        {driver?.photoURL ? (
          <img
            src={driver.photoURL}
            className="w-44 h-44 rounded-full object-cover border-4 border-white shadow-xl ring-4 ring-teal-100"
            alt={driver.name}
          />
        ) : (
          <div className="w-44 h-44 rounded-full bg-slate-600 border-4 border-white shadow-xl ring-4 ring-teal-100 flex items-center justify-center text-white font-bold text-6xl">
            {driver?.name?.charAt(0)?.toUpperCase() ?? '?'}
          </div>
        )}
        <div className="text-center mt-3">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Your driver</div>
          <div className="font-bold text-slate-800 text-xl leading-tight mt-0.5">{driver?.name ?? 'Driver unassigned'}</div>
        </div>
      </div>

      {/* Map */}
      <div className="border-t border-slate-100">
        <DriverMapView
          driverLocations={mapDriverLocations}
          dropoffMarker={dropoffMarker}
          height="480px"
        />
      </div>

      {/* Status banner */}
      <div className={`px-5 py-3 text-center text-sm font-semibold ${bannerClasses(status.tone)}`}>
        {status.label}
      </div>

      {/* Route ID + delay message */}
      <div className="px-5 py-4 border-b border-slate-100">
        <div className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
          Route {shortId}
        </div>
        {delayMinutes != null && delayMinutes > 2 && (
          <div className="mt-1 text-sm text-red-600 font-medium">
            We are currently experiencing a {delayMinutes} minute delay
          </div>
        )}
      </div>

      {/* Pickup section */}
      <div className="border-b border-slate-100">
        <button
          onClick={() => setPickupOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center">
              <MapPin size={18} className="text-emerald-600" />
            </div>
            <div className="text-left">
              <div className="font-semibold text-slate-800">Pickup</div>
              <div className="text-xs text-slate-500">
                Scheduled: {formatTime12h(booking.schoolStartTime)}
                {pickupActual && <> Â· Actual: {pickupActual}</>}
              </div>
            </div>
          </div>
          <ChevronRight
            size={18}
            className={`text-slate-400 transition-transform ${pickupOpen ? 'rotate-90' : ''}`}
          />
        </button>

        {pickupOpen && (
          <div className="px-5 pb-4 space-y-3">
            {schoolNames.length > 0 && (
              <div className="text-sm font-medium text-slate-700">
                {schoolNames.join(' Â· ')}
              </div>
            )}
            <div className="text-xs text-slate-500">{booking.pickupAddress}</div>

            <div className="space-y-2 pt-2">
              {booking.studentIds.map(sid => {
                const s = students[sid];
                const ev = events[sid];
                const isPickedUp = ev?.status === 'picked_up' || ev?.status === 'dropped_off';
                return (
                  <div key={sid} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                    <div className="w-9 h-9 rounded-full bg-[#1a2e4a] flex items-center justify-center text-white text-xs font-bold">
                      {initials(s?.name ?? '?')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">
                        {s?.name ?? 'Student'}
                      </div>
                      {ev && (
                        <span className="inline-block mt-1 text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full border border-slate-200">
                          Recorded by driver
                        </span>
                      )}
                    </div>
                    {isPickedUp ? (
                      <div className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                        <CheckCircle size={14} /> Picked up
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-xs text-slate-400">
                        <Clock size={14} /> Scheduled
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Dropoff section */}
      <div>
        <button
          onClick={() => setDropoffOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#f59e0b]/15 flex items-center justify-center">
              <MapPin size={18} className="text-[#f59e0b]" />
            </div>
            <div className="text-left">
              <div className="font-semibold text-slate-800">Dropoff</div>
              <div className="text-xs text-slate-500">
                Scheduled: {formatTime12h(booking.schoolEndTime)}
                {etaString && (
                  <>
                    {' Â· '}
                    <span
                      className={
                        delayMinutes != null && delayMinutes > 2
                          ? 'text-red-600 font-semibold'
                          : 'text-slate-500'
                      }
                    >
                      Current ETA: {etaString}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <ChevronRight
            size={18}
            className={`text-slate-400 transition-transform ${dropoffOpen ? 'rotate-90' : ''}`}
          />
        </button>

        {dropoffOpen && (
          <div className="px-5 pb-5 space-y-3">
            <div className="text-xs text-slate-500">{booking.dropoffAddress}</div>

            <div className="space-y-2 pt-2">
              {booking.studentIds.map(sid => {
                const s = students[sid];
                const ev = events[sid];
                const isDroppedOff = ev?.status === 'dropped_off';
                return (
                  <div key={sid} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                    <div className="w-9 h-9 rounded-full bg-[#1a2e4a] flex items-center justify-center text-white text-xs font-bold">
                      {initials(s?.name ?? '?')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">
                        {s?.name ?? 'Student'}
                      </div>
                      {ev && (
                        <span className="inline-block mt-1 text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full border border-slate-200">
                          Recorded by driver
                        </span>
                      )}
                    </div>
                    {isDroppedOff ? (
                      <div className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                        <CheckCircle size={14} /> Dropped off
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-xs text-slate-400">
                        <Clock size={14} /> Scheduled
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// â”€â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const LiveTracking: React.FC = () => {
  const { loading, bookings, students, todayLogs, driverLocations, driverBookingMap, drivers } = useParentContext();

  const activeBookings = useMemo(
    () => bookings.filter(b => b.status === 'active'),
    [bookings],
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 animate-pulse h-64" />
        ))}
      </div>
    );
  }

  // Reverse-lookup helper: for a given bookingId find its driverId
  const driverIdForBooking = (bookingId: string): string | null => {
    const entry = Object.entries(driverBookingMap).find(([, bId]) => bId === bookingId);
    return entry ? entry[0] : null;
  };

  return (
    <div className="space-y-6">
      {activeBookings.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <Bus size={40} className="mx-auto text-slate-200 mb-3" />
          <p className="text-slate-600 font-medium">No active routes today</p>
          <p className="text-slate-400 text-sm mt-1">
            Check back when your service is active.
          </p>
        </div>
      ) : (
        activeBookings.map(booking => {
          const log = todayLogs[booking.id] ?? null;
          const driverId = driverIdForBooking(booking.id);
          const driver = driverId ? drivers[driverId] ?? null : null;
          const driverLocation = driverId ? driverLocations[driverId] ?? null : null;
          return (
            <RouteTrackingCard
              key={booking.id}
              booking={booking}
              log={log}
              driver={driver}
              driverLocation={driverLocation}
              students={students}
            />
          );
        })
      )}

      {/* Keep a compact help banner so parents still have a fast way to reach us */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl px-5 py-4 flex items-start gap-3">
        <Phone size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold text-blue-800 text-sm flex items-center gap-1">
            <UserCheck size={14} /> <Navigation size={14} /> Need help?
          </div>
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
