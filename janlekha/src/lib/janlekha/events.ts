import "server-only";
import { decodeEventLog, type Address, type Hex } from "viem";
import { janLekhaAbi } from "./abi";
import { publicClient, type ChainConfig } from "./chain";

export interface TimelineEvent {
  name: string;
  args: Record<string, unknown>;
  /** Unix seconds (block / consensus timestamp). */
  timestamp: number;
  txHash: Hex;
  logIndex: number;
}

type DecodedLog = { eventName: string; args: Record<string, unknown> };

function decode(data: Hex, topics: Hex[]): DecodedLog | null {
  try {
    const decoded = decodeEventLog({ abi: janLekhaAbi, data, topics: topics as [Hex, ...Hex[]] });
    return { eventName: decoded.eventName, args: (decoded.args ?? {}) as Record<string, unknown> };
  } catch {
    return null; // e.g. OpenZeppelin RoleGranted/RoleRevoked emitted by the same contract
  }
}

function belongsTo(log: DecodedLog, projectId: bigint): boolean {
  return log.args.projectId === projectId;
}

/** Local / generic EVM: eth_getLogs from the deployment block. */
async function fromRpc(cfg: ChainConfig, address: Address, projectId: bigint): Promise<TimelineEvent[]> {
  const client = publicClient(cfg);
  const logs = await client.getLogs({ address, fromBlock: cfg.deploymentBlock, toBlock: "latest" });
  const decoded = logs
    .map((log) => ({ log, event: decode(log.data, log.topics as Hex[]) }))
    .filter((x): x is { log: (typeof logs)[number]; event: DecodedLog } => !!x.event && belongsTo(x.event, projectId));

  const blockNumbers = [...new Set(decoded.map((x) => x.log.blockNumber))];
  const blocks = await Promise.all(blockNumbers.map((blockNumber) => client.getBlock({ blockNumber })));
  const timeByBlock = new Map(blocks.map((b) => [b.number, Number(b.timestamp)]));

  return decoded.map(({ log, event }) => ({
    name: event.eventName,
    args: event.args,
    timestamp: timeByBlock.get(log.blockNumber) ?? 0,
    txHash: log.transactionHash,
    logIndex: log.logIndex,
  }));
}

interface MirrorLog {
  data: Hex;
  topics: Hex[];
  index: number;
  timestamp: string;
  transaction_hash: Hex;
}

/**
 * Hedera: the JSON-RPC relay limits eth_getLogs block ranges, so read the contract's
 * logs from the mirror node REST API instead (paginated, oldest first).
 */
async function fromMirrorNode(cfg: ChainConfig, address: Address, projectId: bigint): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];
  let next: string | null = `/api/v1/contracts/${address}/results/logs?order=asc&limit=100`;
  for (let page = 0; next && page < 50; page++) {
    const res = await fetch(new URL(next, cfg.mirrorNodeUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Mirror node returned HTTP ${res.status}`);
    const body = (await res.json()) as { logs: MirrorLog[]; links?: { next: string | null } };
    for (const log of body.logs) {
      const event = decode(log.data, log.topics);
      if (event && belongsTo(event, projectId)) {
        events.push({
          name: event.eventName,
          args: event.args,
          timestamp: Number(log.timestamp.split(".")[0]),
          txHash: log.transaction_hash,
          logIndex: log.index,
        });
      }
    }
    next = body.links?.next ?? null;
  }
  return events;
}

export async function getProjectTimeline(cfg: ChainConfig, address: Address, projectId: bigint) {
  const events = cfg.isHedera
    ? await fromMirrorNode(cfg, address, projectId)
    : await fromRpc(cfg, address, projectId);
  // Logs arrive oldest-first; a stable sort by time keeps in-block log order.
  return events.sort((a, b) => a.timestamp - b.timestamp);
}
