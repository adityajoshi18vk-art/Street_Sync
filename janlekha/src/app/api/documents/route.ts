import { ACCEPTED_DOCUMENT_TYPE, MAX_DOCUMENT_BYTES, startsWithPdfMagic } from "@/lib/documents/limits";
import { StorageFullError, sha256, storeDocument } from "@/lib/documents/storage";

/** Multipart framing overhead allowed on top of the file itself. */
const MAX_BODY_BYTES = MAX_DOCUMENT_BYTES + 64 * 1024;

const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Stores a synthetic/public demo PDF under its SHA-256. Storing a file does not make it
 * official; only an authorised on-chain reference to the hash does.
 */
export async function POST(request: Request) {
  // Checked before parsing: formData() buffers the whole body, so an unbounded body must never reach it.
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader === null) return json(411, { error: "Content-Length is required." });
  const declared = Number(lengthHeader);
  if (!Number.isSafeInteger(declared) || declared < 0) return json(400, { error: "Invalid Content-Length." });
  if (declared > MAX_BODY_BYTES) return json(413, { error: "The PDF exceeds the 2 MB limit." });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: "Expected a multipart form upload." });
  }
  const file = form.get("file");
  const clientHash = String(form.get("sha256") ?? "").toLowerCase();
  if (form.get("synthetic") !== "true") {
    return json(400, { error: "Only synthetic or public demo documents may be stored. Confirm the declaration first." });
  }
  if (!(file instanceof File)) return json(400, { error: "No file was provided." });
  if (file.size === 0 || file.size > MAX_DOCUMENT_BYTES) return json(413, { error: "The PDF must be between 1 byte and 2 MB." });
  if (file.type && file.type !== ACCEPTED_DOCUMENT_TYPE) return json(415, { error: "Only PDF documents are accepted." });

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!startsWithPdfMagic(bytes)) return json(415, { error: "The file is not a valid PDF." });

  // Rejected uploads are never stored.
  const hash = sha256(bytes);
  if (clientHash && clientHash !== hash) {
    return json(422, { error: "The hash computed by your browser does not match the uploaded bytes.", sha256: hash });
  }

  let existing: boolean;
  try {
    ({ existing } = await storeDocument(bytes));
  } catch (error) {
    if (error instanceof StorageFullError) return json(507, { error: "Document storage is full. Contact the operator." });
    console.error("[documents] store failed:", error);
    return json(503, { error: "Document storage is unavailable." });
  }
  return json(existing ? 200 : 201, {
    sha256: hash,
    url: `/api/documents/${hash}`,
    existing,
    notice: "Stored off-chain. Not official until an authorised role references this hash in a confirmed contract transaction.",
  });
}
