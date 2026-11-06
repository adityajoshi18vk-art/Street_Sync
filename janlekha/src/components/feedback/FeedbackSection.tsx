import { Badge, Section } from "@/components/ui";
import { feedbackAvailability, worldIdClientConfig } from "@/lib/feedback/server";
import { listFeedback, type PublicFeedback } from "@/lib/feedback/service";
import { UNIQUE_HUMAN_LABEL } from "@/lib/feedback/signal";
import { formatTimestamp } from "@/lib/janlekha/format";
import { FeedbackForm } from "./FeedbackForm";

export async function FeedbackSection({ projectId }: { projectId: string }) {
  const availability = feedbackAvailability();
  const badge = <Badge tone="offchain">Off-chain · does not change contract state</Badge>;

  if (!availability.enabled) {
    return (
      <Section title="Citizen feedback" badge={badge}>
        <p className="text-sm text-neutral-600">{availability.reason}</p>
      </Section>
    );
  }

  let items: PublicFeedback[] | null = null;
  try {
    items = await listFeedback(availability.store, availability.scope, projectId);
  } catch (error) {
    console.error("[feedback] list failed:", error);
  }
  const world = worldIdClientConfig();

  return (
    <Section title={`Citizen feedback${items ? ` (${items.length})` : ""}`} badge={badge}>
      <p className="mb-4 text-xs text-neutral-600">
        Anyone can read feedback. To post, World ID proves you are a unique human, so each person can post once per project. It does not
        reveal who you are, and it is not KYC. It is used only for feedback, never for department, vendor, inspector or PAO actions.
        Feedback never changes milestone or payment records.
      </p>
      {items === null ? (
        <p role="alert" className="text-sm text-red-800">Feedback storage is unavailable right now. Project records above are unaffected.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-600">No feedback yet.</p>
      ) : (
        <ul className="mb-4 space-y-3">
          {items.map((f) => (
            <li key={f.id} data-testid="feedback-item" className="rounded-lg border border-neutral-200 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <Badge tone="good">{UNIQUE_HUMAN_LABEL}</Badge>
                <span>{formatTimestamp(Math.floor(new Date(f.createdAt).getTime() / 1000))}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800">{f.body}</p>
            </li>
          ))}
        </ul>
      )}
      {world ? (
        <FeedbackForm projectId={projectId} />
      ) : (
        <p className="text-sm text-neutral-600">Posting feedback is disabled: World ID is not configured on this deployment.</p>
      )}
    </Section>
  );
}
