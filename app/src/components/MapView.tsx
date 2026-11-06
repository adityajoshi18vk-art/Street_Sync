"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import Link from "next/link";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  useMap,
  useMapEvents
} from "react-leaflet";
import { STATUS_COLORS, statusName, formatUsdcDisplaySafe } from "@/lib/map-utils";
import type { BountyMapItem } from "@/lib/types";

export interface MapViewProps {
  bounties: BountyMapItem[];
  selectedId: string | null;
  onSelect: (bountyId: string) => void;
  draftPin: { lat: number; lng: number } | null;
  onMapClick: (lat: number, lng: number) => void;
  center?: { lat: number; lng: number } | null;
  className?: string;
}

function ClickAndFocusHandler({
  onMapClick,
  center
}: {
  onMapClick: (lat: number, lng: number) => void;
  center?: { lat: number; lng: number } | null;
}) {
  const map = useMap();

  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    }
  });

  useEffect(() => {
    if (center) {
      map.flyTo([center.lat, center.lng], Math.max(map.getZoom(), 13), { duration: 0.8 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.lat, center?.lng]);

  return null;
}

const DEFAULT_CENTER: [number, number] = [40.7128, -74.006];

export default function MapView({
  bounties,
  selectedId,
  onSelect,
  draftPin,
  onMapClick,
  center,
  className
}: MapViewProps) {
  return (
    <div className={`relative ${className ?? "h-[420px] w-full"}`}>
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={13}
        scrollWheelZoom
        className="h-full w-full rounded-xl"
        attributionControl
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          className="map-tiles-dark"
        />
        <ClickAndFocusHandler onMapClick={onMapClick} center={center} />

        {bounties.map((b) => {
          const color = STATUS_COLORS[statusName(b.status)];
          const selected = b.bountyId === selectedId;
          return (
            <CircleMarker
              key={b.bountyId}
              center={[b.lat, b.lng]}
              radius={selected ? 13 : 9}
              pathOptions={{
                color: selected ? "#1b6bf5" : color,
                fillColor: color,
                fillOpacity: 0.85,
                weight: selected ? 3 : 1.5
              }}
              eventHandlers={{ click: () => onSelect(b.bountyId) }}
            >
              <Popup>
                <div className="min-w-[180px] space-y-1">
                  <p className="text-sm font-semibold text-white">
                    Bounty #{b.bountyId}
                  </p>
                  <p className="text-xs font-semibold" style={{ color }}>
                    {statusName(b.status)}
                  </p>
                  <p className="text-xs text-slate-400">
                    Escrow: <strong className="text-slate-200">{formatUsdcDisplaySafe(b.totalPledged)} USDC</strong>
                  </p>
                  {b.description && (
                    <p className="line-clamp-2 text-xs text-slate-500">{b.description}</p>
                  )}
                  <Link
                    href={`/bounty/${b.bountyId}`}
                    className="mt-1 inline-block rounded-lg bg-gradient-to-b from-brand-500 to-brand-700 px-2.5 py-1 text-xs font-semibold !text-white hover:from-brand-400 hover:to-brand-600"
                  >
                    Open bounty
                  </Link>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {draftPin && (
          <CircleMarker
            center={[draftPin.lat, draftPin.lng]}
            radius={11}
            pathOptions={{
              color: "#1b6bf5",
              fillColor: "#338aff",
              fillOpacity: 0.4,
              weight: 2,
              dashArray: "6 4"
            }}
          >
            <Popup>New bounty location — fill the form to create it.</Popup>
          </CircleMarker>
        )}
      </MapContainer>

      <div className="pointer-events-none absolute bottom-3 left-3 z-[500] flex flex-wrap gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-ink-900/85 px-3 py-2 text-[11px] font-medium backdrop-blur-md">
        {(["Open", "Claimed", "Submitted", "InReview", "Approved", "Rejected", "Refunded"] as const).map(
          (name) => (
            <span key={name} className="flex items-center gap-1 text-slate-300">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[name], boxShadow: `0 0 5px ${STATUS_COLORS[name]}` }}
              />
              {name}
            </span>
          )
        )}
      </div>
    </div>
  );
}

export { L as Leaflet };
