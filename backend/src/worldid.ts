export type WorldIdRole = "worker" | "reviewer";

export function isAllowedWorldIdAction(role: WorldIdRole, action: string): boolean {
  const expectedAction = role === "worker"
    ? process.env.WORLD_ACTION_WORKER ?? "claim-bounty"
    : process.env.WORLD_ACTION_REVIEWER ?? "register-reviewer";
  return action === expectedAction;
}

export function isLocalWorldIdBypassEnabled(
  chainId: number,
  configured: boolean,
  requested: boolean | undefined,
): boolean {
  return chainId === 31337 && configured && requested === true;
}
