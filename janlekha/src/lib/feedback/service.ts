import { UNIQUE_HUMAN_LABEL, feedbackAction, feedbackLengthError, feedbackSignal, isProjectId, normalizeFeedback } from "./signal";
import type { WorldIdVerify } from "./world-id";

/** What the public may see. Deliberately has no nullifier or verification internals. */
export interface PublicFeedback {
  id: string;
  projectId: string;
  body: string;
  createdAt: string;
  verification: typeof UNIQUE_HUMAN_LABEL;
  credential: string;
}

export interface ProjectScope {
  chainId: number;
  contract: string;
}

export interface FeedbackStore {
  /** Atomically stores feedback with its private verification. Returns "duplicate" on (action, nullifier) conflict. */
  create(input: {
    scope: ProjectScope;
    projectId: string;
    body: string;
    credential: string;
    verification: { action: string; nullifier: string; protocolVersion: string; environment: string };
  }): Promise<{ id: string; createdAt: Date } | "duplicate">;
  list(scope: ProjectScope, projectId: string, limit: number): Promise<{ id: string; body: string; credential: string; createdAt: Date }[]>;
}

export interface SubmitDeps {
  scope: ProjectScope;
  actionPrefix: string;
  /** Feedback may only target a project that exists on-chain. Throws if the chain cannot be read. */
  projectExists: (projectId: string) => Promise<boolean>;
  verify: WorldIdVerify;
  store: FeedbackStore;
}

export type SubmitResult =
  | { status: 201; body: { feedback: PublicFeedback } }
  | { status: 400 | 404 | 409 | 503; body: { error: string; code: string } };

const fail = (status: 400 | 404 | 409 | 503, code: string, error: string): SubmitResult => ({ status, body: { error, code } });

function toPublic(projectId: string, row: { id: string; body: string; credential: string; createdAt: Date }): PublicFeedback {
  return {
    id: row.id,
    projectId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    verification: UNIQUE_HUMAN_LABEL,
    credential: row.credential,
  };
}

/**
 * Verifies a World ID proof and stores one feedback item per human per project action.
 * Feedback is off-chain only: this function has no access to, and never changes, contract state.
 */
export async function submitFeedback(input: { projectId: string; body: unknown; idkitResult: unknown }, deps: SubmitDeps): Promise<SubmitResult> {
  if (!isProjectId(input.projectId)) return fail(404, "unknown_project", "Project not found.");
  if (typeof input.body !== "string") return fail(400, "invalid_body", "Feedback text is required.");
  const lengthError = feedbackLengthError(input.body);
  if (lengthError) return fail(400, "invalid_body", lengthError);
  const body = normalizeFeedback(input.body);

  let exists: boolean;
  try {
    exists = await deps.projectExists(input.projectId);
  } catch {
    return fail(503, "chain_unavailable", "The project could not be checked because the blockchain RPC is unavailable. Try again shortly.");
  }
  if (!exists) return fail(404, "unknown_project", "Project not found.");

  const action = feedbackAction(deps.actionPrefix, input.projectId);
  const outcome = await deps.verify(input.idkitResult, { action, signal: await feedbackSignal(input.projectId, body) });
  if (!outcome.ok) {
    return outcome.kind === "unavailable"
      ? fail(503, "verification_unavailable", "The World ID verification service is unavailable. Nothing was stored; please try again.")
      : fail(400, outcome.code, `World ID verification failed: ${outcome.detail}`);
  }

  const created = await deps.store.create({
    scope: deps.scope,
    projectId: input.projectId,
    body,
    credential: outcome.credential,
    verification: { action, nullifier: outcome.nullifier, protocolVersion: outcome.protocolVersion, environment: outcome.environment },
  });
  if (created === "duplicate") {
    return fail(409, "already_submitted", "This verified human has already submitted feedback for this project.");
  }
  return { status: 201, body: { feedback: toPublic(input.projectId, { id: created.id, body, credential: outcome.credential, createdAt: created.createdAt }) } };
}

export async function listFeedback(store: FeedbackStore, scope: ProjectScope, projectId: string, limit = 100): Promise<PublicFeedback[]> {
  const rows = await store.list(scope, projectId, limit);
  return rows.map((r) => toPublic(projectId, r));
}
