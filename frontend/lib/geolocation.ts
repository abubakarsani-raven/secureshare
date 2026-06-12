export interface ViewerGeo {
  lat: number;
  lng: number;
  accuracy: number;
}

// Requests precise browser geolocation (GPS / Wi-Fi). Rejects if the user
// denies permission or the device cannot provide a fix — the caller gates
// viewing on a successful result.
export function requestLocation(): Promise<ViewerGeo> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is not supported on this device'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => reject(new Error(err.message || 'Location access denied')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}
