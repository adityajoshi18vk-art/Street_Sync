import { isProjectId } from "@/lib/feedback/signal";
import { projectExistsOnChain, signFeedbackRequest, worldIdClientConfig } from "@/lib/feedback/server";

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Issues the RP-signed request context IDKit needs. Used only for citizen feedback, never for authorization. */
export async function POST(request: Request) {
  const world = worldIdClientConfig();
  if (!world) return json(503, { error: "World ID is not configured on this deployment." });
  const { projectId } = ((await request.json().catch(() => ({}))) ?? {}) as { projectId?: unknown };
  if (typeof projectId !== "string" || !isProjectId(projectId)) return json(400, { error: "A valid projectId is required." });
  try {
    if (!(await projectExistsOnChain(projectId))) return json(404, { error: "Project not found." });
  } catch {
    return json(503, { error: "The project could not be checked because the blockchain RPC is unavailable." });
  }
  return json(200, signFeedbackRequest(projectId, world));
}
