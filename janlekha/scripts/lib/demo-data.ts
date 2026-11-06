/**
 * Synthetic demonstration data. Every name, place, amount and document here is fictional.
 * Document bytes are deterministic, so the same PDFs always produce the same SHA-256
 * hashes on any machine or chain.
 */
import { buildPdf } from "./pdf.js";
import { sha256Hex } from "./deployment.js";

export const DOCS_DIR = "public/demo-documents";
export const CATALOG_PATH = "src/lib/janlekha/demo-catalog.json";

const BANNER = "SYNTHETIC DEMONSTRATION DOCUMENT - not a real government record.";

export type DocKind =
  | "sanction"
  | "tender"
  | "quotation"
  | "evaluation"
  | "contract"
  | "milestone-spec"
  | "evidence"
  | "inspection"
  | "payment-advice";

export interface DemoDoc {
  file: string;
  kind: DocKind;
  title: string;
  bytes: Uint8Array;
  sha256: `0x${string}`;
}

function doc(file: string, kind: DocKind, title: string, lines: string[]): DemoDoc {
  const bytes = buildPdf(title, [BANNER, "", ...lines, "", "Issued for the JanLekha hackathon demo only."]);
  return { file, kind, title, bytes, sha256: sha256Hex(bytes) };
}

export const RUPEE = 100n; // paise per rupee
export const DRAIN = {
  title: "Ward 12 storm-water drain rehabilitation (synthetic)",
  department: "Synthetic Municipal Engineering Department",
  location: "Demo City, Ward 12",
  allocationPaise: 50_00_000n * RUPEE,
  bidA: 42_00_000n * RUPEE,
  bidB: 45_50_000n * RUPEE,
  milestone1: 12_00_000n * RUPEE,
  milestone2: 18_00_000n * RUPEE,
  docs: {
    sanction: doc("drain-sanction-order.pdf", "sanction", "Sanction Order SYN/ME/2026/012", [
      "Department: Synthetic Municipal Engineering Department",
      "Work: Rehabilitation of 1.2 km storm-water drain, Ward 12, Demo City",
      "Sanctioned amount: Rs 50,00,000",
    ]),
    tender: doc("drain-tender-notice.pdf", "tender", "Tender Notice SYN/ME/T/2026/031", [
      "Scope: desilting, relining and cover slabs for 1.2 km drain",
      "Bid security and eligibility: as per synthetic tender conditions",
      "Sealed bids: commit online before the bid deadline; reveal after it.",
    ]),
    quotationA: doc("drain-quotation-vendor-a.pdf", "quotation", "Quotation - Demo Vendor A (synthetic)", [
      "Quoted amount: Rs 42,00,000",
      "Completion period: 120 days",
    ]),
    quotationB: doc("drain-quotation-vendor-b.pdf", "quotation", "Quotation - Demo Vendor B (synthetic)", [
      "Quoted amount: Rs 45,50,000",
      "Completion period: 100 days",
    ]),
    evaluation: doc("drain-bid-evaluation.pdf", "evaluation", "Bid Evaluation Report", [
      "Bids revealed: 2. Both technically qualified.",
      "Lowest evaluated bid: Demo Vendor A at Rs 42,00,000.",
      "Recommendation: award to Demo Vendor A.",
    ]),
    contract: doc("drain-contract-agreement.pdf", "contract", "Contract Agreement SYN/ME/C/2026/009", [
      "Contractor: Demo Vendor A (synthetic)",
      "Contract value: Rs 42,00,000",
      "Milestones: 1) desilting and survey 2) relining of drain",
    ]),
    m1Spec: doc("drain-m1-specification.pdf", "milestone-spec", "Milestone 1 Specification - Desilting and survey", [
      "Deliverable: desilt full length; submit levels survey.",
      "Milestone value: Rs 12,00,000",
    ]),
    m2Spec: doc("drain-m2-specification.pdf", "milestone-spec", "Milestone 2 Specification - Relining", [
      "Deliverable: concrete relining of 1.2 km with cover slabs.",
      "Milestone value: Rs 18,00,000",
    ]),
    m1Evidence: doc("drain-m1-evidence.pdf", "evidence", "Milestone 1 Completion Evidence", [
      "Photographs (synthetic placeholders) and levels survey attached.",
      "Submitted by: Demo Vendor A",
    ]),
    m1Inspection: doc("drain-m1-inspection-report.pdf", "inspection", "Milestone 1 Inspection Report", [
      "Site inspected. Desilting complete across the full length.",
      "Result: approved.",
    ]),
    m1Payment: doc("drain-m1-mock-pfms-advice.pdf", "payment-advice", "Mock PFMS Payment Advice (synthetic)", [
      "MOCK record for demonstration. No real PFMS integration.",
      "Amount: Rs 12,00,000 for Milestone 1",
    ]),
    m2Evidence: doc("drain-m2-evidence.pdf", "evidence", "Milestone 2 Completion Evidence", [
      "Photographs (synthetic placeholders) of relined sections attached.",
      "Submitted by: Demo Vendor A",
    ]),
  },
};

export const ROOF = {
  title: "Government school roof waterproofing (synthetic)",
  department: "Synthetic School Infrastructure Cell",
  location: "Demo City, Ward 4",
  allocationPaise: 8_00_000n * RUPEE,
  bid: 7_25_000n * RUPEE,
  docs: {
    sanction: doc("roof-sanction-order.pdf", "sanction", "Sanction Order SYN/SIC/2026/044", [
      "Work: Roof waterproofing, Demo Government School No. 3",
      "Sanctioned amount: Rs 8,00,000",
    ]),
    tender: doc("roof-tender-notice.pdf", "tender", "Tender Notice SYN/SIC/T/2026/051", [
      "Scope: membrane waterproofing of 900 sq m roof area",
      "Sealed bids: commit online before the bid deadline; reveal after it.",
    ]),
    // Quotation is deliberately not published: bidding is still open.
    quotation: doc("roof-quotation-unpublished.pdf", "quotation", "Quotation - Demo Vendor B (synthetic)", [
      "Quoted amount: Rs 7,25,000",
    ]),
  },
};

export const SOLAR = {
  title: "Primary health centre rooftop solar (synthetic)",
  department: "Synthetic Health Infrastructure Wing",
  location: "Demo Village PHC",
  allocationPaise: 15_00_000n * RUPEE,
  docs: {
    sanction: doc("solar-sanction-order.pdf", "sanction", "Sanction Order SYN/HIW/2026/007", [
      "Work: 20 kW rooftop solar for Demo Village Primary Health Centre",
      "Sanctioned amount: Rs 15,00,000",
    ]),
  },
};

export const DEMO_PROJECTS = [DRAIN, ROOF, SOLAR];

/** Documents whose files are published off-chain for the demo (the open-tender quotation is not). */
export function publishedDocs(): DemoDoc[] {
  return [...Object.values(DRAIN.docs), ROOF.docs.sanction, ROOF.docs.tender, SOLAR.docs.sanction];
}
