import { STATUS_COLORS, statusLabel, statusName } from "@/lib/types";
import { isOpenExpired } from "@/lib/lifecycle";
import type { BountyMapItem } from "@/lib/types";

export { STATUS_COLORS, STATUS_LABELS, STATUS_TEXT_CLASSES, statusName, statusLabel } from "@/lib/types";

export function formatUsdcDisplaySafe(amount: number): string {
  if (!Number.isFinite(amount)) return "0.00";
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export const EXPIRED_COLOR = "#9ca3af";

/** Label and colour for a listed bounty; Open bounties past their claim deadline show as Expired. */
export function bountyDisplayStatus(
  b: Pick<BountyMapItem, "status" | "claimDeadline">,
  nowSeconds: number
): { label: string; color: string; expired: boolean } {
  const expired = b.claimDeadline > 0 && isOpenExpired(b, nowSeconds);
  return expired
    ? { label: "Expired", color: EXPIRED_COLOR, expired }
    : { label: statusLabel(b.status), color: STATUS_COLORS[statusName(b.status)], expired };
}
