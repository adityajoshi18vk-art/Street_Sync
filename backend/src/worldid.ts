export type WorldIdRole = "worker" | "reviewer";

import dbAccess from "./db.js";

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
