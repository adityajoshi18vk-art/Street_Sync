/**
 * Shared by browser and server. The World ID signal binds a proof to one exact feedback
 * text on one project, so an intercepted proof cannot be attached to different text.
 */
export const FEEDBACK_MIN_CHARS = 10;
export const FEEDBACK_MAX_CHARS = 1000;
export const UNIQUE_HUMAN_LABEL = "Unique human verified";

export function normalizeFeedback(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

export function feedbackLengthError(text: string): string | null {
  const n = [...normalizeFeedback(text)].length;
  if (n < FEEDBACK_MIN_CHARS) return `Feedback must be at least ${FEEDBACK_MIN_CHARS} characters.`;
  if (n > FEEDBACK_MAX_CHARS) return `Feedback must be at most ${FEEDBACK_MAX_CHARS} characters.`;
  return null;
}

export function isProjectId(value: string): boolean {
  return /^[1-9][0-9]{0,30}$/.test(value);
}

/** World ID action: one proof (nullifier) per human per action, i.e. per project. */
export function feedbackAction(prefix: string, projectId: string): string {
  return `${prefix}-p${projectId}`;
}

export async function feedbackSignal(projectId: string, text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeFeedback(text)));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `janlekha-feedback:v1:p${projectId}:sha256:${hex}`;
}
