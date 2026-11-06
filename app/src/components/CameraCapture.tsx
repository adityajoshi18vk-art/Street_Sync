"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadVideo, type VideoEvidence } from "@streetsync/swarm-client";

declare global {
  interface Window {
    lastDeviceOrientation?: DeviceOrientationEvent;
  }
}

export interface CameraTelemetry {
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  headingDeg: number | null;
  timestampMs: number;
}

export interface CaptureResult {
  slot: "before" | "after";
  /** Raw captured frame bytes (pre-WebP) — the "Raw" side of the benchmark. */
  bytes: Uint8Array;
  rawBytes: number;
  previewUrl: string;
  telemetry: CameraTelemetry;
}

export interface CameraCaptureProps {
  slot: "before" | "after";
  /** 4-digit anti-spoofing code emitted by claim(); burned into the photo frame. */
  challengeCode?: number | null;
  onCapture: (result: CaptureResult) => void;
  /** Optional Ethereum Swarm video walkthrough */
  videoWalkthrough?: VideoEvidence | null;
  onVideoRecorded?: (result: VideoEvidence) => void;
}

type CameraState = "idle" | "starting" | "live" | "denied" | "unsupported";

function CompassHeading(): number | null {
  if (typeof window === "undefined") return null;
  const evt = window.lastDeviceOrientation;
  if (!evt) return null;
  const webkit = (evt as DeviceOrientationEvent & { webkitCompassHeading?: number })
    .webkitCompassHeading;
  if (typeof webkit === "number" && !Number.isNaN(webkit)) return webkit;
  if (typeof evt.alpha === "number") return (360 - evt.alpha) % 360;
  return null;
}

function getSupportedMimeType(): string {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return "video/webm";
  const types = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4"
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "video/webm";
}

export default function CameraCapture({
  slot,
  challengeCode,
  onCapture,
  videoWalkthrough,
  onVideoRecorded
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fixRef = useRef<{ lat: number; lng: number; accuracy: number } | null>(null);
  const headingRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [gpsStatus, setGpsStatus] = useState<"acquiring" | "locked" | "denied">("acquiring");
  const [gpsText, setGpsText] = useState("GPS acquiring…");
  const [heading, setHeading] = useState<number | null>(null);
  const [compassDenied, setCompassDenied] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [recordingVideo, setRecordingVideo] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  // ── Live GPS (Rule 6: telemetry recorded alongside capture) ───────────────
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsStatus("denied");
      setGpsText("GPS unavailable");
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        fixRef.current = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
        setGpsStatus("locked");
        setGpsText(
          `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)} ±${Math.round(
            pos.coords.accuracy
          )} m`
        );
      },
      () => {
        setGpsStatus("denied");
        setGpsText("GPS denied — allow location for evidence");
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // ── Compass heading ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (event: DeviceOrientationEvent) => {
      (window as unknown as { lastDeviceOrientation?: DeviceOrientationEvent })
        .lastDeviceOrientation = event;
      const webkit = (event as DeviceOrientationEvent & { webkitCompassHeading?: number })
        .webkitCompassHeading;
      if (typeof webkit === "number" && !Number.isNaN(webkit)) {
        headingRef.current = webkit;
        setHeading(webkit);
      } else if (typeof event.alpha === "number") {
        const h = (360 - event.alpha) % 360;
        headingRef.current = h;
        setHeading(h);
      }
    };
    window.addEventListener("deviceorientation", handler, true);
    return () => window.removeEventListener("deviceorientation", handler, true);
  }, []);

  const enableCompass = async () => {
    const DOE = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (DOE && typeof DOE.requestPermission === "function") {
      try {
        const res = await DOE.requestPermission();
        if (res !== "granted") setCompassDenied(true);
      } catch {
        setCompassDenied(true);
      }
    }
  };

  const startCamera = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraState("unsupported");
      return;
    }
    setCameraState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraState("live");
    } catch (err) {
      const name = (err as DOMException)?.name;
      setCameraState(name === "NotAllowedError" ? "denied" : "unsupported");
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraState("idle");
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const snapshotTelemetry = (): CameraTelemetry => ({
    lat: fixRef.current?.lat ?? null,
    lng: fixRef.current?.lng ?? null,
    accuracyM: fixRef.current?.accuracy ?? null,
    headingDeg: headingRef.current ?? CompassHeading(),
    timestampMs: Date.now()
  });

  /** Burns the challenge code + live telemetry into the actual image bytes. */
  const captureFromVideo = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;

    setCapturing(true);
    try {
      const w = video.videoWidth;
      const h = video.videoHeight;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D unavailable");

      ctx.drawImage(video, 0, 0, w, h);

      const barH = Math.max(64, Math.round(h * 0.13));
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, h - barH, w, barH);
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      const codeFont = Math.round(barH * 0.42);
      const smallFont = Math.round(barH * 0.22);
      ctx.font = `bold ${codeFont}px ui-monospace, monospace`;
      ctx.fillText(
        `CODE ${challengeCode ?? "----"}`,
        Math.round(barH * 0.35),
        h - barH + barH * 0.35
      );
      ctx.font = `${smallFont}px ui-monospace, monospace`;
      const fix = fixRef.current;
      const gpsLine = fix
        ? `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)} ±${Math.round(fix.accuracy)}m`
        : "GPS acquiring…";
      const headLine = headingRef.current !== null ? `  |  ${Math.round(headingRef.current)}°` : "";
      ctx.fillText(
        `${gpsLine}${headLine}`,
        Math.round(barH * 0.35),
        h - barH + barH * 0.75
      );
      const tsText = new Date().toISOString().slice(0, 19).replace("T", " ") + "Z";
      ctx.textAlign = "right";
      ctx.fillText(tsText, w - Math.round(barH * 0.35), h - barH + barH * 0.35);
      ctx.textAlign = "left";

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92)
      );
      if (!blob) throw new Error("Frame encoding failed");

      const bytes = new Uint8Array(await blob.arrayBuffer());
      onCapture({
        slot,
        bytes,
        rawBytes: blob.size,
        previewUrl: URL.createObjectURL(blob),
        telemetry: snapshotTelemetry()
      });
    } finally {
      setCapturing(false);
    }
  };

  /** Record 10-second video walkthrough uploaded to Ethereum Swarm */
  const startVideoRecording = async () => {
    if (!streamRef.current) return;
    setVideoError(null);
    const mimeType = getSupportedMimeType();
    videoChunksRef.current = [];
    setCountdown(10);

    try {
      const recorder = new MediaRecorder(streamRef.current, {
        mimeType,
        videoBitsPerSecond: 800_000
      });

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          videoChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        setRecordingVideo(false);
        setVideoUploading(true);

        try {
          const fullBlob = new Blob(videoChunksRef.current, { type: mimeType });
          const result = await uploadVideo(fullBlob, {
            filename: `walkthrough-${challengeCode ?? "bounty"}-${Date.now()}.webm`,
            mimeType,
            durationSeconds: 10 - countdown
          });
          onVideoRecorded?.(result);
        } catch (err) {
          setVideoError(err instanceof Error ? err.message : String(err));
        } finally {
          setVideoUploading(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(500);
      setRecordingVideo(true);

      const startTime = Date.now();
      countdownTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const remaining = Math.max(0, 10 - elapsed);
        setCountdown(remaining);
        if (remaining <= 0) {
          if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
          if (recorder.state === "recording") {
            recorder.stop();
          }
        }
      }, 250);
    } catch (err) {
      setVideoError("MediaRecorder failed: " + String(err));
    }
  };

  const stopVideoRecording = () => {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  const handleVideoFile = async (file: File) => {
    setVideoUploading(true);
    setVideoError(null);
    try {
      const result = await uploadVideo(file, {
        filename: file.name,
        mimeType: file.type || "video/webm",
        durationSeconds: 10
      });
      onVideoRecorded?.(result);
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : String(err));
    } finally {
      setVideoUploading(false);
    }
  };

  const captureFromFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    onCapture({
      slot,
      bytes,
      rawBytes: file.size,
      previewUrl: URL.createObjectURL(file),
      telemetry: snapshotTelemetry()
    });
  };

  const codeDigits = challengeCode ? String(challengeCode).padStart(4, "0").split("") : null;

  return (
    <div className="card overflow-hidden bg-ink-900/80">
      <div className="flex items-center justify-between px-4 py-2.5">
        <span className="label-micro !text-slate-300">
          {slot} photo
        </span>
        <span className="flex items-center gap-2 text-[11px] font-medium text-slate-400">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              cameraState === "live" ? "animate-pulse bg-red-500 shadow-[0_0_8px_rgb(239_68_68)]" : "bg-slate-600"
            }`}
          />
          {cameraState === "live" ? "REC" : "standby"}
        </span>
      </div>

      {/* Anti-spoofing challenge code — must be visible in the photo frame */}
      <div className="flex items-center justify-center gap-2 border-y border-white/[0.06] bg-black/40 py-3">
        {codeDigits ? (
          codeDigits.map((d, i) => (
            <span
              key={i}
              className="flex h-12 w-9 items-center justify-center rounded-lg bg-white text-2xl font-black text-ink-950 shadow-glow-sm"
            >
              {d}
            </span>
          ))
        ) : (
          <span className="text-xs text-slate-500">Challenge code appears here after claim</span>
        )}
      </div>

      <div className="relative aspect-[4/3] w-full bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`h-full w-full object-cover ${cameraState === "live" ? "" : "hidden"}`}
        />
        {cameraState !== "live" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            {cameraState === "denied" ? (
              <>
                <p className="text-sm text-red-400">Camera access denied.</p>
                <p className="text-xs text-slate-400">
                  Use the system camera button below — gallery uploads are rejected by the flow.
                </p>
              </>
            ) : cameraState === "starting" ? (
              <p className="text-sm text-slate-300">Starting camera…</p>
            ) : (
              <p className="text-sm text-slate-400">
                Camera preview will appear here (rear camera enforced).
              </p>
            )}
          </div>
        )}
        {cameraState === "live" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-x-3 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-[11px] font-medium text-white">
            <span
              className={
                gpsStatus === "locked" ? "text-emerald-300" : "text-yellow-300"
              }
            >
              {gpsText}
            </span>
            <span>{heading !== null ? `${Math.round(heading)}°` : compassDenied ? "compass denied" : "compass —"}</span>
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {videoWalkthrough && (
        <div className="mx-4 mt-3 flex items-center justify-between rounded-xl bg-amber-400/10 px-3 py-2 text-xs ring-1 ring-amber-400/30">
          <div className="flex items-center gap-2">
            <span className="font-bold text-amber-400">Swarm Video:</span>
            <span className="font-mono text-slate-300">{videoWalkthrough.swarmReference.slice(0, 14)}…</span>
          </div>
          <span className="text-[10px] font-semibold text-emerald-400">✓ Sealed for Arkiv</span>
        </div>
      )}

      {videoError && (
        <div className="mx-4 mt-2 rounded-xl bg-red-400/10 p-2.5 text-xs text-red-300 ring-1 ring-red-400/30">
          {videoError}
        </div>
      )}

      <div className="flex flex-col gap-2 px-4 py-3">
        {cameraState === "live" ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <button
                onClick={captureFromVideo}
                disabled={capturing || recordingVideo}
                className="btn-primary flex-1"
              >
                {capturing ? "Capturing…" : `Capture ${slot} photo`}
              </button>
              <button
                onClick={stopCamera}
                disabled={recordingVideo}
                className="btn-ghost"
              >
                Stop
              </button>
            </div>

            {/* Optional 10s Video Walkthrough Button */}
            <button
              type="button"
              onClick={recordingVideo ? stopVideoRecording : startVideoRecording}
              disabled={capturing || videoUploading}
              className={`btn w-full py-2 text-xs text-white ${
                recordingVideo
                  ? "bg-red-600 animate-pulse hover:bg-red-500"
                  : "bg-amber-600 hover:bg-amber-500"
              } disabled:opacity-50`}
            >
              {videoUploading
                ? "Uploading Walkthrough to Swarm…"
                : recordingVideo
                ? `Recording Walkthrough (${countdown}s remaining — Stop)`
                : "Record 10s Video Walkthrough (Swarm)"}
            </button>
          </div>
        ) : (
          <button
            onClick={startCamera}
            disabled={cameraState === "starting"}
            className="btn-primary w-full"
          >
            {cameraState === "starting" ? "Starting…" : "Start live camera"}
          </button>
        )}

        <div className="grid grid-cols-2 gap-2">
          {/* capture="environment" opens the camera directly — no gallery picker */}
          <label className="btn-ghost cursor-pointer py-2 text-xs">
            system camera
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void captureFromFile(file);
                e.target.value = "";
              }}
            />
          </label>

          {/* upload video walkthrough */}
          <label className="btn-ghost cursor-pointer py-2 text-xs !text-amber-300">
            {videoUploading ? "uploading…" : "upload video"}
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleVideoFile(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>

        {(heading === null || gpsStatus !== "locked") && (
          <div className="alert-warn flex items-center justify-between !px-3 !py-2 text-[11px]">
            <span>
              {gpsStatus !== "locked" ? "Waiting for GPS fix. " : ""}
              {heading === null ? "Compass not streaming." : ""}
            </span>
            {heading === null && (
              <button onClick={enableCompass} className="font-semibold text-amber-200 underline">
                Enable
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
