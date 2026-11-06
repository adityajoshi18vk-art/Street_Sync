"use client";

import { BACKEND_API_URL, isLocalNetwork } from "../config/contracts";
import type { IArkivClient } from "@streetsync/arkiv-client";

/**
 * Arkiv transports for the evidence entity store.
 *
 * - HttpArkivClient: REST gateway transport (NEXT_PUBLIC_ARKIV_URL), payload
 *   base64-encoded, attributes as {key,value} pairs, TTL in seconds. Response
 *   parsing is tolerant across gateway revisions ({entityKey|key|id}).
 * - LocalArkivClient: browser-local store used for offline demos (mode=local).
 *   It deliberately mints bytes32-shaped entity keys so the on-chain
 *   arkivEntityKey round-trips without a mapping registry.
 */

const ARKIV_MODE = (process.env.NEXT_PUBLIC_ARKIV_MODE ?? "http").toLowerCase();
// Writes go through the backend relay, which holds the Arkiv access key and gas wallet.
const ARKIV_URL = process.env.NEXT_PUBLIC_ARKIV_URL ?? `${BACKEND_API_URL}/api/arkiv`;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function normalizeAttributes(raw: unknown): Record<string, string> {
  if (Array.isArray(raw)) {
    return Object.fromEntries(
      raw.map((entry) => {
        const e = entry as { key?: string; name?: string; value?: string };
        return [String(e.key ?? e.name ?? ""), String(e.value ?? "")];
      })
    );
  }
  if (raw && typeof raw === "object") {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, String(v)])
    );
  }
  return {};
}

export class HttpArkivClient implements IArkivClient {
  constructor(
    private readonly baseUrl: string = ARKIV_URL,
    private readonly apiKey?: string
  ) {}

  private headers(): HeadersInit {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  async writeEntity(
    payload: Uint8Array,
    attributes: Record<string, string>,
    options?: { ttl?: number }
  ): Promise<{ key: string }> {
    const res = await fetch(`${this.baseUrl}/entities`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        payload: bytesToBase64(payload),
        contentType: "application/octet-stream",
        attributes: Object.entries(attributes).map(([key, value]) => ({ key, value })),
        ttlSeconds: options?.ttl ?? 604_800
      })
    });

    if (!res.ok) {
      throw new Error(`Arkiv write failed: HTTP ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { entityKey?: string; key?: string; id?: string };
    const key = data.entityKey ?? data.key ?? data.id;
    if (!key) throw new Error("Arkiv write returned no entity key");
    this.rememberKey(key);
    return { key };
  }

  async readEntity(key: string): Promise<{ payload: Uint8Array; attributes: Record<string, string> }> {
    const res = await fetch(`${this.baseUrl}/entities/${encodeURIComponent(key)}`, {
      headers: this.headers()
    });

    if (!res.ok) {
      // The on-chain key is bytes32(entityKey). If this device originally wrote
      // the entity it has a stored reverse mapping — try it before failing.
      const mapped = lookupStoredEntityKey(key);
      if (mapped && mapped !== key) {
        return this.readEntity(mapped);
      }
      throw new Error(`Arkiv read failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      payload?: string;
      data?: string;
      attributes?: unknown;
    };
    const rawPayload = data.payload ?? data.data;
    if (rawPayload === undefined) throw new Error("Arkiv entity has no payload");

    return {
      payload: base64ToBytes(rawPayload),
      attributes: normalizeAttributes(data.attributes)
    };
  }

  private rememberKey(key: string): void {
    try {
      const b32 = key.startsWith("0x") && key.length === 66 ? key.toLowerCase() : null;
      if (!b32 || b32 === key.toLowerCase()) return;
      localStorage.setItem(`streetsync:arkivkey:${b32}`, key);
    } catch {
      // storage unavailable (private mode) — mapping falls back to gateway-side resolution
    }
  }
}

export function lookupStoredEntityKey(bytes32Key: string): string | null {
  try {
    return localStorage.getItem(`streetsync:arkivkey:${bytes32Key.toLowerCase()}`);
  } catch {
    return null;
  }
}

export function rememberEntityMapping(bountyId: string, entityKey: string): void {
  try {
    localStorage.setItem(`streetsync:arkiv:bounty:${bountyId}`, entityKey);
  } catch {
    // non-fatal
  }
}

export function lookupBountyEntityKey(bountyId: string): string | null {
  try {
    return localStorage.getItem(`streetsync:arkiv:bounty:${bountyId}`);
  } catch {
    return null;
  }
}

interface LocalArkivRecord {
  payload: string; // base64
  attributes: Record<string, string>;
  createdAt: number;
  expiresAt: number;
}

const LOCAL_STORE_KEY = "streetsync:arkiv:entities";

export class LocalArkivClient implements IArkivClient {
  private load(): Record<string, LocalArkivRecord> {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_STORE_KEY) ?? "{}") as Record<
        string,
        LocalArkivRecord
      >;
    } catch {
      return {};
    }
  }

  private save(all: Record<string, LocalArkivRecord>): void {
    localStorage.setItem(LOCAL_STORE_KEY, JSON.stringify(all));
  }

  async writeEntity(
    payload: Uint8Array,
    attributes: Record<string, string>,
    options?: { ttl?: number }
  ): Promise<{ key: string }> {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const key =
      "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

    const all = this.load();
    all[key] = {
      payload: bytesToBase64(payload),
      attributes: { ...attributes },
      createdAt: Date.now(),
      expiresAt: Date.now() + (options?.ttl ?? 604_800) * 1000
    };
    this.save(all);
    return { key };
  }

  async readEntity(key: string): Promise<{ payload: Uint8Array; attributes: Record<string, string> }> {
    const all = this.load();
    const record = all[key] ?? all[lookupStoredEntityKey(key) ?? ""];
    if (!record) throw new Error(`Local Arkiv entity not found: ${key}`);
    if (record.expiresAt < Date.now()) throw new Error(`Local Arkiv entity expired: ${key}`);
    return { payload: base64ToBytes(record.payload), attributes: record.attributes };
  }
}

export function getArkivClient(): IArkivClient {
  if (ARKIV_MODE === "local") {
    if (!isLocalNetwork) throw new Error("Browser-local evidence is only available on the local test network. Configure shared Arkiv storage for Arc Testnet.");
    return new LocalArkivClient();
  }
  if (ARKIV_MODE !== "http") throw new Error("Unsupported Arkiv storage mode.");
  return new HttpArkivClient(ARKIV_URL);
}
