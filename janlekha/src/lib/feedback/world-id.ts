import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { Nullifier } from "@worldcoin/idkit-core/nullifier";

/**
 * Server-side World ID 4.0 proof verification via the Developer Portal API
 * (POST {base}/api/v4/verify/{rp_id}), per docs.world.org. Verification happens off-chain;
 * nothing about World ID is checked or recorded on Hedera.
 */
export interface WorldIdVerifierConfig {
  rpId: string;
  environment: "production" | "staging";
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export type VerifyOutcome =
  | { ok: true; nullifier: string; credential: string; protocolVersion: string; environment: string }
  | { ok: false; kind: "invalid"; code: string; detail: string }
  | { ok: false; kind: "unavailable"; detail: string };

const CREDENTIAL = "proof_of_human";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Canonical storage form: 0x + 64 lowercase hex. IDKit 4.x types document v4 nullifiers as
 * decimal strings while docs examples show hex, so both are accepted. Out-of-field values throw.
 */
export function canonicalNullifier(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 80) throw new Error("missing nullifier");
  let value: bigint;
  if (/^0x[0-9a-fA-F]+$/.test(raw)) value = BigInt(raw);
  else if (/^[0-9]+$/.test(raw)) value = BigInt(raw);
  else throw new Error("malformed nullifier");
  const hex = `0x${value.toString(16).padStart(64, "0")}`;
  Nullifier.fromHex(hex); // range check against the World ID field
  return hex;
}

const invalid = (code: string, detail: string): VerifyOutcome => ({ ok: false, kind: "invalid", code, detail });

export function createWorldIdVerifier(cfg: WorldIdVerifierConfig) {
  const doFetch = cfg.fetch ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? 10_000;

  return async function verify(
    result: unknown,
    expected: { action: string; signal: string },
  ): Promise<VerifyOutcome> {
    // Local checks first: cheap, and they bind the proof to this project and this text.
    if (!isObj(result) || !Array.isArray(result.responses)) return invalid("malformed_result", "The World ID result is malformed.");
    if (result.protocol_version !== "4.0") return invalid("unsupported_protocol", "Only World ID 4.0 proofs are accepted.");
    if (result.session_id !== undefined) return invalid("unexpected_session", "Session proofs are not accepted for feedback.");
    if (result.action !== expected.action) return invalid("action_mismatch", "The proof was created for a different project or action.");
    if (result.environment !== cfg.environment) return invalid("environment_mismatch", `The proof is from the ${String(result.environment)} environment.`);
    const items = result.responses.filter((r): r is Json => isObj(r) && r.identifier === CREDENTIAL);
    if (items.length !== 1) return invalid("credential_missing", "Exactly one proof-of-human credential is required.");
    const item = items[0];
    if (item.signal_hash !== hashSignal(expected.signal)) {
      return invalid("signal_mismatch", "The proof does not match this feedback text. Verify again after editing.");
    }
    let requestNullifier: string;
    try {
      requestNullifier = canonicalNullifier(item.nullifier);
    } catch {
      return invalid("malformed_nullifier", "The World ID result has an invalid nullifier.");
    }

    let res: Response;
    try {
      res = await doFetch(`${cfg.baseUrl.replace(/\/$/, "")}/api/v4/verify/${encodeURIComponent(cfg.rpId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Forward the IDKit result unmodified, plus the expected environment (per the docs).
        body: JSON.stringify({ ...result, environment: cfg.environment }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return { ok: false, kind: "unavailable", detail: `World ID verification service unreachable: ${(error as Error).name}` };
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // handled below
    }

    if (res.status === 400) {
      const b = isObj(body) ? body : {};
      return invalid(typeof b.code === "string" ? b.code : "verification_failed", typeof b.detail === "string" ? b.detail : "World ID rejected the proof.");
    }
    if (res.status !== 200) {
      // 404 (unknown/inactive RP), 429 and 5xx are service or configuration problems, not the citizen's fault.
      return { ok: false, kind: "unavailable", detail: `World ID verification service returned HTTP ${res.status}` };
    }
    if (!isObj(body) || body.success !== true) return invalid("verification_failed", "World ID did not confirm the proof.");
    if (body.environment !== undefined && body.environment !== cfg.environment) {
      return invalid("environment_mismatch", "World ID verified the proof in a different environment.");
    }
    if (body.action !== undefined && body.action !== expected.action) return invalid("action_mismatch", "World ID verified a different action.");
    const verifiedNullifiers: unknown[] = [];
    if (body.nullifier !== undefined) verifiedNullifiers.push(body.nullifier);
    if (Array.isArray(body.results)) {
      const mine = body.results.find((r) => isObj(r) && r.identifier === CREDENTIAL);
      if (!isObj(mine) || mine.success !== true) return invalid("verification_failed", "The proof-of-human credential was not verified.");
      if (mine.nullifier !== undefined) verifiedNullifiers.push(mine.nullifier);
    }
    // The stored nullifier must be the one World ID verified.
    for (const v of verifiedNullifiers) {
      try {
        if (canonicalNullifier(v) !== requestNullifier) return invalid("nullifier_mismatch", "World ID returned a different nullifier.");
      } catch {
        return invalid("malformed_nullifier", "World ID returned an invalid nullifier.");
      }
    }
    return {
      ok: true,
      nullifier: requestNullifier,
      credential: CREDENTIAL,
      protocolVersion: "4.0",
      environment: cfg.environment,
    };
  };
}

export type WorldIdVerify = ReturnType<typeof createWorldIdVerifier>;
