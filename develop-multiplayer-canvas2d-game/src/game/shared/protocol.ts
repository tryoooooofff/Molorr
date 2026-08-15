// Binary protocol. Every packet on the wire is a Uint8Array.

export const C2S = {
  JOIN: 1,
  INPUT: 2,
  SWAP: 3,
  CRAFT: 4,
  CHANGE_MAP: 5,
  RESPAWN: 6,
  PING: 7,
  ORACLE: 8,
  TRADE: 9,
  /**
   * Swap the main hotbar row with the secondary row. Payload is a single u8:
   * 0xff swaps every slot at once (the "R" hotkey), any other value swaps just
   * that one slot index (the 1-9 hotkeys).
   */
  SWAP_ROW: 10,
  /** Current client-persisted daily-bonus multiplier and seconds remaining. */
  BONUS_STATUS: 11,
  /** Chat message or command (e.g. /claim, /create_public_squad). Payload: utf8 string. */
  CHAT: 12,
  /**
   * Player clicked the [AFK CHECK] button. Clears the pending check and resets
   * the idle timer. Payload: none — the server only cares that it arrived, and
   * it is deliberately NOT sent by ordinary input so a stuck key can't pass it.
   */
  AFK_ACK: 13,
  /**
   * Sync the player's current talent-tree levels to the authoritative server.
   * Payload: 7 × u8, in this fixed order:
   *   reload, petalDamage, summonDamage, summonHealth, health, speed, bodyDamage
   * Each value is clamped to the per-branch max (0..maxLevel). The server
   * recomputes TalentBonuses on receipt and pushes S2C.TALENT_BONUSES back so
   * the client can confirm. Levels are kept client-side (localStorage) so the
   * player owns the allocation; the server just applies the multipliers.
   */
  TALENT: 14,
  /**
   * Player periodically syncs their level and highest petal rarity to the
   * server, which relays it to squad members. Payload: u16 level, u8 rarity.
   * Sent every ~10-30 s by the client.
   */
  SYNC_LEVEL: 15,
  /**
   * Loadout 操作请求（保存/加载/删除配置）。
   * 操作码见 LOADOUT_OP，payload 格式取决于操作码。
   */
  LOADOUT: 16,
  // ── Arena 模式 ──
  ARENA_CREATE:   17, // { u8 mode(1|3) }
  ARENA_LIST:     18, // { }
  ARENA_SEARCH:   19, // { str<32> keyword }
  ARENA_JOIN:     20, // { str<32> roomCode }
  ARENA_LEAVE:    21, // { }
  ARENA_WHEEL:    22, // { u8 bagSlot(0..4095) }
  ARENA_READY:    23, // { u8 ready(0|1) }
  ARENA_LOADOUT:  24, // { u8[10] cells }
} as const;

/** SWAP_ROW payload meaning "swap the entire row", not a single slot. */
export const SWAP_ROW_ALL = 0xff;

/** Fixed order of talent branches for C2S.TALENT and S2C.TALENT_BONUSES. */
export const TALENT_KEYS = [
  "reload",
  "petalDamage",
  "summonDamage",
  "summonHealth",
  "health",
  "speed",
  "bodyDamage",
] as const;

/** Per-branch max levels — kept in sync with the client TalentSystem definition. */
export const TALENT_MAX_LEVELS: Readonly<Record<(typeof TALENT_KEYS)[number], number>> = {
  reload: 7,
  petalDamage: 7,
  summonDamage: 7,
  summonHealth: 7,
  health: 7,
  speed: 7,
  bodyDamage: 7,
};

export const S2C = {
  WELCOME: 1,
  SNAPSHOT: 2,
  INVENTORY: 3,
  STATS: 4,
  EVENT: 5,
  PONG: 6,
  /** Chat message from server (system message, other player message, or command result). */
  CHAT: 7,
  /** Squad state update (joined/created/left/auto-joined). */
  SQUAD_UPDATE: 8,
  /**
   * AFK check state. Payload: u8 active (1 while the button should be shown)
   * followed by u16 secondsLeft until the kick. Sent once when the check opens,
   * once per second while it counts down, and once with active=0 when cleared.
   */
  AFK_CHECK: 9,
  /**
   * Debug-mode telemetry for the client's optional debug overlay. Payload:
   * `u32 collisionChecks` (wall/circle collision tests performed during the
   * tick this packet was built from), `u16 entityCount` (players + mobs +
   * petals + drops currently simulated, server-wide, not just in view),
   * `u16 playerCount` (currently connected players), and `f32 playerSpeed`
   * (owning player's current move speed in px/s, fresh per snapshot).
   * Older server builds may omit the trailing f32 — clients MUST treat the
   * tail as optional. Sent at a reduced cadence (see sim.ts) since it's a
   * diagnostic, not gameplay-critical, packet.
   */
  DEBUG: 10,
  /**
   * Authoritative talent bonuses applied to the receiving player. Sent in
   * response to C2S.TALENT (and once on JOIN). Payload: 7 × f32 multipliers in
   * the same order as TALENT_KEYS:
   *   reloadReduction (0..0.5 typical), petalDmgMult, summonDmgMult,
   *   summonHpMult, healthMult, speedMult, bodyDamageMult.
   * The client can use these to render an authoritative buff panel without
   * recomputing locally.
   */
  TALENT_BONUSES: 11,
  /**
   * Squad member state snapshot relayed by the server. Payload:
   * u16 playerId, u16 level, u8 rarity. Sent on squad join (bulk) and
   * periodically as members update their level/rarity.
   */
  SQUAD_MEMBER_STATE: 12,
  /** 服务器推送 Loadout 数据（完整列表）。 */
  LOADOUT_DATA: 13,
  // ── Arena 模式 ──
  ARENA_LOBBY:  14, // { str code, u8 hostSeat, u8 size, u8 mode, PlayerBrief[seats] }
  ARENA_UPDATE: 15, // { u8 type, u8 seat, payload }
  ARENA_START:  16, // { u32 seed, u16 wallCount, Wall[wallCount] }
  ARENA_EVENT:  17, // { u8 type, u8 seat, u16 payload }
  ARENA_RESULT: 18, // { u8 winnerTeam, u8 cardCount, Cell[cardCount] }
  ARENA_LIST:   19, // { u8 count, RoomBrief[count] }
} as const;

export const ENT = {
  PLAYER: 0,
  MOB: 1,
  PETAL: 2,
  DROP: 3,
  PROJECTILE: 4,
} as const;

export const TEAM = {
  HOSTILE: 0,
  FRIENDLY: 1,
  SELF: 2,
} as const;

export const EVT = {
  XP: 0,
  LOOT: 1,
  CRAFT_OK: 2,
  CRAFT_FAIL: 3,
  DEATH: 4,
  KILL: 5,
  HIT: 6,
  ORACLE_OK: 7,
  ORACLE_FAIL: 8,
  TRADE_OK: 9,
  TRADE_FAIL: 10,
  /** A Rose reached the player and restored HP. `value` is the rounded HP restored. */
  HEAL: 11,
} as const;

/** Loadout 操作码 */
export const LOADOUT_OP = {
  SAVE: 0,   // 保存当前配置
  LOAD: 1,   // 加载配置
  DELETE: 2, // 删除配置
} as const;

export class Writer {
  private buf: Uint8Array;
  private view: DataView;
  private off = 0;

  constructor(size = 512) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(n: number) {
    if (this.off + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.off + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  u8(v: number) { this.ensure(1); this.view.setUint8(this.off, v & 0xff); this.off += 1; return this; }
  i8(v: number) { this.ensure(1); this.view.setInt8(this.off, Math.max(-128, Math.min(127, v | 0))); this.off += 1; return this; }
  u16(v: number) { this.ensure(2); this.view.setUint16(this.off, v & 0xffff); this.off += 2; return this; }
  i16(v: number) { this.ensure(2); this.view.setInt16(this.off, Math.max(-32768, Math.min(32767, v | 0))); this.off += 2; return this; }
  u32(v: number) { this.ensure(4); this.view.setUint32(this.off, v >>> 0); this.off += 4; return this; }
  f32(v: number) { this.ensure(4); this.view.setFloat32(this.off, v); this.off += 4; return this; }

  str(s: string) {
    const bytes: number[] = [];
    for (let i = 0; i < s.length && bytes.length < 250; i++) {
      const c = s.charCodeAt(i);
      if (c < 128) bytes.push(c);
      else bytes.push(63); // '?'
    }
    this.u8(bytes.length);
    this.ensure(bytes.length);
    for (const b of bytes) this.view.setUint8(this.off++, b);
    return this;
  }

  bytes(): Uint8Array {
    return this.buf.slice(0, this.off);
  }
}

export class Reader {
  private view: DataView;
  private off = 0;

  constructor(data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get remaining() { return this.view.byteLength - this.off; }

  u8() { const v = this.view.getUint8(this.off); this.off += 1; return v; }
  i8() { const v = this.view.getInt8(this.off); this.off += 1; return v; }
  u16() { const v = this.view.getUint16(this.off); this.off += 2; return v; }
  i16() { const v = this.view.getInt16(this.off); this.off += 2; return v; }
  u32() { const v = this.view.getUint32(this.off); this.off += 4; return v; }
  f32() { const v = this.view.getFloat32(this.off); this.off += 4; return v; }

  str() {
    const len = this.u8();
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(this.u8());
    return s;
  }
}
