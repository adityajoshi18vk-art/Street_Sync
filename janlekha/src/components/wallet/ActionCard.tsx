"use client";

import type { ReactNode } from "react";
import { TxStatus, type TxState } from "./tx";

export function ActionCard({ title, actor, testId, children }: { title: string; actor: string; testId: string; children: ReactNode }) {
  return (
    <section data-testid={testId} className="rounded-xl border border-blue-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-neutral-900">{title}</h3>
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-800 ring-1 ring-inset ring-blue-200">
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
        className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600"
      >
        {busy ? "Working…" : label}
      </button>
      {blocked && !busy && !done && (
        <p data-testid="blocked-reason" className="mt-2 text-xs text-amber-800">
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
      <span className="font-medium text-neutral-800">{props.label}</span>
      <input
        data-testid={props.testId}
        type={props.type ?? "text"}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
      />
      {props.hint && <span className="mt-1 block text-xs text-neutral-500">{props.hint}</span>}
    </label>
  );
}
