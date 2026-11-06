"use client";

import type { ReactNode } from "react";
import { TxStatus, type TxState } from "./tx";

export function ActionCard({ title, actor, testId, children }: { title: string; actor: string; testId: string; children: ReactNode }) {
  return (
    <section data-testid={testId} className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-extrabold tracking-tight text-white">{title}</h3>
        <span className="rounded-full bg-blue-400/10 px-2 py-0.5 text-[11px] font-semibold text-blue-300 ring-1 ring-inset ring-blue-400/30">
          {actor}
        </span>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Submit button with a visible reason whenever it is disabled. */
export function SubmitRow({
  label,
  blocked,
  busy,
  state,
  onSubmit,
}: {
  label: string;
  blocked: string | null;
  busy: boolean;
  state: TxState;
  onSubmit: () => void;
}) {
  // A confirmed action stays locked until the refreshed contract state remounts or replaces this card,
  // so a second click cannot record the same action twice.
  const done = state.status === "confirmed";
  return (
    <div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={!!blocked || busy || done}
        className="btn-primary"
      >
        {busy ? <><span className="spinner !size-4" aria-hidden="true" />Working…</> : label}
      </button>
      {blocked && !busy && !done && (
        <p data-testid="blocked-reason" className="mt-2 text-xs text-amber-300">
          {blocked}
        </p>
      )}
      <TxStatus state={state} />
    </div>
  );
}

export function TextInput(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; hint?: string; testId?: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-100">{props.label}</span>
      <input
        data-testid={props.testId}
        type={props.type ?? "text"}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        className="field mt-1"
      />
      {props.hint && <span className="mt-1 block text-xs text-slate-400">{props.hint}</span>}
    </label>
  );
}
