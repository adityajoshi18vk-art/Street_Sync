/**
 * neighbour.ts
 * Proximity and status gate for neighbour (problem-validation) attestations.
 * The browser's GPS fix is self-reported, so this is a spam deterrent, not proof of presence;
 * the World ID proof (one human) and the on-chain one-vote-per-wallet rule do the heavy lifting.
 */

import { Status } from "./chain.js";

export const DEFAULT_NEIGHBOUR_RADIUS_KM = 10;

export interface GeoPoint { lat: number; lng: number }

export interface NeighbourBounty {
  status: number;
  latE5: number;
  lngE5: number;
}

export class NeighbourRejectedError extends Error {
  constructor(message: string, readonly status: 400 | 403 = 403) {
    super(message);
  }
}

export function neighbourRadiusKm(): number {
  const n = Number(process.env.NEIGHBOUR_RADIUS_KM);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_NEIGHBOUR_RADIUS_KM;
}

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function parseLocation(raw: unknown): GeoPoint {
  const l = raw as { lat?: unknown; lng?: unknown } | null | undefined;
  const lat = l?.lat;
  const lng = l?.lng;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) ||
      Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new NeighbourRejectedError("Neighbour verification requires your location: {lat, lng}", 400);
  }
  return { lat, lng };
}

/** Throws NeighbourRejectedError (403) unless the bounty is Proposed and the voter is within the radius. */
export function assertNeighbourEligible(
  bounty: NeighbourBounty,
  location: GeoPoint,
  radiusKm = neighbourRadiusKm(),
): number {
  if (bounty.status !== Status.Proposed) {
    throw new NeighbourRejectedError("This problem is no longer open for community validation");
  }
  const distanceKm = haversineKm(location, { lat: bounty.latE5 / 1e5, lng: bounty.lngE5 / 1e5 });
  if (distanceKm > radiusKm) {
    throw new NeighbourRejectedError(
      `You are ${distanceKm.toFixed(1)} km from this problem; neighbours must be within ${radiusKm} km to vote`,
    );
  }
  return distanceKm;
}
