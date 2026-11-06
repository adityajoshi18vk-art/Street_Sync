import type { Address, Hex } from "viem";

export type MilestoneStatusName = "None" | "Defined" | "EvidenceSubmitted" | "Approved" | "Paid";

/** Serializable snapshot of verified contract state handed to the client action panels. */
export interface ActionState {
  projectId: string;
  department: Address;
  allocationPaise: string;
  reservedPaise: string;
  paidPaise: string;
  chainTime: string;
  tender: null | { bidDeadline: string; revealDeadline: string; commitCount: number; revealCount: number };
  bids: { vendor: Address; commitment: Hex; revealed: boolean; amountPaise: string }[];
  award: null | { vendor: Address; amountPaise: string; milestoneTotalPaise: string; milestoneCount: number };
  milestones: { id: number; amountPaise: string; status: MilestoneStatusName; inspector: Address }[];
}
