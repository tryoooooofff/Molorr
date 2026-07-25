// Shared game definitions used by BOTH the authoritative server and the client.
// Keep this file dependency-free so it can run in node and in the browser.

export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;

export const SLOT_COUNT = 8;
export const BAG_COUNT = 32;
export const TOTAL_CELLS = SLOT_COUNT + BAG_COUNT;

export const RARITIES = [
  { name: "Common", color: "#7eef6d", mult: 1 },
  { name: "Unusual", color: "#ffe65d", mult: 1.7 },
  { name: "Rare", color: "#4d52e3", mult: 3 },
  { name: "Epic", color: "#861fde", mult: 5.5 },
  { name: "Legendary", color: "#de1f1f", mult: 10 },
  { name: "Mythic", color: "#1fdbde", mult: 19 },
];
export const MAX_RARITY = RARITIES.length - 1;

export type ItemKind = "petal" | "summon";

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
  desc: string;
}

export const ITEMS: ItemDef[] = [
  { id: 0, name: "Basic", kind: "petal", color: "#ffffff", outline: "#cfcfcf", shape: "circle", radius: 8, damage: 10, health: 12, reload: 1.0, desc: "A nice and simple petal." },
  { id: 1, name: "Leaf", kind: "petal", color: "#39b54a", outline: "#2b8a38", shape: "leaf", radius: 9, damage: 8, health: 14, reload: 1.0, heal: 2.5, desc: "Heals you slowly over time." },
  { id: 2, name: "Stinger", kind: "petal", color: "#333333", outline: "#111111", shape: "triangle", radius: 6, damage: 38, health: 4, reload: 1.6, desc: "Hurts a lot, breaks fast." },
  { id: 3, name: "Rock", kind: "petal", color: "#8d8d8d", outline: "#6a6a6a", shape: "square", radius: 10, damage: 8, health: 55, reload: 2.2, desc: "Heavy and very sturdy." },
  { id: 4, name: "Sand", kind: "petal", color: "#e0c068", outline: "#b89b45", shape: "circle", radius: 7, damage: 14, health: 16, reload: 1.2, desc: "Gritty desert clump." },
  { id: 5, name: "Bubble", kind: "petal", color: "#bfe9ff", outline: "#84c9ee", shape: "circle", radius: 10, damage: 3, health: 3, reload: 2.6, speed: 9, desc: "Makes you swim faster." },
  { id: 6, name: "Pearl", kind: "petal", color: "#eafaff", outline: "#a8d8e8", shape: "circle", radius: 8, damage: 24, health: 12, reload: 1.4, desc: "Shiny treasure of the sea." },
  { id: 7, name: "Wing", kind: "petal", color: "#f3f3ff", outline: "#c3c3e0", shape: "triangle", radius: 9, damage: 14, health: 9, reload: 1.1, speed: 5, desc: "Flaps around, light and quick." },
  { id: 8, name: "Egg", kind: "summon", color: "#fff1cf", outline: "#e0c48a", shape: "egg", radius: 10, damage: 4, health: 20, reload: 3.0, petMob: 0, desc: "Hatches a friendly ladybug." },
  { id: 9, name: "Stick", kind: "summon", color: "#a97442", outline: "#7d5228", shape: "stick", radius: 10, damage: 6, health: 22, reload: 4.0, petMob: 1, desc: "Calls a loyal wasp to fight." },
];

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
  drops: { item: number; chance: number }[];
}

export const MOBS: MobDef[] = [
  { id: 0, name: "Ladybug", color: "#eb4034", outline: "#a82a20", shape: "bug", radius: 22, health: 60, damage: 18, speed: 42, xp: 10, drops: [{ item: 0, chance: 0.35 }, { item: 1, chance: 0.28 }, { item: 8, chance: 0.06 }] },
  { id: 1, name: "Bee", color: "#f5d442", outline: "#c2a41e", shape: "wasp", radius: 18, health: 48, damage: 32, speed: 62, xp: 14, drops: [{ item: 2, chance: 0.3 }, { item: 7, chance: 0.2 }, { item: 9, chance: 0.05 }] },
  { id: 2, name: "Rock", color: "#8d8d8d", outline: "#5f5f5f", shape: "rock", radius: 26, health: 130, damage: 10, speed: 0, xp: 12, drops: [{ item: 3, chance: 0.4 }, { item: 0, chance: 0.3 }] },
  { id: 3, name: "Ant", color: "#5b452c", outline: "#3a2b19", shape: "ant", radius: 16, health: 38, damage: 14, speed: 56, xp: 7, drops: [{ item: 0, chance: 0.4 }, { item: 8, chance: 0.07 }] },
  { id: 4, name: "Cactus", color: "#4caf50", outline: "#357a38", shape: "cactus", radius: 25, health: 110, damage: 26, speed: 0, xp: 18, drops: [{ item: 9, chance: 0.12 }, { item: 3, chance: 0.25 }, { item: 4, chance: 0.3 }] },
  { id: 5, name: "Scorpion", color: "#c76b2a", outline: "#8c4718", shape: "crab", radius: 21, health: 90, damage: 36, speed: 70, xp: 24, drops: [{ item: 2, chance: 0.32 }, { item: 4, chance: 0.3 }] },
  { id: 6, name: "Beetle", color: "#d1a054", outline: "#9c7532", shape: "bug", radius: 23, health: 100, damage: 24, speed: 48, xp: 20, drops: [{ item: 4, chance: 0.35 }, { item: 8, chance: 0.1 }] },
  { id: 7, name: "Jellyfish", color: "#b06be0", outline: "#7d40a8", shape: "jelly", radius: 22, health: 78, damage: 28, speed: 38, xp: 20, drops: [{ item: 5, chance: 0.34 }, { item: 6, chance: 0.16 }] },
  { id: 8, name: "Crab", color: "#ef7d3b", outline: "#b2541f", shape: "crab", radius: 24, health: 120, damage: 32, speed: 44, xp: 26, drops: [{ item: 6, chance: 0.24 }, { item: 3, chance: 0.24 }] },
  { id: 9, name: "Starfish", color: "#f2799e", outline: "#bc4c72", shape: "star", radius: 20, health: 95, damage: 18, speed: 36, xp: 18, drops: [{ item: 1, chance: 0.3 }, { item: 5, chance: 0.25 }, { item: 9, chance: 0.06 }] },
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

function ring(x: number, y: number, w: number, h: number, t: number): Wall[] {
  return [
    { x, y, w, h: t },
    { x, y: y + h - t, w, h: t },
    { x, y, w: t, h },
    { x: x + w - t, y, w: t, h },
  ];
}

export const MAPS: MapDef[] = [
  {
    id: 0,
    name: "Garden",
    bg: "#1eae63",
    grid: "#1a9c58",
    accent: "#ffe27a",
    width: 3200,
    height: 3200,
    mobs: [0, 1, 2, 3],
    mobCap: 46,
    rarityBias: 0,
    walls: [
      { x: 700, y: 600, w: 640, h: 60 },
      { x: 700, y: 600, w: 60, h: 480 },
      { x: 1900, y: 500, w: 60, h: 700 },
      { x: 1400, y: 1500, w: 900, h: 60 },
      { x: 2240, y: 1500, w: 60, h: 620 },
      { x: 600, y: 2000, w: 800, h: 60 },
      { x: 600, y: 2000, w: 60, h: 500 },
      { x: 2400, y: 2400, w: 400, h: 60 },
      ...ring(120, 120, 2960, 2960, 40),
    ],
  },
  {
    id: 1,
    name: "Desert",
    bg: "#e0bd75",
    grid: "#d4ae63",
    accent: "#fff3c4",
    width: 3200,
    height: 3200,
    mobs: [4, 5, 6, 2],
    mobCap: 42,
    rarityBias: 0.12,
    walls: [
      { x: 500, y: 800, w: 1000, h: 70 },
      { x: 1800, y: 300, w: 70, h: 900 },
      { x: 900, y: 1700, w: 70, h: 900 },
      { x: 1500, y: 2100, w: 1100, h: 70 },
      { x: 2300, y: 900, w: 500, h: 70 },
      ...ring(120, 120, 2960, 2960, 40),
    ],
  },
  {
    id: 2,
    name: "Ocean",
    bg: "#2a7fb8",
    grid: "#2472a6",
    accent: "#9fe6ff",
    width: 3200,
    height: 3200,
    mobs: [7, 8, 9],
    mobCap: 40,
    rarityBias: 0.22,
    walls: [
      { x: 600, y: 500, w: 70, h: 900 },
      { x: 600, y: 500, w: 900, h: 70 },
      { x: 2100, y: 700, w: 600, h: 70 },
      { x: 2100, y: 1600, w: 70, h: 900 },
      { x: 700, y: 2200, w: 1100, h: 70 },
      ...ring(120, 120, 2960, 2960, 40),
    ],
  },
];

export function rarityMult(r: number): number {
  return RARITIES[Math.max(0, Math.min(MAX_RARITY, r))].mult;
}

export function xpForLevel(level: number): number {
  return Math.floor(18 * Math.pow(level, 1.7));
}

export function levelFromXp(xp: number): number {
  let lvl = 1;
  while (lvl < 90 && xp >= xpForLevel(lvl + 1)) lvl++;
  return lvl;
}

export const EMPTY_ITEM = 255;
