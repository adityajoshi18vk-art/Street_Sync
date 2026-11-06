import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ErrorPanel, LoadingPanel, NotFoundPanel, OnChain } from "@/components/ui";
import { catalogDocument, catalogProject, formatTimestamp } from "@/lib/janlekha/format";
import { getProject, listProjects, verifiableDocuments } from "@/lib/janlekha/reads";
import { VerifyForm, type VerifyOption } from "./VerifyForm";

export const metadata: Metadata = { title: "Verify a document" };

async function ProjectPicker() {
  const result = await listProjects();
  if (!result.ok) return <ErrorPanel failure={result.failure} />;
  if (result.projects.length === 0) return <p className="text-sm text-neutral-600">No projects on this contract yet.</p>;
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <p className="text-sm font-medium text-neutral-800">Choose the project the document belongs to</p>
      <ul className="mt-3 divide-y divide-neutral-100">
        {result.projects.map((p) => (
          <li key={p.id.toString()}>
            <Link href={`/verify?project=${p.id}`} className="flex justify-between gap-3 py-2 text-sm hover:text-blue-700">
              <span>
                #{p.id.toString()} {catalogProject(p.sanctionDocumentHash)?.title ?? "Untitled project"}
              </span>
              <span className="text-xs text-neutral-500">{p.stage}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function VerifyContent({ searchParams }: { searchParams: PageProps<"/verify">["searchParams"] }) {
  await connection();
  const params = await searchParams;
  const project = typeof params.project === "string" ? params.project : undefined;
  const doc = typeof params.doc === "string" ? params.doc : undefined;
  if (!project) return <ProjectPicker />;

  const result = await getProject(project);
  if (result.status === "not-found") return <NotFoundPanel reason={result.reason} />;
  if (result.status === "error") return <ErrorPanel failure={result.failure} />;

  const p = result.project;
  const options: VerifyOption[] = verifiableDocuments(p).map((d) => ({
    key: d.key,
    label: d.label,
    hash: d.hash,
    recordedAt: formatTimestamp(d.recordedAt),
    offChainFile: catalogDocument(d.hash)?.file,
  }));

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">
        Project{" "}
        <Link href={`/projects/${p.id}`} className="font-medium text-blue-700 underline underline-offset-2">
          #{p.id.toString()} {catalogProject(p.sanctionDocumentHash)?.title ?? ""}
        </Link>{" "}
        · {options.length} document hash(es) recorded on-chain · <Link href="/verify" className="underline underline-offset-2">change project</Link>
      </p>
      <VerifyForm key={`${p.id}-${doc ?? ""}`} options={options} initialKey={doc} />
    </div>
  );
}

export default function VerifyPage({ searchParams }: PageProps<"/verify">) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Verify a document</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Check whether a PDF is exactly the document an authorised role recorded on-chain. Your browser computes the
          file&apos;s SHA-256 and compares it with the hash stored in the JanLekha contract. No wallet or upload needed.
        </p>
        <div className="mt-2"><OnChain /></div>
      </div>
      <Suspense fallback={<LoadingPanel label="Reading document hashes from the contract…" />}>
        <VerifyContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
