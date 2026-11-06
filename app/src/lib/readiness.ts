/** Pure readiness checks for the "report a problem" form, so the UI can say what is missing. */

export interface ReportReadinessInput {
  isConnected: boolean;
  onActiveChain: boolean;
  contractsDeployed: boolean;
  hasPin: boolean;
  hasPhoto: boolean;
  descriptionLength: number;
  minDescription: number;
  maxDescription: number;
  /** Parsed 6-decimal amount, or null when the input is empty or invalid. */
  amount: bigint | null;
  amountInput: string;
  /** Wallet USDC balance (6 decimals), or null while unknown. */
  balance: bigint | null;
  hasExpiry: boolean;
}

export type ReadinessKey = "wallet" | "network" | "pin" | "photo" | "description" | "amount" | "balance" | "expiry";

export interface ReadinessItem {
  key: ReadinessKey;
  label: string;
  done: boolean;
}

export function reportReadiness(i: ReportReadinessInput): { items: ReadinessItem[]; ready: boolean } {
  const descOk = i.descriptionLength >= i.minDescription && i.descriptionLength <= i.maxDescription;
  const amountOk = i.amount !== null && i.amount > 0n;
  const items: ReadinessItem[] = [
    { key: "wallet", label: "Connect your wallet", done: i.isConnected },
    { key: "network", label: "Switch your wallet to Arc Testnet", done: i.isConnected && i.onActiveChain && i.contractsDeployed },
    { key: "pin", label: "Tap the map to pin the problem's location", done: i.hasPin },
    { key: "photo", label: "Add a photo of the problem", done: i.hasPhoto },
    {
      key: "description",
      label:
        i.descriptionLength > i.maxDescription
          ? `Shorten the description to ${i.maxDescription} characters`
          : `Describe the problem (at least ${i.minDescription} characters)`,
      done: descOk
    },
    {
      key: "amount",
      label: i.amountInput.trim() && !amountOk ? "Enter a valid USDC amount (max 6 decimals)" : "Enter how much USDC to fund",
      done: amountOk
    },
    {
      key: "balance",
      label: "Have enough USDC in your wallet (get test USDC at faucet.circle.com)",
      done: !amountOk || i.balance === null || i.balance >= (i.amount as bigint)
    },
    { key: "expiry", label: "Choose an expiry", done: i.hasExpiry }
  ];
  return { items, ready: items.every((x) => x.done) };
}
