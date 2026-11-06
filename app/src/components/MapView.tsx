"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import L from "leaflet";
import {
  MapContainer,
  CircleMarker,
  Marker,
  Popup,
  ZoomControl,
  useMapEvents
} from "react-leaflet";
import { Crosshair, LoaderCircle, LocateFixed, Maximize2, Search, X } from "lucide-react";
import { STATUS_COLORS, statusName, formatUsdcDisplaySafe } from "@/lib/map-utils";
import { searchPlaces, type Place } from "@/lib/geocode";
import type { BountyMapItem } from "@/lib/types";
import { Basemap } from "@/components/map/Basemap";

export interface MapViewProps {
  bounties: BountyMapItem[];
  selectedId: string | null;
  onSelect: (bountyId: string) => void;
  draftPin: { lat: number; lng: number } | null;
  /** Fired for map taps, pin drags, search picks and "use my location"; label when known. */
  onMapClick: (lat: number, lng: number, label?: string) => void;
  center?: { lat: number; lng: number } | null;
  className?: string;
}

export const MUMBAI_CENTER: [number, number] = [19.0760, 72.8777];
const DEFAULT_CENTER: [number, number] = MUMBAI_CENTER;

export const MUMBAI_PRESETS = [
  { label: "Mumbai Central", lat: 19.0760, lng: 72.8777, zoom: 12 },
  { label: "Bandra West", lat: 19.0596, lng: 72.8295, zoom: 14 },
  { label: "Andheri", lat: 19.1136, lng: 72.8697, zoom: 14 },
  { label: "BKC", lat: 19.0657, lng: 72.8687, zoom: 14 },
  { label: "Marine Drive / Colaba", lat: 18.9220, lng: 72.8346, zoom: 14 },
  { label: "Powai", lat: 19.1176, lng: 72.9060, zoom: 14 },
  { label: "Dadar", lat: 19.0178, lng: 72.8478, zoom: 14 }
];

const draftIcon = L.divIcon({
  className: "",
  html: '<div class="ss-pin"><span class="ss-pin-pulse"></span><span class="ss-pin-head"></span></div>',
  iconSize: [36, 46],
  iconAnchor: [18, 44]
});

function TapHandler({ onTap }: { onTap: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onTap(e.latlng.lat, e.latlng.lng) });
  return null;
}

function ControlButton({
  label,
  onClick,
  children,
  busy
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-ink-900/90 text-zinc-200 shadow-card backdrop-blur-md transition hover:border-brand-300/40 hover:text-brand-300"
    >
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : children}
    </button>
  );
}

export default function MapView({
  bounties,
  selectedId,
  onSelect,
  draftPin,
  onMapClick,
  center,
  className
}: MapViewProps) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [tilesReady, setTilesReady] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fittedOnce = useRef(false);

  // Invalidate map size on mount and container resizing to eliminate white/blank voids
  useEffect(() => {
    if (!map) return;
    map.invalidateSize();
    const t1 = setTimeout(() => map.invalidateSize(), 150);
    const t2 = setTimeout(() => map.invalidateSize(), 600);
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
    });
    const c = map.getContainer();
    if (c) ro.observe(c);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro.disconnect();
    };
  }, [map]);

  // Frame bounties only if there are local bounties near India/Mumbai; otherwise stay at Mumbai
  useEffect(() => {
    if (!map || fittedOnce.current || bounties.length === 0) return;
    fittedOnce.current = true;
    const localBounties = bounties.filter(
      (b) => Math.abs(b.lat - MUMBAI_CENTER[0]) < 3 && Math.abs(b.lng - MUMBAI_CENTER[1]) < 3
    );
    if (localBounties.length > 0) {
      const bounds = L.latLngBounds(localBounties.map((b) => [b.lat, b.lng] as [number, number]));
      map.fitBounds(bounds.pad(0.35), { maxZoom: 14, animate: false });
    } else {
      map.setView(MUMBAI_CENTER, 12);
    }
  }, [map, bounties]);

  useEffect(() => {
    if (map && center) map.flyTo([center.lat, center.lng], Math.max(map.getZoom(), 14), { duration: 0.8 });
  }, [map, center?.lat, center?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced place search, biased toward the current view.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setSearchError(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const c = map?.getCenter();
        setResults(await searchPlaces(q, { near: c ? { lat: c.lat, lng: c.lng } : undefined, signal: ctrl.signal }));
        setSearchError(null);
      } catch (e) {
        if (!ctrl.signal.aborted) setSearchError("Search is unavailable right now — tap the map instead.");
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, map]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const pick = (lat: number, lng: number, label?: string) => {
    onMapClick(lat, lng, label);
    map?.flyTo([lat, lng], Math.max(map.getZoom(), 16), { duration: 0.9 });
  };

  const choosePlace = (p: Place) => {
    setQuery("");
    setResults([]);
    pick(p.lat, p.lng, p.detail ? `${p.label}, ${p.detail}` : p.label);
  };

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setNotice("Location isn't available in this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        pick(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        setLocating(false);
        setNotice(err.code === err.PERMISSION_DENIED ? "Location permission was denied." : "Couldn't get your location.");
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  };

  const fitAll = () => {
    if (!map || bounties.length === 0) return;
    map.flyToBounds(L.latLngBounds(bounties.map((b) => [b.lat, b.lng] as [number, number])).pad(0.35), {
      maxZoom: 14,
      duration: 0.8
    });
  };

  const draftHandlers = useMemo(
    () => ({
      dragend: (e: L.DragEndEvent) => {
        const { lat, lng } = (e.target as L.Marker).getLatLng();
        onMapClick(lat, lng);
      }
    }),
    [onMapClick]
  );

  return (
    <div className={`ss-map relative isolate ${className ?? "h-[420px] w-full"}`}>
      <MapContainer
        ref={setMap}
        center={DEFAULT_CENTER}
        zoom={12}
        minZoom={3}
        maxBounds={[[-85, -180], [85, 180]]}
        maxBoundsViscosity={1.0}
        scrollWheelZoom
        zoomControl={false}
        className="h-full w-full rounded-xl"
        attributionControl
      >
        <Basemap onReady={() => setTilesReady(true)} onFailed={() => setTilesFailed(true)} />
        <ZoomControl position="bottomright" />
        <TapHandler onTap={(lat, lng) => onMapClick(lat, lng)} />

        {bounties.map((b) => {
          const color = STATUS_COLORS[statusName(b.status)];
          const selected = b.bountyId === selectedId;
          return (
            <CircleMarker
              key={b.bountyId}
              center={[b.lat, b.lng]}
              radius={selected ? 13 : 9}
              pathOptions={{
                color: selected ? "#bef264" : "#050506",
                fillColor: color,
                fillOpacity: 0.95,
                weight: selected ? 3 : 2
              }}
              eventHandlers={{ click: () => onSelect(b.bountyId) }}
            >
              <Popup>
                <div className="min-w-[190px] space-y-1">
                  <p className="text-sm font-semibold text-white">Bounty #{b.bountyId}</p>
                  <p className="text-xs font-semibold" style={{ color }}>
                    {statusName(b.status)}
                  </p>
                  <p className="text-xs text-zinc-400">
                    Escrow: <strong className="text-zinc-200">{formatUsdcDisplaySafe(b.totalPledged)} USDC</strong>
                  </p>
                  {b.description && <p className="line-clamp-2 text-xs text-zinc-500">{b.description}</p>}
                  <Link
                    href={`/bounty/${b.bountyId}`}
                    className="mt-1 inline-block rounded-full bg-brand-400 px-3 py-1 text-xs font-bold !text-ink-950 hover:bg-brand-300"
                  >
                    Open bounty
                  </Link>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {draftPin && (
          <Marker
            position={[draftPin.lat, draftPin.lng]}
            icon={draftIcon}
            draggable
            autoPan
            eventHandlers={draftHandlers}
            title="New bounty location (drag to adjust)"
          />
        )}
      </MapContainer>

      {/* Search */}
      <div className="absolute left-3 right-16 top-3 z-[500] max-w-sm sm:right-auto sm:w-80">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-ink-900/90 px-3 shadow-card backdrop-blur-md focus-within:border-brand-300/50">
          {searching ? (
            <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-zinc-500" aria-hidden />
          ) : (
            <Search className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) choosePlace(results[0]);
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search a street, landmark or area"
            aria-label="Search location"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-zinc-500 hover:text-zinc-200">
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
        {(results.length > 0 || searchError || (query.trim().length >= 3 && !searching && results.length === 0)) && (
          <ul
            role="listbox"
            className="mt-2 max-h-72 overflow-auto rounded-xl border border-white/10 bg-ink-900/95 p-1 shadow-card backdrop-blur-md"
          >
            {searchError ? (
              <li className="px-3 py-2 text-xs text-red-300">{searchError}</li>
            ) : results.length === 0 ? (
              <li className="px-3 py-2 text-xs text-zinc-500">No places found.</li>
            ) : (
              results.map((p, i) => (
                <li key={`${p.lat},${p.lng},${i}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => choosePlace(p)}
                    className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[0.06]"
                  >
                    <Crosshair className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-zinc-100">{p.label}</span>
                      {p.detail && <span className="block truncate text-xs text-zinc-500">{p.detail}</span>}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {/* Map actions */}
      <div className="absolute right-3 top-3 z-[500] flex flex-col gap-2">
        <ControlButton label="Use my location" onClick={locate} busy={locating}>
          <LocateFixed className="h-4 w-4" aria-hidden />
        </ControlButton>
        {bounties.length > 0 && (
          <ControlButton label="Show all bounties" onClick={fitAll}>
            <Maximize2 className="h-4 w-4" aria-hidden />
          </ControlButton>
        )}
      </div>

      {/* Quick location selector for Mumbai */}
      <div className="absolute bottom-3 left-3 z-[500] flex max-w-[calc(100%-80px)] items-center gap-1.5 overflow-x-auto rounded-xl border border-white/10 bg-ink-900/90 p-1 shadow-card backdrop-blur-md">
        <span className="shrink-0 pl-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-300">
          🇮🇳 Mumbai:
        </span>
        {MUMBAI_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              if (map) {
                map.flyTo([p.lat, p.lng], p.zoom, { duration: 0.8 });
                onMapClick(p.lat, p.lng, `${p.label}, Mumbai, Maharashtra`);
              }
            }}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
          >
            {p.label}
          </button>
        ))}
      </div>

      {notice && (
        <div className="absolute left-1/2 top-16 z-[500] -translate-x-1/2 rounded-full border border-white/10 bg-ink-900/95 px-4 py-2 text-xs font-medium text-zinc-200 shadow-card">
          {notice}
        </div>
      )}

      {(!tilesReady || tilesFailed) && (
        <div className="pointer-events-none absolute inset-0 z-[400] flex items-center justify-center rounded-xl bg-ink-900/70">
          <span className="flex items-center gap-2 rounded-full border border-white/10 bg-ink-900/95 px-4 py-2 text-xs font-medium text-zinc-300">
            {tilesFailed ? (
              "The map couldn't load — check your connection. Search still works."
            ) : (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin text-brand-300" aria-hidden />
                Loading map…
              </>
            )}
          </span>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 z-[500] hidden flex-wrap gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-ink-900/85 px-3 py-2 text-[11px] font-medium backdrop-blur-md sm:flex">
        {(["Open", "Claimed", "Submitted", "InReview", "Approved", "Rejected", "Refunded"] as const).map((name) => (
          <span key={name} className="flex items-center gap-1 text-zinc-300">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[name] }} />
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

export { L as Leaflet };
