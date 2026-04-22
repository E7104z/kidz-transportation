import { useEffect, useRef, useState } from 'react';
import { format, parse } from 'date-fns';
import { loadGoogleMaps } from '../services/placeService';

/**
 * Calculates live ETA from a driver's GPS position to the dropoff address,
 * using the Google Maps JS SDK (DistanceMatrixService) — which works in the
 * browser (no CORS issues, same billing as REST).
 *
 * Cost controls:
 *  - Throttled to one call per MIN_INTERVAL_MS (8s) per hook instance.
 *  - Paused while the browser tab is hidden (document.visibilityState).
 *  - Returns immediately when any required input is missing.
 *
 * @returns delayMinutes — positive minutes late vs scheduled; 0 if on time/early; null if unavailable.
 * @returns etaString — formatted arrival time ("5:16 PM") or null.
 */
export function useETACalculation(
  driverLat: number | null,
  driverLng: number | null,
  dropoffAddress: string | null,
  scheduledDropoffTime: string | null,
): { delayMinutes: number | null; etaString: string | null } {
  const [delayMinutes, setDelayMinutes] = useState<number | null>(null);
  const [etaString, setEtaString] = useState<string | null>(null);

  // Track last fetch time so rapid GPS updates don't spam the API
  const lastFetchRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const MIN_INTERVAL_MS = 8000;

    if (
      driverLat == null ||
      driverLng == null ||
      !dropoffAddress ||
      !scheduledDropoffTime
    ) {
      setDelayMinutes(null);
      setEtaString(null);
      return;
    }

    let cancelled = false;

    const runFetch = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        // Reschedule a short time later when the tab wakes up
        timerRef.current = window.setTimeout(runFetch, MIN_INTERVAL_MS);
        return;
      }

      lastFetchRef.current = Date.now();

      try {
        const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
        if (!key) return;
        await loadGoogleMaps(key);
        const google = (window as any).google;
        if (!google?.maps?.DistanceMatrixService) return;

        const service = new google.maps.DistanceMatrixService();
        const response: any = await new Promise((resolve, reject) => {
          service.getDistanceMatrix(
            {
              origins: [{ lat: driverLat, lng: driverLng }],
              destinations: [dropoffAddress],
              travelMode: google.maps.TravelMode.DRIVING,
              drivingOptions: {
                departureTime: new Date(),
                trafficModel: google.maps.TrafficModel?.BEST_GUESS ?? 'bestguess',
              },
              unitSystem: google.maps.UnitSystem.IMPERIAL,
            },
            (res: any, status: any) => {
              if (status === 'OK') resolve(res);
              else reject(new Error(`DistanceMatrix status: ${status}`));
            }
          );
        });

        if (cancelled) return;

        const element = response?.rows?.[0]?.elements?.[0];
        if (!element || element.status !== 'OK') {
          setDelayMinutes(null);
          setEtaString(null);
          return;
        }

        const durationSeconds: number = element.duration_in_traffic?.value ?? element.duration?.value ?? 0;
        const estimatedArrivalMs = Date.now() + durationSeconds * 1000;
        const formattedEta = format(new Date(estimatedArrivalMs), 'h:mm a');

        const scheduledDate = parse(scheduledDropoffTime, 'HH:mm', new Date());
        const scheduledMs = scheduledDate.getTime();
        const rawDelay = Math.round((estimatedArrivalMs - scheduledMs) / 60000);
        const delay = rawDelay > 0 ? rawDelay : 0;

        setEtaString(formattedEta);
        setDelayMinutes(delay);
      } catch {
        if (!cancelled) {
          setDelayMinutes(null);
          setEtaString(null);
        }
      }
    };

    // Throttle: if last fetch was < MIN_INTERVAL_MS ago, wait for the remainder.
    const elapsed = Date.now() - lastFetchRef.current;
    const delay = elapsed >= MIN_INTERVAL_MS ? 0 : MIN_INTERVAL_MS - elapsed;
    timerRef.current = window.setTimeout(runFetch, delay);

    return () => {
      cancelled = true;
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [driverLat, driverLng, dropoffAddress, scheduledDropoffTime]);

  return { delayMinutes, etaString };
}
