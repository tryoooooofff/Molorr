// Shared game definitions used by BOTH the authoritative server and the client.
// Keep this file dependency-free so it can run in node and in the browser.

export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;

export const SLOT_COUNT = 8;
/**
 * Size of the secondary (backup) hotbar row. It mirrors the main row 1:1 so
 * every main slot has exactly one partner it can be swapped with, both
 * individually (number keys) and all at once (R).
 */
export const SECONDARY_SLOT_COUNT = SLOT_COUNT;
/**
 * Total number of addressable hotbar cells: the main row first, then the
 * secondary row. Bag cells start right after this block, so a single flat
 * index can address any cell in the game (hotbar + bag) in one number.
 */
export const HOTBAR_CELLS = SLOT_COUNT + SECONDARY_SLOT_COUNT;
/**
 * Starting size of the bag. The bag is *unlimited*: it grows on demand whenever
 * a new item/rarity stack needs a home, so a mob that drops 2-3 items at once can
 * never have part of its loot silently rejected. This constant only decides how
 * many empty cells a fresh player begins with (and the minimum the UI reserves).
 */
export const BAG_COUNT = 32;
/**
 * Hard ceiling on bag cells. It exists purely so a malicious/corrupt save can't
 * make the server allocate forever; it is far above what real play can reach
 * (distinct item x rarity combinations number in the low hundreds).
 */
export const BAG_MAX = 4096;
export const TOTAL_CELLS = HOTBAR_CELLS + BAG_MAX;

/** True when a flat cell index addresses a main (petal-equipping) hotbar slot. */
export function isMainCell(idx: number): boolean {
  return idx >= 0 && idx < SLOT_COUNT;
}

/** True when a flat cell index addresses a secondary (backup) hotbar slot. */
export function isSecondaryCell(idx: number): boolean {
  return idx >= SLOT_COUNT && idx < HOTBAR_CELLS;
}

/** True when a flat cell index addresses either hotbar row. */
export function isHotbarCell(idx: number): boolean {
  return idx >= 0 && idx < HOTBAR_CELLS;
}

/** True when a flat cell index addresses a bag cell. */
export function isBagCell(idx: number): boolean {
  return idx >= HOTBAR_CELLS && idx < TOTAL_CELLS;
}

/** Flat cell index of secondary slot `i`. */
export function secondaryCellIndex(i: number): number {
  return SLOT_COUNT + i;
}

/** Flat cell index of bag cell `i`. */
export function bagCellIndex(i: number): number {
  return HOTBAR_CELLS + i;
}

function rgb([r, g, b]: readonly [number, number, number]): string {
  return `rgb(${r},${g},${b})`;
}

export interface RarityDef {
  name: string;
  /** Fill color used for cards/UI. */
  color: string;
  /** Darker border/outline color for cards. */
  border: string;
  /** Multiplier applied to petal damage/health at this rarity. */
  mult: number;
  /** Multiplier applied to wild mob health at this rarity. */
  enemyMult: number;
  /** Chance [0-1] that ONE craft attempt from this rarity succeeds. Absent = not craftable further. */
  craftChance?: number;
}

// Full 11-tier rarity ladder. Colors/multipliers below match the reference
// RARITY_COLORS / BORDER_COLORS / RARITY_MULTIPLIERS / ENEMY_HEALTH_MULTIPLIERS /
// CRAFT_PROBABILITIES tables (ordered low -> high rarity here).
export const RARITIES: RarityDef[] = [
  { name: "Common", color: rgb([102, 192, 87]), border: rgb([73, 138, 62]), mult: 1, enemyMult: 1, craftChance: 0.64 },
  { name: "Unusual", color: rgb([204, 184, 74]), border: rgb([147, 133, 54]), mult: 3, enemyMult: 3.75, craftChance: 0.32 },
  { name: "Rare", color: rgb([62, 66, 182]), border: rgb([44, 47, 131]), mult: 9, enemyMult: 13.5, craftChance: 0.16 },
  { name: "Epic", color: rgb([107, 25, 178]), border: rgb([77, 18, 128]), mult: 27, enemyMult: 54, craftChance: 0.08 },
  { name: "Legendary", color: rgb([178, 26, 25]), border: rgb([128, 19, 18]), mult: 81, enemyMult: 405, craftChance: 0.04 },
  { name: "Mythic", color: rgb([26, 175, 178]), border: rgb([20, 126, 127]), mult: 243, enemyMult: 2430, craftChance: 0.02 },
  { name: "Ultra", color: rgb([209, 71, 98]), border: rgb([148, 26, 67]), mult: 729, enemyMult: 24500, craftChance: 0.01 },
  { name: "Super", color: rgb([34, 204, 130]), border: rgb([25, 148, 94]), mult: 2187, enemyMult: 177800, craftChance: 0.005 },
  { name: "Omega", color: rgb([195, 33, 174]), border: rgb([141, 24, 126]), mult: 19683, enemyMult: 510510, craftChance: 0.0005 },
  { name: "Eternal", color: rgb([220, 220, 220]), border: rgb([112, 112, 112]), mult: 31415, enemyMult: 5059830 },
  { name: "Unique", color: rgb([50, 50, 50]), border: rgb([12, 12, 12]), mult: 30000, enemyMult: 3059830 },
];

/** Number of identical cards consumed by one normal craft attempt. */
export const CRAFT_CARD_COUNT = 5;
/**
 * Number of cards consumed per craft attempt when doing batch crafts
 * (the new unlimited-craft system). Calculated as totalCards / this ratio.
 */
export const CRAFT_CARDS_PER_ATTEMPT = 3.5;
/** Highest rarity index that can ever be stored/displayed. */
export const MAX_RARITY = RARITIES.length - 1;
/** Highest rarity reachable through the normal 5-combine crafting ladder (Eternal). Unique sits outside it. */
export const MAX_CRAFT_RARITY = RARITIES.length - 2;

/**
 * Visual and collision-size multiplier for mobs at each rarity, in rarity
 * order. Unique is outside the normal ladder, so it uses the Eternal cap.
 */
export const MOB_SIZE_MULTIPLIERS: readonly number[] = [
  1,   // Common
  1.2, // Unusual
  1.5, // Rare
  2,   // Epic
  2.6, // Legendary
  3.5, // Mythic
  5,   // Ultra
  6,   // Super
  8,   // Omega
  10,  // Eternal
  10,  // Unique (uses the Eternal cap)
];

export const FRIENDLY_MOB_SIZE_MULTIPLIERS: readonly number[] = [
  1,   // Common
  1.1, // Unusual
  1.2, // Rare
  1.4, // Epic
  1.8, // Legendary
  2.5, // Mythic
  3.8, // Ultra
  5,   // Super
  6.5, // Omega
  8,   // Eternal
  8,   // Unique
];

/** Returns the mob-size multiplier for a rarity index. */
export function mobSizeMult(rarity: number): number {
  const index = Math.max(0, Math.min(MOB_SIZE_MULTIPLIERS.length - 1, Math.floor(rarity)));
  return MOB_SIZE_MULTIPLIERS[index];
}

/** Returns the friendly mob-size multiplier for a rarity index. */
export function friendlyMobSizeMult(rarity: number): number {
  const index = Math.max(0, Math.min(FRIENDLY_MOB_SIZE_MULTIPLIERS.length - 1, Math.floor(rarity)));
  return FRIENDLY_MOB_SIZE_MULTIPLIERS[index];
}

/**
 * Wild mob drops never roll above this rarity. With the block zone system
 * allowing mobs up to Omega (zone G), the cap is raised so high-zone mobs
 * actually drop items at their appropriate tier instead of being silently
 * clamped to Legendary.
 */
export const MAX_WILD_DROP_RARITY = 8;

/**
 * Oracle converts cards to exactly the next rarity in one guaranteed
 * (non-random) conversion (for example, Common → Unusual).
 */
export const ORACLE_SKIP = 1;
/** Hours between allowed Oracle uses, per player. */
export const ORACLE_COOLDOWN_HOURS = 2;
/** Hours between allowed Trade uses, per player. */
export const TRADE_COOLDOWN_HOURS = 3;

/**
 * Cards of `rarity` required for a guaranteed Oracle upgrade to
 * `rarity + ORACLE_SKIP`. Returns undefined when the next tier would be past
 * the craft ladder.
 */
export function oracleRequiredCount(rarity: number): number | undefined {
  if (rarity < 0 || rarity + ORACLE_SKIP > MAX_CRAFT_RARITY) return undefined;
  return 15 + rarity * 5;
}


/**
 * "dna" is reserved: no DNA item ships in ITEMS yet, but the summon rarity
 * roll (see `getSummonRarityWithDna` in sim.ts) already understands them, so
 * adding one here is all that's needed to turn the mechanic on.
 */
export type ItemKind = "petal" | "summon" | "trinket" | "dna";

/**
 * Kinds that orbit the player in a hotbar slot and can be broken/reloaded.
 * Trinkets are inert cargo; everything else spins around the flower — summons
 * included, since they sit in the ring whenever they aren't reloading.
 */
export function orbitsAsPetal(kind: ItemKind): boolean {
  return kind !== "trinket";
}

export interface ItemDef {
  id: number;
  name: string;
  kind: ItemKind;
  color: string;
  outline: string;
  shape: "circle" | "square" | "leaf" | "triangle" | "egg" | "stick" | "star";
  radius: number;
  damage: number;
  health: number;
  reload: number; // seconds
  heal?: number; // hp per second while alive
  speed?: number; // % move speed bonus
  petMob?: number; // mob type spawned when this is a summon
  /**
   * Fallback drop-rarity bias in the (0, 1] range (1.0 = neutral) used only
   * when a caller does not pass the drop entry's own `chance`. Lower values
   * skew toward lower rarities and disable "Super"-tier rolls for normal
   * mobs. Default is 0.8 if unset.
   */
  dropFactor?: number;
  /**
   * Summons only. When true the hatched mob keeps the egg's own rarity instead
   * of being mapped one tier down by `mapRarityToSummonRarity`.
   */
  noDowngrade?: boolean;
  desc: string;
}

export const ITEMS: ItemDef[] = [
  { id: 0, name: "Basic", kind: "petal", color: "#ffffff", outline: "#cfcfcf", shape: "circle", radius: 8, damage: 10, health: 12, reload: 1.0, dropFactor: 1.0, desc: "A nice and simple petal." },
  { id: 1, name: "Leaf", kind: "petal", color: "#39b54a", outline: "#2b8a38", shape: "leaf", radius: 9, damage: 8, health: 14, reload: 1.0, heal: 2.5, dropFactor: 0.7, desc: "Heals you slowly over time." },
  { id: 2, name: "Stinger", kind: "petal", color: "#333333", outline: "#111111", shape: "triangle", radius: 6, damage: 38, health: 4, reload: 1.6, dropFactor: 0.6, desc: "Hurts a lot, breaks fast." },
  { id: 3, name: "Rock", kind: "petal", color: "#8d8d8d", outline: "#6a6a6a", shape: "square", radius: 10, damage: 8, health: 55, reload: 2.2, dropFactor: 0.7, desc: "Heavy and very sturdy." },
  { id: 4, name: "Sand", kind: "petal", color: "#e0c068", outline: "#b89b45", shape: "circle", radius: 7, damage: 14, health: 16, reload: 1.2, dropFactor: 0.65, desc: "Gritty desert clump." },
  { id: 5, name: "Bubble", kind: "petal", color: "#bfe9ff", outline: "#84c9ee", shape: "circle", radius: 10, damage: 3, health: 3, reload: 2.6, speed: 9, dropFactor: 0.8, desc: "Makes you swim faster." },
  { id: 6, name: "Pearl", kind: "petal", color: "#eafaff", outline: "#a8d8e8", shape: "circle", radius: 8, damage: 24, health: 12, reload: 1.4, dropFactor: 0.65, desc: "Shiny treasure of the sea." },
  { id: 7, name: "Wing", kind: "petal", color: "#f3f3ff", outline: "#c3c3e0", shape: "triangle", radius: 9, damage: 14, health: 9, reload: 1.1, speed: 5, dropFactor: 0.7, desc: "Flaps around, light and quick." },
  // Generic "Egg" replaced by the specific Ladybug Egg; same id so the new
  // player's starting kit (`p.bag[0] = { item: 8, ... }`) keeps working.
  { id: 8, name: "Ladybug Egg", kind: "summon", color: "#fff1cf", outline: "#e0c48a", shape: "egg", radius: 10, damage: 4, health: 20, reload: 3.0, petMob: 0, dropFactor: 0.6, desc: "Hatches a friendly ladybug." },
  { id: 9, name: "Stick", kind: "summon", color: "#a97442", outline: "#7d5228", shape: "stick", radius: 10, damage: 6, health: 22, reload: 4.0, petMob: 11, dropFactor: 0.6, desc: "Summons a swirling sandstorm to fight for you." },
  { id: 10, name: "Coin", kind: "trinket", color: "#ffd54a", outline: "#c79a1e", shape: "circle", radius: 7, damage: 0, health: 0, reload: 0, dropFactor: 1.0, desc: "A shiny coin. Worth trading, worth nothing in a fight." },
  // ── Soldier Ant drops ────────────────────────────────────────────────────
  { id: 11, name: "Clover", kind: "petal", color: "#4e9a52", outline: "#2d6833", shape: "circle", radius: 8, damage: 6, health: 10, reload: 1.0, dropFactor: 0.55, desc: "A lucky four-leaf clover." },
  { id: 12, name: "Soldier Ant Egg", kind: "summon", color: "#7a4a25", outline: "#4a2c14", shape: "egg", radius: 10, damage: 5, health: 24, reload: 3.5, petMob: 3, dropFactor: 0.55, desc: "Hatches a soldier ant." },
  // ── Worker Ant drops ────────────────────────────────────────────────────
  { id: 13, name: "Corn", kind: "petal", color: "#eade45", outline: "#a2901c", shape: "circle", radius: 8, damage: 9, health: 13, reload: 1.1, dropFactor: 0.65, desc: "A golden ear of corn." },
  { id: 14, name: "Worker Ant Egg", kind: "summon", color: "#a97442", outline: "#5d3c1f", shape: "egg", radius: 10, damage: 4, health: 18, reload: 3.2, petMob: 10, dropFactor: 0.55, desc: "Hatches a worker ant." },
  // ── Rock drops ──────────────────────────────────────────────────────────
  { id: 15, name: "Rock Egg", kind: "summon", color: "#a8a8a8", outline: "#5f5f5f", shape: "egg", radius: 11, damage: 5, health: 40, reload: 4.5, petMob: 2, dropFactor: 0.55, desc: "Hatches a tiny rolling rock." },
  { id: 16, name: "Heavy", kind: "petal", color: "#5b5048", outline: "#2e2620", shape: "square", radius: 11, damage: 6, health: 80, reload: 2.8, dropFactor: 0.6, desc: "Anchors you to the ground." },
  { id: 17, name: "Moon", kind: "petal", color: "#e8e8f0", outline: "#9a9aa8", shape: "circle", radius: 9, damage: 12, health: 18, reload: 1.3, dropFactor: 0.002, desc: "A pale sliver of moon. Almost never seen." },
  // ── Bee drops ───────────────────────────────────────────────────────────
  { id: 18, name: "Pollen", kind: "petal", color: "#f7e26b", outline: "#b59b1e", shape: "circle", radius: 7, damage: 7, health: 11, reload: 1.0, dropFactor: 0.7, desc: "A pinch of golden pollen." },
  { id: 19, name: "Honey", kind: "petal", color: "#e89a18", outline: "#9a5e08", shape: "circle", radius: 8, damage: 5, health: 14, reload: 1.0, heal: 3.0, dropFactor: 0.7, desc: "Sticky, sweet, and soothing." },
  { id: 20, name: "Bee Egg", kind: "summon", color: "#fff0a8", outline: "#b59a1e", shape: "egg", radius: 10, damage: 5, health: 22, reload: 3.4, petMob: 1, dropFactor: 0.55, desc: "Hatches a buzzing bee." },
  // ── Starfish drops ──────────────────────────────────────────────────────
  { id: 21, name: "Starfish", kind: "petal", color: "#f2799e", outline: "#bc4c72", shape: "star", radius: 10, damage: 11, health: 15, reload: 1.2, dropFactor: 0.65, desc: "A star from the seafloor." },
  { id: 22, name: "Salt", kind: "petal", color: "#ffffff", outline: "#c4c4c4", shape: "circle", radius: 7, damage: 10, health: 9, reload: 1.0, dropFactor: 0.6, desc: "Crystalline sea salt." },
  { id: 23, name: "Starfish Egg", kind: "summon", color: "#f8b6c8", outline: "#bc4c72", shape: "egg", radius: 10, damage: 4, health: 24, reload: 3.6, petMob: 9, dropFactor: 0.55, desc: "Hatches a starfish." },
  // ── Jellyfish drops ─────────────────────────────────────────────────────
  { id: 24, name: "Jelly", kind: "petal", color: "#d3a0ec", outline: "#7d40a8", shape: "circle", radius: 8, damage: 8, health: 12, reload: 1.1, dropFactor: 0.7, desc: "Wobbles gelatinously." },
  { id: 25, name: "Lightning", kind: "petal", color: "#53E5E8", outline: "#4ADEDE", shape: "star", radius: 7, damage: 30, health: 6, reload: 1.4, dropFactor: 0.6, desc: "Zaps hard, fades fast." },
  { id: 26, name: "Jellyfish Egg", kind: "summon", color: "#cfb0ec", outline: "#7d40a8", shape: "egg", radius: 10, damage: 5, health: 20, reload: 3.5, petMob: 7, dropFactor: 0.55, desc: "Hatches a jellyfish." },
  // ── Crab drops ──────────────────────────────────────────────────────────
  { id: 27, name: "Claw", kind: "petal", color: "#ef7d3b", outline: "#7a3008", shape: "triangle", radius: 8, damage: 22, health: 12, reload: 1.4, dropFactor: 0.6, desc: "Snippy little claw." },
  { id: 28, name: "Powder", kind: "petal", color: "#e6dcc4", outline: "#a89c80", shape: "circle", radius: 7, damage: 9, health: 11, reload: 1.0, dropFactor: 0.65, desc: "A puff of fine powder." },
  { id: 29, name: "Crab Egg", kind: "summon", color: "#f5a06b", outline: "#b2541f", shape: "egg", radius: 10, damage: 6, health: 26, reload: 3.8, petMob: 8, dropFactor: 0.55, desc: "Hatches a crab." },
  // ── Ladybug drops ───────────────────────────────────────────────────────
  { id: 30, name: "Rose", kind: "petal", color: "#d6354a", outline: "#8a1f2c", shape: "circle", radius: 8, damage: 9, health: 12, reload: 1.1, dropFactor: 0.7, desc: "A perfect red rose." },
  { id: 31, name: "Light", kind: "petal", color: "#fff3a8", outline: "#c79a1e", shape: "circle", radius: 8, damage: 6, health: 10, reload: 1.0, dropFactor: 0.85, desc: "A warm mote of light." },
  // Ladybug Egg = id 8 (defined above in the starting kit slot).
  // ── Sandstorm drops (desert) ─────────────────────────────────────────────
  // Stick (id 9) and Sand (id 4) are reused from the existing item list.
  { id: 32, name: "Glass", kind: "petal", color: "#c8e6f5", outline: "#6f9bb0", shape: "square", radius: 8, damage: 12, health: 8, reload: 1.2, dropFactor: 0.55, desc: "A sharp shard of glass." },
  // ── Beetle drops ────────────────────────────────────────────────────────
  { id: 33, name: "Bone", kind: "petal", color: "#ece4d0", outline: "#9a8a6a", shape: "square", radius: 9, damage: 14, health: 18, reload: 1.3, dropFactor: 0.6, desc: "A bleached bone chip." },
  { id: 34, name: "Beetle Egg", kind: "summon", color: "#e3c490", outline: "#9c7532", shape: "egg", radius: 11, damage: 6, health: 28, reload: 3.8, petMob: 6, dropFactor: 0.55, desc: "Hatches a beetle." },
  // ── Shared (Beetle / Scorpion) and Scorpion drops ──────────────────────
  { id: 35, name: "Pincer", kind: "petal", color: "#8a4a18", outline: "#3e1e08", shape: "triangle", radius: 8, damage: 20, health: 11, reload: 1.4, dropFactor: 0.6, desc: "A wicked little pincer." },
  { id: 36, name: "Iris", kind: "petal", color: "#5b3aa0", outline: "#2c1a5e", shape: "circle", radius: 8, damage: 10, health: 12, reload: 1.1, dropFactor: 0.6, desc: "A deep-purple iris." },
  { id: 37, name: "Scorpion Egg", kind: "summon", color: "#d9924a", outline: "#8c4718", shape: "egg", radius: 10, damage: 7, health: 26, reload: 3.7, petMob: 5, dropFactor: 0.55, desc: "Hatches a scorpion." },
];

/** Item ids that Oracle/Trade may hand back — never dropped by mobs, never craftable by combining. */
export const TRINKET_ITEM = 10;

export interface MobDef {
  id: number;
  name: string;
  color: string;
  outline: string;
  shape: "bug" | "rock" | "cactus" | "jelly" | "crab" | "star" | "ant" | "wasp";
  radius: number;
  health: number;
  damage: number;
  speed: number;
  xp: number;
  /**
   * Loot table. Every entry drops on every kill; `chance` is NOT a gate on
   * whether the card appears. It is the drop-rarity bias for that entry — a
   * low value pushes the roll toward the floor of the mob's rarity row, a
   * value near 1 leaves the row's own odds intact. See `getDropRarityByItem`.
   */
  drops: { item: number; chance: number }[];
}

export const MOBS: MobDef[] = [
  { id: 0, name: "Ladybug", color: "#eb4034", outline: "#a82a20", shape: "bug", radius: 22, health: 60, damage: 18, speed: 42, xp: 10, drops: [{ item: 30, chance: 0.32 }, { item: 31, chance: 0.28 }, { item: 8, chance: 0.07 }] },
  { id: 1, name: "Bee", color: "#f5d442", outline: "#c2a41e", shape: "wasp", radius: 18, health: 48, damage: 32, speed: 62, xp: 14, drops: [{ item: 2, chance: 0.3 }, { item: 18, chance: 0.24 }, { item: 19, chance: 0.22 }, { item: 20, chance: 0.06 }] },
  { id: 2, name: "Rock", color: "#8d8d8d", outline: "#5f5f5f", shape: "rock", radius: 26, health: 130, damage: 10, speed: 0, xp: 12, drops: [{ item: 15, chance: 0.32 }, { item: 3, chance: 0.32 }, { item: 16, chance: 0.22 }, { item: 17, chance: 0.005 }] },
  // The old generic "Ant" was replaced with Soldier Ant; Worker Ant is a
  // brand new mob added to the Garden biome (id 10 below).
  { id: 3, name: "Soldier Ant", color: "#5b452c", outline: "#3a2b19", shape: "ant", radius: 17, health: 46, damage: 18, speed: 60, xp: 9, drops: [{ item: 7, chance: 0.28 }, { item: 11, chance: 0.3 }, { item: 12, chance: 0.07 }] },
  { id: 4, name: "Cactus", color: "#4caf50", outline: "#357a38", shape: "cactus", radius: 25, health: 110, damage: 26, speed: 0, xp: 18, drops: [{ item: 9, chance: 0.12 }, { item: 3, chance: 0.25 }, { item: 4, chance: 0.3 }] },
  { id: 5, name: "Scorpion", color: "#c76b2a", outline: "#8c4718", shape: "crab", radius: 21, health: 90, damage: 36, speed: 70, xp: 24, drops: [{ item: 36, chance: 0.32 }, { item: 37, chance: 0.28 }, { item: 35, chance: 0.07 }] },
  { id: 6, name: "Beetle", color: "#d1a054", outline: "#9c7532", shape: "bug", radius: 23, health: 100, damage: 24, speed: 48, xp: 20, drops: [{ item: 33, chance: 0.32 }, { item: 35, chance: 0.28 }, { item: 36, chance: 0.1 }] },
  { id: 7, name: "Jellyfish", color: "#b06be0", outline: "#7d40a8", shape: "jelly", radius: 22, health: 78, damage: 28, speed: 38, xp: 20, drops: [{ item: 24, chance: 0.32 }, { item: 25, chance: 0.26 }, { item: 26, chance: 0.07 }] },
  { id: 8, name: "Crab", color: "#ef7d3b", outline: "#b2541f", shape: "crab", radius: 24, health: 120, damage: 32, speed: 44, xp: 26, drops: [{ item: 27, chance: 0.3 }, { item: 28, chance: 0.28 }, { item: 29, chance: 0.07 }, { item: 4, chance: 0.2 }] },
  { id: 9, name: "Starfish", color: "#f2799e", outline: "#bc4c72", shape: "star", radius: 20, health: 95, damage: 18, speed: 36, xp: 18, drops: [{ item: 21, chance: 0.3 }, { item: 22, chance: 0.28 }, { item: 4, chance: 0.22 }, { item: 23, chance: 0.07 }] },
  { id: 10, name: "Worker Ant", color: "#8a6a3c", outline: "#5d4528", shape: "ant", radius: 14, health: 32, damage: 10, speed: 68, xp: 6, drops: [{ item: 1, chance: 0.3 }, { item: 13, chance: 0.3 }, { item: 14, chance: 0.07 }] },
  // Sandstorm: a new desert hazard mob. It reuses the cactus "shape" placeholder
  // until the user finishes its detailed art.
  { id: 11, name: "Sandstorm", color: "#d4b878", outline: "#8a6a3c", shape: "cactus", radius: 28, health: 150, damage: 22, speed: 24, xp: 22, drops: [{ item: 9, chance: 0.18 }, { item: 4, chance: 0.3 }, { item: 32, chance: 0.2 }] },
];

export interface Wall {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapDef {
  id: number;
  name: string;
  bg: string;
  grid: string;
  accent: string;
  width: number;
  height: number;
  mobs: number[];
  mobCap: number;
  rarityBias: number; // extra chance for higher rarity drops
  walls: Wall[];
}

export const MAPS: MapDef[] = [
  {
    id: 0,
    name: "Garden",
    bg: "#1eae63",
    grid: "#1a9c58",
    accent: "#ffe27a",
    width: 8000,
    height: 8000,
    mobs: [0, 1, 2, 3, 10],
    mobCap: 50,
    rarityBias: 0,
    walls: [
      { x: 0, y: 0, w: 8000, h: 400 },
      { x: 0, y: 400, w: 400, h: 7600 },
      { x: 1000, y: 400, w: 1400, h: 200 },
      { x: 2800, y: 400, w: 800, h: 400 },
      { x: 4000, y: 400, w: 1000, h: 200 },
      { x: 5400, y: 400, w: 1200, h: 200 },
      { x: 7400, y: 400, w: 600, h: 800 },
      { x: 1400, y: 600, w: 1200, h: 200 },
      { x: 4200, y: 600, w: 800, h: 200 },
      { x: 5200, y: 600, w: 1000, h: 200 },
      { x: 7200, y: 600, w: 200, h: 800 },
      { x: 400, y: 800, w: 400, h: 1000 },
      { x: 3000, y: 800, w: 800, h: 200 },
      { x: 4200, y: 800, w: 600, h: 200 },
      { x: 5200, y: 800, w: 400, h: 200 },
      { x: 6800, y: 800, w: 400, h: 600 },
      { x: 3400, y: 1000, w: 400, h: 200 },
      { x: 4200, y: 1000, w: 400, h: 200 },
      { x: 6600, y: 1000, w: 200, h: 400 },
      { x: 800, y: 1200, w: 200, h: 200 },
      { x: 3600, y: 1200, w: 400, h: 200 },
      { x: 7600, y: 1200, w: 400, h: 6800 },
      { x: 1800, y: 1400, w: 1200, h: 400 },
      { x: 5000, y: 1400, w: 600, h: 1400 },
      { x: 1600, y: 1600, w: 200, h: 5000 },
      { x: 3000, y: 1600, w: 400, h: 1000 },
      { x: 4800, y: 1600, w: 200, h: 1600 },
      { x: 5600, y: 1600, w: 400, h: 1200 },
      { x: 7400, y: 1600, w: 200, h: 5200 },
      { x: 400, y: 1800, w: 200, h: 600 },
      { x: 1400, y: 1800, w: 200, h: 2600 },
      { x: 1800, y: 1800, w: 800, h: 200 },
      { x: 2800, y: 1800, w: 200, h: 200 },
      { x: 4600, y: 1800, w: 200, h: 400 },
      { x: 6000, y: 1800, w: 200, h: 1200 },
      { x: 7200, y: 1800, w: 200, h: 1800 },
      { x: 1200, y: 2000, w: 200, h: 600 },
      { x: 1800, y: 2000, w: 400, h: 200 },
      { x: 6200, y: 2000, w: 200, h: 1800 },
      { x: 3400, y: 2200, w: 200, h: 1400 },
      { x: 3800, y: 2400, w: 200, h: 200 },
      { x: 6400, y: 2400, w: 200, h: 3800 },
      { x: 3200, y: 2600, w: 200, h: 2400 },
      { x: 4400, y: 2600, w: 400, h: 2400 },
      { x: 800, y: 2800, w: 200, h: 600 },
      { x: 4200, y: 2800, w: 200, h: 800 },
      { x: 5000, y: 2800, w: 200, h: 200 },
      { x: 5800, y: 2800, w: 200, h: 200 },
      { x: 1800, y: 3000, w: 200, h: 3400 },
      { x: 3000, y: 3000, w: 200, h: 2200 },
      { x: 4000, y: 3000, w: 200, h: 600 },
      { x: 2000, y: 3200, w: 200, h: 400 },
      { x: 2600, y: 3200, w: 400, h: 800 },
      { x: 5400, y: 3200, w: 200, h: 3400 },
      { x: 400, y: 3400, w: 200, h: 400 },
      { x: 5600, y: 3400, w: 200, h: 2000 },
      { x: 6600, y: 3400, w: 200, h: 2800 },
      { x: 4800, y: 3600, w: 200, h: 1000 },
      { x: 1000, y: 3800, w: 200, h: 400 },
      { x: 600, y: 4000, w: 200, h: 600 },
      { x: 2000, y: 4000, w: 200, h: 2400 },
      { x: 2800, y: 4000, w: 200, h: 800 },
      { x: 3400, y: 4200, w: 200, h: 1000 },
      { x: 4200, y: 4200, w: 200, h: 1000 },
      { x: 6200, y: 4200, w: 200, h: 400 },
      { x: 2200, y: 4400, w: 200, h: 1800 },
      { x: 3600, y: 4400, w: 600, h: 1000 },
      { x: 1200, y: 4600, w: 200, h: 400 },
      { x: 400, y: 4800, w: 400, h: 200 },
      { x: 6200, y: 4800, w: 200, h: 400 },
      { x: 400, y: 5000, w: 200, h: 200 },
      { x: 4400, y: 5000, w: 200, h: 200 },
      { x: 5200, y: 5000, w: 200, h: 1600 },
      { x: 1400, y: 5200, w: 200, h: 1400 },
      { x: 6800, y: 5200, w: 200, h: 400 },
      { x: 600, y: 5400, w: 200, h: 400 },
      { x: 1200, y: 5400, w: 200, h: 1400 },
      { x: 3600, y: 5400, w: 200, h: 200 },
      { x: 4800, y: 5400, w: 400, h: 1400 },
      { x: 400, y: 5600, w: 200, h: 600 },
      { x: 1000, y: 5600, w: 200, h: 1000 },
      { x: 3000, y: 5600, w: 200, h: 800 },
      { x: 4600, y: 5600, w: 200, h: 1200 },
      { x: 5600, y: 5600, w: 200, h: 200 },
      { x: 3200, y: 5800, w: 200, h: 800 },
      { x: 4400, y: 5800, w: 200, h: 800 },
      { x: 7200, y: 5800, w: 200, h: 600 },
      { x: 2800, y: 6000, w: 200, h: 600 },
      { x: 4000, y: 6000, w: 400, h: 600 },
      { x: 2600, y: 6200, w: 200, h: 600 },
      { x: 3400, y: 6200, w: 600, h: 400 },
      { x: 2400, y: 6400, w: 200, h: 400 },
      { x: 400, y: 6600, w: 200, h: 1400 },
      { x: 3600, y: 6600, w: 400, h: 200 },
      { x: 1800, y: 6800, w: 400, h: 400 },
      { x: 1600, y: 7000, w: 200, h: 200 },
      { x: 3000, y: 7000, w: 200, h: 400 },
      { x: 4000, y: 7000, w: 600, h: 200 },
      { x: 1800, y: 7200, w: 200, h: 200 },
      { x: 2800, y: 7200, w: 200, h: 200 },
      { x: 3200, y: 7200, w: 200, h: 200 },
      { x: 600, y: 7400, w: 200, h: 600 },
      { x: 4800, y: 7400, w: 600, h: 600 },
      { x: 7400, y: 7400, w: 200, h: 600 },
      { x: 800, y: 7600, w: 4000, h: 400 },
      { x: 5400, y: 7600, w: 2000, h: 400 },
    ],
  },
  {
    id: 1,
    name: "Desert",
    bg: "#e0bd75",
    grid: "#d4ae63",
    accent: "#fff3c4",
    width: 8000,
    height: 8000,
    mobs: [4, 5, 6, 2, 11],
    mobCap: 48,
    rarityBias: 0.12,
    walls: [
      { x: 0, y: 0, w: 8000, h: 400 },
      { x: 0, y: 400, w: 800, h: 200 },
      { x: 1800, y: 400, w: 400, h: 200 },
      { x: 2600, y: 400, w: 1000, h: 200 },
      { x: 4000, y: 400, w: 4000, h: 200 },
      { x: 0, y: 600, w: 400, h: 7400 },
      { x: 3200, y: 600, w: 200, h: 200 },
      { x: 4400, y: 600, w: 1200, h: 200 },
      { x: 6800, y: 600, w: 1200, h: 200 },
      { x: 4600, y: 800, w: 800, h: 200 },
      { x: 7200, y: 800, w: 800, h: 800 },
      { x: 400, y: 1000, w: 200, h: 2600 },
      { x: 2400, y: 1000, w: 400, h: 1800 },
      { x: 3600, y: 1000, w: 200, h: 1000 },
      { x: 4600, y: 1000, w: 200, h: 200 },
      { x: 6200, y: 1000, w: 200, h: 600 },
      { x: 600, y: 1200, w: 600, h: 1200 },
      { x: 1600, y: 1200, w: 400, h: 3200 },
      { x: 2200, y: 1200, w: 200, h: 3000 },
      { x: 3200, y: 1200, w: 400, h: 1000 },
      { x: 6400, y: 1200, w: 400, h: 800 },
      { x: 1200, y: 1400, w: 400, h: 1400 },
      { x: 2000, y: 1400, w: 200, h: 3000 },
      { x: 2800, y: 1400, w: 200, h: 1400 },
      { x: 3800, y: 1400, w: 400, h: 200 },
      { x: 5000, y: 1400, w: 600, h: 1000 },
      { x: 3000, y: 1600, w: 200, h: 1000 },
      { x: 3800, y: 1600, w: 200, h: 200 },
      { x: 4600, y: 1600, w: 400, h: 600 },
      { x: 5600, y: 1600, w: 200, h: 3200 },
      { x: 7400, y: 1600, w: 600, h: 800 },
      { x: 4400, y: 1800, w: 200, h: 400 },
      { x: 5800, y: 1800, w: 200, h: 2600 },
      { x: 6800, y: 1800, w: 200, h: 600 },
      { x: 6000, y: 2000, w: 200, h: 2200 },
      { x: 6600, y: 2000, w: 200, h: 200 },
      { x: 3200, y: 2200, w: 200, h: 400 },
      { x: 4800, y: 2200, w: 200, h: 200 },
      { x: 600, y: 2400, w: 200, h: 400 },
      { x: 5200, y: 2400, w: 400, h: 200 },
      { x: 6200, y: 2400, w: 200, h: 1800 },
      { x: 7600, y: 2400, w: 400, h: 5600 },
      { x: 5400, y: 2600, w: 200, h: 2400 },
      { x: 6400, y: 2600, w: 200, h: 1600 },
      { x: 1400, y: 2800, w: 200, h: 1600 },
      { x: 3800, y: 2800, w: 600, h: 600 },
      { x: 6600, y: 2800, w: 400, h: 1200 },
      { x: 1200, y: 3000, w: 200, h: 600 },
      { x: 3400, y: 3000, w: 400, h: 400 },
      { x: 4400, y: 3000, w: 200, h: 200 },
      { x: 7000, y: 3000, w: 200, h: 1200 },
      { x: 7200, y: 3200, w: 400, h: 1400 },
      { x: 2400, y: 3600, w: 400, h: 200 },
      { x: 5000, y: 3600, w: 400, h: 1600 },
      { x: 2400, y: 3800, w: 200, h: 400 },
      { x: 4400, y: 3800, w: 600, h: 1800 },
      { x: 400, y: 4000, w: 400, h: 1000 },
      { x: 3200, y: 4000, w: 600, h: 1000 },
      { x: 3000, y: 4200, w: 200, h: 2000 },
      { x: 4200, y: 4200, w: 200, h: 2000 },
      { x: 2800, y: 4600, w: 200, h: 3400 },
      { x: 7400, y: 4600, w: 200, h: 400 },
      { x: 2400, y: 4800, w: 400, h: 3200 },
      { x: 400, y: 5000, w: 200, h: 1800 },
      { x: 3200, y: 5000, w: 400, h: 200 },
      { x: 600, y: 5200, w: 200, h: 400 },
      { x: 2200, y: 5200, w: 200, h: 2800 },
      { x: 3200, y: 5200, w: 200, h: 400 },
      { x: 5000, y: 5200, w: 200, h: 200 },
      { x: 6600, y: 5200, w: 400, h: 800 },
      { x: 4000, y: 5400, w: 200, h: 1000 },
      { x: 6400, y: 5400, w: 200, h: 600 },
      { x: 2000, y: 5600, w: 200, h: 2400 },
      { x: 3800, y: 5600, w: 200, h: 600 },
      { x: 4400, y: 5600, w: 400, h: 200 },
      { x: 600, y: 5800, w: 200, h: 400 },
      { x: 3600, y: 5800, w: 200, h: 400 },
      { x: 4400, y: 5800, w: 200, h: 200 },
      { x: 1800, y: 6000, w: 200, h: 600 },
      { x: 5600, y: 6000, w: 200, h: 1000 },
      { x: 6600, y: 6000, w: 200, h: 200 },
      { x: 5400, y: 6200, w: 200, h: 800 },
      { x: 7400, y: 6200, w: 200, h: 1800 },
      { x: 3000, y: 6400, w: 200, h: 1600 },
      { x: 5000, y: 6400, w: 400, h: 400 },
      { x: 5800, y: 6400, w: 200, h: 600 },
      { x: 6000, y: 6600, w: 200, h: 400 },
      { x: 3200, y: 6800, w: 200, h: 1200 },
      { x: 7200, y: 6800, w: 200, h: 1200 },
      { x: 3400, y: 7000, w: 600, h: 1000 },
      { x: 7000, y: 7000, w: 200, h: 1000 },
      { x: 400, y: 7200, w: 200, h: 800 },
      { x: 4000, y: 7200, w: 400, h: 800 },
      { x: 6800, y: 7200, w: 200, h: 800 },
      { x: 600, y: 7400, w: 200, h: 600 },
      { x: 1000, y: 7400, w: 200, h: 600 },
      { x: 1600, y: 7400, w: 400, h: 600 },
      { x: 4400, y: 7400, w: 800, h: 600 },
      { x: 6400, y: 7400, w: 400, h: 600 },
      { x: 800, y: 7600, w: 200, h: 400 },
      { x: 1200, y: 7600, w: 400, h: 400 },
      { x: 5200, y: 7600, w: 1200, h: 400 },
    ],
  },
  {
    id: 2,
    name: "Ocean",
    bg: "#2a7fb8",
    grid: "#2472a6",
    accent: "#9fe6ff",
    width: 8000,
    height: 8000,
    mobs: [7, 8, 9],
    mobCap: 40,
    rarityBias: 0.22,
    walls: [
      { x: 0, y: 0, w: 8000, h: 400 },
      { x: 0, y: 400, w: 800, h: 200 },
      { x: 1200, y: 400, w: 4000, h: 200 },
      { x: 7400, y: 400, w: 600, h: 200 },
      { x: 0, y: 600, w: 600, h: 5800 },
      { x: 1200, y: 600, w: 3600, h: 200 },
      { x: 7600, y: 600, w: 400, h: 7400 },
      { x: 2000, y: 800, w: 1800, h: 200 },
      { x: 6600, y: 800, w: 400, h: 600 },
      { x: 2200, y: 1000, w: 1600, h: 200 },
      { x: 6200, y: 1000, w: 400, h: 1400 },
      { x: 7000, y: 1000, w: 200, h: 400 },
      { x: 2400, y: 1200, w: 1200, h: 400 },
      { x: 6000, y: 1200, w: 200, h: 1400 },
      { x: 1200, y: 1400, w: 400, h: 400 },
      { x: 3600, y: 1400, w: 200, h: 3200 },
      { x: 5600, y: 1400, w: 400, h: 1200 },
      { x: 6600, y: 1400, w: 200, h: 600 },
      { x: 1600, y: 1600, w: 200, h: 600 },
      { x: 2600, y: 1600, w: 1000, h: 400 },
      { x: 5200, y: 1600, w: 400, h: 4200 },
      { x: 1400, y: 1800, w: 200, h: 400 },
      { x: 1800, y: 1800, w: 200, h: 200 },
      { x: 5000, y: 1800, w: 200, h: 4600 },
      { x: 7400, y: 1800, w: 200, h: 6200 },
      { x: 2800, y: 2000, w: 800, h: 600 },
      { x: 3800, y: 2000, w: 200, h: 2400 },
      { x: 4800, y: 2000, w: 200, h: 3200 },
      { x: 7200, y: 2000, w: 200, h: 1000 },
      { x: 4600, y: 2200, w: 200, h: 1600 },
      { x: 7000, y: 2200, w: 200, h: 600 },
      { x: 4400, y: 2400, w: 200, h: 1600 },
      { x: 6200, y: 2400, w: 200, h: 200 },
      { x: 2200, y: 2600, w: 200, h: 800 },
      { x: 3000, y: 2600, w: 600, h: 600 },
      { x: 4000, y: 2600, w: 400, h: 1600 },
      { x: 5600, y: 2600, w: 200, h: 200 },
      { x: 1800, y: 2800, w: 400, h: 600 },
      { x: 2400, y: 3000, w: 200, h: 200 },
      { x: 6200, y: 3000, w: 600, h: 200 },
      { x: 600, y: 3200, w: 200, h: 3000 },
      { x: 3200, y: 3200, w: 400, h: 1000 },
      { x: 6400, y: 3200, w: 600, h: 200 },
      { x: 5600, y: 3400, w: 200, h: 2200 },
      { x: 6600, y: 3400, w: 200, h: 200 },
      { x: 5800, y: 3600, w: 400, h: 1200 },
      { x: 7200, y: 3600, w: 200, h: 3400 },
      { x: 6200, y: 3800, w: 200, h: 800 },
      { x: 800, y: 4000, w: 400, h: 2200 },
      { x: 3400, y: 4200, w: 200, h: 400 },
      { x: 4000, y: 4200, w: 200, h: 200 },
      { x: 4600, y: 4200, w: 200, h: 1200 },
      { x: 1200, y: 4400, w: 400, h: 1600 },
      { x: 6800, y: 4400, w: 200, h: 400 },
      { x: 1600, y: 4600, w: 600, h: 1000 },
      { x: 4400, y: 4600, w: 200, h: 800 },
      { x: 2200, y: 4800, w: 800, h: 400 },
      { x: 5800, y: 4800, w: 200, h: 200 },
      { x: 6400, y: 4800, w: 200, h: 400 },
      { x: 4000, y: 5000, w: 400, h: 600 },
      { x: 6200, y: 5000, w: 200, h: 200 },
      { x: 2200, y: 5200, w: 600, h: 200 },
      { x: 6800, y: 5200, w: 400, h: 1400 },
      { x: 2200, y: 5400, w: 400, h: 200 },
      { x: 3000, y: 5400, w: 400, h: 800 },
      { x: 6400, y: 5400, w: 400, h: 1200 },
      { x: 1600, y: 5600, w: 200, h: 200 },
      { x: 2800, y: 5600, w: 200, h: 1000 },
      { x: 3400, y: 5600, w: 200, h: 200 },
      { x: 4800, y: 5600, w: 200, h: 600 },
      { x: 6200, y: 5600, w: 200, h: 800 },
      { x: 2400, y: 5800, w: 400, h: 2200 },
      { x: 4600, y: 5800, w: 200, h: 200 },
      { x: 5200, y: 5800, w: 200, h: 600 },
      { x: 6000, y: 5800, w: 200, h: 400 },
      { x: 1200, y: 6000, w: 200, h: 600 },
      { x: 2000, y: 6000, w: 400, h: 2000 },
      { x: 5400, y: 6000, w: 200, h: 400 },
      { x: 1000, y: 6200, w: 200, h: 200 },
      { x: 1800, y: 6200, w: 200, h: 800 },
      { x: 3000, y: 6200, w: 200, h: 200 },
      { x: 3800, y: 6200, w: 400, h: 800 },
      { x: 5600, y: 6200, w: 200, h: 200 },
      { x: 0, y: 6400, w: 400, h: 1600 },
      { x: 3400, y: 6400, w: 400, h: 1600 },
      { x: 4200, y: 6400, w: 200, h: 200 },
      { x: 3200, y: 6600, w: 200, h: 1400 },
      { x: 4600, y: 6600, w: 400, h: 600 },
      { x: 1600, y: 6800, w: 200, h: 200 },
      { x: 2800, y: 6800, w: 400, h: 1200 },
      { x: 5000, y: 6800, w: 200, h: 200 },
      { x: 5600, y: 6800, w: 600, h: 1200 },
      { x: 6600, y: 6800, w: 200, h: 200 },
      { x: 3800, y: 7000, w: 200, h: 200 },
      { x: 4400, y: 7000, w: 200, h: 1000 },
      { x: 5400, y: 7000, w: 200, h: 1000 },
      { x: 4200, y: 7200, w: 200, h: 800 },
      { x: 4600, y: 7200, w: 200, h: 800 },
      { x: 5200, y: 7200, w: 200, h: 800 },
      { x: 1000, y: 7400, w: 200, h: 600 },
      { x: 1400, y: 7400, w: 600, h: 600 },
      { x: 4000, y: 7400, w: 200, h: 600 },
      { x: 4800, y: 7400, w: 400, h: 600 },
      { x: 6200, y: 7400, w: 200, h: 600 },
      { x: 6600, y: 7400, w: 200, h: 600 },
      { x: 7200, y: 7400, w: 200, h: 600 },
      { x: 400, y: 7600, w: 600, h: 400 },
      { x: 1200, y: 7600, w: 200, h: 400 },
      { x: 3800, y: 7600, w: 200, h: 400 },
      { x: 6400, y: 7600, w: 200, h: 400 },
      { x: 6800, y: 7600, w: 400, h: 400 },
    ],
  },
];

// =====================================================================
// Block rarity system — each map tile belongs to a zone (A-G) that
// determines the rarity distribution of mobs spawning there.
// 1 = wall (no spawn), 2 = player spawn point, A-G = zone letters.
// =====================================================================

/**
 * Per-zone rarity distributions. Each zone maps to a list of
 * { rarityIndex, chance } pairs that define what rarity a mob
// spawning in that zone rolls.
 *
 * Zone A is the safest (mostly Common), zone G the most dangerous
 * (can reach Omega at 1%).
 */
export const BLOCK_ZONES: Record<string, { rarityIndex: number; chance: number }[]> = {
  // Zone A: common 80%, unusual 20%
  "A": [
    { rarityIndex: 0, chance: 0.80 },
    { rarityIndex: 1, chance: 0.20 },
  ],
  // Zone B: common 20%, unusual 70%, rare 10%
  "B": [
    { rarityIndex: 0, chance: 0.20 },
    { rarityIndex: 1, chance: 0.70 },
    { rarityIndex: 2, chance: 0.10 },
  ],
  // Zone C: unusual 20%, rare 70%, epic 10%
  "C": [
    { rarityIndex: 1, chance: 0.20 },
    { rarityIndex: 2, chance: 0.70 },
    { rarityIndex: 3, chance: 0.10 },
  ],
  // Zone D: rare 10%, epic 75%, legendary 15%
  "D": [
    { rarityIndex: 2, chance: 0.10 },
    { rarityIndex: 3, chance: 0.75 },
    { rarityIndex: 4, chance: 0.15 },
  ],
  // Zone E: epic 10%, legendary 75%, mythic 15%
  "E": [
    { rarityIndex: 3, chance: 0.10 },
    { rarityIndex: 4, chance: 0.75 },
    { rarityIndex: 5, chance: 0.15 },
  ],
  // Zone F: legendary 5%, mythic 90%, ultra 5%
  "F": [
    { rarityIndex: 4, chance: 0.05 },
    { rarityIndex: 5, chance: 0.90 },
    { rarityIndex: 6, chance: 0.05 },
  ],
  // Zone G: mythic 5%, ultra 89%, super 5%, omega 1%
  "G": [
    { rarityIndex: 5, chance: 0.05 },
    { rarityIndex: 6, chance: 0.89 },
    { rarityIndex: 7, chance: 0.05 },
    { rarityIndex: 8, chance: 0.01 },
  ],
};

/**
 * Compact 40×40 zone grids for each map. Each row is a 40-character string:
 * '1' = wall (no spawn), '2' = spawn point (treated as zone 'A' by getBlockAt),
 * 'A'-'G' = zone letter.
 * Tile size = map.width / 40 = 200 px per tile.
 */
export const MAP_GRIDS: string[][] = [
  // Garden (map 0)
  [
    '1111111111111111111111111111111111111111',
    '1111111111111111111111111111111111111111',
    '11CCC1111111CC1111CC11111CC111111CCCC111',
    '11CCCCC111111C1111CCC1111C11111CCCCC1111',
    '1111CCCCCCCCCCC1111CC111CC11CCCCCC111111',
    '1111CCCCCCCCCCCCC11BC11CCCCCCCCCC1111111',
    '11111CCCCCCCCCCCCC11BBCCCCCCCCCCC1111C11',
    '1111CCCCC111111CCBBBBBBCC111CCCCCCCCCC11',
    '1111CCCC111111111BBBBBBB111111CCCCDDD111',
    '111DDCC111111G111BBBBBB11111111CCCDD1111',
    '111DDD11111GGGG11BBBBBB111111111CDDD1111',
    '111DDD111GGGGGG111BBBBBB11111111DDDD1111',
    '11DDDD111GGGGGG111B1BBBB111111111DDD1111',
    '11DDDDD11GGGGGGG11BBBB11111111111DDD1111',
    '11DD1DD11GGGGGGG11BBB11111GGG1111DDD1111',
    '11DD1DD111GGGGG111BB11111GGGGGG11DDD1111',
    '11DD1DD1111GG11111BB1111GGG1GGG11DDD1111',
    '111DDDD1111GG11111BB1111GGG11GG111DD1111',
    '111DDDD111GGG1111ABAAA111GG11GG111DDD111',
    '11DDD1D111GGG1111AAAAA111GG11GGG11DDD111',
    '11D1D1D1111GGG111AA2AA111GG11GGG11DDD111',
    '11D1DDD1111GGG1111AAA1111GG11GG111DDD111',
    '11D1DDDE1111GG11111111111GG11GG111DDD111',
    '11EEED1E1111GG1111111111GGG11FGG11EEE111',
    '1111EE1E1111GGG111111111GGG11FF111EEE111',
    '111EEEEE1111GGG1F111111GGG111FF111EEE111',
    '11EEEEE11111FFFFFG111GGGGG111FFF111EE111',
    '11E1EE11111FFFFFFG1GGGGG1111FFFF111EE111',
    '1111E1111111FFF1GGGGGGG111111FFF11EEE111',
    '111EE1111111FFF11GGGGG111111FFFF11EE1111',
    '111EE1111111FF111GGG11111111FFFF11EE1111',
    '11EEE111111FF111111111111111FFFFFEEE1111',
    '11EEE1111FFF111F111111111111FFFFFEEEE111',
    '111EEE1FFFFF11FFFF11FFF111FFFFFFFEEEE111',
    '111EEEFFF11FFFFFFFFFFFFFFFFFFFFEEEEEEE11',
    '111EEEEF111FFFF1FFFF111FFFFFFFFEEEEEEE11',
    '111EEEEEF1FFFF111FFFFFFFFFFFFFFEEEEEEE11',
    '1111EEEEFFFFFFFFFFFFFFFF111FFFEEEEEEE111',
    '1111111111111111111111111111111111111111',
    '1111111111111111111111111111111111111111',
  ],
  // Desert (map 1)
  [
    '1111111111111111111111111111111111111111',
    '1111111111111111111111111111111111111111',
    '1111AAAAA11BB11111BB11111111111111111111',
    '11A2AAAAAABBBBBB1BBBBB111111CCCCDD111111',
    '11AAAAAAAABBBBBBBBBBBBB1111CCCCDDDDD1111',
    '111AAAAAAABB11BBBB1BBBC1CCCCCCD1DDDD1111',
    '111111AA11B111BB111BBBCCCCCCCDD111DD1111',
    '111111111111111B11111CCCC111CDD111DD1111',
    '11111111111111111111CCC111111DDD11DDD111',
    '1111111111111111111CCC11111111DD111DD111',
    '111111111111111111CCCC111111111DD11DD111',
    '11111111111111111CCCCCCC1111111DDD1DD111',
    '1111FF11111111111CCCCCCCCC111111DDDDDD11',
    '1111FF111111111CCCCCCCCCCCC111111DDDDE11',
    '111FFFF11111DDDDDDD111DDDDCC11111111DEE1',
    '111FFF111111DDDDD111111DDDD111111111EE11',
    '111FFF111111DDDDD11111DDDDD1111111111111',
    '111FFF111111DDDDDDDDDDDDDDD1111111111111',
    '11FFFFF1111111DDDDDDDDDDD111111111111111',
    '11FFFFF111111DDDDDDDDD111111111111111111',
    '1111FFF111111DDD111DDD11111111111GG11111',
    '1111EFE1111EEDD1111DD111111111GGGGGG1111',
    '1111EEEEEEEEEDD1111DD11111111GGGGGGG1111',
    '1111EEEEEEEEEE11111EE11111111GGGGGGGG111',
    '1111EEEEEEEE1111111EE1111111GGGGGGGGG111',
    '111EEEEEEEEE111111EEE111111GGGGGGGGGGG11',
    '1111EFFFFFF111111EEEE11111GGGGGGG11GGG11',
    '1111FFFFFFF111111EEE11111GGGGGGG111GGG11',
    '111FFFFFFF111111EEE11111FGGGGGGG111GGG11',
    '1111FFFFFF111111EE11111FGGGGGGGG111GGG11',
    '1111FFFFF1111111EE1111FFFFGG1GGGG1GGGG11',
    '111FFFFFF111111EEEEE1FFFFFG11GGGGGGGG111',
    '111FFFFFF1111111EEEFFFFFF11111GGGGGGG111',
    '111FFFFFFF111111EEEFFFFFF111111GGGGGG111',
    '11FFFFFFFF1111111EFFFFFFFFF1111GGGGG1111',
    '11FFFFGFFF1111111111FFFFFFFFGGGGGGG11111',
    '111FFFFFFF111111111111FFFFFFGGGGGG111111',
    '1111F1FF111111111111111111FFFGGG11111111',
    '1111111111111111111111111111111111111111',
    '1111111111111111111111111111111111111111',
  ],
  // Ocean (map 2)
  [
    '1111111111111111111111111111111111111111',
    '1111111111111111111111111111111111111111',
    '1111GG11111111111111111111EEEEDDDDDDD111',
    '111GGG111111111111111111EEEEEEEDDDDDDD11',
    '111GGGGGGG111111111FFFEEEEEEEEEDD11DDD11',
    '111GGGGGGGG11111111FFFFEEEEEEEE11111DD11',
    '111GGGGGGGGG111111FFFFFFEEEEEE111111DD11',
    '111GGG11GGGG1111111FFFFFEEEE111111DDDD11',
    '111GGG111GGGG111111FFFFFEE11111111DDDD11',
    '111GGGG111GGF111111FFFFFE111111111DDD111',
    '111GGGG11GGFFF111111FFFF1111111111DD1111',
    '111GGGGGGGFFFF111111FF1111111111DDD11111',
    '111GGFFFFFFFFF111111FF1111111111DDD11111',
    '111FFFFFFFF1FFF11111111111111DDDDDD11111',
    '111FFFFFF111FFF1111111111111DDDDDDDD1111',
    '111FFFFFF1111EE1111111111111DDD111DDD111',
    '1111FFFFF111EEEE111111111111DDDD111CC111',
    '1111FFFFFFFEEEEE1111111111111CCCC1CCC111',
    '1111FFFFFFEEEEEE111111111111111CCCCC1111',
    '1111FFFFFEEEEEED1111111D11111111CCCC1111',
    '111111FFEEEEEEDD111111DD11111111CCCC1111',
    '111111FEEEEEEDDDD1111DD111111111CCCC1111',
    '11111111EEEEDDDDD11CCDD111111111CC1C1111',
    '11111111111EEDDDDCCCCC111111111CCC1C1111',
    '111111111111111DDCCCCC11111111CC1CCC1111',
    '111111111111111CCCCC111111111BB11CCC1111',
    '11111111111111DDCCCC1111C1111BBBCC111111',
    '1111111111111DD11CCC11CCB1111BBB11111111',
    '111111111DDDDD1111CCCCCC1111BBB111111111',
    '11111111DDDD11111CCCCCB1111BBB1111111111',
    '1111111DDD1111111CCCBBBB1111BB1111111111',
    '111EE11EE1111111CCC11BBBB1111BB111111111',
    '11EEEE1EE111111CC11111BBBBBBBBAA11111111',
    '11EEEEEEE11111CC11111BB11BBBBBAAAAAA1111',
    '11FEEEEE1111111111111BB111BB111AA1AA1111',
    '11FEEEEEEE1111111111BB111BB1111AAA2AA111',
    '11FEEEEEEE111111111BB111BB11111AAAAAA111',
    '11FEE1E111111111111B111111111111A1AA1111',
    '1111111111111111111111111111111111111111',
    '1111111111111111111111111111111111111111',
  ],
];

/** Number of columns/rows in each block grid. */
export const BLOCK_GRID_COLS = 40;
export const BLOCK_GRID_ROWS = 40;

/**
 * Look up the block zone character at a world position.
 * Returns '1' for walls/out-of-bounds, or a zone letter 'A'-'G'.
 * Spawn-point tiles (stored as '2' in the grid) are mapped to zone 'A',
 * the safest zone (common 80%, unusual 20%), so mobs near spawn points
 * are mostly common.
 */
export function getBlockAt(mapId: number, x: number, y: number): string {
  const grid = MAP_GRIDS[mapId];
  if (!grid) return "1";
  const map = MAPS[mapId];
  const tileW = map.width / BLOCK_GRID_COLS;
  const tileH = map.height / BLOCK_GRID_ROWS;
  const col = Math.floor(x / tileW);
  const row = Math.floor(y / tileH);
  if (row < 0 || row >= BLOCK_GRID_ROWS || col < 0 || col >= BLOCK_GRID_COLS) return "1";
  const ch = grid[row]?.[col] ?? "1";
  // Spawn points ('2') are treated as zone A — the safest zone.
  return ch === "2" ? "A" : ch;
}

/**
 * Roll a rarity index based on the zone letter.
 * Each zone has its own probability distribution defined in BLOCK_ZONES.
 * Falls back to Common (0) if the zone is unknown.
 */
export function rollZoneRarity(zone: string): number {
  const entries = BLOCK_ZONES[zone];
  if (!entries) return 0;
  const roll = Math.random();
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += entry.chance;
    if (roll <= cumulative) return Math.min(entry.rarityIndex, MAX_RARITY);
  }
  // Floating-point rounding: return the highest rarity in the zone
  const last = entries[entries.length - 1];
  return Math.min(last.rarityIndex, MAX_RARITY);
}

/**
 * Find all spawn-point tiles (value '2') in a map's block grid.
 * These tiles are treated as zone 'A' by getBlockAt for rarity rolls,
 * but kept as '2' in the grid so players can be spawned there.
 * Returns an array of { row, col } objects.
 */
export function findSpawnTiles(mapId: number): { row: number; col: number }[] {
  const grid = MAP_GRIDS[mapId];
  if (!grid) return [];
  const result: { row: number; col: number }[] = [];
  for (let row = 0; row < BLOCK_GRID_ROWS; row++) {
    for (let col = 0; col < BLOCK_GRID_COLS; col++) {
      if (grid[row]?.[col] === "2") result.push({ row, col });
    }
  }
  return result;
}

export function rarityMult(r: number): number {
  return RARITIES[Math.max(0, Math.min(MAX_RARITY, r))].mult;
}

export const ENEMY_HEALTH_MULTIPLIERS = {
  "Common": 1,
  "Unusual": 3.75,
  "Rare": 13.5,
  "Epic": 54,
  "Legendary": 405,
  "Mythic": 2430,
  "Ultra": 24500,
  "Super": 177800,
  "Omega": 510510,
  "Eternal": 5059830,
  "Unique": 3059830.0
};

export const PROGRESSIVE_RARITY_MULTIPLIERS = {
  "Common": 1.0,
  "Unusual": 3.0,
  "Rare": 9.0,
  "Epic": 27.0,
  "Legendary": 81.0,
  "Mythic": 205.0,
  "Ultra": 620.0,
  "Super": 2187.0,
  "Omega": 6561.0,
  "Eternal": 18000.0,
  "Unique": 50683.0
};

export function enemyDamageMult(r: number): number {
  const name = RARITIES[Math.max(0, Math.min(MAX_RARITY, r))].name as keyof typeof PROGRESSIVE_RARITY_MULTIPLIERS;
  return PROGRESSIVE_RARITY_MULTIPLIERS[name] ?? 1.0;
}

/** Multiplier applied to a wild mob's health when it spawns at rarity `r`. */
export function enemyRarityMult(r: number): number {
  const name = RARITIES[Math.max(0, Math.min(MAX_RARITY, r))].name as keyof typeof ENEMY_HEALTH_MULTIPLIERS;
  return ENEMY_HEALTH_MULTIPLIERS[name] ?? 1.0;
}

/** Chance that a single craft attempt made from rarity `r` succeeds, or undefined if `r` can't be crafted further. */
export function craftChanceFor(r: number): number | undefined {
  return RARITIES[Math.max(0, Math.min(MAX_RARITY, r))].craftChance;
}


export function xpForLevel(level: number): number {
  return Math.floor(18 * Math.pow(level, 1.7));
}

export function levelFromXp(xp: number): number {
  let lvl = 1;
  while (lvl < 90 && xp >= xpForLevel(lvl + 1)) lvl++;
  return lvl;
}

// =====================================================================
// Per-item drop rarity (replaces the old "roll rarity once per kill"
// approach so each item can have its own bias).
// =====================================================================

/** Ordered list of rarity names used by the drop tables (low → high). */
export const RARITY_ORDER: string[] = RARITIES.map((r) => r.name);

/** Rarity name → index in RARITY_ORDER / RARITIES. */
const RARITY_INDEX: Record<string, number> = Object.fromEntries(
  RARITY_ORDER.map((name, i) => [name, i]),
);

// Base drop distribution per mob rarity (rows). The numbers in each row are
// the unmodified probability of that tier being selected. Anything past the
// rows below is a crafting-only tier and never rolls on a wild drop.
const RARITY_DROP_RATES: Record<string, Record<string, number>> = {
  "Common": {
    "Common": 0.80, "Unusual": 0.20, "Rare": 0.0, "Epic": 0.0,
    "Legendary": 0.0, "Mythic": 0.0, "Ultra": 0.0, "Super": 0.0, "Omega": 0.0, "Unique": 0.0,
  },
  "Unusual": {
    "Common": 0.45, "Unusual": 0.55, "Rare": 0.0, "Epic": 0.0,
    "Legendary": 0.0, "Mythic": 0.0, "Ultra": 0.0, "Super": 0.0, "Omega": 0.0, "Unique": 0.0,
  },
  "Rare": {
    "Common": 0.25, "Unusual": 0.6, "Rare": 0.15, "Epic": 0.0,
    "Legendary": 0.0, "Mythic": 0.0, "Ultra": 0.0, "Super": 0.0, "Omega": 0.0, "Unique": 0.0,
  },
  "Epic": {
    "Common": 0.0, "Unusual": 0.13, "Rare": 0.77, "Epic": 0.1,
    "Legendary": 0.0, "Mythic": 0.0, "Ultra": 0.0, "Super": 0.0, "Omega": 0.0, "Unique": 0.0,
  },
  "Legendary": {
    "Common": 0.0, "Unusual": 0.0, "Rare": 0.1, "Epic": 0.86,
    "Legendary": 0.04, "Mythic": 0.0, "Ultra": 0.0, "Super": 0.0, "Omega": 0.0, "Unique": 0.0,
  },
  "Mythic": {
    "Common": 0.0, "Unusual": 0.0, "Rare": 0.0, "Epic": 0.08,
    "Legendary": 0.90, "Mythic": 0.02, "Ultra": 0.0, "Super": 0.0, "Omega": 0.0, "Unique": 0.0,
  },
  "Ultra": {
    "Common": 0.0, "Unusual": 0.0, "Rare": 0.0, "Epic": 0.0,
    "Legendary": 0.38, "Mythic": 0.617, "Ultra": 0.003, "Super": 0.0, "Omega": 0.0, "Unique": 0.0,
  },
  "Super": {
    "Common": 0.0, "Unusual": 0.0, "Rare": 0.0, "Epic": 0.0,
    "Legendary": 0.0, "Mythic": 0.88, "Ultra": 0.1199, "Super": 0.0001, "Omega": 0.0, "Unique": 0.0,
  },
  "Omega": {
    "Common": 0.0, "Unusual": 0.0, "Rare": 0.0, "Epic": 0.0,
    "Legendary": 0.0, "Mythic": 0.15, "Ultra": 0.845, "Super": 0.005, "Omega": 0.0, "Unique": 0.0,
  },
  "Eternal": {
    "Common": 0.0, "Unusual": 0.0, "Rare": 0.0, "Epic": 0.0,
    "Legendary": 0.0, "Mythic": 0.01, "Ultra": 0.96, "Super": 0.02, "Omega": 0.0, "Unique": 0.0,
  },
};

/**
 * Drop-bias factor for each item, read straight from `ITEM_STATS.dropFactor`.
 * Values are in (0, 1] — 1.0 is neutral, lower values push the roll toward
 * higher rarities and disable "Super"-tier drops for normal mobs.
 */
const DEFAULT_DROP_FACTOR = 0.8;
const ITEM_BASE_FACTOR: Record<number, number> = (() => {
  const out: Record<number, number> = {};
  for (const item of ITEMS) {
    if (item.dropFactor !== undefined) out[item.id] = item.dropFactor;
  }
  return out;
})();

/**
 * Pick the rarity of a single drop for `itemType` from a mob of rarity
 * `mobRarity`.
 *
 * The bias comes from `factorOverride` when supplied — that is the drop
 * entry's own `chance` value from the mob's table. A LOW value biases the
 * roll toward the LOW end of the mob's row: a 0.005 entry (Moon off a Rock)
 * still drops every kill but is almost always the row's floor tier, so a
 * high-rarity Moon is genuinely hard to get. A staple at 0.32 rolls close to
 * the row's own published odds. When no override is passed we fall back to
 * the item's own `dropFactor`.
 */
export function getDropRarityByItem(
  itemType: number,
  mobRarity: string,
  factorOverride?: number,
): string {
  const factor =
    factorOverride !== undefined && factorOverride > 0
      ? factorOverride
      : ITEM_BASE_FACTOR[itemType] ?? DEFAULT_DROP_FACTOR;
  const base = RARITY_DROP_RATES[mobRarity];

  if (!base) return "Common";

  const modifiedBase: Record<string, number> = { ...base };

  // Items with factor < 0.9 can't roll "Super" from normal mobs — divert that
  // probability into "Ultra" so it still feels rewarding. Omega / Eternal mobs
  // are exempt since they are designed to drop everything.
  const isSuperDisabled = factor < 0.9;
  const isSpecialMob = mobRarity === "Omega" || mobRarity === "Eternal";
  if (
    isSuperDisabled &&
    !isSpecialMob &&
    modifiedBase["Super"] !== undefined &&
    modifiedBase["Super"] > 0
  ) {
    const superProb = modifiedBase["Super"];
    modifiedBase["Ultra"] = (modifiedBase["Ultra"] || 0) + superProb;
    modifiedBase["Super"] = 0;
  }

  // Cap drops at the highest wild-rollable tier (Omega, MAX_WILD_DROP_RARITY)
  // — anything past it is crafting-only and must never come off a mob.
  const availableRarities = RARITY_ORDER.filter(
    (r) => modifiedBase[r] > 0 && (RARITY_INDEX[r] ?? 0) <= MAX_WILD_DROP_RARITY,
  );
  if (availableRarities.length === 0) return "Common";

  // Safety net for floating-point residue in the cumulative walk below. It has
  // to be a tier the mob can actually give, so it is the row's LOWEST available
  // tier — never one below it, which would hand out a rarity the table says is
  // impossible (e.g. a Mythic mob paying out "Rare").
  const sortedAvailable = availableRarities.slice().sort(
    (a, b) => RARITY_INDEX[a] - RARITY_INDEX[b],
  );
  const fallbackRarity = sortedAvailable[0];

  // Build the weighted distribution. factor < 1 damps the higher tiers: each
  // step up the ladder is multiplied by `factor` again, so a small factor
  // (a rare table entry) collapses toward the row's floor while a factor near
  // 1 leaves the row's own probabilities essentially untouched.
  //
  // The exponent is measured from the row's lowest tier rather than the
  // absolute rarity index. That is mathematically identical after
  // normalisation but keeps the intermediate weights away from underflow for
  // tiny factors on high rows (0.005^7 vs 0.005^0).
  const lowestIndex = RARITY_INDEX[fallbackRarity];
  const weights: Record<string, number> = {};
  let totalWeight = 0;
  for (const rarity of availableRarities) {
    const baseProb = modifiedBase[rarity];
    const step = RARITY_INDEX[rarity] - lowestIndex;
    const weight = baseProb * Math.pow(factor, step);
    weights[rarity] = weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) return fallbackRarity;

  // Normalized roll.
  let rand = Math.random() * totalWeight;
  let cumulative = 0;
  for (const rarity of RARITY_ORDER) {
    if (weights[rarity]) {
      cumulative += weights[rarity];
      if (rand <= cumulative) return rarity;
    }
  }
  return fallbackRarity;
}

// ------------------------------------------------------------------ summons

/**
 * Item id of the Clover petal. Clovers boost the DNA upgrade chance when a
 * summon rolls its hatch rarity.
 */
export const CLOVER_ITEM = 11;

/**
 * Base chance that a summon backed by a valid DNA petal hatches one rarity
 * tier above its mapped rarity.
 */
export const DNA_UPGRADE_BASE_CHANCE = 0.01;

/**
 * Absolute DNA-upgrade chance added by ONE equipped clover, indexed by the
 * clover's rarity (Common .. Unique). A Common clover is worth +0.1% and an
 * Eternal one +1.2%, so clover luck tops out just above the 1% DNA base rate.
 */
export const CLOVER_DNA_UPGRADE_BONUS: number[] = [
  0.001, // Common    +0.1%
  0.002, // Unusual   +0.2%
  0.003, // Rare      +0.3%
  0.004, // Epic      +0.4%
  0.005, // Legendary +0.5%
  0.006, // Mythic    +0.6%
  0.007, // Ultra     +0.7%
  0.008, // Super     +0.8%
  0.010, // Omega     +1.0%
  0.012, // Eternal   +1.2%
  0.012, // Unique (sits outside the craft ladder; matches Eternal)
];

/**
 * A summon's hatched mob is normally one rarity tier *below* the egg itself
 * (Common eggs still hatch Common). Eggs flagged `noDowngrade` skip this.
 */
export function mapRarityToSummonRarity(rarity: number): number {
  return Math.max(0, Math.min(MAX_RARITY, rarity) - 1);
}

/**
 * Total DNA-upgrade chance contributed by clover petals. Each equipped clover
 * adds its own `CLOVER_DNA_UPGRADE_BONUS` entry, so a stack of high-tier
 * clovers is worth meaningfully more luck.
 */
export function cloverDnaBonus(cloverRarities: number[]): number {
  let bonus = 0;
  for (const rarity of cloverRarities) {
    const tier = Math.max(0, Math.min(MAX_RARITY, rarity));
    bonus += CLOVER_DNA_UPGRADE_BONUS[tier] ?? 0;
  }
  return bonus;
}

// -------------------------------------------------------------------- drops

/**
 * Hard cap on simultaneously-lying drops per map. When the cap is hit the
 * oldest `DROP_TRIM_COUNT` cards are dropped so fresh loot always has a home.
 */
export const MAX_DROPPED_CARDS = 220;
/** How many of the oldest drops are discarded when `MAX_DROPPED_CARDS` is hit. */
export const DROP_TRIM_COUNT = 5;
/** Distance under which two same item+rarity drops merge into one stacked card. */
export const DROP_STACK_RADIUS = 34;
/** Highest count a single dropped card can accumulate through stacking. */
export const DROP_STACK_MAX = 99;

/**
 * "Magic" upgrades: a base item id -> its magic counterpart id. A magic item
 * can only drop while a Magic Core sits in the player's hotbar, and the Core's
 * rarity caps (never raises) the magic drop's rarity.
 *
 * No Magic Core / magic items ship yet, so this map is intentionally empty —
 * filling it in is all that's needed to switch the mechanic on.
 */
export const MAGIC_ITEM_MAP: Record<number, number> = {};

/** Item id of the Magic Core, or -1 while no such item exists in ITEMS. */
export const MAGIC_CORE_ITEM = -1;

/**
 * Per-summon spawn configuration.
 *
 * This is the data-table version of the old `createSpawnMethod(cfg)` factory:
 * instead of generating a bespoke trySpawnX/_cleanDeadX/updateX trio per egg,
 * the single generic summon loop in sim.ts reads its numbers from here. Adding
 * a new egg is one row, no new code — which is what keeps this manageable once
 * there are dozens of mobs.
 */
export interface SummonCfg {
  /** How many pets this summon keeps alive at once. */
  maxCount: number;
  /** How many pets hatch per reload cycle (batch spawn). Defaults to 1. */
  spawnCount?: number;
  /** Seconds of spawn invulnerability, so a fresh pet isn't instantly deleted. */
  spawnProtection?: number;
}

export const SUMMON_CFG: Record<number, SummonCfg> = {
  8:  { maxCount: 1 },                                  // Ladybug Egg
  9:  { maxCount: 2, spawnCount: 2 },                   // Stick — whips up both sandstorms at once
  12: { maxCount: 3 },                                  // Soldier Ant Egg
  14: { maxCount: 4, spawnCount: 2 },                   // Worker Ant Egg — ants come in pairs
  15: { maxCount: 1, spawnProtection: 1.5 },            // Rock Egg — slow, needs a moment
  20: { maxCount: 1 },                                  // Bee Egg
  23: { maxCount: 3 },                                  // Starfish Egg
  26: { maxCount: 2 },                                  // Jellyfish Egg
  29: { maxCount: 1 },                                  // Crab Egg
  34: { maxCount: 1, spawnProtection: 1.5 },            // Beetle Egg
  37: { maxCount: 2 },                                  // Scorpion Egg
};

/** Default seconds of post-spawn invulnerability for a freshly hatched pet. */
export const DEFAULT_SPAWN_PROTECTION = 1.0;

/** Returns the number of pets summoned by a summon item. */
export function getSummonCount(itemId: number): number {
  return SUMMON_CFG[itemId]?.maxCount ?? 1;
}

/** How many pets one reload cycle of this summon hatches at once. */
export function getSummonBatch(itemId: number): number {
  const cfg = SUMMON_CFG[itemId];
  return Math.max(1, Math.min(cfg?.spawnCount ?? 1, cfg?.maxCount ?? 1));
}

/** Seconds of spawn protection granted to a pet hatched by this summon. */
export function getSpawnProtection(itemId: number): number {
  return SUMMON_CFG[itemId]?.spawnProtection ?? DEFAULT_SPAWN_PROTECTION;
}

export const EMPTY_ITEM = 255;

// =====================================================================
// Lookup tables used by the chat system for colored name rendering.
// =====================================================================

/** Maps item name → item def for the chat system's name highlighting. */
export const ITEM_STATS: Record<string, ItemDef> = (() => {
  const out: Record<string, ItemDef> = {};
  for (const item of ITEMS) out[item.name] = item;
  return out;
})();

/** Maps mob name → mob def (drop table) for the chat system's name highlighting. */
export const ENEMY_DROP_TABLE: Record<string, MobDef> = (() => {
  const out: Record<string, MobDef> = {};
  for (const m of MOBS) out[m.name] = m;
  return out;
})();
