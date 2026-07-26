// Authoritative game simulation. Runs on the node/ws server (server/index.ts)
// and, when no remote server is configured, inside the browser (local transport).

import {
  BAG_COUNT,
  BAG_MAX,
  BLOCK_GRID_COLS,
  BLOCK_GRID_ROWS,
  CRAFT_CARD_COUNT,
  craftChanceFor,
  EMPTY_ITEM,
  ITEMS,
  MAPS,
  MAX_CRAFT_RARITY,
  MAX_RARITY,
  MAX_WILD_DROP_RARITY,
  MOBS,
  CLOVER_ITEM,
  orbitsAsPetal,
  DNA_UPGRADE_BASE_CHANCE,
  DROP_STACK_MAX,
  DROP_STACK_RADIUS,
  DROP_TRIM_COUNT,
  MAGIC_CORE_ITEM,
  MAGIC_ITEM_MAP,
  MAX_DROPPED_CARDS,
  cloverDnaBonus,
  mapRarityToSummonRarity,
  ORACLE_COOLDOWN_HOURS,
  ORACLE_SKIP,
  oracleRequiredCount,
  RARITIES,
  SECONDARY_SLOT_COUNT,
  HOTBAR_CELLS,
  isBagCell,
  isHotbarCell,
  isMainCell,
  SLOT_COUNT,
  TOTAL_CELLS,
  TRADE_COOLDOWN_HOURS,
  TRINKET_ITEM,
  Wall,
  enemyRarityMult,
  enemyDamageMult,
  getBlockAt,
  getDropRarityByItem,
  getSpawnProtection,
  getSummonBatch,
  getSummonCount,
  levelFromXp,
  rarityMult,
  rollZoneRarity,
  findSpawnTiles,
} from "./defs";

import { C2S, ENT, EVT, Reader, S2C, SWAP_ROW_ALL, TEAM, Writer } from "./protocol";


export interface Cell {
  item: number;
  rarity: number;
  count: number;
}

/** Player hit-radius / body size. Scaled to 70% of the original 26px. */
export const PLAYER_RADIUS = 26 * 0.7;

interface PetalState {
  id: number;
  alive: boolean;
  hp: number;
  maxHp: number;
  timer: number;
  x: number;
  y: number;
  hitCd: number;
}

export interface PlayerSave {
  slots: (Cell | null)[];
  /** Backup hotbar row. Same length as `slots`; never spawns petals. */
  secondary: (Cell | null)[];
  bag: (Cell | null)[];
  xp: number;
  mapId: number;
  /** Epoch ms timestamp of the next allowed Oracle use (0 = ready now). */
  nextOracleAt?: number;
  /** Epoch ms timestamp of the next allowed Trade use (0 = ready now). */
  nextTradeAt?: number;
}

export class Player {
  id: number;
  name = "flower";
  mapId = 0;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  hp = 120;
  maxHp = 120;
  xp = 0;
  level = 1;
  alive = true;
  respawnIn = 0;
  inDx = 0;
  inDy = 0;
  flags = 0;
  baseAngle = 0;
  orbit = 62;
  nextOracleAt = 0;
  nextTradeAt = 0;

  slots: (Cell | null)[] = new Array(SLOT_COUNT).fill(null);
  /**
   * Secondary hotbar row. It holds real items but never grows petals — it is
   * pure standby storage that can be swapped into the main row instantly.
   */
  secondary: (Cell | null)[] = new Array(SECONDARY_SLOT_COUNT).fill(null);
  bag: (Cell | null)[] = new Array(BAG_COUNT).fill(null);
  petals: PetalState[] = [];
  pets: Mob[][] = Array.from({ length: SLOT_COUNT }, () => []);
  hurtCd = 0;
  dirty = true;
  statsDirty = true;

  constructor(id: number) {
    this.id = id;
  }
}

export class Mob {
  id: number;
  type: number;
  mapId: number;
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  hp: number;
  maxHp: number;
  angle = 0;
  rarity: number;
  friendly: boolean;
  ownerId = 0;
  ownerSlot = -1;
  /** Summon item id that hatched this friendly mob, or -1 for wild mobs. */
  sourceItem = -1;
  /** Rarity of the summon item that hatched this friendly mob. */
  sourceRarity = 0;
  targetId = 0;
  wander = 0;
  hitCd = 0;
  radius: number;
  damage: number;
  speed: number;
  lastHitBy = 0;
  /** Seconds of post-spawn invulnerability. Freshly hatched pets get a moment to get clear. */
  spawnProtection = 0;

  constructor(id: number, type: number, mapId: number, x: number, y: number, rarity: number, friendly = false) {
    const def = MOBS[type];
    // Player-owned summons scale like petals (rarityMult); wild mobs scale on the steeper enemy curve.
    const m = friendly ? rarityMult(rarity) : enemyRarityMult(rarity);
    this.id = id;
    this.type = type;
    this.mapId = mapId;
    this.x = x;
    this.y = y;
    this.rarity = rarity;
    this.friendly = friendly;
    this.maxHp = Math.round(def.health * m);
    this.hp = this.maxHp;
    this.radius = def.radius * (1 + rarity * 0.08);
    this.damage = def.damage * enemyDamageMult(rarity);
    this.speed = def.speed;
  }
}

export class Drop {
  constructor(
    public id: number,
    public mapId: number,
    public x: number,
    public y: number,
    public item: number,
    public rarity: number,
    public ownerId = 0,
    public ttl = 45,
    /** Cards merged into this one card. Nearby identical drops stack instead of littering. */
    public count = 1,
  ) {}
}

interface World {
  mobs: Mob[];
  drops: Drop[];
}

export interface ClientLike {
  send(data: Uint8Array): void;
}

interface ClientState {
  send(data: Uint8Array): void;
  player: Player | null;
  events: Uint8Array[];
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}

function collideWalls(walls: Wall[], x: number, y: number, r: number): [number, number] {
  for (const w of walls) {
    const cx = clamp(x, w.x, w.x + w.w);
    const cy = clamp(y, w.y, w.y + w.h);
    const dx = x - cx;
    const dy = y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      const d = Math.sqrt(d2) || 0.0001;
      const push = r - d;
      if (d2 === 0) {
        x = w.x + w.w * 0.5 < x ? w.x + w.w + r : w.x - r;
      } else {
        x += (dx / d) * push;
        y += (dy / d) * push;
      }
    }
  }
  return [x, y];
}

interface GameServerOptions {
  mobCapScale?: number;
}

export class GameServer {
  private nextId = 1;
  private clients = new Map<number, ClientState>();
  private worlds: World[] = MAPS.map(() => ({ mobs: [], drops: [] }));
  private tickCount = 0;
  private mobCapScale: number;

  constructor(options: GameServerOptions = {}) {
    this.mobCapScale =
      Number.isFinite(options.mobCapScale) && (options.mobCapScale ?? 1) > 0 ? options.mobCapScale ?? 1 : 1;
    for (const map of MAPS) {
      for (let i = 0; i < this.mobCapForMap(map.id); i++) this.spawnMob(map.id);
    }
  }

  playerCount() {
    let count = 0;
    for (const c of this.clients.values()) if (c.player) count++;
    return count;
  }

  private mobCapForMap(mapId: number) {
    return Math.max(0, Math.round(MAPS[mapId].mobCap * this.mobCapScale));
  }

  // ---------------------------------------------------------------- clients
  addClient(id: number, send: (data: Uint8Array) => void) {
    this.clients.set(id, { send, player: null, events: [] });
  }

  removeClient(id: number) {
    const c = this.clients.get(id);
    if (c?.player) {
      const w = this.worlds[c.player.mapId];
      w.mobs = w.mobs.filter((m) => m.ownerId !== c.player!.id);
    }
    this.clients.delete(id);
  }

  getSave(id: number): PlayerSave | null {
    const p = this.clients.get(id)?.player;
    if (!p) return null;
    return {
      slots: p.slots,
      secondary: p.secondary,
      bag: p.bag,
      xp: p.xp,
      mapId: p.mapId,
      nextOracleAt: p.nextOracleAt,
      nextTradeAt: p.nextTradeAt,
    };
  }

  // ------------------------------------------------------------- networking
  handleMessage(clientId: number, data: Uint8Array) {
    const c = this.clients.get(clientId);
    if (!c) return;
    const r = new Reader(data);
    const type = r.u8();
    switch (type) {
      case C2S.JOIN: {
        const name = r.str().slice(0, 14) || "flower";
        const mapId = clamp(r.u8(), 0, MAPS.length - 1);
        const xp = r.u32();
        const p = new Player(this.nextId++);
        p.name = name;
        p.mapId = mapId;
        p.xp = xp;
        for (let i = 0; i < SLOT_COUNT; i++) p.slots[i] = readCell(r);
        for (let i = 0; i < SECONDARY_SLOT_COUNT; i++) p.secondary[i] = readCell(r);
        // Bag length is dynamic (unlimited bag), so it travels as u16.
        const bagCount = Math.min(r.u16(), BAG_MAX);
        if (p.bag.length < bagCount) p.bag.length = bagCount;
        for (let i = 0; i < bagCount; i++) p.bag[i] = readCell(r);
        for (let i = 0; i < p.bag.length; i++) if (p.bag[i] === undefined) p.bag[i] = null;
        // Cooldowns are stored client-side (same trust model as xp above) as
        // "seconds remaining" so they survive reconnects without clock-sync issues.
        const oracleSecLeft = r.u32();
        const tradeSecLeft = r.u32();
        const now = Date.now();
        p.nextOracleAt = oracleSecLeft > 0 ? now + oracleSecLeft * 1000 : 0;
        p.nextTradeAt = tradeSecLeft > 0 ? now + tradeSecLeft * 1000 : 0;
        if (!p.slots.some(Boolean) && !p.secondary.some(Boolean) && !p.bag.some(Boolean)) {
          p.slots[0] = { item: 0, rarity: 0, count: 1 };
          p.slots[1] = { item: 0, rarity: 0, count: 1 };
          p.slots[2] = { item: 1, rarity: 0, count: 1 };
          p.slots[3] = { item: 0, rarity: 0, count: 1 };
          // A fresh player starts with a couple of backups already racked so
          // the secondary row is discoverable from the very first match.
          p.secondary[0] = { item: 2, rarity: 0, count: 1 };
          p.secondary[1] = { item: 8, rarity: 0, count: 1 };
        }
        c.player = p;
        this.applyLevel(p);
        this.rebuildPetals(p);
        this.spawnPlayer(p);
        this.sendWelcome(c, p);
        break;
      }
      case C2S.INPUT: {
        const p = c.player;
        if (!p) return;
        p.inDx = r.i8() / 100;
        p.inDy = r.i8() / 100;
        p.flags = r.u8();
        break;
      }
      case C2S.SWAP: {
        const p = c.player;
        if (!p) return;
        // Cell indices can exceed 255 now that the bag sits behind two hotbar
        // rows, so both endpoints travel as u16.
        const from = r.u16();
        const to = r.u16();
        // Bag entries are stacks, but dragging an inventory card equips/moves
        // one item at a time. Hotbar drags keep their existing swap behaviour.
        if (isBagCell(from)) this.moveOneFromBag(p, from, to);
        else this.swapCells(p, from, to);
        break;
      }
      case C2S.SWAP_ROW: {
        const p = c.player;
        if (!p) return;
        const which = r.u8();
        if (which === SWAP_ROW_ALL) this.swapAllRows(p);
        else this.swapRowSlot(p, which);
        break;
      }
      case C2S.CRAFT: {
        const p = c.player;
        if (!p) return;
        const item = r.u8();
        const rarity = r.u8();
        r.u16(); // legacy requested count; a normal craft is always one group of five
        this.craft(c, p, item, rarity);
        break;
      }
      case C2S.ORACLE: {
        const p = c.player;
        if (!p) return;
        this.oracle(c, p, r.u8(), r.u8());
        break;
      }
      case C2S.TRADE: {
        const p = c.player;
        if (!p) return;
        const item = r.u8();
        const rarity = r.u8();
        const count = r.u16();
        this.trade(c, p, item, rarity, count);
        break;
      }

      case C2S.CHANGE_MAP: {
        const p = c.player;
        if (!p) return;
        const mapId = clamp(r.u8(), 0, MAPS.length - 1);
        if (mapId === p.mapId) return;
        const oldWorld = this.worlds[p.mapId];
        oldWorld.mobs = oldWorld.mobs.filter((m) => m.ownerId !== p.id);
        p.mapId = mapId;
        this.spawnPlayer(p);
        this.rebuildPetals(p);
        this.sendWelcome(c, p);
        break;
      }
      case C2S.RESPAWN: {
        const p = c.player;
        if (!p || p.alive) return;
        p.alive = true;
        this.applyLevel(p);
        p.hp = p.maxHp;
        this.spawnPlayer(p);
        this.rebuildPetals(p);
        p.statsDirty = true;
        break;
      }
      case C2S.PING: {
        const stamp = r.u32();
        const w = new Writer(8);
        w.u8(S2C.PONG).u32(stamp);
        c.send(w.bytes());
        break;
      }
    }
  }

  private sendWelcome(c: ClientState, p: Player) {
    const map = MAPS[p.mapId];
    const w = new Writer(64 + map.walls.length * 8);
    w.u8(S2C.WELCOME).u16(p.id).u8(p.mapId).u16(map.width).u16(map.height);
    w.u16(map.walls.length);
    for (const wall of map.walls) w.u16(wall.x).u16(wall.y).u16(wall.w).u16(wall.h);
    c.send(w.bytes());
    p.dirty = true;
    p.statsDirty = true;
  }

  private pushEvent(c: ClientState, kind: number, x: number, y: number, value: number, item = EMPTY_ITEM, rarity = 0) {
    const w = new Writer(16);
    w.u8(S2C.EVENT).u8(kind).i16(Math.round(x)).i16(Math.round(y)).u32(Math.max(0, Math.round(value))).u8(item).u8(rarity);
    c.events.push(w.bytes());
  }

  private clientOf(playerId: number): ClientState | null {
    for (const c of this.clients.values()) if (c.player && c.player.id === playerId) return c;
    return null;
  }

  // ------------------------------------------------------------- inventory
  /**
   * Reads any cell by flat index. The address space is laid out as
   * `[main row][secondary row][bag...]`, so one number can point at any cell
   * the player owns.
   */
  private cellAt(p: Player, idx: number): Cell | null {
    if (isMainCell(idx)) return p.slots[idx] ?? null;
    if (idx < HOTBAR_CELLS) return p.secondary[idx - SLOT_COUNT] ?? null;
    return p.bag[idx - HOTBAR_CELLS] ?? null;
  }

  private setCell(p: Player, idx: number, cell: Cell | null) {
    if (isMainCell(idx)) {
      p.slots[idx] = cell;
      return;
    }
    if (idx < HOTBAR_CELLS) {
      p.secondary[idx - SLOT_COUNT] = cell;
      return;
    }
    const bagIdx = idx - HOTBAR_CELLS;
    // Grow (and null-fill) the unlimited bag if the target cell is past the end.
    while (p.bag.length <= bagIdx) p.bag.push(null);
    p.bag[bagIdx] = cell;
  }

  private swapCells(p: Player, a: number, b: number) {
    if (a === b || a >= TOTAL_CELLS || b >= TOTAL_CELLS) return;
    const ca = this.cellAt(p, a);
    const cb = this.cellAt(p, b);
    if (ca && cb && ca.item === cb.item && ca.rarity === cb.rarity) {
      cb.count += ca.count;
      this.setCell(p, a, null);
    } else {
      this.setCell(p, a, cb);
      this.setCell(p, b, ca);
    }
    // Only the main row grows petals, so a secondary-only move is free.
    if (isMainCell(a) || isMainCell(b)) this.rebuildPetals(p);
    p.dirty = true;
  }

  /** Swap one main slot with its secondary partner (number-key hotkeys). */
  private swapRowSlot(p: Player, slot: number) {
    if (slot < 0 || slot >= Math.min(SLOT_COUNT, SECONDARY_SLOT_COUNT)) return;
    const main = p.slots[slot] ?? null;
    const backup = p.secondary[slot] ?? null;
    if (!main && !backup) return;
    p.slots[slot] = backup;
    p.secondary[slot] = main;
    // The petal that just arrived starts on cooldown so hot-swapping mid-fight
    // can't be used to dodge reload timers.
    this.rebuildPetals(p);
    this.startReload(p, slot);
    p.dirty = true;
  }

  /** Swap the whole main row with the whole secondary row (the "R" hotkey). */
  private swapAllRows(p: Player) {
    const n = Math.min(SLOT_COUNT, SECONDARY_SLOT_COUNT);
    let touched = false;
    for (let i = 0; i < n; i++) {
      const main = p.slots[i] ?? null;
      const backup = p.secondary[i] ?? null;
      if (!main && !backup) continue;
      p.slots[i] = backup;
      p.secondary[i] = main;
      touched = true;
    }
    if (!touched) return;
    this.rebuildPetals(p);
    for (let i = 0; i < n; i++) this.startReload(p, i);
    p.dirty = true;
  }

  /**
   * Puts the petal in `slot` into its reload state. Used after a hot-swap so a
   * freshly racked petal has to spin up like any other reload.
   */
  private startReload(p: Player, slot: number) {
    const cell = p.slots[slot];
    const st = p.petals[slot];
    if (!cell || !st) return;
    const def = ITEMS[cell.item];
    if (!def || !orbitsAsPetal(def.kind)) return;
    st.alive = false;
    st.timer = def.reload > 0 ? def.reload : 0.001;
  }

  /** Move one card out of an inventory stack, never the full item type. */
  private moveOneFromBag(p: Player, from: number, to: number) {
    if (from === to || !isBagCell(from) || to >= TOTAL_CELLS) return;
    const source = this.cellAt(p, from);
    if (!source || source.count <= 0) return;
    const one: Cell = { item: source.item, rarity: source.rarity, count: 1 };
    const target = this.cellAt(p, to);

    if (isHotbarCell(to)) {
      // Equipping/racking one item replaces whatever occupied that hotbar cell.
      // Return the displaced card to the unlimited bag before placing the
      // single dragged item. This is what makes dragging onto either row work.
      if (target && !this.addItem(p, target.item, target.rarity, target.count)) return;
      this.setCell(p, to, one);
      // Only the main row runs petals; racking into the backup row is inert.
      if (isMainCell(to)) this.rebuildPetals(p);
    } else {
      // A one-item drag can fill an empty bag cell or add to a matching stack;
      // it never overwrites an unrelated stack.
      if (target && (target.item !== one.item || target.rarity !== one.rarity || target.count >= 999)) return;
      if (target) target.count += 1;
      else this.setCell(p, to, one);
    }

    source.count -= 1;
    if (source.count === 0) this.setCell(p, from, null);
    p.dirty = true;
  }

  /**
   * Puts `count` cards of item+rarity into the bag.
   *
   * The bag is unlimited: existing stacks are topped up to 999 first, then any
   * leftover spills into free cells, and the bag grows if there are none. This
   * is what makes a mob that drops 2-3 items at once always deliver *all* of
   * them — previously the second and third drop were silently rejected (and the
   * pickup then failed forever) as soon as the 32 fixed cells were occupied.
   *
   * Returns false only in the pathological case of hitting BAG_MAX.
   */
  addItem(p: Player, item: number, rarity: number, count = 1): boolean {
    if (count <= 0) return true;
    let left = count;

    // 1) top up existing stacks of the same item+rarity
    for (const cell of p.bag) {
      if (left <= 0) break;
      if (cell && cell.item === item && cell.rarity === rarity && cell.count < 999) {
        const room = 999 - cell.count;
        const put = Math.min(room, left);
        cell.count += put;
        left -= put;
      }
    }

    // 2) spill the remainder into free cells, growing the bag as needed
    while (left > 0) {
      let idx = p.bag.indexOf(null);
      if (idx < 0) {
        if (p.bag.length >= BAG_MAX) {
          p.dirty = true;
          return false;
        }
        idx = p.bag.length;
        p.bag.push(null);
      }
      const put = Math.min(999, left);
      p.bag[idx] = { item, rarity, count: put };
      left -= put;
    }

    p.dirty = true;
    return true;
  }

  /** Removes up to `count` cards of item+rarity from a player's bag. Returns how many were actually removed. */
  private takeFromBag(p: Player, item: number, rarity: number, count: number): number {
    let need = count;
    for (let i = 0; i < p.bag.length && need > 0; i++) {
      const cell = p.bag[i];
      if (!cell || cell.item !== item || cell.rarity !== rarity) continue;
      const take = Math.min(need, cell.count);
      cell.count -= take;
      need -= take;
      if (cell.count <= 0) p.bag[i] = null;
    }
    return count - need;
  }

  private countOf(p: Player, item: number, rarity: number): number {
    let have = 0;
    for (const cell of p.bag) if (cell && cell.item === item && cell.rarity === rarity) have += cell.count;
    return have;
  }

  /** Combine exactly five cards of `item`+`rarity` in one craft attempt. */
  private craft(c: ClientState, p: Player, item: number, rarity: number) {
    if (item >= ITEMS.length || ITEMS[item].kind === "trinket") return;
    const successRate = craftChanceFor(rarity);
    if (rarity >= MAX_CRAFT_RARITY || successRate === undefined) return;
    if (this.countOf(p, item, rarity) < CRAFT_CARD_COUNT) return;

    const used = this.takeFromBag(p, item, rarity, CRAFT_CARD_COUNT);
    if (used !== CRAFT_CARD_COUNT) return;

    if (Math.random() < successRate) {
      this.addItem(p, item, rarity + 1);
      this.pushEvent(c, EVT.CRAFT_OK, p.x, p.y, 1, item, rarity + 1);
    } else {
      // A failed attempt destroys 1-4 cards; the rest are returned to the bag.
      const destroyed = 1 + Math.floor(Math.random() * (CRAFT_CARD_COUNT - 1));
      this.addItem(p, item, rarity, CRAFT_CARD_COUNT - destroyed);
      this.pushEvent(c, EVT.CRAFT_FAIL, p.x, p.y, destroyed, item, rarity);
    }
    p.dirty = true;
  }

  /** Guaranteed rarity skip (no RNG) at the cost of many cards and a long cooldown. */
  private oracle(c: ClientState, p: Player, item: number, rarity: number) {
    if (item >= ITEMS.length || ITEMS[item].kind === "trinket") return;
    const required = oracleRequiredCount(rarity);
    if (required === undefined) return;
    if (Date.now() < p.nextOracleAt) return;
    const have = this.countOf(p, item, rarity);
    if (have < required) return;

    this.takeFromBag(p, item, rarity, required);
    const targetRarity = rarity + ORACLE_SKIP;
    this.addItem(p, item, targetRarity, 1);
    p.nextOracleAt = Date.now() + ORACLE_COOLDOWN_HOURS * 3600 * 1000;
    this.pushEvent(c, EVT.ORACLE_OK, p.x, p.y, 0, item, targetRarity);
    p.dirty = true;
    p.statsDirty = true;
  }

  /** Converts cards into Coin trinkets (1:1) on a cooldown — a way to cash out unwanted rarities. */
  private trade(c: ClientState, p: Player, item: number, rarity: number, requestedCount: number) {
    if (item >= ITEMS.length || ITEMS[item].kind === "trinket") return;
    if (Date.now() < p.nextTradeAt) return;
    const have = this.countOf(p, item, rarity);
    const want = requestedCount > 0 ? Math.min(requestedCount, have) : have;
    if (want <= 0) return;

    const used = this.takeFromBag(p, item, rarity, want);
    if (used <= 0) return;
    this.addItem(p, TRINKET_ITEM, rarity, used);
    p.nextTradeAt = Date.now() + TRADE_COOLDOWN_HOURS * 3600 * 1000;
    this.pushEvent(c, EVT.TRADE_OK, p.x, p.y, used, TRINKET_ITEM, rarity);
    p.dirty = true;
    p.statsDirty = true;
  }

  // --------------------------------------------------------------- spawning
  private spawnPlayer(p: Player) {
    const map = MAPS[p.mapId];
    // Try to spawn near a grid spawn point first
    const spawnTiles = findSpawnTiles(p.mapId);
    if (spawnTiles.length > 0) {
      const tile = spawnTiles[Math.floor(Math.random() * spawnTiles.length)];
      const tileW = map.width / BLOCK_GRID_COLS;
      const tileH = map.height / BLOCK_GRID_ROWS;
      // Random position within the spawn-point tile
      for (let tries = 0; tries < 20; tries++) {
        const x = tile.col * tileW + Math.random() * tileW;
        const y = tile.row * tileH + Math.random() * tileH;
        const [cx, cy] = collideWalls(map.walls, x, y, 40);
        if (Math.abs(cx - x) < 0.01 && Math.abs(cy - y) < 0.01) {
          p.x = x;
          p.y = y;
          p.hp = p.maxHp;
          p.alive = true;
          p.statsDirty = true;
          return;
        }
      }
    }
    // Fallback: random position (original behaviour)
    for (let tries = 0; tries < 60; tries++) {
      const x = 200 + Math.random() * (map.width - 400);
      const y = 200 + Math.random() * (map.height - 400);
      const [cx, cy] = collideWalls(map.walls, x, y, 40);
      if (Math.abs(cx - x) < 0.01 && Math.abs(cy - y) < 0.01) {
        p.x = x;
        p.y = y;
        break;
      }
      p.x = x;
      p.y = y;
    }
    p.hp = p.maxHp;
    p.alive = true;
    p.statsDirty = true;
  }

  private spawnMob(mapId: number) {
    const map = MAPS[mapId];
    const type = map.mobs[(Math.random() * map.mobs.length) | 0];
    let rarity = 0;
    let x = 0;
    let y = 0;
    let zone: string = "1";
    for (let tries = 0; tries < 80; tries++) {
      x = 200 + Math.random() * (map.width - 400);
      y = 200 + Math.random() * (map.height - 400);
      zone = getBlockAt(mapId, x, y);
      // Only spawn in zone tiles (A-G); skip walls ('1').
      // Spawn points are mapped to zone 'A' by getBlockAt.
      if (zone === "1") continue;
      const [cx, cy] = collideWalls(map.walls, x, y, MOBS[type].radius + 6);
      if (Math.abs(cx - x) < 0.01 && Math.abs(cy - y) < 0.01) break;
    }
    // Roll rarity from the block zone system.
    // getBlockAt maps spawn points ('2') → zone 'A', so only '1' or 'A'-'G'
    // can appear here. The fallback handles the rare case where all 80 retries
    // landed on walls and zone is still '1'.
    if (zone >= "A" && zone <= "G") {
      rarity = rollZoneRarity(zone);
    } else {
      rarity = 0;
    }
    this.worlds[mapId].mobs.push(new Mob(this.nextId++, type, mapId, x, y, rarity));
  }

  private applyLevel(p: Player) {
    const lvl = levelFromXp(p.xp);
    const maxHp = 110 + lvl * 16;
    if (maxHp !== p.maxHp) {
      const ratio = p.hp / p.maxHp;
      p.maxHp = maxHp;
      p.hp = Math.min(maxHp, Math.max(1, ratio * maxHp));
    }
    if (lvl !== p.level) {
      p.level = lvl;
      p.statsDirty = true;
    }
  }

  /** Immediately despawn every friendly mob tied to one summon slot. */
  private despawnPets(p: Player, slot: number) {
    const pets = p.pets[slot] || [];
    if (pets.length <= 0) return;
    for (const pet of pets) {
      const world = this.worlds[pet.mapId];
      if (world) world.mobs = world.mobs.filter((m) => m !== pet);
    }
    p.pets[slot] = [];
  }

  private rebuildPetals(p: Player) {
    const petals: PetalState[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const old = p.petals[i];
      const cell = p.slots[i];
      const def = cell ? ITEMS[cell.item] : null;
      // Summons orbit as normal petals too — they only vanish while reloading
      // right after they hatch a mob.
      const orbits = !!def && orbitsAsPetal(def.kind);
      const maxHp = orbits ? def!.health * rarityMult(cell!.rarity) : 1;
      petals.push({
        id: old?.id ?? this.nextId++,
        alive: orbits,
        hp: maxHp,
        maxHp,
        timer: 0,
        x: p.x,
        y: p.y,
        hitCd: 0,
      });
      // A summon's pets only live while the exact same egg stays equipped in
      // that same main hotbar slot. Moving/removing/upgrading the egg despawns
      // its old pets instantly; a freshly equipped egg can hatch new ones later.
      const pets = p.pets[i] || [];
      const sameSummon =
        !!cell
        && !!def
        && def.kind === "summon"
        && pets.every((pet) => pet.type === def.petMob && pet.sourceItem === cell.item && pet.sourceRarity === cell.rarity);
      if (pets.length > 0 && !sameSummon) this.despawnPets(p, i);
    }
    p.petals = petals;
  }

  // ------------------------------------------------------------------ tick
  tick(dt: number) {
    this.tickCount++;
    const players: Player[] = [];
    for (const c of this.clients.values()) if (c.player) players.push(c.player);

    for (const p of players) this.updatePlayer(p, dt, players);
    for (let m = 0; m < MAPS.length; m++) this.updateWorld(m, dt, players);
    for (const p of players) this.updatePetals(p, dt);
    for (const p of players) this.pickupDrops(p);

    for (const c of this.clients.values()) this.sendState(c);
  }

  private updatePlayer(p: Player, dt: number, players: Player[]) {
    if (!p.alive) return;
    const map = MAPS[p.mapId];
    let speedBonus = 0;
    let heal = 0;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = p.slots[i];
      if (!cell) continue;
      const def = ITEMS[cell.item];
      // Summons orbit like petals, so a reloading one stops granting its
      // passive stats exactly like a broken petal does.
      const alive = orbitsAsPetal(def.kind) ? p.petals[i]?.alive : true;
      if (!alive) continue;
      if (def.speed) speedBonus += def.speed * (1 + cell.rarity * 0.12);
      if (def.heal) heal += def.heal * rarityMult(cell.rarity) * 0.5;
    }
    const speed = (190 + p.level * 0.8) * (1 + speedBonus / 100);
    const mag = Math.hypot(p.inDx, p.inDy);
    const nx = mag > 1 ? p.inDx / mag : p.inDx;
    const ny = mag > 1 ? p.inDy / mag : p.inDy;
    p.vx += (nx * speed - p.vx) * Math.min(1, dt * 9);
    p.vy += (ny * speed - p.vy) * Math.min(1, dt * 9);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.x = clamp(p.x, 20, map.width - 20);
    p.y = clamp(p.y, 20, map.height - 20);
    const [cx, cy] = collideWalls(map.walls, p.x, p.y, PLAYER_RADIUS);
    p.x = cx;
    p.y = cy;

    // player vs player soft collision
    for (const o of players) {
      if (o === p || o.mapId !== p.mapId || !o.alive) continue;
      const dx = p.x - o.x;
      const dy = p.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d < PLAYER_RADIUS * 2 && d > 0.001) {
        const push = (PLAYER_RADIUS * 2 - d) * 0.5;
        p.x += (dx / d) * push;
        p.y += (dy / d) * push;
      }
    }

    if (heal > 0 && p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + heal * dt);
      p.statsDirty = true;
    }
    p.hurtCd = Math.max(0, p.hurtCd - dt);

    const attack = (p.flags & 1) !== 0;
    const defend = (p.flags & 2) !== 0;
    const targetOrbit = attack ? 118 : defend ? 34 : 62;
    p.orbit += (targetOrbit - p.orbit) * Math.min(1, dt * 6);
    p.baseAngle += dt * (attack ? 3.4 : 2.2);
    this.applyLevel(p);
  }

  private updatePetals(p: Player, dt: number) {
    if (!p.alive) return;
    const world = this.worlds[p.mapId];
    let liveCount = 0;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = p.slots[i];
      if (!cell) continue;
      if (orbitsAsPetal(ITEMS[cell.item].kind)) liveCount++;
    }
    let index = 0;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = p.slots[i];
      const st = p.petals[i];
      if (!cell || !st) continue;
      const def = ITEMS[cell.item];
      const isSummon = def.kind === "summon";
      if (!orbitsAsPetal(def.kind)) continue;
      // Drop pets that died / left the map before deciding whether to hatch.
      if (isSummon) this.cleanupPets(p, i);
      const slotAngle = p.baseAngle + (index / Math.max(1, liveCount)) * Math.PI * 2;
      index++;
      st.hitCd = Math.max(0, st.hitCd - dt);
      if (!st.alive) {
        st.timer -= dt;
        if (st.timer <= 0) {
          st.alive = true;
          st.maxHp = def.health * rarityMult(cell.rarity);
          st.hp = st.maxHp;
        }
        continue;
      }
      // A summon that is orbiting (i.e. finished reloading) immediately hatches
      // the next missing pet, then goes back into reload. It only shows up as a
      // normal petal while its pets are out fighting.
      if (isSummon && (p.pets[i]?.length ?? 0) < getSummonCount(cell.item)) {
        this.hatchPet(p, i, cell);
        st.alive = false;
        st.hp = 0;
        st.timer = def.reload;
        continue;
      }
      const tx = p.x + Math.cos(slotAngle) * p.orbit;
      const ty = p.y + Math.sin(slotAngle) * p.orbit;
      st.x += (tx - st.x) * Math.min(1, dt * 14);
      st.y += (ty - st.y) * Math.min(1, dt * 14);

      const dmg = def.damage * rarityMult(cell.rarity);
      const pr = def.radius * (1 + cell.rarity * 0.06);
      let targetMob: Mob | null = null;
      let targetDist = Infinity;
      let totalIncoming = 0;
      for (const mob of world.mobs) {
        if (mob.friendly) continue;
        const d = Math.hypot(mob.x - st.x, mob.y - st.y);
        if (d >= mob.radius + pr) continue;
        totalIncoming += mob.damage * 0.5;
        if (d < targetDist) {
          targetDist = d;
          targetMob = mob;
        }
      }
      if (targetMob && st.hitCd <= 0) {
        targetMob.hp -= dmg;
        targetMob.lastHitBy = p.id;
        targetMob.targetId = p.id;
        st.hp -= totalIncoming;
        st.hitCd = 0.25;
        const kb = 90 / (targetMob.radius / 20);
        targetMob.vx += ((targetMob.x - st.x) / (targetDist || 1)) * kb;
        targetMob.vy += ((targetMob.y - st.y) / (targetDist || 1)) * kb;
        if (st.hp <= 0) {
          st.alive = false;
          st.timer = def.reload;
          if (isSummon) this.despawnPets(p, i);
        }
      }
    }
  }

  /** Drops dead / off-map pets from a summon slot's live list. */
  private cleanupPets(p: Player, slot: number) {
    const pets = p.pets[slot] || [];
    const activePets: Mob[] = [];
    for (const pet of pets) {
      if (pet && pet.hp > 0 && pet.mapId === p.mapId) {
        activePets.push(pet);
      } else if (pet) {
        const w = this.worlds[pet.mapId];
        if (w) w.mobs = w.mobs.filter((m) => m !== pet);
      }
    }
    p.pets[slot] = activePets;
  }

  /**
   * Hatches this summon's batch of pets for `slot`. The caller puts the summon
   * petal into reload afterwards.
   *
   * Batch size, cap and spawn protection all come from `SUMMON_CFG`, so a new
   * egg is a data row rather than a new spawn method.
   */
  private hatchPet(p: Player, slot: number, cell: Cell) {
    const def = ITEMS[cell.item];
    if (def.petMob === undefined) return;

    const pets = p.pets[slot] || [];
    const room = getSummonCount(cell.item) - pets.length;
    const toSpawn = Math.min(getSummonBatch(cell.item), Math.max(0, room));
    if (toSpawn <= 0) return;

    // One rarity roll per cycle, so a batch hatches as a matched set.
    const rarity = this.getSummonRarityWithDna(p, cell);
    const protection = getSpawnProtection(cell.item);
    const map = MAPS[p.mapId];

    for (let i = 0; i < toSpawn; i++) {
      // Scatter around the player instead of always the same corner offset.
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 30;
      const x = clamp(p.x + Math.cos(angle) * dist, 40, map.width - 40);
      const y = clamp(p.y + Math.sin(angle) * dist, 40, map.height - 40);

      const m = new Mob(this.nextId++, def.petMob, p.mapId, x, y, rarity, true);
      m.ownerId = p.id;
      m.ownerSlot = slot;
      m.sourceItem = cell.item;
      m.sourceRarity = cell.rarity;
      m.maxHp = Math.round(m.maxHp * 1.4);
      m.hp = m.maxHp;
      // Keep summon damage fair: a friendly mob hits exactly as hard as the
      // same wild mob at the same rarity.
      m.speed = Math.max(70, m.speed * 1.5);
      m.spawnProtection = protection;
      this.worlds[p.mapId].mobs.push(m);
      pets.push(m);
    }
    p.pets[slot] = pets;
  }

  /**
   * Rarity of the mob a summon hatches.
   *
   * The egg's own rarity is normally mapped one tier down
   * (`mapRarityToSummonRarity`); eggs flagged `noDowngrade` hatch at their own
   * rarity. If the player has an equipped, unbroken DNA petal of at least the
   * egg's rarity, the hatch gets a small chance (base 1%, plus the clover
   * bonus) to come out one tier *above* the mapped rarity.
   *
   * No DNA item exists in ITEMS yet — the lookup below is intentionally kept so
   * that adding one (`kind: "dna"`) enables the mechanic with no further work.
   */
  private getSummonRarityWithDna(p: Player, cell: Cell): number {
    const def = ITEMS[cell.item];
    if (!def || def.kind !== "summon") return 0;

    const summonRarity = Math.max(0, Math.min(MAX_RARITY, cell.rarity));
    const mappedRarity = def.noDowngrade ? summonRarity : mapRarityToSummonRarity(summonRarity);

    // Look for an equipped, unbroken DNA petal at least as rare as the egg.
    let hasValidDna = false;
    const cloverRarities: number[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const other = p.slots[i];
      if (!other) continue;
      const otherDef = ITEMS[other.item];
      const st = p.petals[i];
      const broken = st ? !st.alive : false;
      if (broken) continue;
      if (otherDef.kind === "dna" && other.rarity >= summonRarity) hasValidDna = true;
      if (other.item === CLOVER_ITEM) cloverRarities.push(other.rarity);
    }

    if (!hasValidDna) return mappedRarity;

    const totalChance = Math.min(1, DNA_UPGRADE_BASE_CHANCE + cloverDnaBonus(cloverRarities));
    if (Math.random() < totalChance && mappedRarity < MAX_RARITY) return mappedRarity + 1;
    return mappedRarity;
  }

  private updateWorld(mapId: number, dt: number, players: Player[]) {
    const map = MAPS[mapId];
    const world = this.worlds[mapId];
    const here = players.filter((p) => p.mapId === mapId && p.alive);

    for (let i = world.mobs.length - 1; i >= 0; i--) {
      const mob = world.mobs[i];
      mob.hitCd = Math.max(0, mob.hitCd - dt);
      mob.spawnProtection = Math.max(0, mob.spawnProtection - dt);

      // targeting
      let target: { x: number; y: number; id: number } | null = null;
      let best = Infinity;
      if (mob.friendly) {
        for (const other of world.mobs) {
          if (other.friendly) continue;
          const d = Math.hypot(other.x - mob.x, other.y - mob.y);
          if (d < 520 && d < best) {
            best = d;
            target = other;
          }
        }
        const owner = here.find((p) => p.id === mob.ownerId);
        if (owner) {
          const od = Math.hypot(owner.x - mob.x, owner.y - mob.y);
          if (!target || od > 260) target = { x: owner.x, y: owner.y, id: owner.id };
        }
      } else {
        for (const p of here) {
          const d = Math.hypot(p.x - mob.x, p.y - mob.y);
          if (d < 460 && d < best) {
            best = d;
            target = { x: p.x, y: p.y, id: p.id };
          }
        }
        for (const other of world.mobs) {
          if (!other.friendly) continue;
          const d = Math.hypot(other.x - mob.x, other.y - mob.y);
          if (d < 380 && d < best) {
            best = d;
            target = other;
          }
        }
      }

      if (target && mob.speed > 0) {
        const dx = target.x - mob.x;
        const dy = target.y - mob.y;
        const d = Math.hypot(dx, dy) || 1;
        mob.vx += ((dx / d) * mob.speed - mob.vx) * Math.min(1, dt * 4);
        mob.vy += ((dy / d) * mob.speed - mob.vy) * Math.min(1, dt * 4);
        mob.angle = Math.atan2(dy, dx);
      } else if (mob.speed > 0) {
        mob.wander -= dt;
        if (mob.wander <= 0) {
          mob.wander = 1.5 + Math.random() * 3;
          mob.angle = Math.random() * Math.PI * 2;
        }
        mob.vx += (Math.cos(mob.angle) * mob.speed * 0.4 - mob.vx) * Math.min(1, dt * 2);
        mob.vy += (Math.sin(mob.angle) * mob.speed * 0.4 - mob.vy) * Math.min(1, dt * 2);
      } else {
        mob.vx *= 0.9;
        mob.vy *= 0.9;
      }

      mob.x += mob.vx * dt;
      mob.y += mob.vy * dt;
      mob.x = clamp(mob.x, mob.radius, map.width - mob.radius);
      mob.y = clamp(mob.y, mob.radius, map.height - mob.radius);
      const [cx, cy] = collideWalls(map.walls, mob.x, mob.y, mob.radius);
      mob.x = cx;
      mob.y = cy;

      // mob vs mob collision box
      for (const other of world.mobs) {
        if (other === mob) continue;
        const dx = mob.x - other.x;
        const dy = mob.y - other.y;
        const d = Math.hypot(dx, dy);
        const min = mob.radius + other.radius;
        if (d < min && d > 0.001) {
          const push = (min - d) * 0.4;
          mob.x += (dx / d) * push;
          mob.y += (dy / d) * push;
          if (mob.friendly !== other.friendly && mob.hitCd <= 0) {
            // friendly pets fight hostiles
            const attacker = mob.friendly ? mob : other;
            const victim = mob.friendly ? other : mob;
            // A just-hatched pet can't be chipped down before it gets moving.
            if (victim.spawnProtection <= 0) {
              victim.hp -= attacker.damage * 0.6;
              victim.lastHitBy = attacker.ownerId;
            }
            if (attacker.spawnProtection <= 0) attacker.hp -= victim.damage * 0.3;
            mob.hitCd = 0.5;
            other.hitCd = 0.5;
          }
        }
      }

      // hostile mob vs players
      if (!mob.friendly) {
        for (const p of here) {
          const d = Math.hypot(p.x - mob.x, p.y - mob.y);
          if (d < mob.radius + PLAYER_RADIUS) {
            const push = (mob.radius + PLAYER_RADIUS - d) * 0.5;
            const ux = (p.x - mob.x) / (d || 1);
            const uy = (p.y - mob.y) / (d || 1);
            p.x += ux * push;
            p.y += uy * push;
            mob.x -= ux * push * 0.4;
            mob.y -= uy * push * 0.4;
            if (p.hurtCd <= 0) {
              p.hp -= mob.damage;
              p.hurtCd = 0.55;
              p.statsDirty = true;
              const c = this.clientOf(p.id);
              if (c) this.pushEvent(c, EVT.HIT, p.x, p.y, Math.round(mob.damage));
              if (p.hp <= 0) this.killPlayer(p);
            }
          }
        }
      }

      if (mob.hp <= 0) {
        world.mobs.splice(i, 1);
        if (mob.friendly) {
          const owner = here.find((p) => p.id === mob.ownerId);
          if (owner && mob.ownerSlot >= 0) {
            // The slot's summon petal re-hatches (and re-enters reload) on the
            // next tick, as soon as it is done orbiting.
            owner.pets[mob.ownerSlot] = (owner.pets[mob.ownerSlot] || []).filter((m) => m !== mob);
          }
          continue;
        }
        this.onMobKilled(mob, mapId);
        continue;
      }
    }

    // drops
    for (let i = world.drops.length - 1; i >= 0; i--) {
      const d = world.drops[i];
      d.ttl -= dt;
      if (d.ttl <= 0) world.drops.splice(i, 1);
    }

    // respawn mobs
    const hostiles = world.mobs.filter((m) => !m.friendly).length;
    if (hostiles < this.mobCapForMap(mapId) && Math.random() < 0.5) this.spawnMob(mapId);
  }

  /**
   * Extra whole copies of every drop this player earns, on top of the base one.
   *
   * Mirrors the reference `bonusMultiplier + membershipDropRate` maths. Neither
   * a bonus/event system nor a shop membership exists here yet, so both terms
   * are 0 and every kill drops a single copy — wiring either one up later only
   * needs this method to return a bigger number.
   */
  private dropMultiplierFor(_p: Player | null): number {
    const bonusMultiplier = 1; // event / bonus system multiplier
    const membershipDropRate = 0; // shop membership bonus
    return Math.max(1, Math.floor(bonusMultiplier + membershipDropRate));
  }

  /**
   * Highest-rarity Magic Core equipped in the player's hotbar, or -1 if none.
   * A Core lets magic item variants drop and caps (never raises) their rarity.
   */
  private magicCoreRarity(p: Player | null): number {
    if (!p || MAGIC_CORE_ITEM < 0) return -1;
    let best = -1;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = p.slots[i];
      if (cell && cell.item === MAGIC_CORE_ITEM && cell.rarity > best) best = cell.rarity;
    }
    return best;
  }

  private onMobKilled(mob: Mob, mapId: number) {
    // Friendly pets never drop loot — they just despawn.
    if (mob.friendly) return;

    const def = MOBS[mob.type];
    const map = MAPS[mapId];
    const world = this.worlds[mapId];
    const killerClient = mob.lastHitBy ? this.clientOf(mob.lastHitBy) : null;
    const killer = killerClient?.player ?? null;

    if (killer) {
      const xp = Math.round(def.xp * (1 + mob.rarity * 0.9));
      killer.xp += xp;
      this.applyLevel(killer);
      killer.statsDirty = true;
      this.pushEvent(killerClient!, EVT.XP, mob.x, mob.y, xp);
      this.pushEvent(killerClient!, EVT.KILL, mob.x, mob.y, mob.type);
    }

    // Keep the ground from filling up with stale cards: once the map is at the
    // cap the oldest few are swept away so fresh loot always has a home.
    if (world.drops.length >= MAX_DROPPED_CARDS) {
      world.drops.splice(0, DROP_TRIM_COUNT);
    }

    const dropCount = this.dropMultiplierFor(killer);
    const coreRarity = this.magicCoreRarity(killer);

    // The map's rarity bias still nudges the mob's rarity a bit before we hand
    // it to the per-item drop table, matching the old "rarer map = better drops"
    // feel. We just don't bake the roll into a single number anymore.
    const biasedRarityIndex = (() => {
      let r = mob.rarity;
      while (r < MAX_WILD_DROP_RARITY && Math.random() < 0.14 + map.rarityBias) r++;
      if (Math.random() < 0.35 && r > 0) r--;
      return Math.max(0, Math.min(MAX_RARITY, r));
    })();
    const mobRarityName = RARITIES[biasedRarityIndex].name;

    const rarityIndexOf = (name: string) =>
      Math.max(0, Math.min(MAX_RARITY, RARITIES.findIndex((r) => r.name === name)));

    // Roll every entry of the drop table first, then lay the winners out in a
    // small ring. Scattering them deterministically (rather than at random)
    // guarantees a 2- or 3-item drop never stacks into what looks like one card.
    const rolled: { item: number; rarity: number }[] = [];
    for (const drop of def.drops) {
      for (let i = 0; i < dropCount; i++) {
        if (Math.random() > drop.chance) continue;

        // Normal item: rolled straight off the per-item table, untouched by any
        // Magic Core the player may be holding.
        let item = drop.item;
        let rarity = rarityIndexOf(getDropRarityByItem(drop.item, mobRarityName));

        // Magic variant: only reachable while a Magic Core is equipped, and only
        // when the variant's own roll beats Common. The Core then clamps the
        // result down to its own rarity — it can never push a drop higher.
        const magicItem = MAGIC_ITEM_MAP[drop.item];
        if (magicItem !== undefined && coreRarity >= 0) {
          const magicRarity = rarityIndexOf(getDropRarityByItem(magicItem, mobRarityName));
          if (magicRarity > 0) {
            item = magicItem;
            rarity = Math.min(magicRarity, coreRarity);
          }
        }

        rolled.push({ item, rarity });
      }
    }

    const spread = rolled.length > 1 ? 26 : 0;
    const baseAngle = Math.random() * Math.PI * 2;
    rolled.forEach((roll, idx) => {
      const a = baseAngle + (idx / rolled.length) * Math.PI * 2;
      const dist = spread * (1 + Math.floor(idx / def.drops.length) * 0.5);
      const x = mob.x + Math.cos(a) * dist + (Math.random() - 0.5) * 10;
      const y = mob.y + Math.sin(a) * dist + (Math.random() - 0.5) * 10;
      this.spawnDrop(mapId, roll.item, roll.rarity, x, y, killer ? killer.id : 0);
    });
  }

  /**
   * Drops one card, merging it into a nearby identical card when possible so a
   * busy field reads as a few stacked cards instead of a carpet of singles.
   */
  private spawnDrop(mapId: number, item: number, rarity: number, x: number, y: number, ownerId: number) {
    const world = this.worlds[mapId];
    for (const d of world.drops) {
      if (d.item !== item || d.rarity !== rarity || d.count >= DROP_STACK_MAX) continue;
      if (Math.hypot(d.x - x, d.y - y) > DROP_STACK_RADIUS) continue;
      d.count++;
      d.ttl = Math.max(d.ttl, 45); // refresh so a growing stack doesn't expire mid-fight
      if (d.ownerId !== ownerId) d.ownerId = 0; // contested stack: nobody gets vacuum priority
      return;
    }
    world.drops.push(new Drop(this.nextId++, mapId, x, y, item, rarity, ownerId));
  }

  private killPlayer(p: Player) {
    p.alive = false;
    p.hp = 0;
    p.statsDirty = true;
    const world = this.worlds[p.mapId];
    world.mobs = world.mobs.filter((m) => m.ownerId !== p.id);
    for (let i = 0; i < SLOT_COUNT; i++) p.pets[i] = [];
    const c = this.clientOf(p.id);
    if (c) this.pushEvent(c, EVT.DEATH, p.x, p.y, p.level);
  }

  private pickupDrops(p: Player) {
    if (!p.alive) return;
    const world = this.worlds[p.mapId];
    let lootedThisTick = 0;
    for (let i = world.drops.length - 1; i >= 0; i--) {
      const d = world.drops[i];
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      if (dist < 46) {
        // A stacked card hands over every merged copy at once.
        if (this.addItem(p, d.item, d.rarity, d.count)) {
          world.drops.splice(i, 1);
          const c = this.clientOf(p.id);
          // Spread the loot floaters out a little so a mob that dropped 2-3
          // items reads as 2-3 pickups instead of one overlapping label.
          if (c) this.pushEvent(c, EVT.LOOT, d.x, d.y - (lootedThisTick++ % 3) * 18, 0, d.item, d.rarity);
        }
      } else if (dist < (d.ownerId === p.id ? 900 : 160)) {
        const k = d.ownerId === p.id ? 0.05 : 0.06;
        d.x += (p.x - d.x) * k;
        d.y += (p.y - d.y) * k;
      }
    }
  }

  // ------------------------------------------------------------ state sync
  private sendState(c: ClientState) {
    const p = c.player;
    if (!p) return;
    const world = this.worlds[p.mapId];
    const w = new Writer(4096);
    w.u8(S2C.SNAPSHOT).u32(this.tickCount);
    let count = 0;
    const viewX = 1300;
    const viewY = 950;
    const inView = (x: number, y: number) => Math.abs(x - p.x) < viewX && Math.abs(y - p.y) < viewY;

    const body = new Writer(4096);
    // players
    for (const other of this.clients.values()) {
      const op = other.player;
      if (!op || op.mapId !== p.mapId || !op.alive) continue;
      if (op !== p && !inView(op.x, op.y)) continue;
      body
        .u8(ENT.PLAYER)
        .u16(op.id)
        .u8(op.flags)
        .u8(op === p ? TEAM.SELF : TEAM.FRIENDLY)
        .i16(Math.round(op.x))
        .i16(Math.round(op.y))
        .u16(Math.round(((op.baseAngle % (Math.PI * 2)) / (Math.PI * 2)) * 65535))
        .u8(Math.round(PLAYER_RADIUS))
        .u8(Math.round((op.hp / op.maxHp) * 255))
        .str(op.name);
      count++;
      // petals belonging to this player (summons orbit as petals too, and are
      // simply absent from the snapshot while reloading)
      for (let i = 0; i < SLOT_COUNT; i++) {
        const cell = op.slots[i];
        const st = op.petals[i];
        if (!cell || !st || !st.alive) continue;
        if (!orbitsAsPetal(ITEMS[cell.item].kind)) continue;
        body
          .u8(ENT.PETAL)
          .u16(st.id)
          .u8(cell.item)
          .u8(cell.rarity)
          .i16(Math.round(st.x))
          .i16(Math.round(st.y))
          .u16(0)
          .u8(Math.round(ITEMS[cell.item].radius * (1 + cell.rarity * 0.06)))
          .u8(Math.round((st.hp / st.maxHp) * 255));
        count++;
      }
    }
    // mobs
    for (const mob of world.mobs) {
      if (!inView(mob.x, mob.y)) continue;
      body
        .u8(ENT.MOB)
        .u16(mob.id)
        .u8(mob.type)
        .u8(mob.friendly ? (mob.ownerId === p.id ? TEAM.SELF : TEAM.FRIENDLY) : TEAM.HOSTILE)
        .i16(Math.round(mob.x))
        .i16(Math.round(mob.y))
        .u16(Math.round((((mob.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2)) * 65535))
        .u8(Math.min(255, Math.round(mob.radius)))
        .u8(Math.max(0, Math.round((mob.hp / mob.maxHp) * 255)))
        .u8(mob.rarity);
      count++;
    }
    // drops
    for (const d of world.drops) {
      if (!inView(d.x, d.y)) continue;
      // The drop entity has no health, so its hp byte carries the stack count.
      body
        .u8(ENT.DROP)
        .u16(d.id)
        .u8(d.item)
        .u8(d.rarity)
        .i16(Math.round(d.x))
        .i16(Math.round(d.y))
        .u16(0)
        .u8(12)
        .u8(Math.min(255, d.count));
      count++;
    }
    // Per-slot reload progress (0..255, 255 = ready) trails the entity list so
    // the hotbar can draw a live reload sweep on every petal and summon.
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = p.slots[i];
      const st = p.petals[i];
      const def = cell ? ITEMS[cell.item] : null;
      if (!cell || !st || !def || !orbitsAsPetal(def.kind) || st.alive) {
        body.u8(255);
        continue;
      }
      const total = def.reload > 0 ? def.reload : 1;
      const progress = 1 - Math.max(0, Math.min(1, st.timer / total));
      body.u8(Math.round(progress * 255));
    }

    // Per-slot health/damage (0..255, 255 = full health)
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = p.slots[i];
      const st = p.petals[i];
      if (!cell || !st || !st.alive) {
        body.u8(255);
        continue;
      }
      const maxHp = st.maxHp > 0 ? st.maxHp : 1;
      body.u8(Math.max(0, Math.min(255, Math.round((st.hp / maxHp) * 255))));
    }

    w.u16(count);
    const head = w.bytes();
    const tail = body.bytes();
    const packet = new Uint8Array(head.length + tail.length);
    packet.set(head, 0);
    packet.set(tail, head.length);
    c.send(packet);

    if (p.dirty) {
      p.dirty = false;
      const iw = new Writer(256);
      iw.u8(S2C.INVENTORY).u8(SLOT_COUNT);
      for (const cell of p.slots) writeCell(iw, cell);
      // Secondary row rides along right after the main row.
      iw.u8(SECONDARY_SLOT_COUNT);
      for (let i = 0; i < SECONDARY_SLOT_COUNT; i++) writeCell(iw, p.secondary[i] ?? null);
      // The bag can grow past BAG_COUNT, so its length is sent as u16. Trailing
      // empty cells are trimmed (never below BAG_COUNT) to keep the packet small.
      let bagLen = p.bag.length;
      while (bagLen > BAG_COUNT && !p.bag[bagLen - 1]) bagLen--;
      iw.u16(bagLen);
      for (let i = 0; i < bagLen; i++) writeCell(iw, p.bag[i] ?? null);
      c.send(iw.bytes());
    }
    if (p.statsDirty || this.tickCount % 10 === 0) {
      p.statsDirty = false;
      const now = Date.now();
      const oracleSecLeft = Math.max(0, Math.ceil((p.nextOracleAt - now) / 1000));
      const tradeSecLeft = Math.max(0, Math.ceil((p.nextTradeAt - now) / 1000));
      const sw = new Writer(24);
      sw
        .u8(S2C.STATS)
        .u32(p.xp)
        .u16(p.level)
        .u16(Math.max(0, Math.round(p.hp)))
        .u16(Math.round(p.maxHp))
        .u8(p.mapId)
        .u8(p.alive ? 1 : 0)
        .u32(oracleSecLeft)
        .u32(tradeSecLeft);
      c.send(sw.bytes());
    }
    for (const e of c.events) c.send(e);
    c.events.length = 0;
  }
}

function writeCell(w: Writer, cell: Cell | null) {
  if (!cell || cell.count <= 0) w.u8(EMPTY_ITEM).u8(0).u16(0);
  else w.u8(cell.item).u8(cell.rarity).u16(Math.min(65535, cell.count));
}

function readCell(r: Reader): Cell | null {
  const item = r.u8();
  const rarity = r.u8();
  const count = r.u16();
  if (item === EMPTY_ITEM || count <= 0 || item >= ITEMS.length) return null;
  return { item, rarity: Math.min(rarity, MAX_RARITY), count };
}

export { writeCell, readCell };
