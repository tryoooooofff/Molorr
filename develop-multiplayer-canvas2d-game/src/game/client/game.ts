/**
 * CLIENT MAIN FILE
 * ----------------
 * Everything the player sees is painted with canvas2d (no DOM/CSS UI):
 * main menu, account panel, world, HUD, inventory bag, crafting panel,
 * drag & drop of item cards, panel/scene animations.
 */
import {
  BAG_COUNT,
  EMPTY_ITEM,
  ITEMS,
  MAPS,
  MAX_CRAFT_RARITY,
  MOBS,
  RARITIES,
  SLOT_COUNT,
  Wall,
  craftChanceFor,
  oracleRequiredCount,
  xpForLevel,
} from "../shared/defs";
import { C2S, ENT, EVT, Reader, S2C, TEAM, Writer } from "../shared/protocol";
import type { Cell } from "../shared/sim";
import { createTransport, Transport } from "./transport";
import {
  button,
  craftBurst,
  craftPad,
  drawCard,
  drawFlower,
  drawItemIcon,
  drawMob,
  dropdownField,
  dropdownList,
  ease,
  healthBar,
  hit,
  panel,
  Rect,
  roundRect,
  scrollbar,
  searchField,
  shade,
  text,
} from "./ui";

interface Ent {
  id: number;
  kind: number;
  type: number;
  team: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  angle: number;
  radius: number;
  hp: number;
  name: string;
  seen: number;
  hurt: number;
  spawn: number;
}

interface Floater {
  x: number;
  y: number;
  msg: string;
  color: string;
  life: number;
  vy: number;
}

/** Burst particle used by the crafting animation (ported from CraftAnimation). */
interface CraftParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  size: number;
  color: [number, number, number];
  gravity: boolean;
}

interface SaveData {
  slots: (Cell | null)[];
  bag: (Cell | null)[];
  xp: number;
  mapId: number;
  nextOracleAt?: number;
  nextTradeAt?: number;
  craftPetals?: number;
  craftCrafted?: number;
  craftBurned?: number;
  craftAttempts?: number;
}

const SAVE_KEY = "petalia.save";
const AUTH_KEY = "petalia.auth";

// Biome names sourced straight from the map list. Each item is tagged with every
// biome that has at least one mob capable of dropping it.
const BIOME_LIST = ["All", ...MAPS.map((m) => m.name)];

function buildItemBiomeMap(): Map<number, Set<string>> {
  const map = new Map<number, Set<string>>();
  for (const m of MAPS) {
    for (const mobId of m.mobs) {
      const mob = MOBS[mobId];
      if (!mob) continue;
      for (const drop of mob.drops) {
        if (!map.has(drop.item)) map.set(drop.item, new Set());
        map.get(drop.item)!.add(m.name);
      }
    }
  }
  return map;
}

function emptyCells(n: number): (Cell | null)[] {
  return new Array(n).fill(null);
}

export class GameClient {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private last = performance.now();
  private time = 0;
  private w = 800;
  private h = 600;

  // scene
  private scene: "menu" | "game" = "menu";
  private fade = 0; // 1 = fully covered
  private pendingScene: (() => void) | null = null;
  private mapFlash = 0;

  // menu state
  private playerName = "flower";
  private selectedMap = 0;
  private authUser = "";
  private authPass = "";
  private focus: "name" | "user" | "pass" | null = null;
  private authStatus = "Playing as guest. Progress saved locally.";
  private account: { username: string; token: string } | null = null;
  private menuTab: "play" | "account" = "play";

  // net
  private net: Transport | null = null;
  private connected = false;
  private selfId = 0;
  private inputTimer = 0;

  // world
  private mapId = 0;
  private worldW = 3200;
  private worldH = 3200;
  private walls: Wall[] = [];
  private ents = new Map<number, Ent>();
  private camX = 0;
  private camY = 0;

  // player state
  private hp = 100;
  private maxHp = 100;
  private xp = 0;
  private level = 1;
  private alive = true;
  private nextOracleAt = 0;
  private nextTradeAt = 0;
  private slots: (Cell | null)[] = emptyCells(SLOT_COUNT);
  private bag: (Cell | null)[] = emptyCells(BAG_COUNT);
  private floaters: Floater[] = [];
  private killFeed: { msg: string; life: number }[] = [];

  // ui state
  private bagOpen = false;
  private bagAnim = 0;
  private bagScrollY = 0;
  private bagSearchText = "";
  private bagSearchActive = false;
  private bagBiome = "All";
  private bagBiomeOpen = false;
  private bagDraggingThumb = false;
  private bagThumbDragStartY = 0;
  private bagScrollAtDragStart = 0;
  private itemBiomeCache: Map<number, Set<string>> | null = null;
  private craftOpen = false;
  private craftAnim = 0;
  private craftMode: "normal" | "oracle" | "trade" = "normal";
  private craftSel: { item: number; rarity: number } | null = null;
  private craftSpin = 0;
  private craftMsg = "";
  private craftMsgLife = 0;
  // crafting browser (mirrors the inventory: search bar, biome filter, scrollable 5-wide grid)
  private craftSearchText = "";
  private craftSearchActive = false;
  private craftBiome = "All";
  private craftBiomeOpen = false;
  private craftScrollY = 0;
  private craftDraggingThumb = false;
  private craftThumbDragStartY = 0;
  private craftScrollAtDragStart = 0;
  // craft juice
  private craftGlow = 0;
  private craftBurstT = 0;
  private craftBurstColor = "#ffe763";
  private craftShake = 0;

  // ── Ported CraftAnimation state (color / arrangement / animation) ──
  // Rotation phase machine: "none" | "rotating" | "waiting" | "showing"
  private craftPhase: "none" | "rotating" | "waiting" | "showing" = "none";
  private craftRotTime = 0; // seconds elapsed while rotating
  private craftRotDuration = 1.5; // seconds, mirrors startAnimation(1.5)
  private craftAngle = 0; // degrees, accumulates during rotation
  private craftRotDir = 1;
  private craftRotSpeed = 300; // deg/s, accelerates 300 -> 800
  private craftWaitStart = 0; // performance.now() ms
  private craftWaitDuration = 0.3; // seconds before revealing result
  private craftShowTimer = 0; // seconds the result card is shown
  private craftShowDuration = 1.6; // seconds before auto-clearing the result card
  private craftPending: { item: number; rarity: number; count: number } | null = null;
  // Slot-fill animation when a card lands (grow + spin)
  private craftFillActive = false;
  private craftFillElapsed = 0; // ms, 0..200
  private craftFillTotal = 200; // ms
  // Particle bursts
  private craftSuccessParticles: CraftParticle[] = [];
  private craftFailParticles: CraftParticle[] = [];
  // Craft log stats (mirrors drawCraftLog)
  private craftLogPetals = 0;
  private craftLogCrafted = 0;
  private craftLogBurned = 0;
  private craftLogAttempts = 0;
  private craftLogLast = "No Result";

  private drag: { from: number; cell: Cell } | null = null;
  private dragX = 0;
  private dragY = 0;
  private mx = 0;
  private my = 0;
  private mouseDown = false;
  private rightDown = false;
  private keys = new Set<string>();
  private saveTimer = 0;
  private saveDirty = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("canvas2d unavailable");
    this.ctx = ctx;
    this.loadLocal();
  }

  // ------------------------------------------------------------- lifecycle
  start() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("contextmenu", this.onContext);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.resize();
    window.addEventListener("resize", this.resize);
    this.loop(performance.now());
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("contextmenu", this.onContext);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("resize", this.resize);
    this.net?.close();
  }


  private resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(320, Math.floor(rect.width));
    this.h = Math.max(240, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.w * dpr);
    this.canvas.height = Math.floor(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  // ------------------------------------------------------------- storage
  private loadLocal() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const data = JSON.parse(raw) as SaveData;
        this.applySave(data);
      }
      const auth = localStorage.getItem(AUTH_KEY);
      if (auth) {
        this.account = JSON.parse(auth);
        if (this.account) {
          this.authUser = this.account.username;
          this.playerName = this.account.username;
          this.authStatus = `Signed in as ${this.account.username}.`;
          void this.pullCloudSave();
        }
      }
      const nm = localStorage.getItem("petalia.name");
      if (nm) this.playerName = nm;
    } catch {
      /* ignore */
    }
  }

  private applySave(data: SaveData) {
    if (!data) return;
    this.slots = emptyCells(SLOT_COUNT);
    this.bag = emptyCells(BAG_COUNT);
    (data.slots || []).slice(0, SLOT_COUNT).forEach((c, i) => (this.slots[i] = c ?? null));
    (data.bag || []).slice(0, BAG_COUNT).forEach((c, i) => (this.bag[i] = c ?? null));
    this.xp = data.xp || 0;
    this.selectedMap = Math.max(0, Math.min(MAPS.length - 1, data.mapId || 0));
    this.nextOracleAt = data.nextOracleAt || 0;
    this.nextTradeAt = data.nextTradeAt || 0;
    this.craftLogPetals = data.craftPetals || 0;
    this.craftLogCrafted = data.craftCrafted || 0;
    this.craftLogBurned = data.craftBurned || 0;
    this.craftLogAttempts = data.craftAttempts || 0;
  }

  private currentSave(): SaveData {
    return {
      slots: this.slots,
      bag: this.bag,
      xp: this.xp,
      mapId: this.mapId,
      nextOracleAt: this.nextOracleAt,
      nextTradeAt: this.nextTradeAt,
      craftPetals: this.craftLogPetals,
      craftCrafted: this.craftLogCrafted,
      craftBurned: this.craftLogBurned,
      craftAttempts: this.craftLogAttempts,
    };
  }

  private persist() {
    const data = this.currentSave();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      localStorage.setItem("petalia.name", this.playerName);
    } catch {
      /* ignore */
    }
    if (this.account) {
      void fetch("/api/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: this.account.token, data }),
      }).catch(() => {});
    }
  }

  private async pullCloudSave() {
    if (!this.account) return;
    try {
      const res = await fetch(`/api/save?token=${encodeURIComponent(this.account.token)}`);
      if (!res.ok) return;
      const json = (await res.json()) as { data?: SaveData };
      if (json.data) this.applySave(json.data);
    } catch {
      /* ignore */
    }
  }

  private async auth(mode: "login" | "register") {
    if (this.authUser.length < 3 || this.authPass.length < 3) {
      this.authStatus = "Username and password need 3+ characters.";
      return;
    }
    this.authStatus = mode === "login" ? "Signing in..." : "Creating account...";
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: this.authUser, password: this.authPass }),
      });
      const json = (await res.json()) as { token?: string; error?: string; data?: SaveData };
      if (!res.ok || !json.token) {
        this.authStatus = json.error || "Failed.";
        return;
      }
      this.account = { username: this.authUser, token: json.token };
      localStorage.setItem(AUTH_KEY, JSON.stringify(this.account));
      this.playerName = this.authUser;
      if (json.data) this.applySave(json.data);
      this.authStatus = `Signed in as ${this.authUser}. Progress syncs to the database.`;
      this.menuTab = "play";
    } catch {
      this.authStatus = "Network error.";
    }
  }

  private logout() {
    this.account = null;
    localStorage.removeItem(AUTH_KEY);
    this.authStatus = "Playing as guest. Progress saved locally.";
  }

  // ------------------------------------------------------------- networking
  private connect() {
    this.net?.close();
    this.ents.clear();
    const net = createTransport();
    this.net = net;
    net.onOpen = () => {
      this.connected = true;
      this.sendJoin();
    };
    net.onClose = () => {
      this.connected = false;
    };
    net.onMessage = (data) => this.handlePacket(data);
  }

  private sendJoin() {
    const w = new Writer(256);
    w.u8(C2S.JOIN).str(this.playerName).u8(this.selectedMap).u32(this.xp);
    for (let i = 0; i < SLOT_COUNT; i++) this.writeCell(w, this.slots[i]);
    w.u8(BAG_COUNT);
    for (let i = 0; i < BAG_COUNT; i++) this.writeCell(w, this.bag[i]);
    const now = Date.now();
    w.u32(Math.max(0, Math.ceil((this.nextOracleAt - now) / 1000)));
    w.u32(Math.max(0, Math.ceil((this.nextTradeAt - now) / 1000)));
    this.net?.send(w.bytes());
  }

  private writeCell(w: Writer, cell: Cell | null) {
    if (!cell || cell.count <= 0) w.u8(EMPTY_ITEM).u8(0).u16(0);
    else w.u8(cell.item).u8(cell.rarity).u16(cell.count);
  }

  private handlePacket(data: Uint8Array) {
    const r = new Reader(data);
    const type = r.u8();
    switch (type) {
      case S2C.WELCOME: {
        this.selfId = r.u16();
        this.mapId = r.u8();
        this.worldW = r.u16();
        this.worldH = r.u16();
        const wallCount = r.u16();
        this.walls = [];
        for (let i = 0; i < wallCount; i++) {
          this.walls.push({ x: r.u16(), y: r.u16(), w: r.u16(), h: r.u16() });
        }
        this.ents.clear();
        this.mapFlash = 1;
        break;
      }
      case S2C.SNAPSHOT: {
        r.u32();
        const count = r.u16();
        for (let i = 0; i < count; i++) {
          const kind = r.u8();
          const id = r.u16();
          const etype = r.u8();
          const team = r.u8();
          const x = r.i16();
          const y = r.i16();
          const angle = (r.u16() / 65535) * Math.PI * 2;
          const radius = r.u8();
          const hp = r.u8() / 255;
          let name = "";
          if (kind === ENT.PLAYER) name = r.str();
          if (kind === ENT.MOB) r.u8();
          let e = this.ents.get(id);
          if (!e) {
            e = {
              id, kind, type: etype, team, x, y, tx: x, ty: y, angle,
              radius, hp, name, seen: this.time, hurt: 0, spawn: 0,
            };
            this.ents.set(id, e);
          }
          if (hp < e.hp) e.hurt = 0.22;
          e.kind = kind;
          e.type = etype;
          e.team = team;
          e.tx = x;
          e.ty = y;
          e.angle = angle;
          e.radius = radius;
          e.hp = hp;
          if (name) e.name = name;
          e.seen = this.time;
          if (e.spawn < 1) e.spawn = Math.min(1, e.spawn + 0.12);
        }
        break;
      }
      case S2C.INVENTORY: {
        const slotCount = r.u8();
        const slots = emptyCells(SLOT_COUNT);
        for (let i = 0; i < slotCount; i++) {
          const c = this.readCell(r);
          if (i < SLOT_COUNT) slots[i] = c;
        }
        const bagCount = r.u8();
        const bag = emptyCells(BAG_COUNT);
        for (let i = 0; i < bagCount; i++) {
          const c = this.readCell(r);
          if (i < BAG_COUNT) bag[i] = c;
        }
        this.slots = slots;
        this.bag = bag;
        this.saveDirty = true;
        break;
      }
      case S2C.STATS: {
        this.xp = r.u32();
        this.level = r.u16();
        this.hp = r.u16();
        this.maxHp = r.u16();
        this.mapId = r.u8();
        this.alive = r.u8() === 1;
        const oracleSecLeft = r.u32();
        const tradeSecLeft = r.u32();
        const now = Date.now();
        this.nextOracleAt = oracleSecLeft > 0 ? now + oracleSecLeft * 1000 : 0;
        this.nextTradeAt = tradeSecLeft > 0 ? now + tradeSecLeft * 1000 : 0;
        break;
      }
      case S2C.EVENT: {
        const kind = r.u8();
        const x = r.i16();
        const y = r.i16();
        const value = r.u32();
        const item = r.u8();
        const rarity = r.u8();
        this.onEvent(kind, x, y, value, item, rarity);
        break;
      }
      default:
        break;
    }
  }

  private readCell(r: Reader): Cell | null {
    const item = r.u8();
    const rarity = r.u8();
    const count = r.u16();
    if (item === EMPTY_ITEM || count <= 0) return null;
    return { item, rarity, count };
  }

  private onEvent(kind: number, x: number, y: number, value: number, item: number, rarity: number) {
    switch (kind) {
      case EVT.XP:
        this.floaters.push({ x, y, msg: `+${value} XP`, color: "#ffe65d", life: 1.3, vy: -34 });
        break;
      case EVT.LOOT:
        this.floaters.push({
          x, y,
          msg: `${RARITIES[rarity].name} ${ITEMS[item]?.name ?? "?"}`,
          color: RARITIES[rarity].color,
          life: 1.6,
          vy: -22,        });
        break;
      case EVT.HIT:
        this.floaters.push({ x, y, msg: `-${value}`, color: "#ff6f6f", life: 0.9, vy: -40 });
        break;
      case EVT.KILL:
        this.killFeed.unshift({ msg: `Defeated ${MOBS[value]?.name ?? "mob"}`, life: 3 });
        this.killFeed = this.killFeed.slice(0, 5);
        break;
      case EVT.CRAFT_OK:
        this.craftMsg = value > 1
          ? `Crafted ${value}x ${RARITIES[rarity].name} ${ITEMS[item].name}!`
          : `Crafted ${RARITIES[rarity].name} ${ITEMS[item].name}!`;
        this.craftSucceeded(rarity);
        break;
      case EVT.CRAFT_FAIL:
        this.craftMsg = value > 0 ? `Craft failed... ${value} petal${value === 1 ? "" : "s"} lost.` : "Craft failed.";
        this.craftFailed();
        break;
      case EVT.ORACLE_OK:
        this.craftMsg = `Oracle success! Created ${RARITIES[rarity].name} ${ITEMS[item].name}!`;
        this.craftSucceeded(rarity);
        break;
      case EVT.ORACLE_FAIL:
        this.craftMsg = "Oracle refused — check the requirement and cooldown.";
        this.craftFailed();
        break;
      case EVT.TRADE_OK:
        this.craftMsg = `Traded for ${value}x ${RARITIES[rarity].name} Coin!`;
        this.craftSucceeded(rarity);
        break;
      case EVT.TRADE_FAIL:
        this.craftMsg = "Trade refused — check the cooldown.";
        this.craftFailed();
        break;
      case EVT.DEATH:
        this.alive = false;
        this.floaters.length = 0;
        break;
    }
    this.saveDirty = true;
  }

  /** Shared feedback for every successful craft/oracle/trade: burst + green message. */
  private craftSucceeded(rarity: number) {
    this.craftMsgLife = 2.8;
    this.craftSpin = 0;
    this.craftBurstT = 1;
    this.craftBurstColor = RARITIES[rarity]?.color ?? "#ffe763";
  }

  /** Shared feedback for a refused/failed craft: shake + red message. */
  private craftFailed() {
    this.craftMsgLife = 2.6;
    this.craftSpin = 0;
    this.craftShake = 0.5;
  }

  // ------------------------------------------------------------- main loop
  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.update(dt);
    this.render(dt);
  };

  private update(dt: number) {
    // scene fade
    if (this.pendingScene) {
      this.fade = Math.min(1, this.fade + dt * 3.2);
      if (this.fade >= 1) {
        this.pendingScene();
        this.pendingScene = null;
      }
    } else {
      this.fade = Math.max(0, this.fade - dt * 2.6);
    }
    this.mapFlash = Math.max(0, this.mapFlash - dt * 1.6);

    this.bagAnim += ((this.bagOpen ? 1 : 0) - this.bagAnim) * Math.min(1, dt * 10);
    this.craftAnim += ((this.craftOpen ? 1 : 0) - this.craftAnim) * Math.min(1, dt * 10);
    if (this.craftSpin > 0) this.craftSpin = Math.max(0, this.craftSpin - dt);
    if (this.craftMsgLife > 0) this.craftMsgLife -= dt;
    if (this.craftBurstT > 0) this.craftBurstT = Math.max(0, this.craftBurstT - dt * 1.6);
    if (this.craftShake > 0) this.craftShake = Math.max(0, this.craftShake - dt * 2);
    this.craftGlow += ((this.craftSel ? 1 : 0) - this.craftGlow) * Math.min(1, dt * 8);

    for (const e of this.ents.values()) {
      const k = Math.min(1, dt * 16);
      e.x += (e.tx - e.x) * k;
      e.y += (e.ty - e.y) * k;
      e.hurt = Math.max(0, e.hurt - dt);
      if (this.time - e.seen > 0.6) this.ents.delete(e.id);
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      f.y += f.vy * dt;
      if (f.life <= 0) this.floaters.splice(i, 1);
    }
    for (let i = this.killFeed.length - 1; i >= 0; i--) {
      this.killFeed[i].life -= dt;
      if (this.killFeed[i].life <= 0) this.killFeed.splice(i, 1);
    }

    if (this.scene === "game") {
      const me = this.ents.get(this.selfId);
      if (me) {
        this.camX += (me.x - this.camX) * Math.min(1, dt * 7);
        this.camY += (me.y - this.camY) * Math.min(1, dt * 7);
      }
      this.inputTimer -= dt;
      if (this.inputTimer <= 0) {
        this.inputTimer = 0.05;
        this.sendInput();
      }
      this.saveTimer -= dt;
      if (this.saveTimer <= 0) {
        this.saveTimer = 4;
        if (this.saveDirty) {
          this.saveDirty = false;
          this.persist();
        }
      }
    }
  }

  private sendInput() {
    if (!this.net || !this.connected) return;
    let dx = 0;
    let dy = 0;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) dx -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) dx += 1;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) dy -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) dy += 1;
    const uiBusy = this.drag !== null;
    let flags = 0;
    if (this.mouseDown && !uiBusy) flags |= 1;
    if (this.rightDown || this.keys.has("Space")) flags |= 2;
    const w = new Writer(8);
    w.u8(C2S.INPUT).i8(dx * 100).i8(dy * 100).u8(flags);
    this.net.send(w.bytes());
  }

  // --------------------------------------------------------------- layouts
  private hotbarRects(): Rect[] {
    const size = Math.min(66, this.w / 12);
    const gap = 8;
    const total = SLOT_COUNT * size + (SLOT_COUNT - 1) * gap;
    const x0 = (this.w - total) / 2;
    const y = this.h - size - 18;
    return new Array(SLOT_COUNT).fill(0).map((_, i) => ({ x: x0 + i * (size + gap), y, w: size, h: size }));
  }

  private bagPanelRect(): Rect {
    const w = Math.min(400, this.w * 0.92);
    const hotbarH = Math.min(66, this.w / 12);
    const maxH = this.h - hotbarH - 130;
    const h = Math.min(560, Math.max(320, maxH));
    const hidden = this.h + 20;
    const shown = this.h - hotbarH - h - 26;
    const t = ease.outCubic(this.bagAnim);
    return { x: (this.w - w) / 2, y: hidden + (shown - hidden) * t, w, h };
  }

  /** Geometry for the scrollable item grid + header widgets inside the bag panel. */
  private bagLayout() {
    const p = this.bagPanelRect();
    const cols = 5;
    const gap = 10;
    const pad = 15;
    const slotSize = Math.floor((p.w - pad * 2 - gap * (cols - 1)) / cols);
    const itemHeight = slotSize + gap;
    const headerH = 44;
    const barY = p.y + headerH;
    const barH = 28;
    const dropW = Math.min(120, p.w * 0.3);
    const barGap = 6;
    const barW = p.w - dropW - barGap - pad * 2;
    const barX = p.x + pad;
    const dropX = barX + barW + barGap;
    const statsH = 92;
    const gridTop = barY + barH + 12;
    const gridBottom = p.y + p.h - statsH - 6;
    const gridH = Math.max(itemHeight, gridBottom - gridTop);
    const maxVisibleRows = Math.max(1, Math.floor(gridH / itemHeight));
    const scrollTrack: Rect = { x: p.x + p.w - pad + 2, y: gridTop, w: 6, h: gridH };
    return {
      panel: p,
      cols,
      gap,
      pad,
      slotSize,
      itemHeight,
      headerH,
      barX,
      barY,
      barW,
      barH,
      dropX,
      dropW,
      gridTop,
      gridH,
      maxVisibleRows,
      statsH,
      closeRect: { x: p.x + p.w - 34, y: p.y + 10, w: 24, h: 24 } as Rect,
      scrollTrack,
    };
  }

  private bagEntries(): { slot: number; cell: Cell }[] {
    const entries: { slot: number; cell: Cell }[] = [];
    for (let i = 0; i < this.bag.length; i++) {
      const cell = this.bag[i];
      if (cell) entries.push({ slot: i, cell });
    }
    entries.sort((a, b) => b.cell.rarity - a.cell.rarity);
    return entries;
  }

  private itemBiomes(item: number): Set<string> {
    if (!this.itemBiomeCache) this.itemBiomeCache = buildItemBiomeMap();
    return this.itemBiomeCache.get(item) ?? new Set();
  }

  private bagFilteredEntries(): { slot: number; cell: Cell }[] {
    const all = this.bagEntries();
    const query = this.bagSearchText.trim().toLowerCase();
    const biome = this.bagBiome;
    return all.filter(({ cell }) => {
      const def = ITEMS[cell.item];
      if (!def) return false;
      if (query && !def.name.toLowerCase().includes(query)) return false;
      if (biome !== "All" && !this.itemBiomes(cell.item).has(biome)) return false;
      return true;
    });
  }

  private bagMaxScroll(): number {
    const layout = this.bagLayout();
    const filtered = this.bagFilteredEntries();
    const totalRows = Math.ceil(filtered.length / layout.cols);
    const totalHeight = totalRows * layout.itemHeight;
    const visibleHeight = layout.maxVisibleRows * layout.itemHeight;
    return Math.max(0, totalHeight - visibleHeight);
  }

  private clampBagScroll() {
    this.bagScrollY = Math.max(0, Math.min(this.bagMaxScroll(), this.bagScrollY));
  }

  /** Rect of the i-th slot currently visible in the scrolled/filtered grid (i relative to render start). */
  private bagSlotAtPoint(x: number, y: number): number {
    const layout = this.bagLayout();
    const p = layout.panel;
    if (x < p.x || x > p.x + p.w || y < layout.gridTop || y > layout.gridTop + layout.gridH) return -1;
    this.clampBagScroll();
    const filtered = this.bagFilteredEntries();
    const startRow = Math.floor(this.bagScrollY / layout.itemHeight);
    const yOffset = -(this.bagScrollY % layout.itemHeight);
    const startIdx = startRow * layout.cols;
    const relX = x - (p.x + layout.pad);
    const relY = y - layout.gridTop - yOffset;
    if (relX < 0 || relY < 0) return -1;
    const col = Math.floor(relX / (layout.slotSize + layout.gap));
    const row = Math.floor(relY / (layout.slotSize + layout.gap));
    if (col < 0 || col >= layout.cols || row < 0) return -1;
    const localIdx = row * layout.cols + col;
    const entry = filtered[startIdx + localIdx];
    if (!entry) return -1;
    // make sure the click actually landed on the card, not the margin gap
    const slotX = p.x + layout.pad + col * (layout.slotSize + layout.gap);
    const slotY = layout.gridTop + row * (layout.slotSize + layout.gap) + yOffset;
    if (x < slotX || x > slotX + layout.slotSize || y < slotY || y > slotY + layout.slotSize) return -1;
    return SLOT_COUNT + entry.slot;
  }

  private craftPanelRect(): Rect {
    const w = Math.min(400, this.w * 0.92);
    const hotbarH = Math.min(66, this.w / 12);
    const maxH = this.h - hotbarH - 130;
    // tall enough for header + tabs + search + one grid row + the whole bottom block
    const h = Math.min(Math.max(600, this.h - 32), Math.max(470, maxH));
    const t = ease.outCubic(this.craftAnim);
    // slides in from the right edge, same easing curve the bag uses when it slides up
    const hidden = this.w + 20;
    const shown = this.w - w - 16;
    return { x: hidden + (shown - hidden) * t, y: Math.max(16, this.h - hotbarH - h - 26), w, h };
  }

  /**
   * Geometry for the crafting panel. It is laid out exactly like the inventory:
   * header, search bar + biome dropdown, a scrollable 5-wide card grid, and then
   * the five big craft slots + action button pinned to the bottom.
   */
  private craftLayout() {
    const p = this.craftPanelRect();
    const cols = 5;
    const gap = 10;
    const pad = 15;
    const slotSize = Math.floor((p.w - pad * 2 - gap * (cols - 1)) / cols);
    const itemHeight = slotSize + gap;
    const headerH = 44;
    const tabsY = p.y + headerH;
    const tabsH = 30;
    const barY = tabsY + tabsH + 8;
    const barH = 28;
    const dropW = Math.min(120, p.w * 0.3);
    const barGap = 6;
    const barW = p.w - dropW - barGap - pad * 2;
    const barX = p.x + pad;
    const dropX = barX + barW + barGap;

    // bottom block: 5 big slots -> info lines -> action button.
    // The slots shrink first when the panel is short, so the grid always keeps a row.
    const bigGap = 8;
    const btnH = 48;
    // room for: item name, count line, result line, cooldown line, result message
    const infoH = 110;
    const chromeH = headerH + tabsH + 8 + barH + 12 + itemHeight + 8 + 22 + infoH + btnH + 16;
    const idealBig = Math.floor((p.w - pad * 2 - bigGap * (cols - 1)) / cols);
    const bigSize = Math.max(40, Math.min(idealBig, idealBig + (p.h - chromeH - idealBig)));
    const bottomH = 22 + bigSize + infoH + btnH + 16;
    const bottomY = p.y + p.h - bottomH;
    const bigY = bottomY + 22;
    const bigSlots: Rect[] = new Array(cols)
      .fill(0)
      .map((_, i) => ({ x: p.x + pad + i * (bigSize + bigGap), y: bigY, w: bigSize, h: bigSize }));
    const singleSlot: Rect = { x: p.x + p.w / 2 - bigSize / 2, y: bigY, w: bigSize, h: bigSize };

    const gridTop = barY + barH + 12;
    const gridH = Math.max(itemHeight, bottomY - 8 - gridTop);
    const maxVisibleRows = Math.max(1, Math.floor(gridH / itemHeight));
    const scrollTrack: Rect = { x: p.x + p.w - pad + 2, y: gridTop, w: 6, h: gridH };

    return {
      panel: p,
      cols,
      gap,
      pad,
      slotSize,
      itemHeight,
      tabsY,
      tabsH,
      barRect: { x: barX, y: barY, w: barW, h: barH } as Rect,
      dropRect: { x: dropX, y: barY, w: dropW, h: barH } as Rect,
      gridTop,
      gridH,
      maxVisibleRows,
      bigSlots,
      singleSlot,
      bigSize,
      infoY: bigY + bigSize + 16,
      actionRect: { x: p.x + p.w / 2 - 100, y: p.y + p.h - btnH - 16, w: 200, h: btnH } as Rect,
      closeRect: { x: p.x + p.w - 34, y: p.y + 10, w: 24, h: 24 } as Rect,
      scrollTrack,
      cx: bigSlots[2].x + bigSlots[2].w / 2,
      cy: bigSlots[2].y + bigSlots[2].h / 2,
      radius: bigSize * 0.8,
    };
  }

  private craftModeRects(): { mode: "normal" | "oracle" | "trade"; rect: Rect; label: string; color: string }[] {
    const layout = this.craftLayout();
    const p = layout.panel;
    const gap = 6;
    const w = (p.w - layout.pad * 2 - gap * 2) / 3;
    const y = layout.tabsY;
    const h = layout.tabsH;
    return [
      { mode: "normal", rect: { x: p.x + layout.pad, y, w, h }, label: "Craft", color: "#c9762b" },
      { mode: "oracle", rect: { x: p.x + layout.pad + w + gap, y, w, h }, label: "Oracle", color: "#6a3fb0" },
      { mode: "trade", rect: { x: p.x + layout.pad + (w + gap) * 2, y, w, h }, label: "Trade", color: "#3f8f5a" },
    ];
  }

  /** The five big slots the selected cards animate into (Craft mode). */
  private craftPadRects(): Rect[] {
    return this.craftLayout().bigSlots;
  }

  /** Single centered slot used by Oracle/Trade modes (they only ever hold one item type). */
  private craftSingleSlotRect(): Rect {
    return this.craftLayout().singleSlot;
  }

  private craftActionButtonRect(): Rect {
    return this.craftLayout().actionRect;
  }

  /** Bag stacks that can go into the crafting panel, filtered by search text + biome. */
  private craftFilteredEntries(): { slot: number; cell: Cell }[] {
    const query = this.craftSearchText.trim().toLowerCase();
    const biome = this.craftBiome;
    return this.bagEntries().filter(({ cell }) => {
      const def = ITEMS[cell.item];
      if (!def) return false;
      if (this.craftMode !== "trade" && def.kind === "trinket") return false;
      if (query && !def.name.toLowerCase().includes(query)) return false;
      if (biome !== "All" && !this.itemBiomes(cell.item).has(biome)) return false;
      return true;
    });
  }

  private craftMaxScroll(): number {
    const layout = this.craftLayout();
    const totalRows = Math.ceil(this.craftFilteredEntries().length / layout.cols);
    const totalHeight = totalRows * layout.itemHeight;
    const visibleHeight = layout.maxVisibleRows * layout.itemHeight;
    return Math.max(0, totalHeight - visibleHeight);
  }

  private clampCraftScroll() {
    this.craftScrollY = Math.max(0, Math.min(this.craftMaxScroll(), this.craftScrollY));
  }

  private craftScrollThumbRect(layout: ReturnType<GameClient["craftLayout"]>): Rect {
    const track = layout.scrollTrack;
    const totalRows = Math.max(1, Math.ceil(this.craftFilteredEntries().length / layout.cols));
    if (totalRows <= layout.maxVisibleRows) return { x: track.x, y: track.y, w: track.w, h: track.h };
    const maxScroll = this.craftMaxScroll();
    const thumbH = Math.max(20, (layout.maxVisibleRows / totalRows) * track.h);
    const ratio = maxScroll > 0 ? this.craftScrollY / maxScroll : 0;
    return { x: track.x, y: track.y + ratio * (track.h - thumbH), w: track.w, h: thumbH };
  }

  private dragCraftThumb(my: number) {
    const layout = this.craftLayout();
    const maxScroll = this.craftMaxScroll();
    if (maxScroll <= 0) {
      this.craftDraggingThumb = false;
      return;
    }
    const track = layout.scrollTrack;
    const totalRows = Math.max(1, Math.ceil(this.craftFilteredEntries().length / layout.cols));
    const thumbH = Math.max(20, (layout.maxVisibleRows / totalRows) * track.h);
    const maxDrag = track.h - thumbH;
    if (maxDrag <= 0) return;
    const ratio = (my - this.craftThumbDragStartY) / maxDrag;
    this.craftScrollY = Math.max(0, Math.min(maxScroll, this.craftScrollAtDragStart + ratio * maxScroll));
  }

  /** Card the pointer is over inside the crafting browser grid, or null. */
  private craftGridEntryAtPoint(x: number, y: number): { slot: number; cell: Cell } | null {
    const layout = this.craftLayout();
    const p = layout.panel;
    if (x < p.x || x > p.x + p.w || y < layout.gridTop || y > layout.gridTop + layout.gridH) return null;
    this.clampCraftScroll();
    const filtered = this.craftFilteredEntries();
    const startRow = Math.floor(this.craftScrollY / layout.itemHeight);
    const yOffset = -(this.craftScrollY % layout.itemHeight);
    const relX = x - (p.x + layout.pad);
    const relY = y - layout.gridTop - yOffset;
    if (relX < 0 || relY < 0) return null;
    const col = Math.floor(relX / (layout.slotSize + layout.gap));
    const row = Math.floor(relY / (layout.slotSize + layout.gap));
    if (col < 0 || col >= layout.cols || row < 0) return null;
    const entry = filtered[startRow * layout.cols + row * layout.cols + col];
    if (!entry) return null;
    const slotX = p.x + layout.pad + col * (layout.slotSize + layout.gap);
    const slotY = layout.gridTop + row * layout.itemHeight + yOffset;
    if (x < slotX || x > slotX + layout.slotSize || y < slotY || y > slotY + layout.slotSize) return null;
    return entry;
  }

  // ── Ported CraftAnimation helpers (spin / contraction / particles / fill) ──

  /** Local position of the i-th pentagon slot (before rotation/contraction). */
  private craftLocalPos(i: number): [number, number] {
    const { radius } = this.craftLayout();
    const a = (Math.PI / 180) * (-90 + i * 72);
    return [Math.cos(a) * radius, Math.sin(a) * radius];
  }

  /** Contraction curve from CraftAnimation.getContractedPosition (slots suck toward center). */
  private craftContractedPos(progress: number, ox: number, oy: number): [number, number] {
    const originalRadius = Math.sqrt(ox * ox + oy * oy);
    const originalAngle = Math.atan2(oy, ox);
    const maxContraction = 1.0;
    const minContraction = 0.2;
    const currentBase = maxContraction - (maxContraction - minContraction) * progress;
    const frequency = 4.0 + progress * 7.0;
    const oscillation = Math.sin(progress * Math.PI * frequency);
    const factor = currentBase + 0.3 * oscillation;
    return [Math.cos(originalAngle) * originalRadius * factor, Math.sin(originalAngle) * originalRadius * factor];
  }

  /** Begin the accelerating spin + contraction animation when a craft is fired. */
  private craftStartRotation() {
    this.craftPhase = "rotating";
    this.craftRotTime = 0;
    this.craftAngle = 0;
    this.craftRotDir = 1;
    this.craftRotSpeed = 300;
    this.craftPending = null;
    this.craftSuccessParticles.length = 0;
    this.craftFailParticles.length = 0;
  }

  /** Reveal a successful result card immediately + success particles (Oracle/Trade). */
  private craftStartShow(result: { item: number; rarity: number; count: number }) {
    this.craftPhase = "showing";
    this.craftShowTimer = 0;
    this.craftPending = result;
    this.craftSel = null;
    this.craftSpawnSuccessParticles(this.rarityRgb(result.rarity), Math.min(50 * Math.max(1, result.count), 1600));
  }

  /** Called once the spin finishes: spawn particles and (optionally) reveal the result card. */
  private craftFinalizeShow() {
    if (this.craftPending) {
      this.craftPhase = "showing";
      this.craftShowTimer = 0;
      this.craftSpawnSuccessParticles(this.rarityRgb(this.craftPending.rarity), Math.min(50 * Math.max(1, this.craftPending.count), 1600));
    } else {
      // Nothing crafted — burst failure particles from each pentagon slot.
      this.craftSpawnFailParticles();
      this.craftPhase = "none";
    }
    this.craftSel = null;
  }

  /** Per-frame update for the rotation phase machine, fill animation and particles. */
  private craftUpdate(dt: number) {
    if (this.craftPhase === "rotating") {
      this.craftRotTime += dt;
      const progress = Math.min(this.craftRotTime / this.craftRotDuration, 1);
      this.craftRotSpeed = 300 + (800 - 300) * progress;
      this.craftAngle -= this.craftRotDir * this.craftRotSpeed * dt;
      if (this.craftRotTime >= this.craftRotDuration) {
        this.craftAngle = 0;
        this.craftPhase = "waiting";
        this.craftWaitStart = performance.now();
      }
    } else if (this.craftPhase === "waiting") {
      if ((performance.now() - this.craftWaitStart) / 1000 >= this.craftWaitDuration) {
        this.craftFinalizeShow();
      }
    } else if (this.craftPhase === "showing") {
      this.craftShowTimer += dt;
      if (this.craftShowTimer >= this.craftShowDuration) {
        this.craftPhase = "none";
        this.craftPending = null;
      }
    }

    if (this.craftFillActive) {
      this.craftFillElapsed += dt * 1000;
      if (this.craftFillElapsed >= this.craftFillTotal) {
        this.craftFillActive = false;
        this.craftFillElapsed = 0;
      }
    }

    // Particles move per-frame (mirrors CraftAnimation.updateParticles).
    this.craftSuccessParticles = this.craftSuccessParticles.filter((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      return p.life > 0;
    });
    this.craftFailParticles = this.craftFailParticles.filter((p) => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.gravity) p.vy += 0.1;
      p.life -= p.decay;
      return p.life > 0;
    });
  }

  private craftSpawnSuccessParticles(color: [number, number, number], count: number) {
    const { cx, cy } = this.craftLayout();
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * 2 * Math.PI;
      const speed = 3 + Math.random() * 7;
      this.craftSuccessParticles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        decay: 0.005 + Math.random() * 0.015,
        size: 4 + Math.floor(Math.random() * 5),
        color,
        gravity: false,
      });
    }
  }

  private craftSpawnFailParticles() {
    const { cx, cy } = this.craftLayout();
    const color: [number, number, number] = this.craftSel ? this.rarityRgb(this.craftSel.rarity) : [200, 80, 80];
    for (let i = 0; i < 5; i++) {
      const [ox, oy] = this.craftLocalPos(i);
      const rad = (Math.PI / 180) * this.craftAngle;
      const wx = cx + ox * Math.cos(rad) - oy * Math.sin(rad);
      const wy = cy + ox * Math.sin(rad) + oy * Math.cos(rad);
      const count = 10 + Math.floor(Math.random() * 11);
      for (let j = 0; j < count; j++) {
        const angle = Math.random() * 2 * Math.PI;
        const speed = 2 + Math.random() * 5;
        this.craftFailParticles.push({
          x: wx,
          y: wy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1.0,
          decay: 0.01 + Math.random() * 0.02,
          size: 3 + Math.floor(Math.random() * 5),
          color,
          gravity: true,
        });
      }
    }
  }

  private drawCraftParticles(ctx: CanvasRenderingContext2D) {
    const draw = (list: CraftParticle[]) => {
      for (const p of list) {
        const alpha = Math.max(0, Math.min(1, p.life));
        const size = Math.max(1, p.size * p.life);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = `rgb(${p.color[0]},${p.color[1]},${p.color[2]})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };
    draw(this.craftSuccessParticles);
    draw(this.craftFailParticles);
  }

  private rarityRgb(r: number): [number, number, number] {
    const idx = Math.max(0, Math.min(RARITIES.length - 1, r));
    const c = RARITIES[idx]?.color ?? "rgb(160,160,160)";
    const m = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (m) {
      const out: [number, number, number] = [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
      return out;
    }
    return [160, 160, 160];
  }

  /** Start the slot grow+spin fill animation (when a card lands). */
  private craftStartFill() {
    this.craftFillActive = true;
    this.craftFillElapsed = 0;
  }

  /** A craft/oracle/trade was refused by the server (cooldown / requirement): show why and cancel feedback. */
  private craftRefused(msg: string) {
    this.craftMsg = msg;
    this.craftMsgLife = 2.6;
    this.craftFillActive = false;
  }

  /** Ease-out fill curve (mirrors drawFillAnimation): scale 0.01 -> 1, spin PI -> 0. */
  private craftFillTransform(): { scale: number; angle: number } {
    const t = Math.min(1, this.craftFillElapsed / this.craftFillTotal);
    const e = 1 - Math.pow(1 - t, 3);
    return { scale: 0.01 + e * 0.99, angle: (1 - e) * Math.PI };
  }

  private formatCooldown(msLeft: number): string {
    if (msLeft <= 0) return "Ready";
    const h = Math.floor(msLeft / 3600000);
    const m = Math.floor((msLeft % 3600000) / 60000);
    const s = Math.floor((msLeft % 60000) / 1000);
    return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  }

  private cellAt(index: number): Cell | null {
    return index < SLOT_COUNT ? this.slots[index] : this.bag[index - SLOT_COUNT];
  }

  private cellIndexAtPoint(x: number, y: number): number {
    const hb = this.hotbarRects();
    for (let i = 0; i < hb.length; i++) if (hit(hb[i], x, y)) return i;
    if (this.bagAnim > 0.35) return this.bagSlotAtPoint(x, y);
    return -1;
  }

  private hudButtons(): { id: string; rect: Rect; label: string; color: string }[] {
    const bw = Math.min(120, this.w / 8);
    return [
      { id: "bag", rect: { x: 16, y: this.h - 108, w: bw, h: 38 }, label: "Inventory", color: "#3d8bd6" },
      { id: "craft", rect: { x: 16, y: this.h - 62, w: bw, h: 38 }, label: "Craft", color: "#c9762b" },
      { id: "menu", rect: { x: this.w - 108, y: this.h - 62, w: 92, h: 38 }, label: "Menu", color: "#8a4d4d" },
    ];
  }

  private mapButtons(): { id: number; rect: Rect }[] {
    const bw = 92;
    const x = this.w - (bw + 8) * MAPS.length - 8;
    return MAPS.map((m) => ({ id: m.id, rect: { x: x + m.id * (bw + 8), y: this.h - 108, w: bw, h: 38 } }));
  }

  // ---------------------------------------------------------------- events
  private onContext = (e: Event) => e.preventDefault();

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.scene === "menu" && this.focus) {
      e.preventDefault();
      this.typeInto(e.key);
      return;
    }
    if (this.scene === "game" && this.bagOpen && this.bagSearchActive) {
      e.preventDefault();
      this.typeIntoBagSearch(e.key);
      return;
    }
    if (this.scene === "game" && this.craftOpen && this.craftSearchActive) {
      e.preventDefault();
      this.typeIntoCraftSearch(e.key);
      return;
    }
    this.keys.add(e.code);
    if (e.code === "Space") e.preventDefault();
    if (this.scene === "game") {
      if (e.code === "KeyE" || e.code === "KeyI") this.toggleBag();
      if (e.code === "KeyC") this.toggleCraft();
      if (e.code === "Escape") this.gotoMenu();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private typeIntoBagSearch(key: string) {
    if (key === "Backspace") this.bagSearchText = this.bagSearchText.slice(0, -1);
    else if (key === "Escape" || key === "Enter") this.bagSearchActive = false;
    else if (key.length === 1 && this.bagSearchText.length < 24) this.bagSearchText += key;
    this.bagScrollY = 0;
    this.clampBagScroll();
  }

  private typeIntoCraftSearch(key: string) {
    if (key === "Backspace") this.craftSearchText = this.craftSearchText.slice(0, -1);
    else if (key === "Escape" || key === "Enter") this.craftSearchActive = false;
    else if (key.length === 1 && this.craftSearchText.length < 24) this.craftSearchText += key;
    this.craftScrollY = 0;
    this.clampCraftScroll();
  }

  private typeInto(key: string) {
    const field = this.focus;
    if (!field) return;
    const get = () => (field === "name" ? this.playerName : field === "user" ? this.authUser : this.authPass);
    const set = (v: string) => {
      if (field === "name") this.playerName = v;
      else if (field === "user") this.authUser = v;
      else this.authPass = v;
    };
    if (key === "Backspace") set(get().slice(0, -1));
    else if (key === "Enter") this.focus = null;
    else if (key === "Tab") this.focus = field === "user" ? "pass" : "user";
    else if (key.length === 1 && get().length < 16) set(get() + key);
  }

  private pointerPos(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onPointerMove = (e: PointerEvent) => {
    const p = this.pointerPos(e);
    this.mx = p.x;
    this.my = p.y;
    if (this.drag) {
      this.dragX = p.x;
      this.dragY = p.y;
    }
    if (this.bagDraggingThumb) this.dragBagThumb(p.y);
    if (this.craftDraggingThumb) this.dragCraftThumb(p.y);
  };

  private onPointerDown = (e: PointerEvent) => {
    const p = this.pointerPos(e);
    this.mx = p.x;
    this.my = p.y;
    if (e.button === 2) {
      this.rightDown = true;
      return;
    }
    this.mouseDown = true;
    if (this.scene === "menu") this.menuClick(p.x, p.y);
    else this.gameClick(p.x, p.y);
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.button === 2) {
      this.rightDown = false;
      return;
    }
    this.mouseDown = false;
    this.bagDraggingThumb = false;
    this.craftDraggingThumb = false;
    if (this.drag) this.dropDrag(this.mx, this.my);
  };

  private onWheel = (e: WheelEvent) => {
    if (this.scene !== "game") return;
    // Pixel-accurate scrolling: translate the wheel delta directly into scrollY pixels
    // (with a little extra punch for coarse "line" deltas some browsers/mice report).
    const scrollAmount = (gridH: number) => {
      let amount = e.deltaY;
      if (e.deltaMode === 1) amount *= 18; // DOM_DELTA_LINE
      else if (e.deltaMode === 2) amount *= gridH; // DOM_DELTA_PAGE
      return amount;
    };

    if (this.craftOpen && this.craftAnim >= 0.4) {
      const layout = this.craftLayout();
      if (hit(layout.panel, this.mx, this.my)) {
        e.preventDefault();
        this.craftScrollY += scrollAmount(layout.gridH);
        this.clampCraftScroll();
        return;
      }
    }

    if (this.bagOpen && this.bagAnim >= 0.4) {
      const layout = this.bagLayout();
      if (hit(layout.panel, this.mx, this.my)) {
        e.preventDefault();
        this.bagScrollY += scrollAmount(layout.gridH);
        this.clampBagScroll();
      }
    }
  };

  // ------------------------------------------------------------ menu logic
  private menuLayout() {
    const cw = Math.min(620, this.w - 40);
    const ch = Math.min(430, this.h - 140);
    const x = (this.w - cw) / 2;
    const y = Math.max(90, (this.h - ch) / 2 + 20);
    return { x, y, w: cw, h: ch };
  }

  private menuClick(mx: number, my: number) {
    const box = this.menuLayout();
    const tabW = 120;
    if (hit({ x: box.x + 16, y: box.y + 12, w: tabW, h: 34 }, mx, my)) this.menuTab = "play";
    if (hit({ x: box.x + 16 + tabW + 8, y: box.y + 12, w: tabW, h: 34 }, mx, my)) this.menuTab = "account";

    if (this.menuTab === "play") {
      const nameRect = { x: box.x + 30, y: box.y + 76, w: box.w - 60, h: 42 };
      this.focus = hit(nameRect, mx, my) ? "name" : null;
      const cardW = (box.w - 80) / 3;
      for (let i = 0; i < MAPS.length; i++) {
        const r = { x: box.x + 30 + i * (cardW + 10), y: box.y + 140, w: cardW, h: 130 };
        if (hit(r, mx, my)) this.selectedMap = i;
      }
      const playRect = { x: box.x + box.w / 2 - 110, y: box.y + box.h - 74, w: 220, h: 52 };
      if (hit(playRect, mx, my)) this.startGame();
    } else {
      const userRect = { x: box.x + 30, y: box.y + 96, w: box.w - 60, h: 42 };
      const passRect = { x: box.x + 30, y: box.y + 168, w: box.w - 60, h: 42 };
      this.focus = hit(userRect, mx, my) ? "user" : hit(passRect, mx, my) ? "pass" : null;
      const bw = (box.w - 80) / 3;
      const by = box.y + 240;
      if (hit({ x: box.x + 30, y: by, w: bw, h: 46 }, mx, my)) void this.auth("login");
      if (hit({ x: box.x + 40 + bw, y: by, w: bw, h: 46 }, mx, my)) void this.auth("register");
      if (hit({ x: box.x + 50 + bw * 2, y: by, w: bw, h: 46 }, mx, my)) this.logout();
    }
  }

  private startGame() {
    this.pendingScene = () => {
      this.scene = "game";
      this.alive = true;
      this.connect();
    };
  }

  private gotoMenu() {
    this.persist();
    this.pendingScene = () => {
      this.scene = "menu";
      this.net?.close();
      this.net = null;
      this.connected = false;
      this.bagOpen = false;
      this.craftOpen = false;
      this.craftSearchActive = false;
      this.craftBiomeOpen = false;
    };
  }

  // ------------------------------------------------------------ game input
  private gameClick(mx: number, my: number) {
    if (!this.alive) {
      const bw = 180;
      const cx = this.w / 2;      if (hit({ x: cx - bw - 10, y: this.h / 2 + 40, w: bw, h: 52 }, mx, my)) {
        const w = new Writer(2);
        w.u8(C2S.RESPAWN);
        this.net?.send(w.bytes());
        this.alive = true;
      }
      if (hit({ x: cx + 10, y: this.h / 2 + 40, w: bw, h: 52 }, mx, my)) this.gotoMenu();
      return;
    }

    for (const b of this.hudButtons()) {
      if (!hit(b.rect, mx, my)) continue;
      if (b.id === "bag") this.toggleBag();
      if (b.id === "craft") this.toggleCraft();
      if (b.id === "menu") this.gotoMenu();
      return;
    }
    for (const b of this.mapButtons()) {
      if (!hit(b.rect, mx, my)) continue;
      if (b.id !== this.mapId) {
        this.selectedMap = b.id;
        this.mapFlash = 1;
        const w = new Writer(4);
        w.u8(C2S.CHANGE_MAP).u8(b.id);
        this.net?.send(w.bytes());
      }
      return;
    }

    if (this.craftAnim > 0.4 && this.handleCraftClick(mx, my)) return;

    if (this.bagAnim > 0.4 && this.handleBagClick(mx, my)) return;


    const idx = this.cellIndexAtPoint(mx, my);
    if (idx >= 0) {
      const cell = this.cellAt(idx);
      if (cell) {
        this.drag = { from: idx, cell };
        this.dragX = mx;
        this.dragY = my;
      }
      return;
    }
  }

  /** The bag and the craft panel are the same size, so only one is ever open. */
  private toggleBag() {
    this.bagOpen = !this.bagOpen;
    if (this.bagOpen) {
      this.craftOpen = false;
      this.craftSearchActive = false;
      this.craftBiomeOpen = false;
    }
  }

  private toggleCraft() {
    this.craftOpen = !this.craftOpen;
    if (this.craftOpen) {
      this.bagOpen = false;
      this.bagSearchActive = false;
      this.bagBiomeOpen = false;
      this.clampCraftScroll();
    } else {
      this.craftSearchActive = false;
      this.craftBiomeOpen = false;
    }
  }

  /** Cooldown remaining (ms) for the given craft mode; 0 if ready or not applicable. */
  private craftCooldownLeft(mode: "oracle" | "trade"): number {
    const until = mode === "oracle" ? this.nextOracleAt : this.nextTradeAt;
    return Math.max(0, until - Date.now());
  }

  /** Handles clicks that land on the crafting panel (tabs/search/grid/slots/action button). */
  private handleCraftClick(mx: number, my: number): boolean {
    const layout = this.craftLayout();
    const p = layout.panel;
    if (!hit(p, mx, my)) return false;

    if (hit(layout.closeRect, mx, my)) {
      this.craftOpen = false;
      return true;
    }

    for (const { mode, rect } of this.craftModeRects()) {
      if (!hit(rect, mx, my)) continue;
      if (this.craftMode !== mode) {
        this.craftMode = mode;
        this.craftSel = null;
        this.craftMsg = "";
        this.craftScrollY = 0;
        this.clampCraftScroll();
      }
      return true;
    }

    if (hit(layout.barRect, mx, my)) {
      this.craftSearchActive = true;
      this.craftBiomeOpen = false;
      return true;
    }

    if (hit(layout.dropRect, mx, my)) {
      this.craftBiomeOpen = !this.craftBiomeOpen;
      this.craftSearchActive = false;
      return true;
    }

    if (this.craftBiomeOpen) {
      const optH = layout.dropRect.h + 2;
      const listY = layout.dropRect.y + layout.dropRect.h + 4;
      for (let i = 0; i < BIOME_LIST.length; i++) {
        const rect: Rect = { x: layout.dropRect.x + 3, y: listY + 3 + i * optH, w: layout.dropRect.w - 6, h: optH - 2 };
        if (hit(rect, mx, my)) {
          this.craftBiome = BIOME_LIST[i];
          this.craftBiomeOpen = false;
          this.craftScrollY = 0;
          this.clampCraftScroll();
          return true;
        }
      }
      this.craftBiomeOpen = false;
      return true;
    }

    if (this.craftMaxScroll() > 0) {
      const thumb = this.craftScrollThumbRect(layout);
      if (hit(thumb, mx, my)) {
        this.craftDraggingThumb = true;
        this.craftThumbDragStartY = my;
        this.craftScrollAtDragStart = this.craftScrollY;
        return true;
      }
      if (hit(layout.scrollTrack, mx, my)) {
        const maxScroll = this.craftMaxScroll();
        const ratio = (my - layout.scrollTrack.y) / layout.scrollTrack.h;
        this.craftScrollY = Math.max(0, Math.min(maxScroll, ratio * maxScroll));
        return true;
      }
    }

    this.craftSearchActive = false;

    // click a card in the browser grid to load it into the craft slots (drag still works too)
    const entry = this.craftGridEntryAtPoint(mx, my);
    if (entry) {
      this.selectCraftCell(entry.cell);
      return true;
    }

    // clicking the big slots clears the selection
    const slots = this.craftMode === "normal" ? this.craftPadRects() : [this.craftSingleSlotRect()];
    for (const r of slots) {
      if (hit(r, mx, my) && this.craftSel) {
        this.craftSel = null;
        this.craftMsg = "";
        return true;
      }
    }

    if (hit(layout.actionRect, mx, my)) this.submitCraft();
    return true;
  }

  /** Puts a bag cell into the craft slots, with a little pop of feedback. */
  private selectCraftCell(cell: Cell) {
    if (this.craftMode !== "trade" && ITEMS[cell.item]?.kind === "trinket") {
      this.craftMsg = "Coins can only be traded.";
      this.craftMsgLife = 2;
      return;
    }
    this.craftSel = { item: cell.item, rarity: cell.rarity };
    this.craftMsg = "";
    this.craftGlow = 1;
  }

  /** Fires the current mode's request if the selection satisfies its requirements. */
  private submitCraft() {
    const sel = this.craftSel;
    if (!sel) {
      this.craftMsg = "Pick a card first.";
      this.craftMsgLife = 2;
      this.craftShake = 0.35;
      return;
    }
    const avail = this.countOf(sel.item, sel.rarity);

    if (this.craftMode === "normal") {
      if (avail < 5 || sel.rarity >= MAX_CRAFT_RARITY) {
        this.craftMsg = avail < 5 ? "Need 5 identical cards." : "Already at max craftable rarity.";
        this.craftMsgLife = 2;
        this.craftShake = 0.35;
        return;
      }
      const w = new Writer(6);
      w.u8(C2S.CRAFT).u8(sel.item).u8(sel.rarity).u16(0);
      this.net?.send(w.bytes());
      this.craftSpin = 0.8;
      return;
    }

    if (this.craftMode === "oracle") {
      const required = oracleRequiredCount(sel.rarity);
      if (required === undefined || avail < required || this.craftCooldownLeft("oracle") > 0) {
        this.craftMsg = required === undefined ? "Cannot Oracle this rarity." : avail < required ? `Need ${required} cards.` : "Oracle is on cooldown.";
        this.craftMsgLife = 2;
        this.craftShake = 0.35;
        return;
      }
      const w = new Writer(4);
      w.u8(C2S.ORACLE).u8(sel.item).u8(sel.rarity);
      this.net?.send(w.bytes());
      this.craftSpin = 0.8;
      return;
    }

    if (avail < 1 || this.craftCooldownLeft("trade") > 0) {
      this.craftMsg = avail < 1 ? "Nothing to trade." : "Trade is on cooldown.";
      this.craftMsgLife = 2;
      this.craftShake = 0.35;
      return;
    }
    const w = new Writer(6);
    w.u8(C2S.TRADE).u8(sel.item).u8(sel.rarity).u16(0);
    this.net?.send(w.bytes());
    this.craftSpin = 0.8;
  }

  /** Handles clicks that land on the bag's own chrome (close/search/biome/scrollbar). */
  private handleBagClick(mx: number, my: number): boolean {
    const layout = this.bagLayout();
    const p = layout.panel;
    if (!hit(p, mx, my)) return false;

    if (hit(layout.closeRect, mx, my)) {
      this.bagOpen = false;
      return true;
    }

    const barRect: Rect = { x: layout.barX, y: layout.barY, w: layout.barW, h: layout.barH };
    if (hit(barRect, mx, my)) {
      this.bagSearchActive = true;
      this.bagBiomeOpen = false;
      return true;
    }

    const dropRect: Rect = { x: layout.dropX, y: layout.barY, w: layout.dropW, h: layout.barH };
    if (hit(dropRect, mx, my)) {
      this.bagBiomeOpen = !this.bagBiomeOpen;
      this.bagSearchActive = false;
      return true;
    }

    if (this.bagBiomeOpen) {
      const optH = layout.barH + 2;
      const listY = layout.barY + layout.barH + 4;
      for (let i = 0; i < BIOME_LIST.length; i++) {
        const rect: Rect = { x: layout.dropX + 3, y: listY + 3 + i * optH, w: layout.dropW - 6, h: optH - 2 };
        if (hit(rect, mx, my)) {
          this.bagBiome = BIOME_LIST[i];
          this.bagBiomeOpen = false;
          this.bagScrollY = 0;
          this.clampBagScroll();
          return true;
        }
      }
      this.bagBiomeOpen = false;
      return true;
    }

    if (this.bagMaxScroll() > 0) {
      const thumb = this.bagScrollThumbRect(layout);
      if (hit(thumb, mx, my)) {
        this.bagDraggingThumb = true;
        this.bagThumbDragStartY = my;
        this.bagScrollAtDragStart = this.bagScrollY;
        return true;
      }
      if (hit(layout.scrollTrack, mx, my)) {
        const maxScroll = this.bagMaxScroll();
        const ratio = (my - layout.scrollTrack.y) / layout.scrollTrack.h;
        this.bagScrollY = Math.max(0, Math.min(maxScroll, ratio * maxScroll));
        return true;
      }
    }

    this.bagSearchActive = false;
    return false;
  }

  private bagScrollThumbRect(layout: ReturnType<GameClient["bagLayout"]>): Rect {
    const track = layout.scrollTrack;
    const filtered = this.bagFilteredEntries();
    const totalRows = Math.max(1, Math.ceil(filtered.length / layout.cols));
    if (totalRows <= layout.maxVisibleRows) return { x: track.x, y: track.y, w: track.w, h: track.h };
    const maxScroll = this.bagMaxScroll();
    const thumbH = Math.max(20, (layout.maxVisibleRows / totalRows) * track.h);
    const ratio = maxScroll > 0 ? this.bagScrollY / maxScroll : 0;
    const thumbY = track.y + ratio * (track.h - thumbH);
    return { x: track.x, y: thumbY, w: track.w, h: thumbH };
  }

  private dragBagThumb(my: number) {
    const layout = this.bagLayout();
    const maxScroll = this.bagMaxScroll();
    if (maxScroll <= 0) {
      this.bagDraggingThumb = false;
      return;
    }
    const track = layout.scrollTrack;
    const filtered = this.bagFilteredEntries();
    const totalRows = Math.max(1, Math.ceil(filtered.length / layout.cols));
    const thumbH = Math.max(20, (layout.maxVisibleRows / totalRows) * track.h);
    const maxDrag = track.h - thumbH;
    if (maxDrag <= 0) return;
    const dy = my - this.bagThumbDragStartY;
    const ratio = dy / maxDrag;
    this.bagScrollY = Math.max(0, Math.min(maxScroll, this.bagScrollAtDragStart + ratio * maxScroll));
  }

  private countOf(item: number, rarity: number) {
    let n = 0;
    for (const c of this.bag) if (c && c.item === item && c.rarity === rarity) n += c.count;
    return n;
  }

  private dropDrag(mx: number, my: number) {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    if (this.craftAnim > 0.4 && hit(this.craftPanelRect(), mx, my)) {
      this.selectCraftCell(drag.cell);
      return;
    }
    const target = this.cellIndexAtPoint(mx, my);
    if (target < 0 || target === drag.from) return;
    const w = new Writer(4);
    w.u8(C2S.SWAP).u8(drag.from).u8(target);
    this.net?.send(w.bytes());
    // optimistic local swap for snappy feel
    const a = this.cellAt(drag.from);
    const b = this.cellAt(target);
    this.setCellLocal(drag.from, b);
    this.setCellLocal(target, a);
  }

  private setCellLocal(index: number, cell: Cell | null) {
    if (index < SLOT_COUNT) this.slots[index] = cell;
    else this.bag[index - SLOT_COUNT] = cell;
  }

  // --------------------------------------------------------------- render
  private render(dt: number) {
    const ctx = this.ctx;
    ctx.save();
    if (this.scene === "menu") this.renderMenu(dt);
    else this.renderGame(dt);
    ctx.restore();

    if (this.fade > 0.001) {
      ctx.save();
      ctx.globalAlpha = this.fade;
      ctx.fillStyle = "#0b1016";
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
      if (this.fade > 0.5) {
        text(ctx, "Loading...", this.w / 2, this.h / 2, 26, "rgba(255,255,255,0.85)");
      }
      ctx.restore();
    }
  }

  private renderMenu(dt: number) {
    const ctx = this.ctx;
    const t = this.time;
    // animated gradient background
    const g = ctx.createLinearGradient(0, 0, this.w, this.h);
    g.addColorStop(0, "#123c2c");
    g.addColorStop(0.5, "#15544a");
    g.addColorStop(1, "#1d3b58");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    for (let i = 0; i < 26; i++) {
      const px = ((i * 397) % this.w) + Math.sin(t * 0.5 + i) * 40;
      const py = (((i * 251) % this.h) + t * (12 + (i % 5) * 6)) % (this.h + 60);
      ctx.save();
      ctx.globalAlpha = 0.25;
      drawItemIcon(ctx, i % ITEMS.length, px, this.h - py, 12 + (i % 4) * 3, t * (0.4 + (i % 3) * 0.2));
      ctx.restore();
    }

    const bob = Math.sin(t * 1.6) * 6;
    drawFlower(ctx, this.w / 2, 62 + bob, 30, true, 0);
    text(ctx, "PETALIA.IO", this.w / 2, 130 + bob * 0.4, Math.min(58, this.w / 10), "#ffe763");
    text(ctx, "a florr-like arena: garden / desert / ocean", this.w / 2, 166, 15, "rgba(255,255,255,0.8)");

    const box = this.menuLayout();
    panel(ctx, box);
    const tabW = 120;
    button(ctx, { x: box.x + 16, y: box.y + 12, w: tabW, h: 34 }, "Play", this.menuTab === "play" ? "#3fae60" : "#41505f", false, 17);
    button(ctx, { x: box.x + 16 + tabW + 8, y: box.y + 12, w: tabW, h: 34 }, "Account", this.menuTab === "account" ? "#3fae60" : "#41505f", false, 17);

    if (this.menuTab === "play") {
      this.field(box.x + 30, box.y + 76, box.w - 60, 42, this.playerName, "Flower name", this.focus === "name");
      const cardW = (box.w - 80) / 3;
      for (const map of MAPS) {
        const r = { x: box.x + 30 + map.id * (cardW + 10), y: box.y + 140, w: cardW, h: 130 };
        const selected = this.selectedMap === map.id;
        const hovered = hit(r, this.mx, this.my);
        ctx.save();
        const pulse = selected ? 1 + Math.sin(t * 5) * 0.015 : 1;
        ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
        ctx.scale(pulse, pulse);
        ctx.translate(-r.x - r.w / 2, -r.y - r.h / 2);
        roundRect(ctx, r.x, r.y, r.w, r.h, 12);
        ctx.fillStyle = map.bg;
        ctx.fill();
        ctx.lineWidth = selected ? 5 : 3;
        ctx.strokeStyle = selected ? "#ffe763" : hovered ? "#ffffff" : "rgba(0,0,0,0.35)";
        ctx.stroke();
        ctx.save();
        roundRect(ctx, r.x, r.y, r.w, r.h, 12);
        ctx.clip();
        ctx.fillStyle = map.grid;
        for (let i = 0; i < 10; i++) ctx.fillRect(r.x + i * 26 - ((t * 12) % 26), r.y, 13, r.h);
        const mobIds = map.mobs.slice(0, 3);
        mobIds.forEach((mid, i) => {
          drawMob(ctx, mid, r.x + r.w * (0.25 + i * 0.25), r.y + r.h * 0.55 + Math.sin(t * 2 + i) * 5, 15, Math.sin(t + i) * 0.6, t, false);
        });
        ctx.restore();
        text(ctx, map.name, r.x + r.w / 2, r.y + 20, 20, "#ffffff");
        text(ctx, `${map.mobs.length} species`, r.x + r.w / 2, r.y + r.h - 16, 13, "rgba(255,255,255,0.9)");
        ctx.restore();
      }
      const playRect = { x: box.x + box.w / 2 - 110, y: box.y + box.h - 74, w: 220, h: 52 };
      button(ctx, playRect, "PLAY", "#3fae60", hit(playRect, this.mx, this.my), 26);
      text(ctx, this.authStatus, box.x + box.w / 2, box.y + box.h - 96, 13, "rgba(255,255,255,0.75)");
    } else {
      text(ctx, "Account (stored in PostgreSQL)", box.x + 30, box.y + 74, 16, "#ffe763", "left");
      this.field(box.x + 30, box.y + 96, box.w - 60, 42, this.authUser, "username", this.focus === "user");
      this.field(box.x + 30, box.y + 168, box.w - 60, 42, "*".repeat(this.authPass.length), "password", this.focus === "pass");
      const bw = (box.w - 80) / 3;
      const by = box.y + 240;
      button(ctx, { x: box.x + 30, y: by, w: bw, h: 46 }, "Log in", "#3d8bd6", hit({ x: box.x + 30, y: by, w: bw, h: 46 }, this.mx, this.my), 18);
      button(ctx, { x: box.x + 40 + bw, y: by, w: bw, h: 46 }, "Register", "#3fae60", hit({ x: box.x + 40 + bw, y: by, w: bw, h: 46 }, this.mx, this.my), 18);
      button(ctx, { x: box.x + 50 + bw * 2, y: by, w: bw, h: 46 }, "Guest", "#7a5f45", hit({ x: box.x + 50 + bw * 2, y: by, w: bw, h: 46 }, this.mx, this.my), 18);
      text(ctx, this.authStatus, box.x + box.w / 2, by + 76, 14, "rgba(255,255,255,0.85)");
      text(ctx, "Guest progress lives in localStorage.", box.x + box.w / 2, by + 100, 13, "rgba(255,255,255,0.55)");
    }
    text(
      ctx,
      "WASD / arrows move · hold left mouse to attack · right mouse to defend · E bag · C craft",
      this.w / 2,
      this.h - 24,
      14,
      "rgba(255,255,255,0.7)",
    );
  }

  private field(x: number, y: number, w: number, h: number, value: string, placeholder: string, focused: boolean) {
    const ctx = this.ctx;
    roundRect(ctx, x, y, w, h, 8);
    ctx.fillStyle = focused ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.3)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = focused ? "#ffe763" : "rgba(255,255,255,0.3)";
    ctx.stroke();
    const caret = focused && Math.floor(this.time * 2) % 2 === 0 ? "|" : "";
    text(
      ctx,
      value ? value + caret : placeholder,
      x + 14,
      y + h / 2,
      18,
      value ? "#ffffff" : "rgba(255,255,255,0.45)",
      "left",
    );
  }

  // ------------------------------------------------------------ game scene
  private renderGame(dt: number) {
    const ctx = this.ctx;
    const map = MAPS[this.mapId] ?? MAPS[0];
    ctx.fillStyle = map.bg;
    ctx.fillRect(0, 0, this.w, this.h);

    const zoom = Math.min(1.15, Math.max(0.72, Math.min(this.w / 1280, this.h / 800) * 1.05));
    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-this.camX, -this.camY);

    // grid
    const viewW = this.w / zoom;
    const viewH = this.h / zoom;
    const gx0 = Math.floor((this.camX - viewW / 2) / 64) * 64;
    const gy0 = Math.floor((this.camY - viewH / 2) / 64) * 64;
    ctx.strokeStyle = map.grid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = gx0; x < this.camX + viewW / 2 + 64; x += 64) {
      ctx.moveTo(x, this.camY - viewH / 2);
      ctx.lineTo(x, this.camY + viewH / 2);
    }
    for (let y = gy0; y < this.camY + viewH / 2 + 64; y += 64) {
      ctx.moveTo(this.camX - viewW / 2, y);
      ctx.lineTo(this.camX + viewW / 2, y);
    }
    ctx.stroke();

    // out-of-bounds shading
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    const ob = 4000;
    ctx.fillRect(this.camX - viewW, -ob, viewW * 2, ob);
    ctx.fillRect(this.camX - viewW, this.worldH, viewW * 2, ob);
    ctx.fillRect(-ob, this.camY - viewH, ob, viewH * 2);
    ctx.fillRect(this.worldW, this.camY - viewH, ob, viewH * 2);

    // walls
    for (const wall of this.walls) {
      roundRect(ctx, wall.x, wall.y + 6, wall.w, wall.h, 10);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fill();
      roundRect(ctx, wall.x, wall.y, wall.w, wall.h, 10);
      ctx.fillStyle = shade(map.bg, -58);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = shade(map.bg, -84);
      ctx.stroke();
    }

    // entities
    const list = [...this.ents.values()].sort((a, b) => a.kind - b.kind || a.y - b.y);
    for (const e of list) {
      if (e.kind === ENT.DROP) this.drawDrop(e);
    }
    for (const e of list) {
      if (e.kind === ENT.PETAL) drawItemIcon(ctx, e.type, e.x, e.y, e.radius, this.time * 3 + e.id);
      else if (e.kind === ENT.MOB) this.drawMobEnt(e);
      else if (e.kind === ENT.PLAYER) this.drawPlayerEnt(e);
    }

    // floaters live in world space
    for (const f of this.floaters) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
      text(ctx, f.msg, f.x, f.y, 16, f.color);
      ctx.restore();
    }
    ctx.restore();

    if (this.mapFlash > 0) {
      ctx.save();
      ctx.globalAlpha = this.mapFlash * 0.8;
      ctx.fillStyle = map.accent;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();
      text(ctx, map.name, this.w / 2, this.h / 2 - 120, 44 + (1 - this.mapFlash) * 6, "#ffffff");
    }

    this.renderHud();
    this.renderBag();
    this.renderCraft();
    if (this.drag) {
      const size = 60;
      drawCard(ctx, { x: this.dragX - size / 2, y: this.dragY - size / 2, w: size, h: size }, this.drag.cell, {
        hovered: true,
        scale: 1.1,
      });
    }
    if (!this.alive) this.renderDeath();
    if (!this.connected) {
      panel(ctx, { x: this.w / 2 - 120, y: 16, w: 240, h: 40 });
      text(ctx, "connecting to server...", this.w / 2, 36, 16, "#ffe763");
    }
  }

  private drawDrop(e: Ent) {
    const ctx = this.ctx;
    const rarity = RARITIES[Math.min(e.team, RARITIES.length - 1)] ?? RARITIES[0];
    const bob = Math.sin(this.time * 4 + e.id) * 3;
    ctx.save();
    ctx.globalAlpha = 0.9;
    roundRect(ctx, e.x - 15, e.y - 18 + bob, 30, 36, 6);
    ctx.fillStyle = rarity.color;
    ctx.fill();
    roundRect(ctx, e.x - 12, e.y - 15 + bob, 24, 30, 5);    ctx.fillStyle = shade(rarity.color, -40);
    ctx.fill();
    drawItemIcon(ctx, e.type, e.x, e.y + bob, 9, this.time * 2);
    ctx.restore();
  }

  private drawMobEnt(e: Ent) {
    const ctx = this.ctx;
    const def = MOBS[e.type];
    if (!def) return;
    drawMob(ctx, e.type, e.x, e.y, e.radius, e.angle, this.time, e.team !== TEAM.HOSTILE);
    if (e.hurt > 0) {
      ctx.save();
      ctx.globalAlpha = e.hurt * 3;
      ctx.fillStyle = "rgba(255,120,120,0.7)";
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (e.hp < 0.999) healthBar(ctx, e.x - e.radius, e.y + e.radius + 6, e.radius * 2, 8, e.hp, e.team === TEAM.HOSTILE ? "#ff7070" : "#7dffa0");
    text(ctx, def.name, e.x, e.y - e.radius - 12, 12, "rgba(255,255,255,0.9)");
  }

  private drawPlayerEnt(e: Ent) {
    const ctx = this.ctx;
    drawFlower(ctx, e.x, e.y, e.radius, e.team === TEAM.SELF, e.hurt);
    text(ctx, e.name || "flower", e.x, e.y - e.radius - 16, 14, "#ffffff");
    healthBar(ctx, e.x - 32, e.y + e.radius + 8, 64, 9, e.hp);
  }

  private renderHud() {
    const ctx = this.ctx;
    // xp / level bar
    const barW = Math.min(340, this.w * 0.32);
    panel(ctx, { x: 16, y: 16, w: barW, h: 66 }, "rgba(18,24,32,0.75)");
    const need = xpForLevel(this.level + 1);
    const prev = xpForLevel(this.level);
    const pct = Math.max(0, Math.min(1, (this.xp - prev) / Math.max(1, need - prev)));
    text(ctx, `Lv ${this.level} ${this.playerName}`, 30, 36, 16, "#ffe763", "left");
    healthBar(ctx, 30, 50, barW - 28, 14, pct, "#ffd34a");
    text(ctx, `${this.xp} XP`, 30 + (barW - 28) / 2, 57, 11, "#3a2b00");

    // health
    const hpW = Math.min(300, this.w * 0.28);
    healthBar(ctx, this.w / 2 - hpW / 2, this.h - 96, hpW, 18, this.hp / Math.max(1, this.maxHp), "#57e36a");
    text(ctx, `${Math.max(0, Math.round(this.hp))} / ${this.maxHp}`, this.w / 2, this.h - 87, 12, "#ffffff");

    // hotbar
    const rects = this.hotbarRects();
    rects.forEach((r, i) => {
      const cell = this.slots[i];
      const hovered = hit(r, this.mx, this.my);
      drawCard(ctx, r, cell, { hovered, empty: `${i + 1}`, dim: this.drag?.from === i ? 0.35 : 1 });
      if (cell && ITEMS[cell.item].kind === "summon") {
        text(ctx, "SUMMON", r.x + r.w / 2, r.y + 12, 9, "#ffe763");
      }
    });

    // buttons
    for (const b of this.hudButtons()) button(ctx, b.rect, b.label, b.color, hit(b.rect, this.mx, this.my), 16);
    for (const b of this.mapButtons()) {
      const active = b.id === this.mapId;
      button(ctx, b.rect, MAPS[b.id].name, active ? "#3fae60" : "#41505f", hit(b.rect, this.mx, this.my), 15);
    }

    // minimap
    const mm = 132;
    const mx = this.w - mm - 16;
    const my = 16;
    panel(ctx, { x: mx, y: my, w: mm, h: mm }, "rgba(10,16,22,0.72)");
    const sx = (mm - 12) / this.worldW;
    const sy = (mm - 12) / this.worldH;
    ctx.save();
    ctx.translate(mx + 6, my + 6);
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    for (const w of this.walls) ctx.fillRect(w.x * sx, w.y * sy, Math.max(1, w.w * sx), Math.max(1, w.h * sy));
    for (const e of this.ents.values()) {
      if (e.kind === ENT.MOB) ctx.fillStyle = e.team === TEAM.HOSTILE ? "rgba(255,120,120,0.8)" : "rgba(140,255,170,0.9)";
      else if (e.kind === ENT.PLAYER) ctx.fillStyle = e.team === TEAM.SELF ? "#ffe763" : "#9ad4ff";
      else continue;
      const size = e.team === TEAM.SELF ? 4 : 3;
      ctx.fillRect(e.x * sx - size / 2, e.y * sy - size / 2, size, size);
    }
    ctx.restore();
    text(ctx, MAPS[this.mapId]?.name ?? "", mx + mm / 2, my + mm - 10, 12, "rgba(255,255,255,0.85)");

    // kill feed
    this.killFeed.forEach((k, i) => {
      ctx.save();
      ctx.globalAlpha = Math.min(1, k.life);
      text(ctx, k.msg, this.w - 16, my + mm + 24 + i * 20, 14, "#d9ffd9", "right");
      ctx.restore();
    });
  }

  private renderBag() {
    if (this.bagAnim < 0.01) return;
    const ctx = this.ctx;
    const layout = this.bagLayout();
    const p = layout.panel;
    this.clampBagScroll();

    ctx.save();
    ctx.globalAlpha = Math.min(1, this.bagAnim * 1.3);

    // main panel background, styled like the reference UI (blue card + dark border)
    roundRect(ctx, p.x, p.y, p.w, p.h, 10);
    ctx.fillStyle = "#5aa0db";
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#3f7dc2";
    ctx.stroke();

    text(ctx, "Inventory", p.x + p.w / 2, p.y + 24, 20, "#ffffff");

    // close button
    button(ctx, layout.closeRect, "x", "#e53232", hit(layout.closeRect, this.mx, this.my), 15);

    // search bar + biome dropdown
    const barRect: Rect = { x: layout.barX, y: layout.barY, w: layout.barW, h: layout.barH };
    const dropRect: Rect = { x: layout.dropX, y: layout.barY, w: layout.dropW, h: layout.barH };
    searchField(ctx, barRect, this.bagSearchText, this.bagSearchActive);
    dropdownField(ctx, dropRect, this.bagBiome, this.bagBiomeOpen);

    // clipped, pixel-scrolled item grid
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x + 2, layout.gridTop, p.w - 4, layout.gridH);
    ctx.clip();

    const filtered = this.bagFilteredEntries();
    const maxScroll = this.bagMaxScroll();
    this.bagScrollY = Math.max(0, Math.min(maxScroll, this.bagScrollY));

    const startRow = Math.floor(this.bagScrollY / layout.itemHeight);
    const yOffset = -(this.bagScrollY % layout.itemHeight);
    const startIdx = startRow * layout.cols;
    const visibleSlots = layout.maxVisibleRows + 2;
    const endIdx = startIdx + visibleSlots * layout.cols;
    const visible = filtered.slice(startIdx, endIdx);

    let hoveredEntry: { slot: number; cell: Cell } | null = null;
    let hoveredRect: Rect | null = null;

    visible.forEach((entry, i) => {
      const row = Math.floor(i / layout.cols);
      const col = i % layout.cols;
      const slotX = p.x + layout.pad + col * (layout.slotSize + layout.gap);
      const slotY = layout.gridTop + row * layout.itemHeight + yOffset;
      if (slotY + layout.slotSize < layout.gridTop || slotY > layout.gridTop + layout.gridH) return;
      const r: Rect = { x: slotX, y: slotY, w: layout.slotSize, h: layout.slotSize };
      const hovered = hit(r, this.mx, this.my) && !this.drag;
      if (hovered) {
        hoveredEntry = entry;
        hoveredRect = r;
      }
      drawCard(ctx, r, entry.cell, { hovered, dim: this.drag?.from === SLOT_COUNT + entry.slot ? 0.35 : 1 });
    });

    ctx.restore();

    // scrollbar
    const totalRows = Math.max(1, Math.ceil(filtered.length / layout.cols));
    if (totalRows > layout.maxVisibleRows) {
      scrollbar(ctx, layout.scrollTrack, this.bagScrollThumbRect(layout), this.bagDraggingThumb);
    }

    // rarity summary panel
    this.drawBagRarityStats(ctx, layout);

    // tooltip for hovered card
    if (hoveredEntry && hoveredRect) {
      this.tooltip((hoveredEntry as { slot: number; cell: Cell }).cell, this.mx + 14, this.my - 10);
    }

    if (this.bagBiomeOpen) dropdownList(ctx, dropRect, BIOME_LIST, this.bagBiome, this.mx, this.my);

    ctx.restore();
  }

  private bagRarityStats(): { count: number; color: string; name: string }[] {
    const stats = RARITIES.map((r) => ({ count: 0, color: r.color, name: r.name }));
    for (const cell of this.bag) {
      if (cell && stats[cell.rarity]) stats[cell.rarity].count += cell.count;
    }
    return stats;
  }

  private drawBagRarityStats(ctx: CanvasRenderingContext2D, layout: ReturnType<GameClient["bagLayout"]>) {
    const p = layout.panel;
    const panelH = layout.statsH;
    const panelY = p.y + p.h - panelH - 4;
    const panelX = p.x + layout.pad;
    const panelW = p.w - layout.pad * 2;

    ctx.save();
    roundRect(ctx, panelX, panelY, panelW, panelH, 6);
    ctx.fillStyle = "#3f7dc2";
    ctx.fill();

    const stats = this.bagRarityStats();
    const total = stats.reduce((sum, s) => sum + s.count, 0);
    text(ctx, `Summary: ${this.formatBagNumber(total)}`, panelX + 12, panelY + 16, 12, "#ffffff", "left");

    const visible = stats.filter((s) => s.count > 0).reverse();
    if (visible.length === 0) {
      text(ctx, "Empty", panelX + panelW / 2, panelY + panelH / 2 + 8, 13, "rgba(255,255,255,0.8)");
      ctx.restore();
      return;
    }

    const cols = 3;
    const colWidth = (panelW - 16) / cols;
    const rowHeight = 18;
    const startX = panelX + 10;
    const startY = panelY + 40;
    visible.forEach((s, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * colWidth;
      const y = startY + row * rowHeight;
      const label = s.name.length > 10 ? s.name.slice(0, 4) + ".." : s.name;
      text(ctx, label, x, y, 10, "#ffffff", "left");
      ctx.font = "10px sans-serif";
      const tw = ctx.measureText(label).width;
      text(ctx, this.formatBagNumber(s.count), x + tw + 6, y, 10, s.color, "left");
    });
    ctx.restore();
  }

  private formatBagNumber(num: number): string {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
    if (num >= 1000) return (num / 1000).toFixed(2) + "K";
    return num.toString();
  }

  private tooltip(cell: Cell, x: number, y: number) {
    const ctx = this.ctx;
    const def = ITEMS[cell.item];
    const w = 208;
    const h = 128;
    const px = Math.min(x, this.w - w - 8);
    const py = Math.max(8, Math.min(y - h, this.h - h - 8));
    panel(ctx, { x: px, y: py, w, h }, "rgba(12,18,26,0.95)");
    text(ctx, def.name, px + 12, py + 20, 17, RARITIES[cell.rarity].color, "left");
    text(ctx, RARITIES[cell.rarity].name, px + 12, py + 40, 13, RARITIES[cell.rarity].color, "left");
    const mult = RARITIES[cell.rarity].mult;
    if (def.kind === "petal") {
      text(ctx, `Damage ${(def.damage * mult).toFixed(0)}`, px + 12, py + 62, 13, "#ffffff", "left");
      text(ctx, `Health ${(def.health * mult).toFixed(0)}`, px + 12, py + 80, 13, "#ffffff", "left");
    } else if (def.kind === "summon") {
      text(ctx, `Summons ${MOBS[def.petMob ?? 0].name}`, px + 12, py + 62, 13, "#8fffa8", "left");
      text(ctx, `Respawn ${def.reload}s`, px + 12, py + 80, 13, "#ffffff", "left");
    } else {
      text(ctx, "Trade fodder — no combat use", px + 12, py + 62, 13, "#ffd54a", "left");
    }
    text(ctx, def.desc, px + 12, py + 104, 12, "rgba(255,255,255,0.7)", "left");
  }

  /**
   * Crafting panel. Same shell as the inventory: header + tabs, search bar with
   * biome dropdown, scrollable 5-wide card grid, and the five big craft slots
   * pinned along the bottom. Everything animates (slide-in, hover pop, spin,
   * success burst, failure shake) and is painted in the panel's blue palette.
   */
  private renderCraft() {
    if (this.craftAnim < 0.01) return;
    const ctx = this.ctx;
    const layout = this.craftLayout();
    const p = layout.panel;
    this.clampCraftScroll();

    const accent = this.craftAccent();
    const shakeX = this.craftShake > 0 ? Math.sin(this.time * 60) * this.craftShake * 7 : 0;

    ctx.save();
    ctx.globalAlpha = Math.min(1, this.craftAnim * 1.3);
    ctx.translate(shakeX, 0);

    // panel body — blue card + dark border, exactly like the inventory
    roundRect(ctx, p.x, p.y, p.w, p.h, 10);
    ctx.fillStyle = "#5aa0db";
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#3f7dc2";
    ctx.stroke();

    text(ctx, "Crafting", p.x + p.w / 2, p.y + 24, 20, "#ffffff");
    button(ctx, layout.closeRect, "x", "#e53232", hit(layout.closeRect, this.mx, this.my), 15);

    // mode tabs
    for (const { mode, rect, label, color } of this.craftModeRects()) {
      const active = this.craftMode === mode;
      button(ctx, rect, label, active ? color : "#3f7dc2", hit(rect, this.mx, this.my), 14);
    }

    // search + biome filter
    searchField(ctx, layout.barRect, this.craftSearchText, this.craftSearchActive, "Search cards...");
    dropdownField(ctx, layout.dropRect, this.craftBiome, this.craftBiomeOpen);

    // scrollable browser grid
    const hovered = this.renderCraftGrid(ctx, layout);

    // five big slots + mode-specific readout
    if (this.craftMode === "normal") this.renderCraftSlots(ctx, layout);
    else this.renderCraftSingle(ctx, layout, this.craftMode);

    // action button
    const btn = layout.actionRect;
    const label = this.craftActionLabel();
    button(ctx, btn, label.text, accent, hit(btn, this.mx, this.my), 18, label.enabled);

    // transient result message, right above the button
    if (this.craftMsgLife > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.craftMsgLife);
      const bad = /fail|cooldown|need|cannot|refused|nothing|first|max/i.test(this.craftMsg);
      text(ctx, this.craftMsg, p.x + p.w / 2, btn.y - 12, 13, bad ? "#ffbcbc" : "#c9ffd6");
      ctx.restore();
    }

    // success burst over the slot row
    if (this.craftBurstT > 0) {
      const focus = this.craftMode === "normal" ? layout.bigSlots[2] : layout.singleSlot;
      craftBurst(ctx, focus.x + focus.w / 2, focus.y + focus.h / 2, this.craftBurstT, this.craftBurstColor);
    }

    if (hovered) this.tooltip(hovered.cell, this.mx + 14, this.my - 10);
    if (this.craftBiomeOpen) dropdownList(ctx, layout.dropRect, BIOME_LIST, this.craftBiome, this.mx, this.my);

    ctx.restore();
  }

  /** Draws the clipped, pixel-scrolled card browser; returns the hovered entry (for the tooltip). */
  private renderCraftGrid(
    ctx: CanvasRenderingContext2D,
    layout: ReturnType<GameClient["craftLayout"]>,
  ): { slot: number; cell: Cell } | null {
    const p = layout.panel;
    const filtered = this.craftFilteredEntries();

    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x + 2, layout.gridTop, p.w - 4, layout.gridH);
    ctx.clip();

    const startRow = Math.floor(this.craftScrollY / layout.itemHeight);
    const yOffset = -(this.craftScrollY % layout.itemHeight);
    const startIdx = startRow * layout.cols;
    const visible = filtered.slice(startIdx, startIdx + (layout.maxVisibleRows + 2) * layout.cols);

    let hoveredEntry: { slot: number; cell: Cell } | null = null;
    const sel = this.craftSel;

    visible.forEach((entry, i) => {
      const row = Math.floor(i / layout.cols);
      const col = i % layout.cols;
      const r: Rect = {
        x: p.x + layout.pad + col * (layout.slotSize + layout.gap),
        y: layout.gridTop + row * layout.itemHeight + yOffset,
        w: layout.slotSize,
        h: layout.slotSize,
      };
      if (r.y + r.h < layout.gridTop || r.y > layout.gridTop + layout.gridH) return;
      const isHovered = hit(r, this.mx, this.my) && !this.drag;
      if (isHovered) hoveredEntry = entry;
      const picked = !!sel && sel.item === entry.cell.item && sel.rarity === entry.cell.rarity;
      // hovered cards pop, the picked stack stays slightly raised
      const scale = isHovered ? 1.07 : picked ? 1.03 : 1;
      drawCard(ctx, r, entry.cell, { hovered: isHovered || picked, scale, dim: picked ? 1 : 0.94 });
      if (picked) {
        ctx.save();
        ctx.globalAlpha = 0.6 + Math.sin(this.time * 6) * 0.3;
        roundRect(ctx, r.x - 2, r.y - 2, r.w + 4, r.h + 4, 9);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#ffe763";
        ctx.stroke();
        ctx.restore();
      }
    });

    ctx.restore();

    if (filtered.length === 0) {
      text(
        ctx,
        this.craftSearchText || this.craftBiome !== "All" ? "No cards match the filter" : "Bag is empty",
        p.x + p.w / 2,
        layout.gridTop + layout.gridH / 2,
        14,
        "rgba(255,255,255,0.75)",
      );
    }

    const totalRows = Math.max(1, Math.ceil(filtered.length / layout.cols));
    if (totalRows > layout.maxVisibleRows) {
      scrollbar(ctx, layout.scrollTrack, this.craftScrollThumbRect(layout), this.craftDraggingThumb);
    }

    return hoveredEntry;
  }

  /** Craft mode: 5 big slots in a row, filled left to right as you own enough copies. */
  private renderCraftSlots(ctx: CanvasRenderingContext2D, layout: ReturnType<GameClient["craftLayout"]>) {
    const p = layout.panel;
    const sel = this.craftSel;
    const avail = sel ? this.countOf(sel.item, sel.rarity) : 0;
    const attempts = Math.floor(avail / 5);
    const spin = this.craftSpin > 0 ? ease.inOutCubic(1 - this.craftSpin / 0.8) * Math.PI * 2 : 0;

    text(ctx, "5 identical cards combine into 1 of the next rarity", p.x + p.w / 2, layout.bigSlots[0].y - 12, 12, "rgba(255,255,255,0.85)");

    layout.bigSlots.forEach((r, i) => {
      const filled = !!sel && avail >= i + 1;
      craftPad(ctx, r, filled ? this.craftGlow : 0, this.time + i * 0.4);
      if (!filled) {
        text(ctx, "+", r.x + r.w / 2, r.y + r.h / 2, Math.max(14, r.h * 0.4), "rgba(255,255,255,0.4)");
        return;
      }
      ctx.save();
      // each card spins in place while a craft resolves, staggered around the row
      if (this.craftSpin > 0) {
        ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
        ctx.rotate(spin + i * 0.25);
        ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
      }
      const bob = Math.sin(this.time * 3 + i * 0.7) * 1.5;
      drawCard(ctx, { ...r, y: r.y + bob }, { item: sel!.item, rarity: sel!.rarity, count: 1 }, {
        showName: false,
        scale: this.craftSpin > 0 ? 1.06 : 1,
      });
      ctx.restore();
    });

    const y = layout.infoY;
    if (!sel) {
      text(ctx, "Click or drag a card from the list above", p.x + p.w / 2, y + 10, 14, "rgba(255,255,255,0.8)");
      return;
    }
    const def = ITEMS[sel.item];
    const chance = craftChanceFor(sel.rarity);
    text(ctx, `${RARITIES[sel.rarity].name} ${def.name}`, p.x + p.w / 2, y, 16, RARITIES[sel.rarity].color);
    text(
      ctx,
      `You have ${avail} · ${attempts} attempt${attempts === 1 ? "" : "s"}`,
      p.x + p.w / 2,
      y + 20,
      13,
      avail >= 5 ? "#c9ffd6" : "#ffbcbc",
    );
    if (sel.rarity < MAX_CRAFT_RARITY && chance !== undefined) {
      const next = sel.rarity + 1;
      text(ctx, `→ ${RARITIES[next].name} (${(chance * 100).toFixed(2)}% each)`, p.x + p.w / 2, y + 40, 13, RARITIES[next].color);
    } else {
      text(ctx, "Already at max craftable rarity", p.x + p.w / 2, y + 40, 13, "rgba(255,255,255,0.75)");
    }
  }

  /** Oracle / Trade modes: one centered slot plus the cooldown readout. */
  private renderCraftSingle(
    ctx: CanvasRenderingContext2D,
    layout: ReturnType<GameClient["craftLayout"]>,
    mode: "oracle" | "trade",
  ) {
    const p = layout.panel;
    const isOracle = mode === "oracle";
    const sel = this.craftSel;
    const avail = sel ? this.countOf(sel.item, sel.rarity) : 0;
    const r = layout.singleSlot;

    text(
      ctx,
      isOracle ? "Skip 2 rarities at once — guaranteed" : "Exchange cards for Coins",
      p.x + p.w / 2,
      r.y - 12,
      12,
      "rgba(255,255,255,0.85)",
    );

    craftPad(ctx, r, sel ? this.craftGlow : 0, this.time);
    if (sel) {
      ctx.save();
      if (this.craftSpin > 0) {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        ctx.translate(cx, cy);
        ctx.rotate(ease.inOutCubic(1 - this.craftSpin / 0.8) * Math.PI * 2);
        ctx.translate(-cx, -cy);
      }
      drawCard(ctx, r, { item: sel.item, rarity: sel.rarity, count: avail }, { showName: false });
      ctx.restore();
    } else {
      text(ctx, "+", r.x + r.w / 2, r.y + r.h / 2, Math.max(14, r.h * 0.4), "rgba(255,255,255,0.4)");
    }

    const cooldownMs = this.craftCooldownLeft(mode);
    const ready = cooldownMs <= 0;
    const y = layout.infoY;

    if (sel) {
      const def = ITEMS[sel.item];
      text(ctx, `${RARITIES[sel.rarity].name} ${def.name}`, p.x + p.w / 2, y, 16, RARITIES[sel.rarity].color);
      if (isOracle) {
        const required = oracleRequiredCount(sel.rarity);
        if (required === undefined) {
          text(ctx, "Cannot Oracle this rarity", p.x + p.w / 2, y + 20, 13, "#ffbcbc");
        } else {
          text(ctx, `Need ${required} — have ${avail}`, p.x + p.w / 2, y + 20, 13, avail >= required ? "#c9ffd6" : "#ffbcbc");
          const target = sel.rarity + 2;
          if (target < RARITIES.length) {
            text(ctx, `→ ${RARITIES[target].name} ${def.name}`, p.x + p.w / 2, y + 40, 13, RARITIES[target].color);
          }
        }
      } else {
        text(ctx, `${avail} card${avail === 1 ? "" : "s"} → ${avail} Coin${avail === 1 ? "" : "s"}`, p.x + p.w / 2, y + 20, 13, "#ffd54a");
      }
    } else {
      text(ctx, "Click or drag a card from the list above", p.x + p.w / 2, y + 10, 14, "rgba(255,255,255,0.8)");
    }

    text(
      ctx,
      `${isOracle ? "Oracle" : "Trade"} cooldown: ${ready ? "Ready" : this.formatCooldown(cooldownMs)}`,
      p.x + p.w / 2,
      y + 60,
      12,
      ready ? "#c9ffd6" : "#ffd54a",
    );
  }

  /** Accent color of the active mode — used by the tabs and the action button. */
  private craftAccent(): string {
    return this.craftMode === "normal" ? "#c9762b" : this.craftMode === "oracle" ? "#6a3fb0" : "#3f8f5a";
  }

  /** Text + enabled state of the action button for the current mode/selection. */
  private craftActionLabel(): { text: string; enabled: boolean } {
    const sel = this.craftSel;
    const avail = sel ? this.countOf(sel.item, sel.rarity) : 0;
    if (this.craftMode === "normal") {
      const attempts = Math.floor(avail / 5);
      const enabled = !!sel && avail >= 5 && sel.rarity < MAX_CRAFT_RARITY;
      return { text: attempts > 1 ? `CRAFT x${attempts}` : "CRAFT", enabled };
    }
    if (this.craftMode === "oracle") {
      const required = sel ? oracleRequiredCount(sel.rarity) : undefined;
      const enabled = !!sel && required !== undefined && avail >= required && this.craftCooldownLeft("oracle") <= 0;
      return { text: "ORACLE", enabled };
    }
    return { text: "TRADE", enabled: !!sel && avail >= 1 && this.craftCooldownLeft("trade") <= 0 };
  }

  private renderDeath() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "rgba(8,10,14,0.66)";
    ctx.fillRect(0, 0, this.w, this.h);
    text(ctx, "You were shredded!", this.w / 2, this.h / 2 - 70, 42, "#ff8080");
    text(ctx, `Level ${this.level} · ${this.xp} XP · you keep 75% on respawn`, this.w / 2, this.h / 2 - 20, 17, "#ffffff");
    const bw = 180;
    const cx = this.w / 2;
    const r1 = { x: cx - bw - 10, y: this.h / 2 + 40, w: bw, h: 52 };
    const r2 = { x: cx + 10, y: this.h / 2 + 40, w: bw, h: 52 };
    button(ctx, r1, "Respawn", "#3fae60", hit(r1, this.mx, this.my), 20);
    button(ctx, r2, "Main menu", "#41505f", hit(r2, this.mx, this.my), 20);
    ctx.restore();
  }
}
