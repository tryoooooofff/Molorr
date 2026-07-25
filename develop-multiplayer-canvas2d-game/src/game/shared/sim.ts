// Authoritative game simulation. Runs on the node/ws server (server/index.ts)
// and, when no remote server is configured, inside the browser (local transport).

import {
  BAG_COUNT,
  CRAFT_CARD_COUNT,
  craftChanceFor,
  EMPTY_ITEM,
  ITEMS,
  MAPS,
  MAX_CRAFT_RARITY,
  MAX_RARITY,
  MAX_WILD_DROP_RARITY,
  MOBS,
  ORACLE_COOLDOWN_HOURS,
  ORACLE_SKIP,
  oracleRequiredCount,
  SLOT_COUNT,
  TOTAL_CELLS,
  TRADE_COOLDOWN_HOURS,
  TRINKET_ITEM,
  Wall,
  enemyRarityMult,
  levelFromXp,
  rarityMult,
} from "./defs";

import { C2S, ENT, EVT, Reader, S2C, TEAM, Writer } from "./protocol";


export interface Cell {
  item: number;
  rarity: number;
  count: number;
}

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
  bag: (Cell | null)[] = new Array(BAG_COUNT).fill(null);
  petals: PetalState[] = [];
  pets: (Mob | null)[] = new Array(SLOT_COUNT).fill(null);
  petTimer: number[] = new Array(SLOT_COUNT).fill(0);
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
  targetId = 0;
  wander = 0;
  hitCd = 0;
  radius: number;
  damage: number;
  speed: number;
  lastHitBy = 0;

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
    this.damage = def.damage * (1 + rarity * 0.35);
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
        const bagCount = r.u8();
        for (let i = 0; i < bagCount && i < BAG_COUNT; i++) p.bag[i] = readCell(r);
        // Cooldowns are stored client-side (same trust model as xp above) as
        // "seconds remaining" so they survive reconnects without clock-sync issues.
        const oracleSecLeft = r.u32();
        const tradeSecLeft = r.u32();
        const now = Date.now();
        p.nextOracleAt = oracleSecLeft > 0 ? now + oracleSecLeft * 1000 : 0;
        p.nextTradeAt = tradeSecLeft > 0 ? now + tradeSecLeft * 1000 : 0;
        if (!p.slots.some(Boolean) && !p.bag.some(Boolean)) {
          p.slots[0] = { item: 0, rarity: 0, count: 1 };
          p.slots[1] = { item: 0, rarity: 0, count: 1 };
          p.slots[2] = { item: 1, rarity: 0, count: 1 };
          p.slots[3] = { item: 0, rarity: 0, count: 1 };
          p.bag[0] = { item: 8, rarity: 0, count: 1 };
          p.bag[1] = { item: 2, rarity: 0, count: 1 };
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
        this.swapCells(p, r.u8(), r.u8());

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
        p.xp = Math.floor(p.xp * 0.75);
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
  private cellAt(p: Player, idx: number): Cell | null {
    return idx < SLOT_COUNT ? p.slots[idx] : p.bag[idx - SLOT_COUNT];
  }

  private setCell(p: Player, idx: number, cell: Cell | null) {
    if (idx < SLOT_COUNT) p.slots[idx] = cell;
    else p.bag[idx - SLOT_COUNT] = cell;
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
    if (a < SLOT_COUNT || b < SLOT_COUNT) this.rebuildPetals(p);
    p.dirty = true;
  }

  addItem(p: Player, item: number, rarity: number, count = 1): boolean {
    if (count <= 0) return true;
    for (const cell of p.bag) {
      if (cell && cell.item === item && cell.rarity === rarity && cell.count < 999) {
        cell.count = Math.min(999, cell.count + count);
        p.dirty = true;
        return true;
      }
    }
    for (let i = 0; i < BAG_COUNT; i++) {
      if (!p.bag[i]) {
        p.bag[i] = { item, rarity, count: Math.min(999, count) };
        p.dirty = true;
        return true;
      }
    }
    return false;
  }

  /** Removes up to `count` cards of item+rarity from a player's bag. Returns how many were actually removed. */
  private takeFromBag(p: Player, item: number, rarity: number, count: number): number {
    let need = count;
    for (let i = 0; i < BAG_COUNT && need > 0; i++) {
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
    while (rarity < 3 && Math.random() < 0.16 + map.rarityBias) rarity++;
    let x = 0;
    let y = 0;
    for (let tries = 0; tries < 40; tries++) {
      x = 200 + Math.random() * (map.width - 400);
      y = 200 + Math.random() * (map.height - 400);
      const [cx, cy] = collideWalls(map.walls, x, y, MOBS[type].radius + 6);
      if (Math.abs(cx - x) < 0.01 && Math.abs(cy - y) < 0.01) break;
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

  private rebuildPetals(p: Player) {
    const petals: PetalState[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const old = p.petals[i];
      const cell = p.slots[i];
      const def = cell ? ITEMS[cell.item] : null;
      const maxHp = def && def.kind === "petal" ? def.health * rarityMult(cell!.rarity) : 1;
      petals.push({
        id: old?.id ?? this.nextId++,
        alive: !!def && def.kind === "petal",
        hp: maxHp,
        maxHp,
        timer: 0,
        x: p.x,
        y: p.y,
        hitCd: 0,
      });
      // remove pet if slot no longer holds the same summon
      const pet = p.pets[i];
      if (pet && (!def || def.kind !== "summon" || ITEMS[cell!.item].petMob !== pet.type)) {
        const world = this.worlds[pet.mapId];
        world.mobs = world.mobs.filter((m) => m !== pet);
        p.pets[i] = null;
        p.petTimer[i] = 0;
      }
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
      const alive = def.kind === "petal" ? p.petals[i]?.alive : true;
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
    const [cx, cy] = collideWalls(map.walls, p.x, p.y, 26);
    p.x = cx;
    p.y = cy;

    // player vs player soft collision
    for (const o of players) {
      if (o === p || o.mapId !== p.mapId || !o.alive) continue;
      const dx = p.x - o.x;
      const dy = p.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d < 52 && d > 0.001) {
        const push = (52 - d) * 0.5;
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
    for (let i = 0; i < SLOT_COUNT; i++) if (p.slots[i] && ITEMS[p.slots[i]!.item].kind === "petal") liveCount++;
    let index = 0;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = p.slots[i];
      const st = p.petals[i];
      if (!cell || !st) continue;
      const def = ITEMS[cell.item];
      if (def.kind === "summon") {
        this.updatePet(p, i, cell.item, cell.rarity, dt);
        continue;
      }
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
      const tx = p.x + Math.cos(slotAngle) * p.orbit;
      const ty = p.y + Math.sin(slotAngle) * p.orbit;
      st.x += (tx - st.x) * Math.min(1, dt * 14);
      st.y += (ty - st.y) * Math.min(1, dt * 14);

      const dmg = def.damage * rarityMult(cell.rarity);
      const pr = def.radius * (1 + cell.rarity * 0.06);
      for (const mob of world.mobs) {
        if (mob.friendly) continue;
        const d = Math.hypot(mob.x - st.x, mob.y - st.y);
        if (d < mob.radius + pr && st.hitCd <= 0) {
          mob.hp -= dmg;
          mob.lastHitBy = p.id;
          mob.targetId = p.id;
          st.hp -= mob.damage * 0.5;
          st.hitCd = 0.25;
          const kb = 90 / (mob.radius / 20);
          mob.vx += ((mob.x - st.x) / (d || 1)) * kb;
          mob.vy += ((mob.y - st.y) / (d || 1)) * kb;
          if (st.hp <= 0) {
            st.alive = false;
            st.timer = def.reload;
          }
          break;
        }
      }
    }
  }

  private updatePet(p: Player, slot: number, item: number, rarity: number, dt: number) {
    const def = ITEMS[item];
    if (def.petMob === undefined) return;
    let pet = p.pets[slot];
    if (pet && (pet.hp <= 0 || pet.mapId !== p.mapId)) {
      const w = this.worlds[pet.mapId];
      w.mobs = w.mobs.filter((m) => m !== pet);
      p.pets[slot] = null;
      p.petTimer[slot] = def.reload;
      pet = null;
    }
    if (!pet) {
      p.petTimer[slot] -= dt;
      if (p.petTimer[slot] <= 0) {
        const m = new Mob(this.nextId++, def.petMob, p.mapId, p.x + 40, p.y + 40, rarity, true);
        m.ownerId = p.id;
        m.ownerSlot = slot;
        m.maxHp = Math.round(m.maxHp * 1.4);
        m.hp = m.maxHp;
        m.damage *= 1.3;
        m.speed = Math.max(70, m.speed * 1.5);
        this.worlds[p.mapId].mobs.push(m);
        p.pets[slot] = m;
      }
    }
  }

  private updateWorld(mapId: number, dt: number, players: Player[]) {
    const map = MAPS[mapId];
    const world = this.worlds[mapId];
    const here = players.filter((p) => p.mapId === mapId && p.alive);

    for (let i = world.mobs.length - 1; i >= 0; i--) {
      const mob = world.mobs[i];
      mob.hitCd = Math.max(0, mob.hitCd - dt);

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
            victim.hp -= attacker.damage * 0.6;
            victim.lastHitBy = attacker.ownerId;
            attacker.hp -= victim.damage * 0.3;
            mob.hitCd = 0.5;
            other.hitCd = 0.5;
          }
        }
      }

      // hostile mob vs players
      if (!mob.friendly) {
        for (const p of here) {
          const d = Math.hypot(p.x - mob.x, p.y - mob.y);
          if (d < mob.radius + 26) {
            const push = (mob.radius + 26 - d) * 0.5;
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
            owner.pets[mob.ownerSlot] = null;
            owner.petTimer[mob.ownerSlot] = 4;
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

  private onMobKilled(mob: Mob, mapId: number) {
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

    for (const drop of def.drops) {
      if (Math.random() > drop.chance) continue;
      let rarity = mob.rarity;
      while (rarity < MAX_WILD_DROP_RARITY && Math.random() < 0.14 + map.rarityBias) rarity++;
      if (Math.random() < 0.35 && rarity > 0) rarity--;
      const d = new Drop(
        this.nextId++,
        mapId,
        mob.x + (Math.random() - 0.5) * 40,
        mob.y + (Math.random() - 0.5) * 40,
        drop.item,
        rarity,
        killer ? killer.id : 0,
      );
      world.drops.push(d);
    }
  }

  private killPlayer(p: Player) {
    p.alive = false;
    p.hp = 0;
    p.statsDirty = true;
    const world = this.worlds[p.mapId];
    world.mobs = world.mobs.filter((m) => m.ownerId !== p.id);
    for (let i = 0; i < SLOT_COUNT; i++) p.pets[i] = null;
    const c = this.clientOf(p.id);
    if (c) this.pushEvent(c, EVT.DEATH, p.x, p.y, p.level);
  }

  private pickupDrops(p: Player) {
    if (!p.alive) return;
    const world = this.worlds[p.mapId];
    for (let i = world.drops.length - 1; i >= 0; i--) {
      const d = world.drops[i];
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      if (dist < 46) {
        if (this.addItem(p, d.item, d.rarity)) {
          world.drops.splice(i, 1);
          const c = this.clientOf(p.id);
          if (c) this.pushEvent(c, EVT.LOOT, d.x, d.y, 0, d.item, d.rarity);
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
        .u8(0)
        .u8(op === p ? TEAM.SELF : TEAM.FRIENDLY)
        .i16(Math.round(op.x))
        .i16(Math.round(op.y))
        .u16(Math.round(((op.baseAngle % (Math.PI * 2)) / (Math.PI * 2)) * 65535))
        .u8(26)
        .u8(Math.round((op.hp / op.maxHp) * 255))
        .str(op.name);
      count++;
      // petals belonging to this player
      for (let i = 0; i < SLOT_COUNT; i++) {
        const cell = op.slots[i];
        const st = op.petals[i];
        if (!cell || !st || !st.alive || ITEMS[cell.item].kind !== "petal") continue;
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
      body.u8(ENT.DROP).u16(d.id).u8(d.item).u8(d.rarity).i16(Math.round(d.x)).i16(Math.round(d.y)).u16(0).u8(12).u8(255);
      count++;
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
      iw.u8(BAG_COUNT);
      for (const cell of p.bag) writeCell(iw, cell);
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
