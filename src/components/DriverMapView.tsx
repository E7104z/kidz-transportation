import React, { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { DriverLocation } from '../types';

const busIcon = L.divIcon({
  html: `<div style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:#2563eb;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);"><svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='1' y='3' width='15' height='13' rx='2'/><path d='M16 8h4l3 4v3h-7V8z'/><circle cx='5.5' cy='18.5' r='2.5'/><circle cx='18.5' cy='18.5' r='2.5'/></svg></div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  popupAnchor: [0, -20],
  className: '',
});

const pickupIcon = L.divIcon({
  html: `<div style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:#10b981;border:2px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.2);"><svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='#fff'><path d='M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z'/></svg></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14],
  className: '',
});

const dropoffIcon = L.divIcon({
  html: `<div style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:#ef4444;border:2px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.2);"><svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='#fff'><path d='M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z'/></svg></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14],
  className: '',
});

// Solid green destination pin used by the parent live-tracking view
const destinationIcon = L.divIcon({
  html: `<div style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:#10b981;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.35);"></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  className: '',
});

// Auto-recenter map when driver location changes
const RecenterMap: React.FC<{ lat: number; lng: number }> = ({ lat, lng }) => {
  const map = useMap();
  React.useEffect(() => {
    map.setView([lat, lng], map.getZoom(), { animate: true });
  }, [lat, lng, map]);
  return null;
};

export interface MapMarker {
  type: 'driver' | 'pickup' | 'dropoff';
  lat: number;
  lng: number;
  label: string;
  sublabel?: string;
}

interface DriverMapViewProps {
  driverLocations: DriverLocation[];
  markers?: MapMarker[];
  height?: string;
  dropoffMarker?: { lat: number; lng: number; label: string };
}

const DriverMapView: React.FC<DriverMapViewProps> = ({
  driverLocations,
  markers = [],
  height = '640px',
  dropoffMarker,
}) => {
  // Determine map center â€” use first driver position, or dropoff, or first marker, or St. Louis default
  const center = useMemo(() => {
    if (driverLocations.length > 0) {
      return { lat: driverLocations[0].lat, lng: driverLocations[0].lng };
    }
    if (dropoffMarker) {
      return { lat: dropoffMarker.lat, lng: dropoffMarker.lng };
    }
    if (markers.length > 0) {
      return { lat: markers[0].lat, lng: markers[0].lng };
    }
    return { lat: 38.627, lng: -90.199 }; // St. Louis
  }, [driverLocations, markers, dropoffMarker]);

  const primaryDriver = driverLocations[0];

  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm" style={{ height }}>
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Recenter on driver movement */}
        {primaryDriver && (
          <RecenterMap lat={primaryDriver.lat} lng={primaryDriver.lng} />
        )}

        {/* Driver markers */}
        {driverLocations.map(dl => (
          <Marker key={dl.driverId} position={[dl.lat, dl.lng]} icon={busIcon}>
            <Popup>
              <div className="text-center">
                <div className="font-semibold text-sm">Driver en route</div>
                {dl.speed != null && dl.speed > 0 && (
                  <div className="text-xs text-slate-500">{Math.round(dl.speed * 0.621371)} mph</div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Pickup / dropoff markers (legacy API) */}
        {markers.map((m, i) => (
          <Marker
            key={`${m.type}-${i}`}
            position={[m.lat, m.lng]}
            icon={m.type === 'pickup' ? pickupIcon : dropoffIcon}
          >
            <Popup>
              <div className="text-center">
                <div className="font-semibold text-xs">{m.type === 'pickup' ? 'Pickup' : 'Drop-off'}</div>
                <div className="text-xs text-slate-500">{m.label}</div>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Destination pin (solid green) */}
        {dropoffMarker && (
          <Marker
            position={[dropoffMarker.lat, dropoffMarker.lng]}
            icon={destinationIcon}
          >
            <Popup>
              <div className="text-center">
                <div className="font-semibold text-xs">Destination</div>
                <div className="text-xs text-slate-500">{dropoffMarker.label}</div>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
};

export default DriverMapView;
