"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { decodeEventLog, type Hex } from "viem";
import { ActionCard, SubmitRow, TextInput } from "@/components/wallet/ActionCard";
import { DocumentInput } from "@/components/wallet/DocumentInput";
import { useWriteGate } from "@/components/wallet/hooks";
import { TxActivityProvider, useContractTx } from "@/components/wallet/tx";
import { janLekhaAbi } from "@/lib/janlekha/abi";
import { formatPaise } from "@/lib/janlekha/format";
import { parseRupeesToPaise } from "@/lib/wallet/amounts";
import { CONTRACT_ADDRESS } from "@/lib/wallet/chain";

function CreateProjectForm() {
  const router = useRouter();
  const gate = useWriteGate();
  const tx = useContractTx("Create project");
  const [sanction, setSanction] = useState<Hex | null>(null);
  const [allocation, setAllocation] = useState("");
  const paise = parseRupeesToPaise(allocation);

  const blocked =
    gate.reason ??
    gate.needRole("DEPARTMENT_ROLE", "create a project") ??
    (!sanction ? "Add the sanction order PDF first." : null) ??
    (!paise ? "Enter the sanctioned allocation in rupees (e.g. 50,00,000)." : null);

  return (
    <ActionCard title="Create a project" actor="Department" testId="create-project">
      <p className="text-xs text-slate-300">
        Records the sanction document hash and the allocation on-chain. Amounts are stored in paise; no money moves.
      </p>
      <DocumentInput label="Sanction order (PDF)" purpose="public" onChange={setSanction} testId="sanction-doc" />
      <TextInput
        label="Allocation (₹)"
        value={allocation}
        onChange={setAllocation}
        placeholder="50,00,000"
        hint={paise ? `= ${formatPaise(paise)} (${paise.toString()} paise)` : undefined}
        testId="allocation-input"
      />
      <SubmitRow
        label="Create project"
        blocked={blocked}
        busy={tx.busy}
        state={tx.state}
        onSubmit={() =>
          void tx.run("createProject", [sanction!, paise!], {
            refresh: false,
            onConfirmed: (receipt) => {
              for (const log of receipt.logs) {
                if (!CONTRACT_ADDRESS || log.address.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue;
                try {
                  const ev = decodeEventLog({ abi: janLekhaAbi, data: log.data, topics: log.topics });
                  if (ev.eventName === "ProjectCreated") return router.push(`/projects/${ev.args.projectId}`);
                } catch {
                  // other events
                }
              }
              router.refresh();
            },
          })
        }
      />
    </ActionCard>
  );
}

export function CreateProjectPanel() {
  return (
    <details className="group card p-4 open:pb-5">
      <summary className="cursor-pointer text-sm font-semibold text-slate-100">Department tools: create a project</summary>
      <div className="mt-4">
        <TxActivityProvider>
          <CreateProjectForm />
        </TxActivityProvider>
      </div>
    </details>
  );
}
