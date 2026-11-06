export type WorldIdRole = "worker" | "reviewer" | "neighbour";

import dbAccess from "./db.js";

export const WORLD_ID_ROLES: readonly WorldIdRole[] = ["worker", "reviewer", "neighbour"];

export function actionForRole(role: WorldIdRole): string {
  switch (role) {
    case "worker": return process.env.WORLD_ACTION_WORKER ?? "claim-bounty";
    case "reviewer": return process.env.WORLD_ACTION_REVIEWER ?? "register-reviewer";
    case "neighbour": return process.env.WORLD_ACTION_NEIGHBOUR ?? "vote-problem";
  }
}

export function isAllowedWorldIdAction(role: WorldIdRole, action: string): boolean {
  return action === actionForRole(role);
}

/** Every role needs its own action, otherwise one proof would satisfy several roles. */
export function areWorldActionsConfigured(): boolean {
  const actions = WORLD_ID_ROLES.map(actionForRole);
  return actions.every(Boolean) && new Set(actions).size === actions.length;
}

export function isLocalWorldIdBypassEnabled(
  chainId: number,
  configured: boolean,
  requested: boolean | undefined,
): boolean {
  return chainId === 31337 && configured && requested === true;
}

export function recordWorldIdNullifier(
  nullifierHash: string,
  action: string,
  wallet: string,
): "recorded" | "reused" | "conflict" {
  const existing = dbAccess.checkNullifier(nullifierHash, action);
  if (existing) return existing.wallet.toLowerCase() === wallet.toLowerCase() ? "reused" : "conflict";

  try {
    dbAccess.insertNullifier(nullifierHash, action, wallet.toLowerCase());
    return "recorded";
  } catch {
    const raced = dbAccess.checkNullifier(nullifierHash, action);
    return raced?.wallet.toLowerCase() === wallet.toLowerCase() ? "reused" : "conflict";
  }
}
