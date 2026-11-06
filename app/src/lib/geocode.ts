/**
 * Place search + reverse geocoding via Photon (komoot), an OpenStreetMap geocoder
 * that needs no API key and allows browser (CORS) requests.
 */
const PHOTON_URL = process.env.NEXT_PUBLIC_GEOCODER_URL ?? "https://photon.komoot.io";

export interface Place {
  label: string;
  detail: string;
  lat: number;
  lng: number;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    city?: string;
    state?: string;
    country?: string;
  };
}

function describe(p: PhotonFeature["properties"]): { label: string; detail: string } {
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const label = p.name ?? (street || p.district || p.city || "Unnamed place");
  const detail = [p.name && street ? street : null, p.district, p.city, p.state, p.country]
    .filter((v, i, arr) => v && v !== label && arr.indexOf(v) === i)
    .slice(0, 3)
    .join(", ");
  return { label, detail };
}

function toPlace(f: PhotonFeature): Place {
  const [lng, lat] = f.geometry.coordinates;
  return { ...describe(f.properties), lat, lng };
}

export async function searchPlaces(
  query: string,
  opts: { near?: { lat: number; lng: number }; signal?: AbortSignal } = {}
): Promise<Place[]> {
  const params = new URLSearchParams({ q: query, limit: "10" });
  if (opts.near) {
    params.set("lat", opts.near.lat.toFixed(4));
    params.set("lon", opts.near.lng.toFixed(4));
  }
  const res = await fetch(`${PHOTON_URL}/api/?${params}`, { signal: opts.signal });
  if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);
  const data = (await res.json()) as { features: PhotonFeature[] };
  // OSM often has several features for one place (node + way + station entrance).
  const seen = new Set<string>();
  const places = data.features.map(toPlace).filter((p) => {
    const key = `${p.label}|${p.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return places.slice(0, 6);
}

export async function reverseGeocode(lat: number, lng: number, signal?: AbortSignal): Promise<string | null> {
  const res = await fetch(`${PHOTON_URL}/reverse?lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`, { signal });
  if (!res.ok) return null;
  const data = (await res.json()) as { features: PhotonFeature[] };
  if (!data.features[0]) return null;
  const { label, detail } = describe(data.features[0].properties);
  return detail ? `${label}, ${detail}` : label;
}
