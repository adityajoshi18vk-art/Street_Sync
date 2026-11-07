export function formatINR(n: number): string {
  if (n >= 1e7) return "Rs " + (n / 1e7).toFixed(2) + " Cr";
  if (n >= 1e5) return "Rs " + (n / 1e5).toFixed(1) + " Lakh";
  return "Rs " + n.toLocaleString("en-IN");
}
export function formatINRCompact(n: number): string {
  if (n >= 1e7) return "Rs " + (n / 1e7).toFixed(1) + " Cr";
  if (n >= 1e5) return "Rs " + (n / 1e5).toFixed(0) + " L";
  return "Rs " + n.toLocaleString("en-IN");
}
export function formatUSDC(usdc: number): string {
  return usdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USDC";
}
export function formatDate(d: string): string {
  try { return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); } catch { return d; }
}
export function shortHash(h: string): string {
  if (!h) return "";
  return h.length > 18 ? h.slice(0, 10) + "..." + h.slice(-6) : h;
}
export async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
  const buf = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", buf as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
