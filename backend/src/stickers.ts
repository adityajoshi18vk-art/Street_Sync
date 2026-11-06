/**
 * stickers.ts
 * Gamification engine for StreetSync: collectible stickers + XP levels.
 *
 * Stickers are computed lazily from indexed on-chain activity (bounties,
 * pledges, vote reveals, slashes) and persisted to the `stickers` table the
 * first time a wallet qualifies, so `awarded_at` is stable across requests.
 */

import dbAccess from "./db.js";

export type StickerTier = "bronze" | "silver" | "gold";

export type WalletStats = ReturnType<typeof dbAccess.getWalletStats>;

export interface StickerDef {
  id: string;
  name: string;
  emoji: string;
  description: string;
  tier: StickerTier;
  xp: number;
  /** Target value and current progress extractor against wallet stats. */
  target: number;
  progress: (s: WalletStats) => number;
}

// Whole-USDC helper (amounts are stored as 6-decimal base-unit strings)
const usdc = (raw: string) => Math.floor(Number(raw) / 1_000_000);

export const STICKER_CATALOG: StickerDef[] = [
  {
    id: "first-spark", name: "First Spark", emoji: "🔥", tier: "bronze", xp: 30,
    description: "Create your first bounty and put a problem on the map.",
    target: 1, progress: (s) => s.bountiesCreated,
  },
  {
    id: "city-planner", name: "City Planner", emoji: "🏗️", tier: "silver", xp: 75,
    description: "Create 5 bounties for your neighborhood.",
    target: 5, progress: (s) => s.bountiesCreated,
  },
  {
    id: "block-backer", name: "Block Backer", emoji: "🤝", tier: "bronze", xp: 40,
    description: "Pledge USDC to 3 different bounties.",
    target: 3, progress: (s) => s.pledgedBounties,
  },
  {
    id: "treasurer", name: "Neighborhood Treasurer", emoji: "💰", tier: "gold", xp: 120,
    description: "Pledge 100 USDC in total toward civic repairs.",
    target: 100, progress: (s) => usdc(s.pledgedTotal),
  },
  {
    id: "proof-positive", name: "Proof Positive", emoji: "📸", tier: "bronze", xp: 40,
    description: "Submit your first compressed evidence bundle to Arkiv.",
    target: 1, progress: (s) => s.evidenceSubmitted,
  },
  {
    id: "street-surgeon", name: "Street Surgeon", emoji: "🛠️", tier: "silver", xp: 100,
    description: "Get your first fix approved by community consensus.",
    target: 1, progress: (s) => s.approvedFixes,
  },
  {
    id: "pothole-slayer", name: "Pothole Slayer", emoji: "🦾", tier: "gold", xp: 200,
    description: "Complete 5 community-approved fixes.",
    target: 5, progress: (s) => s.approvedFixes,
  },
  {
    id: "sharp-eye", name: "Sharp Eye", emoji: "👁️", tier: "bronze", xp: 40,
    description: "Reveal your first review vote as a panel reviewer.",
    target: 1, progress: (s) => s.votesRevealed,
  },
  {
    id: "consensus-keeper", name: "Consensus Keeper", emoji: "⚖️", tier: "silver", xp: 100,
    description: "Reveal 10 review votes and keep settlements moving.",
    target: 10, progress: (s) => s.votesRevealed,
  },
  {
    id: "clean-record", name: "Clean Record", emoji: "🛡️", tier: "gold", xp: 150,
    description: "Reveal 5 votes without ever being slashed.",
    target: 5, progress: (s) => (s.slashes === 0 ? s.votesRevealed : 0),
  },
];

export const LEVELS = [
  { title: "Newcomer", minXp: 0 },
  { title: "Neighbor", minXp: 50 },
  { title: "Block Builder", minXp: 150 },
  { title: "Street Hero", minXp: 400 },
  { title: "Civic Champion", minXp: 800 },
  { title: "Legend of the Ward", minXp: 1500 },
];

// XP earned per on-chain action, independent of sticker bonuses
function actionXp(s: WalletStats): number {
  return (
    s.bountiesCreated * 25 +
    s.pledgedBounties * 10 +
    s.evidenceSubmitted * 40 +
    s.approvedFixes * 100 +
    s.votesRevealed * 20
  );
}

export interface StickerStatus {
  id: string;
  name: string;
  emoji: string;
  description: string;
  tier: StickerTier;
  xp: number;
  target: number;
  progress: number;
  earned: boolean;
  awardedAt: number | null;
}

export interface StickerProfile {
  address: string;
  stats: WalletStats;
  xp: number;
  level: {
    index: number;
    title: string;
    minXp: number;
    nextXp: number | null;
  };
  earnedCount: number;
  totalCount: number;
  stickers: StickerStatus[];
}

export function computeStickerProfile(address: string): StickerProfile {
  const wallet = address.toLowerCase();
  const stats = dbAccess.getWalletStats(wallet);

  // Award any newly-qualified stickers (INSERT OR IGNORE keeps awarded_at stable)
  for (const def of STICKER_CATALOG) {
    if (def.progress(stats) >= def.target) {
      dbAccess.awardSticker(wallet, def.id);
    }
  }

  const earnedRows = dbAccess.getEarnedStickers(wallet);
  const earnedMap = new Map(earnedRows.map((r) => [r.sticker_id, r.awarded_at]));

  const stickers: StickerStatus[] = STICKER_CATALOG.map((def) => {
    const awardedAt = earnedMap.get(def.id) ?? null;
    return {
      id: def.id,
      name: def.name,
      emoji: def.emoji,
      description: def.description,
      tier: def.tier,
      xp: def.xp,
      target: def.target,
      progress: Math.min(def.progress(stats), def.target),
      earned: awardedAt !== null,
      awardedAt,
    };
  });

  const stickerXp = stickers.reduce((sum, s) => sum + (s.earned ? s.xp : 0), 0);
  const xp = actionXp(stats) + stickerXp;

  let levelIndex = 0;
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (xp >= LEVELS[i].minXp) {
      levelIndex = i;
      break;
    }
  }

  return {
    address: wallet,
    stats,
    xp,
    level: {
      index: levelIndex,
      title: LEVELS[levelIndex].title,
      minXp: LEVELS[levelIndex].minXp,
      nextXp: LEVELS[levelIndex + 1]?.minXp ?? null,
    },
    earnedCount: stickers.filter((s) => s.earned).length,
    totalCount: stickers.length,
    stickers,
  };
}

export default { STICKER_CATALOG, LEVELS, computeStickerProfile };
