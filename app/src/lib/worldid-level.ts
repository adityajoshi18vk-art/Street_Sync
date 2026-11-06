/**
 * Minimum World ID credential StreetSync asks World App for.
 * "device" accepts every verified World ID (device, document or Orb); "orb" rejects
 * anyone who hasn't verified at an Orb with "credentials don't meet requirements".
 */
export type WorldIdLevel = "device" | "document" | "secure_document" | "orb";

const LEVELS: readonly WorldIdLevel[] = ["device", "document", "secure_document", "orb"];

export function parseWorldIdLevel(raw: string | undefined | null): WorldIdLevel {
  const v = (raw ?? "").trim().toLowerCase();
  return (LEVELS as readonly string[]).includes(v) ? (v as WorldIdLevel) : "device";
}

const LEVEL_LABEL: Record<WorldIdLevel, string> = {
  device: "any verified World ID",
  document: "a document-verified or Orb-verified World ID",
  secure_document: "an NFC-passport or Orb-verified World ID",
  orb: "an Orb-verified World ID"
};

export function worldIdLevelLabel(level: WorldIdLevel): string {
  return LEVEL_LABEL[level];
}

/** Human-readable text for IDKit error codes. */
export function worldIdErrorMessage(code: string, level: WorldIdLevel): string {
  switch (code) {
    case "credential_unavailable":
    case "verification_rejected":
      return `World App says your World ID doesn't meet the requirement: this step needs ${LEVEL_LABEL[level]}. Open World App, finish verifying, then try again.`;
    case "user_rejected":
    case "cancelled":
      return "World ID verification was cancelled.";
    case "max_verifications_reached":
      return "This World ID has already been used for this action.";
    case "inclusion_proof_pending":
      return "Your World ID was verified very recently and isn't ready yet. Try again in about an hour.";
    case "connection_failed":
    case "timeout":
      return "Couldn't reach World App. Keep World App open and try again.";
    case "unknown_rp":
    case "inactive_rp":
    case "invalid_rp_signature":
    case "invalid_rp_id_format":
    case "rp_signature_expired":
      return `World ID app configuration problem (${code}). The StreetSync operator needs to check the World Developer Portal settings.`;
    default:
      return `World ID error: ${code}`;
  }
}
