// Mileage auto-suggest service for KIDZ Transportation
// Uses the new Google Maps RouteMatrix API (replaces deprecated DistanceMatrixService)

import { loadGoogleMaps } from './placeService';

export async function getMileage(
  origin: string,
  destination: string
): Promise<number | null> {
  try {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!key) {
      console.warn('getMileage: VITE_GOOGLE_MAPS_API_KEY not set');
      return null;
    }

    await loadGoogleMaps(key);
    const google = (window as any).google;
    if (!google?.maps) return null;

    // Use new RouteMatrix API if available
    if (google.maps.routes?.RouteMatrix) {
      try {
        const response = await google.maps.routes.RouteMatrix.computeRouteMatrix({
          origins: [origin],
          destinations: [destination],
          travelMode: 'DRIVE',
        }, { fields: ['originIndex', 'destinationIndex', 'status', 'distanceMeters', 'duration'] });

        // Response is an array of route matrix elements
        if (response && response.length > 0) {
          const element = response[0];
          const meters = element.distanceMeters;
          if (typeof meters === 'number') {
            return Math.round((meters / 1609.344) * 10) / 10;
          }
        }
        return null;
      } catch (err) {
        console.warn('getMileage: RouteMatrix error, falling back to DistanceMatrix:', err);
      }
    }

    // Fallback to legacy DistanceMatrixService (until fully removed)
    return new Promise((resolve) => {
      const service = new google.maps.DistanceMatrixService();
      service.getDistanceMatrix(
        {
          origins: [origin],
          destinations: [destination],
          travelMode: google.maps.TravelMode.DRIVING,
          unitSystem: google.maps.UnitSystem.IMPERIAL,
        },
        (response: any, status: any) => {
          if (status !== 'OK') {
            console.warn('getMileage: DistanceMatrixService status:', status);
            return resolve(null);
          }
          const element = response?.rows?.[0]?.elements?.[0];
          if (!element || element.status !== 'OK') return resolve(null);
          const meters = element.distance?.value;
          if (typeof meters !== 'number') return resolve(null);
          resolve(Math.round((meters / 1609.344) * 10) / 10);
        }
      );
    });
  } catch (err) {
    console.warn('getMileage error:', err);
    return null;
  }
}
