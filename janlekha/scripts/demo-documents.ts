/**
 * Writes the synthetic demo PDFs and the off-chain catalog used by the public pages.
 *
 *   npm run demo:documents
 *
 * The catalog maps on-chain SHA-256 hashes to display metadata and downloadable copies.
 * It is off-chain, unverified convenience data; contract state stays authoritative.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { CATALOG_PATH, DEMO_PROJECTS, DOCS_DIR, publishedDocs } from "./lib/demo-data.js";

await mkdir(DOCS_DIR, { recursive: true });
for (const d of publishedDocs()) {
  await writeFile(path.join(DOCS_DIR, d.file), d.bytes);
}

const catalog = {
  notice: "Synthetic, off-chain demo metadata. Not verified by the contract.",
  projects: Object.fromEntries(
    DEMO_PROJECTS.map((p) => [
      p.docs.sanction.sha256,
      { title: p.title, department: p.department, location: p.location },
    ]),
  ),
  documents: Object.fromEntries(
    publishedDocs().map((d) => [d.sha256, { title: d.title, kind: d.kind, file: `/demo-documents/${d.file}` }]),
  ),
};
await writeFile(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${publishedDocs().length} synthetic PDFs to ${DOCS_DIR} and ${CATALOG_PATH}`);
