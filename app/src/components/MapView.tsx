"use client";

import "leaflet/dist/leaflet.css";
import { Component, useEffect, type ReactNode } from "react";
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
import { STATUS_COLORS, STATUS_LABELS, bountyDisplayStatus, formatUsdcDisplaySafe } from "@/lib/map-utils";
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

/**
 * react-leaflet can try to initialise a map twice on the same element when part of the tree
 * suspends during the first mount ("Map container is already initialized"). Remount on a fresh
 * element instead of letting the whole page fall into the error boundary.
 */
class MapRecoveryBoundary extends Component<{ children: (key: number) => ReactNode }, { key: number; failed: boolean }> {
  state = { key: 0, failed: false };

  static getDerivedStateFromError() {
    return null;
  }

  componentDidCatch(error: Error) {
    if (this.state.key < 3 && /already initialized/i.test(error.message)) {
      this.setState((s) => ({ key: s.key + 1 }));
    } else {
      this.setState({ failed: true });
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex h-full w-full items-center justify-center rounded-xl bg-gray-100 text-sm text-gray-600">
          The map failed to load.{" "}
          <button type="button" onClick={() => window.location.reload()} className="ml-1 font-semibold text-brand-700 underline">
            Reload
          </button>
        </div>
      );
    }
    return this.props.children(this.state.key);
  }
}

export default function MapView(props: MapViewProps) {
  return (
    <div className={`relative ${props.className ?? "h-[420px] w-full"}`}>
      <MapRecoveryBoundary>{(key) => <MapViewInner key={key} {...props} />}</MapRecoveryBoundary>
    </div>
  );
}

function MapViewInner({
  bounties,
  selectedId,
  onSelect,
  draftPin,
  onMapClick,
  center,
  className
}: MapViewProps) {
  return (
    <div className="relative h-full w-full">
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
        />
        <ClickAndFocusHandler onMapClick={onMapClick} center={center} />

        {bounties.map((b) => {
          const display = bountyDisplayStatus(b, Math.floor(Date.now() / 1000));
          const color = display.color;
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
                  <p className="text-sm font-semibold text-gray-900">
                    Bounty #{b.bountyId}
                  </p>
                  <p className="text-xs" style={{ color }}>
                    {display.label}
                  </p>
                  <p className="text-xs text-gray-600">
                    Escrow: <strong>{formatUsdcDisplaySafe(b.totalPledged)} USDC</strong>
                  </p>
                  {b.description && (
                    <p className="line-clamp-2 text-xs text-gray-500">{b.description}</p>
                  )}
                  <Link
                    href={`/bounty/${b.bountyId}`}
                    className="popup-cta mt-1 inline-block rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
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

      <div className="pointer-events-none absolute bottom-3 left-3 z-[500] flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-white/95 px-3 py-2 text-[11px] font-medium shadow-card ring-1 ring-gray-200">
        {(["Proposed", "Open", "Claimed", "Submitted", "InReview", "Approved", "Rejected", "Refunded"] as const).map(
          (name) => (
            <span key={name} className="flex items-center gap-1 text-gray-700">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[name] }}
              />
              {STATUS_LABELS[name]}
            </span>
          )
        )}
      </div>
    </div>
  );
}

export { L as Leaflet };
