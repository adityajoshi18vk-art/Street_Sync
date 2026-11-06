import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Hex } from "viem";
import { serverEnv } from "@/env/server";
import { catalogDocument } from "@/lib/janlekha/format";
import { isHash } from "./limits";

export class StorageFullError extends Error {
  constructor() {
    super("Document storage is full.");
  }
}

function dir() {
  return path.resolve(serverEnv.DOCUMENT_STORAGE_DIR);
}

function fileFor(hash: string) {
  if (!isHash(hash)) throw new Error("invalid hash");
  return path.join(dir(), `${hash.slice(2)}.pdf`);
}

export function sha256(bytes: Uint8Array): Hex {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

async function usedBytes(): Promise<number> {
  let total = 0;
  for (const name of await readdir(dir()).catch(() => [] as string[])) {
    if (!name.endsWith(".pdf")) continue;
    total += (await stat(path.join(dir(), name)).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

/** Content-addressed write: the file name is its own SHA-256, so stored copies cannot be silently altered. */
export async function storeDocument(bytes: Uint8Array): Promise<{ hash: Hex; existing: boolean }> {
  const hash = sha256(bytes);
  const target = fileFor(hash);
  try {
    await access(target);
    return { hash, existing: true };
  } catch {
    // not stored yet
  }
  await mkdir(dir(), { recursive: true });
  // Best-effort cap: concurrent uploads may overshoot by at most one file each.
  if ((await usedBytes()) + bytes.length > serverEnv.DOCUMENT_STORAGE_MAX_BYTES) throw new StorageFullError();
  const tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, bytes, { flag: "wx" });
  try {
    await rename(tmp, target);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
  return { hash, existing: false };
}

export async function readStoredDocument(hash: string): Promise<Uint8Array | null> {
  try {
    return await readFile(fileFor(hash));
  } catch {
    return null;
  }
}

export type DocumentStoreStatus =
  | { status: "ok"; usedBytes: number; maxBytes: number }
  | { status: "unwritable"; detail: string };

/** Writes need a persistent, writable directory; ephemeral or read-only hosts block every authorised action. */
export async function checkDocumentStore(): Promise<DocumentStoreStatus> {
  try {
    await mkdir(dir(), { recursive: true });
    await access(dir(), constants.W_OK);
    return { status: "ok", usedBytes: await usedBytes(), maxBytes: serverEnv.DOCUMENT_STORAGE_MAX_BYTES };
  } catch (error) {
    console.error("[health] document store check failed:", error);
    return { status: "unwritable", detail: "DOCUMENT_STORAGE_DIR is not writable" };
  }
}

export interface OffChainCopy {
  title: string;
  url: string;
  source: "demo-catalog" | "uploaded";
}

/** A downloadable off-chain copy for an on-chain hash, if one exists. Unverified until checked. */
export async function findOffChainCopy(hash: Hex): Promise<OffChainCopy | null> {
  const catalog = catalogDocument(hash);
  if (catalog) return { title: catalog.title, url: catalog.file, source: "demo-catalog" };
  const key = hash.toLowerCase();
  if (!isHash(key)) return null;
  try {
    await access(fileFor(key));
    return { title: "Uploaded copy", url: `/api/documents/${key}`, source: "uploaded" };
  } catch {
    return null;
  }
}
