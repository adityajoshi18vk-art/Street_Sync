export { STATUS_COLORS, STATUS_TEXT_CLASSES, statusName, statusLabel } from "@/lib/types";

export function formatUsdcDisplaySafe(amount: number): string {
  if (!Number.isFinite(amount)) return "0.00";
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
