import { isHash } from "@/lib/documents/limits";
import { readStoredDocument } from "@/lib/documents/storage";

export async function GET(_request: Request, ctx: RouteContext<"/api/documents/[hash]">) {
  const { hash } = await ctx.params;
  const key = hash.toLowerCase();
  if (!isHash(key)) return Response.json({ error: "Invalid document hash." }, { status: 400 });
  const bytes = await readStoredDocument(key);
  if (!bytes) return Response.json({ error: "No stored copy for this hash." }, { status: 404 });
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="janlekha-${key.slice(2, 14)}.pdf"`,
      // Content-addressed: the bytes for a hash never change.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    },
  });
}
