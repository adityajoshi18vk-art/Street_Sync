"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { TileLayer, useMap } from "react-leaflet";

/**
 * Keyless basemaps only. OSM's own tile servers return "Access blocked" images to apps,
 * and CARTO's basemaps now return "API key required" images (both with HTTP 200).
 * Primary: OpenFreeMap dark vector style (MapLibre). Fallback: Esri dark gray raster.
 */
const VECTOR_STYLE = process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/dark";
const VECTOR_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const ESRI_ATTRIBUTION = "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors";
const VECTOR_TIMEOUT_MS = 15_000;

type Mode = "vector" | "raster" | "failed";

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function Basemap({ onReady, onFailed }: { onReady: () => void; onFailed: () => void }) {
  const map = useMap();
  const [mode, setMode] = useState<Mode>(() => (supportsWebGL() ? "vector" : "raster"));
  const rasterStats = useRef({ loaded: 0, failed: 0 });

  useEffect(() => {
    if (mode !== "vector") return;
    let cancelled = false;
    let loaded = false;
    let layer: import("leaflet").Layer | null = null;
    const fallback = () => {
      if (!cancelled && !loaded) setMode("raster");
    };
    const timer = setTimeout(fallback, VECTOR_TIMEOUT_MS);

    import("@maplibre/maplibre-gl-leaflet")
      .then(({ maplibreGL }) => {
        if (cancelled) return;
        const gl = maplibreGL({ style: VECTOR_STYLE, attributionControl: false });
        layer = gl.addTo(map);
        map.attributionControl?.addAttribution(VECTOR_ATTRIBUTION);
        const lib = gl.getMaplibreMap();
        try {
          lib.setRenderWorldCopies(false);
        } catch {}
        lib.once("load", () => {
          loaded = true;
          clearTimeout(timer);
          if (!cancelled) {
            try {
              lib.resize();
              map.invalidateSize();
            } catch {}
            onReady();
          }
        });
        const onResize = () => {
          try {
            lib.resize();
          } catch {}
        };
        map.on("resize", onResize);
        lib.on("error", fallback);
      })
      .catch(fallback);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      layer?.remove();
      map.attributionControl?.removeAttribution(VECTOR_ATTRIBUTION);
    };
  }, [mode, map]); // eslint-disable-line react-hooks/exhaustive-deps

  if (mode !== "raster") return null;

  return (
    <>
      <TileLayer
        url={`${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`}
        attribution={ESRI_ATTRIBUTION}
        maxNativeZoom={16}
        maxZoom={20}
        noWrap
        eventHandlers={{
          tileload: () => {
            rasterStats.current.loaded++;
            onReady();
          },
          tileerror: () => {
            const stats = rasterStats.current;
            stats.failed++;
            if (stats.loaded === 0 && stats.failed >= 6) {
              setMode("failed");
              onFailed();
            }
          }
        }}
      />
      <TileLayer url={`${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`} maxNativeZoom={16} maxZoom={20} noWrap />
    </>
  );
}
