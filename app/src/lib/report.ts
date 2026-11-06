import { base64ToBytes, bytesToBase64 } from "./api";

/** Minimal Storage surface so the pending-report helpers are testable without a DOM. */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const PENDING_REPORT_PREFIX = "streetsync:pending-report:";

export function pendingReportKey(reportHash: string): string {
  return PENDING_REPORT_PREFIX + reportHash.toLowerCase();
}

/** Persist the report bundle BEFORE any transaction so the upload can be retried later. */
export function savePendingReport(storage: KeyValueStorage, reportHash: string, bundle: Uint8Array): void {
  storage.setItem(pendingReportKey(reportHash), bytesToBase64(bundle));
}

export function loadPendingReport(storage: KeyValueStorage, reportHash: string): Uint8Array | null {
  const raw = storage.getItem(pendingReportKey(reportHash));
  if (!raw) return null;
  try {
    return base64ToBytes(raw);
  } catch {
    return null;
  }
}

export function deletePendingReport(storage: KeyValueStorage, reportHash: string): void {
  storage.removeItem(pendingReportKey(reportHash));
}

export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const MAX_PHOTO_INPUT_BYTES = 25 * 1024 * 1024;

export function photoDataUrl(photoBase64: string, mime = "image/webp"): string {
  return `data:${mime};base64,${photoBase64}`;
}
