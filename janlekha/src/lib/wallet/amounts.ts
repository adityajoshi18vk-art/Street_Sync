/** Parses a rupee amount such as "42,00,000" or "1250.50" into integer paise. */
export function parseRupeesToPaise(input: string): bigint | null {
  const cleaned = input.replace(/[,\s₹]/g, "");
  const match = /^(\d{1,15})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
}

/** Seconds → value for <input type="datetime-local"> in the browser's local time zone. */
export function toDateTimeLocal(unixSeconds: bigint): string {
  const d = new Date(Number(unixSeconds) * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDateTimeLocal(value: string): bigint | null {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? BigInt(Math.floor(ms / 1000)) : null;
}
