import type { GeoPoint } from "./api";

/** Browser GPS as a promise with human-readable failures. */
export function requestPosition(): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Your browser can't share its location, so you can't vote on this report."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        const message =
          err.code === err.PERMISSION_DENIED
            ? "Location access was denied. Allow location for this site in your browser settings — neighbours must be near the problem to vote."
            : err.code === err.TIMEOUT
              ? "Getting your location timed out. Move to a spot with a better signal and try again."
              : "Couldn't determine your location. Try again.";
        reject(new Error(message));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 }
    );
  });
}
