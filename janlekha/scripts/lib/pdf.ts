/**
 * Minimal deterministic PDF writer for synthetic demo documents.
 * Output depends only on the input text (no timestamps or ids), so file hashes are
 * reproducible and can be anchored on-chain and re-verified later.
 */

function escapePdfText(text: string): string {
  // Standard PDF fonts here use WinAnsi; keep documents ASCII to avoid encoding surprises.
  if (!/^[\x20-\x7e]*$/.test(text)) throw new Error(`Non-ASCII text in synthetic PDF: ${text}`);
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function buildPdf(title: string, lines: string[]): Uint8Array {
  const ops: string[] = ["BT", "/F2 15 Tf", "56 790 Td", `(${escapePdfText(title)}) Tj`, "/F1 10 Tf", "0 -26 Td"];
  for (const line of lines) {
    ops.push(`(${escapePdfText(line)}) Tj`, "0 -15 Td");
  }
  ops.push("ET");
  const stream = ops.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}
