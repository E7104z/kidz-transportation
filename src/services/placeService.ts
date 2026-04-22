// Dynamic loader and wrapper for Google Maps Places
// Uses the new Places API (AutocompleteSuggestion + PlaceAutocompleteElement)

declare global {
  interface Window {
    google: any;
  }
}

let loading: Promise<void> | null = null;

export function loadGoogleMaps(apiKey: string): Promise<void> {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('Not in browser'));
    if ((window as any).google?.maps?.places) return resolve();
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places,routes&loading=async`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const check = (attempts = 0) => {
        if ((window as any).google?.maps?.places) return resolve();
        if (attempts > 50) return resolve();
        setTimeout(() => check(attempts + 1), 100);
      };
      check();
    };
    script.onerror = (e) => {
      console.error('[Places] Failed to load Google Maps script:', e);
      loading = null;
      reject(e);
    };
    document.head.appendChild(script);
  });
  return loading;
}

export async function getPlacePredictions(input: string): Promise<Array<{ description: string; place_id: string }>> {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) {
    console.warn('[Places] VITE_GOOGLE_MAPS_API_KEY is not set');
    return [];
  }
  try {
    await loadGoogleMaps(key);
  } catch {
    return [];
  }

  const google = (window as any).google;

  // Use new AutocompleteSuggestion API if available
  if (google?.maps?.places?.AutocompleteSuggestion) {
    try {
      const { suggestions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        includedRegionCodes: ['us'],
      });
      return (suggestions ?? []).map((s: any) => ({
        description: s.placePrediction?.text?.text ?? '',
        place_id: s.placePrediction?.placeId ?? '',
      })).filter((s: any) => s.description);
    } catch (err) {
      console.warn('[Places] AutocompleteSuggestion error, falling back to legacy:', err);
    }
  }

  // Fallback to legacy AutocompleteService
  return new Promise((resolve) => {
    try {
      const service = new google.maps.places.AutocompleteService();
      service.getPlacePredictions({ input }, (preds: any[], status: any) => {
        if (!preds || preds.length === 0) {
          if (status !== 'OK' && status !== 'ZERO_RESULTS') {
            console.warn('[Places] AutocompleteService status:', status);
          }
          return resolve([]);
        }
        resolve(preds.map(p => ({ description: p.description, place_id: p.place_id })));
      });
    } catch (err) {
      console.error('[Places] AutocompleteService error:', err);
      resolve([]);
    }
  });
}

export async function getPlaceDetails(placeId: string): Promise<any> {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    await loadGoogleMaps(key);
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    try {
      const service = new (window as any).google.maps.places.PlacesService(document.createElement('div'));
      service.getDetails({ placeId }, (place: any, _status: any) => {
        if (!place) return resolve(null);
        resolve(place);
      });
    } catch (err) {
      console.error('[Places] getDetails error:', err);
      resolve(null);
    }
  });
}
