/**
 * Upload/download API for off-chain documents. Calls the real route handlers.
 * Run with `npm run test:documents` (needs the react-server condition for `server-only`).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "janlekha-docs-"));
const CAP_BYTES = 4_000;
process.env.DOCUMENT_STORAGE_DIR = STORAGE_DIR;
process.env.DOCUMENT_STORAGE_MAX_BYTES = String(CAP_BYTES);

type PostHandler = (req: Request) => Promise<Response>;
type GetHandler = (req: Request, ctx: { params: Promise<{ hash: string }> }) => Promise<Response>;
let POST: PostHandler;
let GET: GetHandler;

let counter = 0;
function pdf(size = 300): Uint8Array {
  const head = `%PDF-1.4\n% synthetic test document ${++counter}\n`;
  return new TextEncoder().encode(head.padEnd(size, "x"));
}
const sha = (b: Uint8Array) => `0x${createHash("sha256").update(b).digest("hex")}`;
const stored = () => readdirSync(STORAGE_DIR).filter((f) => f.endsWith(".pdf")).length;

/** Builds a multipart upload with an explicit Content-Length, as browsers and curl send. */
async function upload(
  bytes: Uint8Array,
  opts: { type?: string; sha256?: string; synthetic?: string | null; omitLength?: boolean; declaredLength?: string } = {},
) {
  const form = new FormData();
  form.set("file", new File([bytes as BlobPart], "doc.pdf", { type: opts.type ?? "application/pdf" }));
  if (opts.sha256 !== undefined) form.set("sha256", opts.sha256);
  if (opts.synthetic !== null) form.set("synthetic", opts.synthetic ?? "true");
  const encoded = new Response(form);
  const body = new Uint8Array(await encoded.arrayBuffer());
  const headers = new Headers({ "content-type": encoded.headers.get("content-type")! });
  if (!opts.omitLength) headers.set("content-length", opts.declaredLength ?? String(body.length));
  const res = await POST(new Request("http://localhost/api/documents", { method: "POST", headers, body, duplex: "half" } as RequestInit));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const get = (hash: string) => GET(new Request(`http://localhost/api/documents/${hash}`), { params: Promise.resolve({ hash }) });

describe("document upload API", () => {
  before(async () => {
    ({ POST } = (await import("../src/app/api/documents/route")) as unknown as { POST: PostHandler });
    ({ GET } = (await import("../src/app/api/documents/[hash]/route")) as unknown as { GET: GetHandler });
  });
  after(() => rmSync(STORAGE_DIR, { recursive: true, force: true }));

  it("stores a new PDF under its SHA-256 (201), and is idempotent (200)", async () => {
    const bytes = pdf();
    const first = await upload(bytes, { sha256: sha(bytes) });
    assert.equal(first.status, 201);
    assert.equal(first.json.sha256, sha(bytes));
    assert.equal(first.json.existing, false);
    const again = await upload(bytes, { sha256: sha(bytes) });
    assert.equal(again.status, 200);
    assert.equal(again.json.existing, true);
    assert.equal(stored(), 1);
  });

  it("serves stored bytes unchanged with safe headers", async () => {
    const bytes = pdf();
    await upload(bytes);
    const res = await get(sha(bytes));
    assert.equal(res.status, 200);
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(res.headers.get("content-security-policy"), "sandbox");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });

  it("returns 400 for a malformed hash and 404 for an unknown one", async () => {
    assert.equal((await get("../../etc/passwd")).status, 400);
    assert.equal((await get("0x" + "A".repeat(64))).status, 404); // normalised to lowercase, valid but absent
    assert.equal((await get("0x" + "b".repeat(64))).status, 404);
  });

  it("requires a Content-Length and rejects oversized declarations before parsing (411/413)", async () => {
    const before = stored();
    assert.equal((await upload(pdf(), { omitLength: true })).status, 411);
    assert.equal((await upload(pdf(), { declaredLength: String(10 * 1024 * 1024) })).status, 413);
    assert.equal((await upload(pdf(), { declaredLength: "abc" })).status, 400);
    assert.equal(stored(), before);
  });

  it("rejects missing declaration, wrong type, non-PDF bytes and oversized files", async () => {
    const before = stored();
    assert.equal((await upload(pdf(), { synthetic: null })).status, 400);
    assert.equal((await upload(pdf(), { type: "image/png" })).status, 415);
    assert.equal((await upload(new TextEncoder().encode("not a pdf at all"))).status, 415);
    assert.equal((await upload(pdf(2 * 1024 * 1024 + 1), { declaredLength: String(2 * 1024 * 1024 + 1000) })).status, 413);
    assert.equal(stored(), before);
  });

  it("rejects a browser/server hash mismatch (422) without storing the file", async () => {
    const bytes = pdf();
    const res = await upload(bytes, { sha256: "0x" + "a".repeat(64) });
    assert.equal(res.status, 422);
    assert.equal(res.json.sha256, sha(bytes));
    assert.equal((await get(sha(bytes))).status, 404);
  });

  it("refuses new files once the storage cap is reached (507)", async () => {
    let status = 201;
    for (let i = 0; i < 20 && status === 201; i++) status = (await upload(pdf(1_000))).status;
    assert.equal(status, 507);
    const used = readdirSync(STORAGE_DIR).reduce((n, f) => n + (f.endsWith(".pdf") ? 1 : 0), 0);
    assert.ok(used * 300 <= CAP_BYTES + 1_000, "stays within the cap (plus at most one file)");
  });
});
