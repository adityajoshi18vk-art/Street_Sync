import { feedbackAvailability, submitDeps, worldIdClientConfig } from "@/lib/feedback/server";
import { listFeedback, submitFeedback } from "@/lib/feedback/service";
import { isProjectId } from "@/lib/feedback/signal";

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Public: feedback for a project. Never includes nullifiers. No World ID needed to read. */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]/feedback">) {
  const { id } = await ctx.params;
  if (!isProjectId(id)) return json(404, { error: "Project not found." });
  const availability = feedbackAvailability();
  if (!availability.enabled) return json(503, { error: availability.reason });
  try {
    return json(200, { projectId: id, feedback: await listFeedback(availability.store, availability.scope, id) });
  } catch (error) {
    console.error("[feedback] list failed:", error);
    return json(503, { error: "Feedback storage is unavailable." });
  }
}

/** Off-chain only: verifying a human and storing text never touches milestones or payments. */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/feedback">) {
  const { id } = await ctx.params;
  const availability = feedbackAvailability();
  if (!availability.enabled) return json(503, { error: availability.reason, code: "feedback_disabled" });
  const world = worldIdClientConfig();
  if (!world) return json(503, { error: "World ID is not configured on this deployment.", code: "world_id_disabled" });

  const payload = (await request.json().catch(() => null)) as { body?: unknown; idkitResult?: unknown } | null;
  if (!payload) return json(400, { error: "Expected a JSON body.", code: "invalid_request" });
  try {
    const result = await submitFeedback(
      { projectId: id, body: payload.body, idkitResult: payload.idkitResult },
      submitDeps(availability.store, availability.scope, world),
    );
    return json(result.status, result.body);
  } catch (error) {
    console.error("[feedback] submit failed:", error);
    return json(503, { error: "Feedback storage is unavailable. Nothing was stored.", code: "storage_unavailable" });
  }
}
