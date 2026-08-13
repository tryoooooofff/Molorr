// Authoritative game simulation. Runs on the node/ws server (server/index.ts)
// and, when no remote server is configured, inside the browser (local transport).

import {
  AFK_CHECK_SECONDS,
  AFK_IDLE_SECONDS,
  BAG_COUNT,
  BAG_MAX,
  BLOCK_GRID_COLS,
  BLOCK_GRID_ROWS,
  CRAFT_CARD_COUNT,
  CRAFT_CARDS_PER_ATTEMPT,
  craftChanceFor,
  EMPTY_ITEM,
  ITEMS,
  MAPS,
  MAX_CRAFT_RARITY,
  MAX_RARITY,
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
  MAP_GRIDS,
  cloverDnaBonus,
  mapRarityToSummonRarity,
  mobSizeMult,
  friendlyMobSizeMult,
  ORACLE_COOLDOWN_HOURS,
  ORACLE_SKIP,
  oracleRequiredCount,
  RARITIES,
  ROSE_ABSORB_TIME,
  ROSE_HEAL_DELAY,
  SHELL_ITEM,
  isAbsorbItem,
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
  thirdEyeOrbitBonus,
  pickWeightedMob,
} from "./defs";
import { C2S, ENT, EVT, LOADOUT_OP, Reader, S2C, SWAP_ROW_ALL, TALENT_KEYS, TALENT_MAX_LEVELS, TEAM, Writer } from "./protocol";

// =====================================================================
// Squad system
// =====================================================================

interface SquadMember {
  clientId: number;
  playerId: number;
  name: string;
  level: number;
  /** Highest rarity among all petals the player owns (0..MAX_RARITY). */
  rarity: number;
}

interface Squad {
  code: string;
  isPublic: boolean;
  members: Map<number, SquadMember>; // key = playerId
  createdAt: number;
}

/** Maximum level gap between squad members */
const SQUAD_LEVEL_GAP_MAX = 30;

/** Maximum members per squad */
const SQUAD_MAX_MEMBERS = 4;

/** Squad code length */
const SQUAD_CODE_LENGTH = 6;

/** Loadout 预设配置 */
export interface LoadoutConfig {
  name: string;
  slots: (Cell | null)[];
  active?: boolean;
}

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
  /** Delay before a freshly spawned Rose is allowed to heal. */
  specialTimer: number;
  /** Remaining travel time while a Rose is being absorbed by its owner. */
  absorbTimer: number;
  /** 目标搜索降频计时（帧）：每隔几帧才重新寻找攻击目标。 */
  targetCheckTimer: number;
  /** 上次搜索锁定的目标 mob id（降频帧间复用，0 = 无目标）。 */
  targetId: number;
  /** 该花瓣对应的物品ID，用于检测槽位是否变化 */
  item: number;
  /** 该花瓣对应的稀有度，用于检测槽位是否变化 */
  rarity: number;
  /** 弹射物发射计时器（秒）：Missile 等远程花瓣用，<=0 时可发射。 */
  fireTimer: number;
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
  /** Loadout 预设配置（持久化保存） */
  loadouts?: LoadoutConfig[];
}

// =====================================================================
// Talent system (server-authoritative multipliers)
// =====================================================================
//
// The client owns the player's talent point allocation (saved to localStorage
// and gated by player level). Whenever the allocation changes, the client
// sends a C2S.TALENT packet listing the current per-branch levels. The
// server stores the snapshot on the Player, recomputes the multiplier
// bundle, and applies it to all sim formulas that read the relevant stat
// (max HP, move speed, petal damage, summon damage / HP, reload time).
//
// Bonus names + effects MUST stay in lockstep with the client
// `TalentSystem` in talent.ts — they're duplicated here on purpose so the
// server can be deployed without depending on the client module.

/** Per-branch talent levels, keyed by the canonical branch name. */
export type TalentTreeLevels = Readonly<Record<(typeof TALENT_KEYS)[number], number>>;

/** Multiplier bundle the server applies to the owning player every tick. */
export interface TalentBonuses {
  /** Flat reload-time reduction (0..0.5 typical). Subtracts from each reload. */
  reloadReduction: number;
  /** Multiplier on player-dealt petal damage. */
  petalDmgMult: number;
  /** Multiplier on friendly summon damage. */
  summonDmgMult: number;
  /** Multiplier on friendly summon max HP. */
  summonHpMult: number;
  /** Multiplier on player max HP (combined with the level curve). */
  healthMult: number;
  /** Multiplier on player move speed. */
  speedMult: number;
  /** Multiplier on body-contact damage. */
  bodyDamageMult: number;
}

const DEFAULT_TALENT_BONUSES: TalentBonuses = {
  reloadReduction: 0,
  petalDmgMult: 1,
  summonDmgMult: 1,
  summonHpMult: 1,
  healthMult: 1,
  speedMult: 1,
  bodyDamageMult: 1,
};

/**
 * Per-branch step effect (matches the client TalentSystem definition).
 * Keep this table in sync with `talent.ts` to avoid drift.
 */
const TALENT_BRANCH_EFFECT: Readonly<Record<(typeof TALENT_KEYS)[number], number>> = {
  reload: 0.05,
  petalDamage: 0.05,
  summonDamage: 0.05,
  summonHealth: 0.05,
  health: 0.05,
  speed: 0.05,
  bodyDamage: 0.04,
};

/**
 * Pure function: convert a per-branch level snapshot into the multiplier
 * bundle applied to the player. Safe to call on every tick — no allocations
 * beyond the returned object.
 */
export function computeTalentBonuses(levels: TalentTreeLevels): TalentBonuses {
  const lvl = (k: (typeof TALENT_KEYS)[number]): number => {
    const raw = levels[k] ?? 0;
    const max = TALENT_MAX_LEVELS[k];
    return raw < 0 ? 0 : raw > max ? max : raw;
  };
  // "reload" is a flat reduction (capped so the formula stays sane).
  const reloadReduction = Math.min(0.5, lvl("reload") * TALENT_BRANCH_EFFECT.reload);
  return {
    reloadReduction,
    petalDmgMult: 1 + lvl("petalDamage") * TALENT_BRANCH_EFFECT.petalDamage,
    summonDmgMult: 1 + lvl("summonDamage") * TALENT_BRANCH_EFFECT.summonDamage,
    summonHpMult: 1 + lvl("summonHealth") * TALENT_BRANCH_EFFECT.summonHealth,
    healthMult: 1 + lvl("health") * TALENT_BRANCH_EFFECT.health,
    speedMult: 1 + lvl("speed") * TALENT_BRANCH_EFFECT.speed,
    bodyDamageMult: 1 + lvl("bodyDamage") * TALENT_BRANCH_EFFECT.bodyDamage,
  };
}

/** Read the 7 u8 levels from a C2S.TALENT payload in TALENT_KEYS order. */
export function readTalentLevels(r: Reader): TalentTreeLevels {
  const out: Record<(typeof TALENT_KEYS)[number], number> = {
    reload: 0, petalDamage: 0, summonDamage: 0, summonHealth: 0,
    health: 0, speed: 0, bodyDamage: 0,
  };
  for (let i = 0; i < TALENT_KEYS.length; i++) {
    const k = TALENT_KEYS[i];
    const max = TALENT_MAX_LEVELS[k];
    const v = r.u8();
    out[k] = v < 0 ? 0 : v > max ? max : v;
  }
  return out;
}

/** Serialize a TalentBonuses bundle in the same order as TALENT_KEYS. */
export function writeTalentBonuses(w: Writer, b: TalentBonuses): Writer {
  w.f32(b.reloadReduction);
  w.f32(b.petalDmgMult);
  w.f32(b.summonDmgMult);
  w.f32(b.summonHpMult);
  w.f32(b.healthMult);
  w.f32(b.speedMult);
  w.f32(b.bodyDamageMult);
  return w;
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
  /**
   * 主页面(菜单)模式:玩家不进入世界模拟——不生成花瓣、不参与世界/花瓣
   * 更新、不接收世界快照;但背包/合成/交易/快捷栏切换等物品操作照常可用。
   * 由 JOIN 载荷末尾的模式字节设置。
   */
  menuMode = false;
  /** 死亡时的位置，用于死亡后仍然更新该位置周围的生物 */
  deathX = 0;
  deathY = 0;
  respawnIn = 0;
  inDx = 0;
  inDy = 0;
  flags = 0;
  baseAngle = 0;
  orbit = 62;
  nextOracleAt = 0;
  nextTradeAt = 0;
  /** Daily-bonus state supplied by the local-progress client. */
  bonusMultiplier = 1;
  bonusEndsAt = 0;
  /** Squad code this player belongs to (empty string = no squad). */
  squadCode = "";
  slots: (Cell | null)[] = new Array(SLOT_COUNT).fill(null);
  /**
   * Secondary hotbar row. It holds real items but never grows petals — it is
   * pure standby storage that can be swapped into the main row instantly.
   */
  secondary: (Cell | null)[] = new Array(SECONDARY_SLOT_COUNT).fill(null);
  bag: (Cell | null)[] = new Array(BAG_COUNT).fill(null);
  /** Loadout 预设列表 */
  loadouts: LoadoutConfig[] = [];
  petals: PetalState[] = [];
  pets: Mob[][] = Array.from({ length: SLOT_COUNT }, () => []);
  hurtCd = 0;
  /** Shield points (1 shield absorbs 2 damage). Generated by Shell petals. */
  shield = 0;
  dirty = true;
  statsDirty = true;

  // =====================================================================
  // Talent tree snapshot (client-owned allocation, server-applied).
  // `talentLevels` is the per-branch level map; `talentBonuses` is the
  // derived multiplier bundle recomputed whenever the levels change.
  // Both are sent to the client on demand so it can confirm what the
  // authoritative sim is using.
  // =====================================================================
  talentLevels: TalentTreeLevels = {
    reload: 0, petalDamage: 0, summonDamage: 0, summonHealth: 0,
    health: 0, speed: 0, bodyDamage: 0,
  };
  talentBonuses: TalentBonuses = { ...DEFAULT_TALENT_BONUSES };
  /**
   * Body-contact damage the player deals to a mob on direct physical
   * collision (no petal, no projectile). Multiplied by the `bodyDamage`
   * talent branch via `talentBonuses.bodyDamageMult` at the point of impact.
   * Default 10 — small enough that petals still feel like the main weapon,
   * large enough that bumping into a hornet hurts it.
   */
  bodyDamage = 10;
  /**
   * Last computed move speed in px/s, refreshed every `updatePlayer` tick.
   * Surfaced in the DEBUG packet so the client's debug overlay can show
   * "current speed" without re-deriving it from the slot table.
   */
  currentSpeed = 0;

  // =====================================================================
  // 卡墙安全网：记录上次"确认不在墙内"的位置，深度卡墙时回退到此点。
  // =====================================================================
  lastSafeX = 0;
  lastSafeY = 0;

  // =====================================================================
  // Bubble: defend-key rising-edge detection
  // =====================================================================
  /** Previous tick's defend flag, used to detect a fresh press of Shift/Contract. */
  wasDefending = false;

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
  /** 卡墙弹开冷却（秒）：弹开后短时间内不再触发，防止被反复弹飞/抖动。 */
  pushOutCooldown = 0;
  /** HP-fraction thresholds that have already released their minions (spawner mobs only). */
  spawnedThresholds: Set<number> = new Set();
  /** Accumulated damage dealt by each player (petal + friendly mob damage). */
  damageByPlayer: Map<number, number> = new Map();
  /** 思考计时器（秒）：降频至每 MOB_THINK_INTERVAL 秒才更新一次决策 */
  thinkTimer = 0;
  /** 缓存目标坐标（降频帧间复用） */
  cachedTargetX = 0;
  cachedTargetY = 0;
  /** 弹射物发射计时器（秒）：Hornet 等远程生物用，<=0 时可发射。 */
  missileTimer = 0;
  /**
   * 生物间碰撞/生物-玩家碰撞倒计时（秒）。
   *  - 静止生物（speed === 0）会用一个极大的值，使其永远跳过生物间碰撞；
   *  - 慢速生物每 0.1s 一次，快速生物每帧一次。
   * 计数归零后才执行一次完整碰撞检查，然后按生物速度重置。
   */
  collisionTimer = 0;

  constructor(
    id: number,
    type: number,
    mapId: number,
    x: number,
    y: number,
    rarity: number,
    friendly = false
  ) {
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
    // Mob rarity controls physical size as well as its combat stats. Keeping
    // this radius authoritative means rendering, wall collision, melee range,
    // and mob-to-mob collision all agree on the requested size ladder.
    this.radius = def.radius * (friendly ? friendlyMobSizeMult(rarity) : mobSizeMult(rarity));
    this.damage = def.damage * enemyDamageMult(rarity);
    this.speed = def.speed;
  }

  addDamage(playerId: number, amount: number) {
    if (!playerId || amount <= 0) return;
    this.damageByPlayer.set(playerId, (this.damageByPlayer.get(playerId) || 0) + amount);
  }

}

export class Drop {
  /** Set of playerIds allowed to loot this drop. null = anyone, empty = no one (unlootable). */
  allowedPlayerIds: Set<number> | null = null;
  /** 地面停留计时器（秒），初始 0.8，期间 magnet 不生效 */
  groundTimer: number;
  /** 快速吸取计时器（秒），>0 表示正在快速飞向玩家 */
  suctionTimer: number;
  constructor(
    public id: number,
    public mapId: number,
    public x: number,
    public y: number,
    public item: number,
    public rarity: number,
    public ownerId = 0,
    public ttl = 50,
    /** Cards merged into one card. Nearby identical drops stack instead of littering. */
    public count = 1
  ) {
    this.groundTimer = 0.5;
    this.suctionTimer = 0;
  }
}
interface DormantMob {
  type: number;
  rarity: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  health: number;
  maxHealth: number;
  lastHitBy: number;
  damageByPlayer: Array<[number, number]>;
  spawnedThresholds: number[];
}

/**
 * 弹射物（Projectile）—— 生物与花瓣共用的远程攻击逻辑。
 *
 * 设计目标：
 *  - Hornet 朝玩家发射导弹（身体随之转向目标）；
 *  - 玩家装备 Missile 花瓣后按 spread(attack) 发射导弹；
 *  - 后续可扩展更多远程物品/生物，只需复用本类与 updateProjectiles。
 *
 * 字段说明：
 *  - team: TEAM.HOSTILE（生物发射，命中玩家）或 TEAM.FRIENDLY（玩家发射，命中敌对生物）；
 *  - ownerId: 发射者 ID（mob.id 或 player.id），用于伤害归属与经验计算；
 *  - sourceType: 发射来源类型（mob.type 或 item id），客户端据此渲染外观；
 *  - rarity: 稀有度，影响伤害/大小；
 *  - ttl: 存活时间（秒），到时自动销毁；
 *  - hitCd: 命中冷却（秒），防止穿透多个目标时同一帧重复判定。
 */
export class Projectile {
  id: number;
  mapId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  radius: number;
  damage: number;
  hp: number;
  maxHp: number;
  team: number;
  ownerId: number;
  sourceType: number;
  rarity: number;
  ttl: number;
  hitCd: number;
  /** 是否穿透墙壁与目标（命中后不销毁，扣减自身 hp）。 */
  isPiercing: boolean;
  /** 最大飞行距离（像素），0 表示无限制。 */
  maxDistance: number;
  /** 已飞行距离（像素）。 */
  distanceTraveled: number;

  constructor(
    id: number,
    mapId: number,
    x: number,
    y: number,
    angle: number,
    speed: number,
    damage: number,
    team: number,
    ownerId: number,
    sourceType: number,
    rarity: number,
    radius = 10,
    isPiercing = false,
    maxDistance = 0,
    projHp = 1,
  ) {
    this.id = id;
    this.mapId = mapId;
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.angle = angle;
    this.radius = radius;
    this.damage = damage;
    this.hp = 1;
    this.maxHp = 1;
    this.team = team;
    this.ownerId = ownerId;
    this.sourceType = sourceType;
    this.rarity = rarity;
    this.ttl = PROJECTILE_TTL;
    this.hitCd = 0;
    this.isPiercing = isPiercing;
    this.maxDistance = maxDistance;
    this.distanceTraveled = 0;
    this.hp = projHp;
    this.maxHp = projHp;
  }
}

// =====================================================================
// Poison system (DoT)
// =====================================================================

/** 毒伤伤害来源(谁施加的毒)。 */
export interface PoisonSource {
  /** 伤害类型标签,固定 "poison"。 */
  type: "poison";
  /** 标记为持续伤害(DoT),便于客户端飘字染色。 */
  isDoT: true;
  /** 真正的施法者 id(可空,例如环境毒)。 */
  owner: number | null;
}

/** 当前活跃毒伤的统计信息,供调试/UI 读取。 */
export interface PoisonStats {
  active: boolean;
  baseDamage: number;
  currentDamage: number;
  totalDamage: number;
  tickCount: number;
  remainingTime: number;
  stage: "decay" | "stable" | "ended";
}

/** 单条毒伤的状态机。 */
export class PoisonSystem {
  /** 伤害来源(可空)。 */
  source: PoisonSource | null;
  /** 当前基础伤害(已叠加层数后的值)。 */
  baseDamage: number;
  /** 总持续时间(毫秒)。 */
  duration: number;
  /** 初始倍率(默认 1.5)。 */
  initialMultiplier: number;
  /** 稳定倍率(默认 0.5)。 */
  stableMultiplier: number;

  /** 毒伤是否仍处于活跃状态。 */
  active: boolean;
  /** 起始时间(毫秒,Date.now())。 */
  startTime: number;
  /** 上次 tick 的时间(毫秒,Date.now()),用于控制 tick 节奏。 */
  lastTickTime: number;
  /** tick 间隔(毫秒,默认 100ms)。 */
  tickInterval: number;
  /** 当前叠加层数。 */
  stackCount: number;
  /** 最大叠加层数。 */
  maxStack: number;

  /** 衰减阶段时长(毫秒),默认占 30%。 */
  decayDuration: number;
  /** 稳定阶段时长(毫秒),默认占 70%。 */
  stableDuration: number;

  /** 当前帧应输出的伤害(由 getCurrentDamage 维护)。 */
  currentDamage: number;

  /** 累计造成伤害(用于 stack 时的合并统计)。 */
  totalDamageDealt: number;
  /** 已 tick 次数。 */
  tickCount: number;

  constructor(
    source: PoisonSource | null,
    baseDamage: number,
    duration: number = 5000,
    initialMultiplier: number = 1.5,
    stableMultiplier: number = 0.5,
  ) {
    this.source = source;
    this.baseDamage = baseDamage;
    this.duration = duration;
    this.initialMultiplier = initialMultiplier;
    this.stableMultiplier = stableMultiplier;

    // 毒伤状态
    this.active = true;
    this.startTime = Date.now();
    this.lastTickTime = Date.now();
    this.tickInterval = 100;
    this.stackCount = 1;
    this.maxStack = 10;

    // 计算各阶段参数
    this.decayDuration = duration * 0.3;
    this.stableDuration = duration * 0.7;

    // 当前伤害值
    this.currentDamage = baseDamage * initialMultiplier;

    // 统计
    this.totalDamageDealt = 0;
    this.tickCount = 0;
  }

  /**
   * 获取当前应该造成的伤害(按时间分阶段)。
   *  - 超过总时长:毒伤结束,返回 0;
   *  - 衰减阶段:在 initialMultiplier 与 stableMultiplier 之间线性插值;
   *  - 稳定阶段:始终输出 baseDamage * stableMultiplier。
   */
  getCurrentDamage(): number {
    const now = Date.now();
    const elapsed = now - this.startTime;

    // 毒伤结束
    if (elapsed >= this.duration) {
      this.active = false;
      this.currentDamage = 0;
      return 0;
    }

    // 衰减阶段
    if (elapsed < this.decayDuration) {
      const progress = elapsed / this.decayDuration;
      const damage =
        this.baseDamage * this.initialMultiplier * (1 - progress) +
        this.baseDamage * this.stableMultiplier * progress;
      this.currentDamage = damage;
    } else {
      // 稳定阶段
      this.currentDamage = this.baseDamage * this.stableMultiplier;
    }

    return this.currentDamage;
  }

  /**
   * 更新并返回本 tick 应造成的伤害;若未到 tick 间隔则返回 0。
   *  - 由 PoisonManager.updateAll 周期调用;
   *  - 副作用:递增 tickCount / totalDamageDealt,推进 lastTickTime。
   */
  updateAndTick(): number {
    if (!this.active) return 0;

    const now = Date.now();

    // 检查是否到达 tick 时间
    if (now - this.lastTickTime >= this.tickInterval) {
      const damage = this.getCurrentDamage();

      if (damage > 0) {
        this.lastTickTime = now;
        this.tickCount++;
        this.totalDamageDealt += damage;
        return damage;
      } else {
        this.active = false;
      }
    }

    return 0;
  }

  /** 检查是否还有效(未到期 + active)。 */
  isActive(): boolean {
    if (!this.active) return false;
    const elapsed = Date.now() - this.startTime;
    return elapsed < this.duration;
  }

  /**
   * 获取当前毒伤阶段信息。
   *  - "decay"  : 仍在衰减阶段(0 ~ 30%);
   *  - "stable" : 已进入稳定阶段(30% ~ 100%);
   *  - "ended"  : 已结束。
   */
  getStageInfo(): {
    stage: "decay" | "stable" | "ended";
    progress: number;
    currentDamage: number;
    remainingTime: number;
  } {
    const elapsed = Date.now() - this.startTime;

    if (elapsed < this.decayDuration) {
      return {
        stage: "decay",
        progress: elapsed / this.decayDuration,
        currentDamage: this.currentDamage,
        remainingTime: this.duration - elapsed,
      };
    } else if (elapsed < this.duration) {
      return {
        stage: "stable",
        progress: (elapsed - this.decayDuration) / this.stableDuration,
        currentDamage: this.currentDamage,
        remainingTime: this.duration - elapsed,
      };
    } else {
      return {
        stage: "ended",
        progress: 1,
        currentDamage: 0,
        remainingTime: 0,
      };
    }
  }

  /** 重置时间(但不改变层数/伤害)—— 用于被新毒伤"刷新"时复用同一实例。 */
  reset(): void {
    this.startTime = Date.now();
    this.lastTickTime = Date.now();
    this.active = true;
    this.currentDamage = this.baseDamage * this.initialMultiplier;
  }

  /**
   * 将另一条毒伤的伤害合并到本条:
   *  - 已达最大层数 → 只刷新时间,不叠加伤害(原参考行为);
   *  - 否则:层数 +1,基础伤害累加,伤害统计累加,并 reset 时间。
   */
  stack(newPoison: PoisonSystem): void {
    if (this.stackCount >= this.maxStack) {
      this.reset();
      return;
    }

    this.stackCount++;
    this.baseDamage += newPoison.baseDamage;
    this.currentDamage = this.baseDamage * this.initialMultiplier;
    this.totalDamageDealt += newPoison.totalDamageDealt;
    this.reset();
  }

  /** 获取毒伤统计快照。 */
  getStats(): PoisonStats {
    return {
      active: this.active,
      baseDamage: this.baseDamage,
      currentDamage: this.currentDamage,
      totalDamage: this.totalDamageDealt,
      tickCount: this.tickCount,
      remainingTime: Math.max(0, this.duration - (Date.now() - this.startTime)),
      stage: this.getStageInfo().stage,
    };
  }
}

/** 任意可被附加毒伤的目标(玩家或生物)。 */
interface Poisonable {
  hp: number;
  /** 仅 Player 有此字段;Mob 通过 hp <= 0 视为死亡。 */
  alive?: boolean;
}

/**
 * 全局毒伤管理器:为每个目标维护至多一条活跃毒伤。
 *  - 目标死亡时自动清除(防止引用泄漏);
 *  - tick 节奏由 GameServer 主循环驱动,每 tick 调用一次 updateAll。
 */
export class PoisonManager {
  /** 当前活跃毒伤,key = 目标引用。 */
  private activePoisons: Map<Poisonable, PoisonSystem> = new Map();

  /**
   * 对目标施加毒伤。
   *  - 目标为空或已死亡 → 静默失败;
   *  - canStack=true → 在已有毒伤上调 stack();
   *  - canStack=false → 新伤害更高则替换,否则只 reset() 已有毒伤。
   * @returns 是否成功施加/叠加。
   */
  applyPoison(
    target: Poisonable,
    source: PoisonSource | null,
    baseDamage: number,
    duration: number = 3000,
    initialMultiplier: number = 1.2,
    stableMultiplier: number = 0.5,
    canStack: boolean = false,
  ): boolean {
    if (!target) return false;
    // Player: 用 alive 标记;Mob: 用 hp <= 0 推断死亡
    if (target.alive === false || target.hp <= 0) return false;

    const newPoison = new PoisonSystem(
      source,
      baseDamage,
      duration,
      initialMultiplier,
      stableMultiplier,
    );

    const existing = this.activePoisons.get(target);
    if (existing) {
      if (canStack) {
        existing.stack(newPoison);
      } else {
        if (newPoison.baseDamage > existing.baseDamage) {
          this.activePoisons.set(target, newPoison);
        } else {
          existing.reset();
        }
      }
    } else {
      this.activePoisons.set(target, newPoison);
    }

    return true;
  }

  /**
   * 每帧调用:对所有活跃毒伤 tick 一次,造成伤害并清理失效条目。
   * @param gameInstance 用于获取 pushEvent / clientOf 的服务器实例,允许为 null。
   */
  updateAll(gameInstance: GameServerLike | null): void {
    const targetsToRemove: Poisonable[] = [];

    for (const [target, poison] of this.activePoisons) {
      if (!target) {
        targetsToRemove.push(target);
        continue;
      }
      // Player: alive === false;Mob: hp <= 0
      const isDead = target.alive === false || target.hp <= 0;
      if (isDead) {
        targetsToRemove.push(target);
        continue;
      }

      const damage = poison.updateAndTick();
      if (damage > 0 && !isDead) {
        this.applyDamage(target, damage, gameInstance);
      }

      if (!poison.isActive()) {
        targetsToRemove.push(target);
      }
    }

    for (const target of targetsToRemove) {
      this.activePoisons.delete(target);
    }
  }

  /**
   * 实际把伤害写到目标上:
   *  - 优先调用 takeDamage(由 Player/Mob 提供),否则直接扣 hp;
   *  - 通过 pushEvent(EVT.HIT) 发送飘字,客户端据此渲染 poison 染色。
   */
  private applyDamage(
    target: Poisonable,
    damage: number,
    gameInstance: GameServerLike | null,
  ): void {
    const candidate = target as unknown as {
      takeDamage?: (dmg: number, source: PoisonSource) => void;
      id?: number;
      x?: number;
      y?: number;
    };

    if (typeof candidate.takeDamage === "function") {
      const src: PoisonSource = { type: "poison", isDoT: true, owner: null };
      candidate.takeDamage(damage, src);
    } else {
      target.hp -= damage;
    }

    if (gameInstance && typeof candidate.id === "number") {
      const client = gameInstance.clientOf(candidate.id);
      if (client && typeof candidate.x === "number" && typeof candidate.y === "number") {
        gameInstance.pushEvent(
          client,
          EVT.HIT,
          candidate.x,
          candidate.y,
          Math.round(damage),
        );
      }
    }
  }

  /** 查询目标当前毒伤统计;若不存在返回 null。 */
  getPoisonInfo(target: Poisonable): PoisonStats | null {
    const poison = this.activePoisons.get(target);
    return poison ? poison.getStats() : null;
  }

  /** 主动清除某目标的毒伤(玩家死亡、被净化等场景)。 */
  clearPoison(target: Poisonable): void {
    this.activePoisons.delete(target);
  }

  /** 当前活跃毒伤数量(调试用)。 */
  getActiveCount(): number {
    return this.activePoisons.size;
  }
}

/**
 * PoisonManager 所需的 GameServer 最小接口(避免循环依赖,
 * 也让 PoisonManager 可以在不引入具体类型的情况下被独立测试)。
 */
export interface GameServerLike {
  clientOf(playerId: number): ClientState | null;
  pushEvent(
    c: ClientState,
    kind: number,
    x: number,
    y: number,
    value: number,
    item?: number,
    rarity?: number,
  ): void;
}

interface World {
  mobs: Mob[];
  drops: Drop[];
  dormantMobs: DormantMob[];
  projectiles: Projectile[];
}

export interface ClientLike {
  send(data: Uint8Array): void;
}

interface ClientState {
  send(data: Uint8Array): void;
  player: Player | null;
  events: Uint8Array[];
  /** Seconds since the last meaningful (non-neutral) client action. */
  idleSeconds: number;
  /** True once the [AFK CHECK] button has been shown and is awaiting a click. */
  afkPending: boolean;
  /** Seconds left on the visible AFK countdown; only meaningful while pending. */
  afkSecondsLeft: number;
  /** Last countdown value pushed to the client, so we only resend on change. */
  afkLastSent: number;
  /** Set by the AFK sweep; the host closes the socket on the next drain. */
  kick: boolean;
  /** Last INPUT payload seen, so only a *change* in input counts as activity. */
  lastInDx: number;
  lastInDy: number;
  lastFlags: number;
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}

// ===== 区块生物生成上限 =====
// 每个区块（按 getBlockAt 返回的字母 A-G）允许的最大同时活跃生物数量
const ZONE_MOB_LIMITS: Record<string, number> = {
  A: 10, B: 20, C: 25, D: 30, E: 16, F: 15, G: 10,
};

/** 区块字母集合（A-G），用于按区块补生。 */
const ZONE_LETTERS = ["A", "B", "C", "D", "E", "F", "G"];

/** 区块补生检查间隔（秒）。达到上限后不再生成；每 5 秒检查一次，有缺口才补生。 */
const ZONE_REFILL_INTERVAL = 5;

/** 判定生物"卡入墙内"的最小碰撞修正位移（px）。超过则触发 8 方向弹开。 */
const PUSH_OUT_THRESHOLD = 6;

const MOB_WALL_INFLATE = 10;

/** 花瓣重新寻找攻击目标的间隔（帧数），降频以减少每帧距离计算。 */
const PETAL_TARGET_RECHECK_FRAMES = 3;

/** 生物决策（目标寻找/寻路）间隔（秒）：每 0.2 秒思考一次，其余帧复用缓存目标。 */
const MOB_THINK_INTERVAL = 0.2;

/**
 * Missile 物品 ID（Hornet 掉落）。玩家装备后按 spread(attack) 可发射弹射物。
 * 与 defs.ts 中 ITEMS 数组的 id 保持一致。
 */
const MISSILE_ITEM = 52;

/** 弹射物基础存活时间（秒）。 */
const PROJECTILE_TTL = 5;
/** 弹射物命中后的冷却（秒），防止同一帧多次命中同一目标。 */
const PROJECTILE_HIT_CD = 0.3;
/** Hornet 发射导弹的间隔（秒）。 */
const HORNET_MISSILE_INTERVAL = 2.0;
/** Hornet 发射导弹的射程（像素），超出则不发射。 */
const HORNET_MISSILE_RANGE = 600;
/** 导弹飞行速度（像素/秒）。 */
const MISSILE_SPEED = 320;

// ---- Scorpion 毒针配置 ----
/** Scorpion mob type id（请根据 defs.ts 中 MOBS 数组的实际索引修改）。 */
const SCORPION_TYPE = 5;
/** Scorpion 发射毒针的间隔（秒）。 */
const SCORPION_MISSILE_INTERVAL = 2.5;
/** Scorpion 发射毒针的射程（像素）。 */
const SCORPION_MISSILE_RANGE = 500;
/** Scorpion 毒针最大飞行距离（像素），超过即销毁。 */
const SCORPION_PROJECTILE_MAX_DISTANCE = 1500;
/** Scorpion 毒针基础血量（乘以 rarityMult 后作为弹射物总血量）。 */
const SCORPION_PROJECTILE_BASE_HP = 40;
/** Scorpion 毒针飞行速度（像素/秒）。 */
const SCORPION_MISSILE_SPEED = 260;

/**
 * 生物间碰撞 / 生物-玩家碰撞的频率（基于生物自身速度）：
 *  - 静止生物（speed === 0，例如 Ant Hole / Crab Cave / Hive 等巢穴）不进行生物间碰撞；
 *  - 慢速生物：每 SLOW_INTERVAL 秒才做一次；
 *  - 快速生物：每帧都做。
 * 这样能显著降低大规模战斗时的 O(n^2) 距离计算开销。
 */
const MOB_COLLISION_SLOW_INTERVAL = 0.1;   // 慢速生物：10Hz
const MOB_COLLISION_FAST_INTERVAL = 1 / 60; // 快速生物：约 60Hz（每帧）
/** 速度阈值（像素/秒），低于此值视为"慢速"或"无速度"生物。 */
const MOB_COLLISION_SLOW_SPEED = 30;

/**
 * 全局碰撞压力阈值：当某一帧的累计碰撞检测次数超过该值时，
 * 后续帧将"每 4 帧"才做一次生物间碰撞（限流），防止单帧 CPU 尖峰。
 */
const MOB_COLLISION_OVERLOAD_THRESHOLD = 10000;
const MOB_COLLISION_OVERLOAD_SKIP = 4; // 限流时跳过的帧数

/**
 * Mutable counter threaded through the collision helpers below so
 * `GameServer` can report a live "collision checks per tick" debug metric
 * without every call site needing to know about it individually.
 */
export interface CollisionCounter {
  n: number;
}

// =====================================================================
// Polygon-based Wall Collider with BVH (O(log n) queries)
// 多边形噪声墙壁 + 层次包围盒碰撞系统
// —— 用于【玩家】精确碰撞（与客户端渲染的凹凸视觉墙一致）
// =====================================================================

interface WallEdge {
  x1: number; y1: number;
  x2: number; y2: number;
  nx: number; ny: number;   // 预计算外法线（单位向量）
  len: number;
}

interface AABB {
  minX: number; minY: number;
  maxX: number; maxY: number;
}

interface BVHNode {
  aabb: AABB;
  left: BVHNode | null;
  right: BVHNode | null;
  edges: WallEdge[] | null;  // 仅叶子节点存储边
}

interface GridCell {
  edges: WallEdge[];
}

class PolygonWallCollider {
  private polygons: { x: number; y: number }[][] = [];
  private edges: WallEdge[] = [];
  private bvh: BVHNode | null = null;
  private spatialGrid: Map<string, GridCell> = new Map();
  private gridCellSize: number;
  private mapWidth: number;
  private mapHeight: number;
  private gridCols: number;
  private gridRows: number;
  wallMaxJitterPx = 0;

  // 调试统计
  bvhNodeCount = 0;
  bvhLeafCount = 0;
  bvhMaxDepth = 0;

  constructor(
    walls: Wall[],
    mapWidth: number,
    mapHeight: number,
    gridResolution: number = 256,
    private maxEdgesPerLeaf: number = 8
  ) {
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.gridCellSize = Math.max(mapWidth, mapHeight) / gridResolution;
    this.gridCols = Math.ceil(mapWidth / this.gridCellSize);
    this.gridRows = Math.ceil(mapHeight / this.gridCellSize);

    // =========================
    // 预处理阶段（服务器启动一次性完成）
    // =========================
    const t0 = performance.now();

    // 1. AABB 墙壁栅格化为二进制网格
    const grid = this.rasterizeWalls(walls, gridResolution);

    // 2. 提取有向轮廓边（逆时针闭合多边形）
    const loops = this.extractContours(grid, gridResolution);

    // 3. 简化：剔除共线中间点
    const simplified = loops.map(l => this.simplifyLoop(l));

    // 4. 加噪声并转换到世界坐标
    const cellW = mapWidth / gridResolution;
    const cellH = mapHeight / gridResolution;
    this.polygons = simplified.map((loop, idx) =>
      this.addNoise(loop, idx, cellW, cellH)
    );

    // 5. 构建带预计算法线的边表
    for (const poly of this.polygons) {
      const n = poly.length;
      for (let i = 0; i < n; i++) {
        const p1 = poly[i];
        const p2 = poly[(i + 1) % n];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.001) continue;
        // 外法线：轮廓为逆时针，(-dy, dx) 朝外
        const nx = -dy / len;
        const ny = dx / len;
        this.edges.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, nx, ny, len });
      }
    }

    // 6. 构建 BVH 层次包围盒
    this.bvh = this.buildBVH(this.edges);

    // 7. 构建空间网格（作为 broad-phase 备选/兼容层）
    this.buildSpatialGrid();

    const t1 = performance.now();
    console.log(
      `[PolygonWallCollider] Preprocessed ${walls.length} walls => ` +
      `${this.edges.length} edges, ${this.bvhNodeCount} BVH nodes ` +
      `(${this.bvhLeafCount} leaves, depth ${this.bvhMaxDepth}), ` +
      `${this.spatialGrid.size} grid cells. ` +
      `Took ${(t1 - t0).toFixed(2)}ms`
    );
  }

  // 1. 栅格化：将 AABB 墙壁填充到二进制网格
  private rasterizeWalls(walls: Wall[], size: number): Uint8Array {
    const grid = new Uint8Array(size * size);
    const cellW = this.mapWidth / size;
    const cellH = this.mapHeight / size;

    for (const w of walls) {
      const x0 = Math.max(0, Math.floor(w.x / cellW));
      const y0 = Math.max(0, Math.floor(w.y / cellH));
      const x1 = Math.min(size - 1, Math.floor((w.x + w.w) / cellW));
      const y1 = Math.min(size - 1, Math.floor((w.y + w.h) / cellH));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          grid[y * size + x] = 1;
        }
      }
    }
    return grid;
  }

  // 2. 轮廓提取：栅格 → 有向边 → 闭合多边形
  private extractContours(grid: Uint8Array, size: number): { x: number; y: number }[][] {
    const W = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < size && y < size && grid[y * size + x] === 1;

    const edgeMap = new Map<number, { x: number; y: number }>();
    const keyOf = (x: number, y: number) => x * (size + 1) + y;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!W(x, y)) continue;
        if (!W(x, y - 1)) edgeMap.set(keyOf(x, y), { x: x + 1, y });
        if (!W(x + 1, y)) edgeMap.set(keyOf(x + 1, y), { x: x + 1, y: y + 1 });
        if (!W(x, y + 1)) edgeMap.set(keyOf(x + 1, y + 1), { x, y: y + 1 });
        if (!W(x - 1, y)) edgeMap.set(keyOf(x, y + 1), { x, y });
      }
    }

    const rawLoops: { x: number; y: number }[][] = [];
    const visited = new Set<number>();

    for (const startKey of edgeMap.keys()) {
      if (visited.has(startKey)) continue;
      const loop: { x: number; y: number }[] = [];
      let curKey = startKey;
      let guard = 0;
      while (!visited.has(curKey) && guard++ < size * size * 4) {
        visited.add(curKey);
        loop.push({ x: Math.floor(curKey / (size + 1)), y: curKey % (size + 1) });
        const next = edgeMap.get(curKey);
        if (!next) break;
        curKey = keyOf(next.x, next.y);
      }
      if (loop.length >= 3) rawLoops.push(loop);
    }
    return rawLoops;
  }

  // 3. 简化：剔除共线中间点
  private simplifyLoop(loop: { x: number; y: number }[]): { x: number; y: number }[] {
    const n = loop.length;
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const p0 = loop[(i - 1 + n) % n];
      const p1 = loop[i];
      const p2 = loop[(i + 1) % n];
      const collinear =
        (p1.x - p0.x) * (p2.y - p1.y) === (p1.y - p0.y) * (p2.x - p1.x);
      if (!collinear) out.push(p1);
    }
    return out.length >= 3 ? out : loop;
  }

    private addNoise(
    loop: { x: number; y: number }[],
    loopIdx: number, // 保留参数以兼容调用，但内部不再使用
    cellW: number,
    cellH: number
  ): { x: number; y: number }[] {
    // 1. 优化后的噪声函数：去掉了 seed 参数，直接基于坐标计算
    // 这保证了全地图的噪声风格统一
    const noise = (x: number, y: number) => {
      // 使用大质数防止产生规律性
      let h = x * 374761393 + y * 668265263;
      h = (h ^ (h >> 13)) * 1274126177;
      h = h ^ (h >> 16);
      return (h & 0x7fffffff) / 0x7fffffff;
    };

    // 2. 参数配置
    const PTS_PER_CELL = 1;  // 原值是 7。改为 0.5 意味着“每2个单位才产生一个点”。
                                // 8000 的长度将只生成 4000 个点（原来是 56000+ 个），压力骤减。

    const BIG_AMP = 0.4;       // 保持或稍微增大。点变少了，每个点的波动要稍微明显一点才看得出效果。
    const FINE_AMP = 0.2;      // 保持或稍微增大。同上，细节波动要明显一点。

    const BIG_FREQ = 0.08;     // 降低频率。原来的 0.1 在长距离上会产生很多波动，降低它可以减少计算次数。
    const FINE_FREQ = 1.8;

    const pts: { x: number; y: number }[] = [];
    const n = loop.length;

    for (let i = 0; i < n; i++) {
      const p1 = loop[i];
      const p2 = loop[(i + 1) % n];
      const horizontal = p1.y === p2.y;
      const len = horizontal ? Math.abs(p2.x - p1.x) : Math.abs(p2.y - p1.y);

      // 限制最大步数，防止超长墙壁产生过多顶点
      const steps = Math.max(1, Math.min(Math.round(len * PTS_PER_CELL), 200));

      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const wx = p1.x + (p2.x - p1.x) * t;
        const wy = p1.y + (p2.y - p1.y) * t;

        let j = 0;
        if (s !== 0) { // 跳过顶点，保持角落锐利
          // 【核心修改】传入坐标作为噪声种子，不再传 loopIdx
            const big = (noise(Math.floor(wx * BIG_FREQ * 1000), Math.floor(wy * BIG_FREQ * 1000)) - 0.5) * 2 * BIG_AMP;
            const fine = (noise(Math.floor(wx * FINE_FREQ * 1000), Math.floor(wy * FINE_FREQ * 1000)) - 0.5) * 2 * FINE_AMP;
          j = big + fine;
        }

        pts.push({
          x: (wx + (horizontal ? 0 : j)) * cellW,
          y: (wy + (horizontal ? j : 0)) * cellH,
        });
      }
    }

    // 更新最大抖动值
    this.wallMaxJitterPx = Math.max(
      this.wallMaxJitterPx,
      (BIG_AMP + FINE_AMP) * Math.min(cellW, cellH)
    );
    return pts;
  }

  // 5. BVH 构建（SAH 中位分割）
  private buildBVH(edges: WallEdge[]): BVHNode | null {
    if (edges.length === 0) return null;
    return this.buildBVHRecursive(edges, 0);
  }

  private buildBVHRecursive(edges: WallEdge[], depth: number): BVHNode {
    this.bvhNodeCount++;
    this.bvhMaxDepth = Math.max(this.bvhMaxDepth, depth);

    const aabb = this.computeEdgesAABB(edges);

    if (edges.length <= this.maxEdgesPerLeaf) {
      this.bvhLeafCount++;
      return { aabb, left: null, right: null, edges };
    }

    const extentX = aabb.maxX - aabb.minX;
    const extentY = aabb.maxY - aabb.minY;
    const axis = extentX >= extentY ? 0 : 1;

    const sorted = edges.slice().sort((a, b) => {
      const ca = axis === 0 ? (a.x1 + a.x2) * 0.5 : (a.y1 + a.y2) * 0.5;
      const cb = axis === 0 ? (b.x1 + b.x2) * 0.5 : (b.y1 + b.y2) * 0.5;
      return ca - cb;
    });

    const mid = Math.floor(sorted.length / 2);
    const left = this.buildBVHRecursive(sorted.slice(0, mid), depth + 1);
    const right = this.buildBVHRecursive(sorted.slice(mid), depth + 1);

    return { aabb, left, right, edges: null };
  }

  private computeEdgesAABB(edges: WallEdge[]): AABB {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    for (const e of edges) {
      minX = Math.min(minX, e.x1, e.x2);
      minY = Math.min(minY, e.y1, e.y2);
      maxX = Math.max(maxX, e.x1, e.x2);
      maxY = Math.max(maxY, e.y1, e.y2);
    }
    return { minX, minY, maxX, maxY };
  }

  // 6. 空间网格（broad-phase / 兼容层）
  private buildSpatialGrid() {
    for (const e of this.edges) {
      const x0 = Math.floor(Math.min(e.x1, e.x2) / this.gridCellSize);
      const y0 = Math.floor(Math.min(e.y1, e.y2) / this.gridCellSize);
      const x1 = Math.floor(Math.max(e.x1, e.x2) / this.gridCellSize);
      const y1 = Math.floor(Math.max(e.y1, e.y2) / this.gridCellSize);

      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          const key = `${gx},${gy}`;
          let cell = this.spatialGrid.get(key);
          if (!cell) {
            cell = { edges: [] };
            this.spatialGrid.set(key, cell);
          }
          cell.edges.push(e);
        }
      }
    }
  }

  // =========================
  // 7. 碰撞查询 API
  // =========================

  /** 圆与多边形墙壁碰撞检测（主 API）。使用 BVH 快速排除，平均 O(log n)。 */
  collideCircle(x: number, y: number, r: number, counter?: CollisionCounter): [number, number] {
    if (!this.bvh) return [x, y];
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      const candidates = this.queryBVH(this.bvh, x, y, r, counter);
      for (const e of candidates) {
        if (counter) counter.n++;
        const result = this.circleSegmentCollide(x, y, r, e);
        if (result) {
          moved = true;
          x = result.x;
          y = result.y;
        }
      }
      if (!moved) break;
    }
    return [x, y];
  }

  /** 圆是否完全不在任何墙壁内（碰撞修正无位移即视为安全点，用于从墙内弹开）。 */
  isFree(x: number, y: number, r: number): boolean {
    const [cx, cy] = this.collideCircle(x, y, r);
    return Math.abs(cx - x) < 0.01 && Math.abs(cy - y) < 0.01;
  }

  /** 带移动步进的圆碰撞（防止高速穿透）。 */
  moveCircle(
    x: number, y: number, dx: number, dy: number, r: number, counter?: CollisionCounter
  ): [number, number] {
    const dist = Math.hypot(dx, dy);
    const maxStep = Math.max(4, r * 0.45);
    const steps = Math.max(1, Math.ceil(dist / maxStep));
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      x += sx;
      y += sy;
      [x, y] = this.collideCircle(x, y, r, counter);
    }
    return [x, y];
  }

  /** 兼容旧接口：获取某位置附近的墙壁边（空间网格查询）。 */
  getWallsNear(x: number, y: number, radius: number): WallEdge[] {
    const results = new Set<WallEdge>();
    const minGX = Math.floor((x - radius) / this.gridCellSize);
    const maxGX = Math.floor((x + radius) / this.gridCellSize);
    const minGY = Math.floor((y - radius) / this.gridCellSize);
    const maxGY = Math.floor((y + radius) / this.gridCellSize);

    for (let gy = minGY; gy <= maxGY; gy++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        const cell = this.spatialGrid.get(`${gx},${gy}`);
        if (cell) {
          for (const e of cell.edges) results.add(e);
        }
      }
    }
    return Array.from(results);
  }

  /**
   * 粗筛：判断圆 (x,y,r) 是否可能与任何墙壁相交。
   * 用于 wallCollisionBatch 决定是否需要 BVH 高精度碰撞。
   * 用空间网格（spatialGrid）按 (x,y) 所在的格子取出该格子内的墙边列表，
   * 然后把圆扩张到 (r + 网格内墙的最大延伸) 做一次 AABB 测试。
   * 复杂度 O(1)（只查 9 个格子），O(n^2) 永远不会发生。
   * 返回 true 表示可能相交（需要精确碰撞）；false 表示远离所有墙（可跳过）。
   */
  circleNeedsPreciseCheck(x: number, y: number, r: number): boolean {
    if (this.spatialGrid.size === 0) return false;
    // 取以 (x,y) 为中心的 3x3 格子集合
    const cx = Math.floor(x / this.gridCellSize);
    const cy = Math.floor(y / this.gridCellSize);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cell = this.spatialGrid.get(`${cx + dx},${cy + dy}`);
        if (!cell) continue;
        for (const e of cell.edges) {
          // 圆心到线段最短距离的平方 与 (r+线段端点距圆心最远距离)^2 比较：
          // 这里用 AABB 快速近似判断线段所在线段包围盒与圆是否相交。
          const minX = Math.min(e.x1, e.x2);
          const maxX = Math.max(e.x1, e.x2);
          const minY = Math.min(e.y1, e.y2);
          const maxY = Math.max(e.y1, e.y2);
          const closestX = Math.max(minX, Math.min(x, maxX));
          const closestY = Math.max(minY, Math.min(y, maxY));
          const ddx = x - closestX;
          const ddy = y - closestY;
          if (ddx * ddx + ddy * ddy <= r * r) return true;
        }
      }
    }
    return false;
  }

  // 8. BVH 查询（核心 O(log n) 路径）
  private queryBVH(node: BVHNode, x: number, y: number, r: number, counter?: CollisionCounter): WallEdge[] {
    const results: WallEdge[] = [];
    const stack: BVHNode[] = [node];

    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (counter) counter.n++;
      if (!this.circleAABBOverlap(x, y, r, cur.aabb)) continue;
      if (cur.edges) {
        results.push(...cur.edges);
      } else {
        if (cur.left) stack.push(cur.left);
        if (cur.right) stack.push(cur.right);
      }
    }
    return results;
  }

  private circleAABBOverlap(cx: number, cy: number, r: number, aabb: AABB): boolean {
    const closestX = Math.max(aabb.minX, Math.min(cx, aabb.maxX));
    const closestY = Math.max(aabb.minY, Math.min(cy, aabb.maxY));
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx * dx + dy * dy <= r * r;
  }

  // 9. 精确碰撞：圆 vs 线段
  private circleSegmentCollide(
    cx: number, cy: number, r: number, e: WallEdge
  ): { x: number; y: number } | null {
    const { x1, y1, x2, y2 } = e;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((cx - x1) * dx + (cy - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));

    const closestX = x1 + t * dx;
    const closestY = y1 + t * dy;

    const dcx = cx - closestX;
    const dcy = cy - closestY;
    const dist2 = dcx * dcx + dcy * dcy;

    if (dist2 >= r * r) return null;

    if (dist2 < 0.0001) {
      return { x: cx + e.nx * r, y: cy + e.ny * r };
    }

    const dist = Math.sqrt(dist2);
    const push = r - dist;
    return { x: cx + (dcx / dist) * push, y: cy + (dcy / dist) * push };
  }
}

// ---------------------------------------------------------------------
// Array-based Wall Collider (AABB)
// 基于墙壁数组（Wall[]，x/y/w/h AABB 矩形）的简单碰撞系统：
//  - 直接使用 defs 中原始的墙壁数组，不做栅格化/轮廓提取/噪声变换，
//    因此碰撞面是规整的矩形墙，而不是"凹凸的墙壁"；
//  - 均匀网格分桶（普通数组）快速筛选候选墙壁，避免每帧遍历全部墙；
//  - 圆 vs AABB 推挤修正，多趟迭代收敛；
//  - 提供与旧多边形碰撞器相同的接口（collideCircle / isFree /
//    moveCircle / circleNeedsPreciseCheck / getWallsNear），
//    并允许每次实体更新（位置积分后）直接调用。
// ---------------------------------------------------------------------

class ArrayWallCollider {
  private walls: Wall[];
  private mapWidth: number;
  private mapHeight: number;
  private gridCellSize: number;
  private cols: number;
  private rows: number;
  /** 均匀网格：grid[row * cols + col] = 该格子内的墙壁数组 */
  private grid: Wall[][];

  /** 兼容旧字段（旧多边形碰撞器用它记录噪声抖动幅度，这里恒为 0）。 */
  wallMaxJitterPx = 0;

  constructor(
    walls: Wall[],
    mapWidth: number,
    mapHeight: number,
    gridResolution: number = 256,
  ) {
    this.walls = walls;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.gridCellSize = Math.max(mapWidth, mapHeight) / gridResolution;
    this.cols = Math.max(1, Math.ceil(mapWidth / this.gridCellSize));
    this.rows = Math.max(1, Math.ceil(mapHeight / this.gridCellSize));
    this.grid = [];

    // 预处理：把每面墙登记到它覆盖的所有格子中（服务器启动时一次性完成）
    for (const w of walls) {
      const x0 = Math.max(0, Math.floor(w.x / this.gridCellSize));
      const y0 = Math.max(0, Math.floor(w.y / this.gridCellSize));
      const x1 = Math.min(this.cols - 1, Math.floor((w.x + w.w) / this.gridCellSize));
      const y1 = Math.min(this.rows - 1, Math.floor((w.y + w.h) / this.gridCellSize));
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          const idx = gy * this.cols + gx;
          let bucket = this.grid[idx];
          if (!bucket) {
            bucket = [];
            this.grid[idx] = bucket;
          }
          bucket.push(w);
        }
      }
    }
  }

  /** 收集与圆可能相交的候选墙壁（圆所在及覆盖的格子；inflate 额外扩大搜索范围）。 */
  private candidates(x: number, y: number, r: number, inflate = 0): Wall[] {
    const out: Wall[] = [];
    const rr = r + inflate;
    const gx0 = Math.max(0, Math.floor((x - rr) / this.gridCellSize));
    const gy0 = Math.max(0, Math.floor((y - rr) / this.gridCellSize));
    const gx1 = Math.min(this.cols - 1, Math.floor((x + rr) / this.gridCellSize));
    const gy1 = Math.min(this.rows - 1, Math.floor((y + rr) / this.gridCellSize));
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const bucket = this.grid[gy * this.cols + gx];
        if (bucket) out.push(...bucket);
      }
    }
    return out;
  }

  /** 圆 vs AABB 推挤：若相交则把圆心沿最短推出方向移到墙外，否则原样返回。 */
  private pushOutOfWall(cx: number, cy: number, r: number, w: Wall, inflate = 0): [number, number] {
    // inflate > 0 时墙的碰撞范围向外扩张（等效于墙变厚），生物用 +10px
    const minX = w.x - inflate;
    const minY = w.y - inflate;
    const maxX = w.x + w.w + inflate;
    const maxY = w.y + w.h + inflate;
    const closestX = Math.max(minX, Math.min(cx, maxX));
    const closestY = Math.max(minY, Math.min(cy, maxY));
    const dx = cx - closestX;
    const dy = cy - closestY;
    const dist2 = dx * dx + dy * dy;
    if (dist2 >= r * r) return [cx, cy];

    if (dist2 < 0.0001) {
      // 圆心在墙内部：沿最近的边推出去
      const left = cx - minX;
      const right = maxX - cx;
      const top = cy - minY;
      const bottom = maxY - cy;
      const minD = Math.min(left, right, top, bottom);
      if (minD === left) return [minX - r, cy];
      if (minD === right) return [maxX + r, cy];
      if (minD === top) return [cx, minY - r];
      return [cx, maxY + r];
    }

    const dist = Math.sqrt(dist2);
    const push = r - dist;
    return [cx + (dx / dist) * push, cy + (dy / dist) * push];
  }

  /**
   * 圆与墙壁数组碰撞（主 API）：多趟推挤，平均 O(候选墙数)。
   * @param inflate 墙壁外扩量（px）。生物传 MOB_WALL_INFLATE=10；玩家/弹射物默认 0。
   */
  collideCircle(x: number, y: number, r: number, counter?: CollisionCounter, inflate = 0): [number, number] {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const w of this.candidates(x, y, r, inflate)) {
        if (counter) counter.n++;
        const [nx, ny] = this.pushOutOfWall(x, y, r, w, inflate);
        if (nx !== x || ny !== y) {
          moved = true;
          x = nx;
          y = ny;
        }
      }
      if (!moved) break;
    }
    return [x, y];
  }

  /** 圆是否完全不在任何墙壁内（碰撞修正无位移即视为安全点，用于从墙内弹开）。 */
  isFree(x: number, y: number, r: number, inflate = 0): boolean {
    const [cx, cy] = this.collideCircle(x, y, r, undefined, inflate);
    return Math.abs(cx - x) < 0.01 && Math.abs(cy - y) < 0.01;
  }

  /** 带移动步进的圆碰撞（防止高速穿透）。 */
  moveCircle(
    x: number, y: number, dx: number, dy: number, r: number, counter?: CollisionCounter, inflate = 0
  ): [number, number] {
    const dist = Math.hypot(dx, dy);
    const maxStep = Math.max(4, r * 0.45);
    const steps = Math.max(1, Math.ceil(dist / maxStep));
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      x += sx;
      y += sy;
      [x, y] = this.collideCircle(x, y, r, counter, inflate);
    }
    return [x, y];
  }

  /**
   * 粗筛：圆附近（含 r 半径范围）是否存在墙壁。
   * 用于快速跳过远离所有墙的实体，避免不必要的推挤。
   */
  circleNeedsPreciseCheck(x: number, y: number, r: number, inflate = 0): boolean {
    return this.candidates(x, y, r, inflate).length > 0;
  }

  /** 获取某位置附近的墙壁（空间网格查询，兼容旧接口，返回墙数组）。 */
  getWallsNear(x: number, y: number, radius: number, inflate = 0): Wall[] {
    return this.candidates(x, y, radius, inflate);
  }
}

interface GameServerOptions {
  mobCapScale?: number;
  /**
   * 视野缩放因子（viewScale）。客户端渲染时使用的相机缩放比例。
   * 服务器端的视野裁剪半径 VIEW_RADIUS 需要除以 viewScale，
   * 以保证视野范围与客户端实际可见区域一致。
   * 默认 1（无缩放）。例如 viewScale=2 时，视野半径减半。
   */
  viewScale?: number;
  /**
   * 持久化回调：服务器定期（每 30 秒）和玩家断开时调用，
   * 将玩家数据保存到数据库或文件，防止服务器重启导致数据丢失。
   * 回调参数为 (clientId, PlayerSave)。
   */
  persistCallback?: (clientId: number, save: PlayerSave) => void;
}

export class GameServer {
  private nextId = 1;
  private clients = new Map<number, ClientState>();
  private worlds: World[] = MAPS.map(() => ({ mobs: [], drops: [], dormantMobs: [], projectiles: [] }));

  // 生物墙壁碰撞：数组 AABB（直接使用墙壁数组，无噪声多边形；碰撞时墙向外 +10px）
  private wallColliders: ArrayWallCollider[] = [];
  // 玩家墙壁碰撞：数组 AABB 碰撞器（与 mob 共用逻辑，直 AABB 圆-矩碰撞，无栅格无噪声）
  private playerWallColliders: ArrayWallCollider[] = [];

  private tickCount = 0;
  private mobCapScale: number;
  /** 区块补生计时器（秒），累计满 ZONE_REFILL_INTERVAL 后执行一次补生检查。 */
  private zoneRefillTimer = 0;
  /** 视野缩放因子，VIEW_RADIUS 会被除以该值。 */
  private viewScale: number;
  /** 持久化回调（传参注入） */
  private persistCallback: (clientId: number, save: PlayerSave) => void;
  /** 持久化计时器，累计满 SAVE_INTERVAL 后执行一次批量保存。 */
  private persistTimer = 0;

  /**
   * 全局生物碰撞限流计数器：上一帧碰撞检测次数超过 MOB_COLLISION_OVERLOAD_THRESHOLD
   * 时设置此值；之后 MOB_COLLISION_OVERLOAD_SKIP 帧内不进行生物间碰撞。
   *  - 0 = 正常每帧执行；
   *  - >0 = 当前处于限流冷却中，剩余多少帧需要跳过。
   */
  private mobCollisionSkipFrames = 0;

  /** All active squads, keyed by their 6-character code. */
  private squads = new Map<string, Squad>();

  /**
   * 全局毒伤管理器:由 update() 每帧驱动,所有 Scorpion 毒针
   * 命中玩家时通过 applyPoison() 注入。
   */
  private poisonManager: PoisonManager = new PoisonManager();

  /**
   * Per-map zone mob counts (A-G), used to enforce ZONE_MOB_LIMITS.
   * zoneMobCounts[mapId] = Map<zoneLetter, count>
   */
  private zoneMobCounts: Map<string, number>[] = MAPS.map(() => new Map());

  /**
   * Wall/circle collision tests performed during the most recently completed
   * tick. Exposed for the client's debug overlay (`collisionChecks()`); reset
   * at the start of every `tick()` so it always reflects one tick's worth of
   * work rather than accumulating forever.
   */
  private collisionCounter: CollisionCounter = { n: 0 };

  constructor(options: GameServerOptions = {}) {
    this.mobCapScale =
      Number.isFinite(options.mobCapScale) && (options.mobCapScale ?? 1) > 0
        ? options.mobCapScale ?? 1
        : 1;

    // viewScale：客户端相机缩放因子。VIEW_RADIUS 需要除以该值，
    // 以匹配客户端实际可见的世界范围。默认 1（无缩放）。
    this.viewScale =
      Number.isFinite(options.viewScale) && (options.viewScale ?? 1) > 0
        ? options.viewScale ?? 1
        : 1;

    this.persistCallback = options.persistCallback ?? (() => {});

    // 玩家：数组 AABB 碰撞器（与 mob 同一套，无栅格无噪声）
    for (const map of MAPS) {
      this.playerWallColliders.push(new ArrayWallCollider(map.walls, map.width, map.height, 256));
    }
    // 生物：数组 AABB 碰撞器（直接使用墙壁数组，无噪声多边形；碰撞时墙向外 +10px）
    for (const map of MAPS) {
      this.wallColliders.push(new ArrayWallCollider(map.walls, map.width, map.height, 256));
    }

    // 全图生物只预生成一次：每个区块按上限减 1 生成（比 limit 略少，留出补生余量）。
    // 之后的生成全部走 refillZoneMobs() 的视野裁剪：视野外不生成、不更新。
    for (const map of MAPS) {
      this.preSpawnMap(map.id);
    }
  }

  playerCount() {
    let count = 0;
    for (const c of this.clients.values()) if (c.player) count++;
    return count;
  }

  /** Total entities (players + mobs + petals + drops) currently simulated across every map. */
  entityCount(): number {
    let count = 0;
    for (const c of this.clients.values()) {
      if (!c.player) continue;
      count++;
      for (const st of c.player.petals) if (st && st.alive) count++;
    }
    for (const w of this.worlds) count += w.mobs.length + w.drops.length;
    return count;
  }

  /** Wall/circle collision checks performed during the last completed tick. */
  collisionChecks(): number {
    return this.collisionCounter.n;
  }

  private mobCapForMap(mapId: number) {
    return Math.max(0, Math.round(MAPS[mapId].mobCap * this.mobCapScale));
  }

private preSpawnMap(mapId: number) {
    const map = MAPS[mapId];
    if (!map) return;


    // 计算目标数量
    const targetMobs = Math.floor(this.mobCapForMap(mapId));

    let spawned = 0;
    let attempts = 0;

    // ✅ 2. 增加 while 循环的尝试次数上限 (从 *50 增加到 *200)，防止因密度太高导致提前退出
    while (spawned < targetMobs && attempts < targetMobs * 200) {
        attempts++;

        // 随机生成位置
        const x = 50 + Math.random() * (map.width - 200);
        const y = 50 + Math.random() * (map.height - 200);
        const zone = getBlockAt(mapId, x, y);

        // 跳过墙壁
        if (zone === "1" || zone < "A" || zone > "G") continue;

        if (this.zoneFull(mapId, zone)) continue;

        // 直接生成怪物
        const type = pickWeightedMob(mapId, map.mobs);
        const rarity = rollZoneRarity(zone);

        // 增加区块计数 (保留计数逻辑以便后续可能的其他逻辑使用)
        const zoneCounts = this.zoneMobCounts[mapId];
        zoneCounts.set(zone, (zoneCounts.get(zone) || 0) + 1);

        this.worlds[mapId].mobs.push(new Mob(
            this.nextId++,
            type,
            mapId,
            x,
            y,
            rarity
        ));
        spawned++;
    }

    console.log(`[preSpawnMap] 生成 ${spawned}/${targetMobs} 只怪物 (尝试 ${attempts} 次)`);
}



private getZoneFromPosition(col: number, row: number, cols: number, rows: number): string {
    // 计算归一化距离中心的距离 (0-1)
    const centerCol = cols / 2;
    const centerRow = rows / 2;
    const maxDist = Math.max(centerCol, centerRow);

    const dist = Math.sqrt(
        Math.pow((col - centerCol) / maxDist, 2) +
        Math.pow((row - centerRow) / maxDist, 2)
    );

    // 距离越近等级越高 (A近，G远)
    const zoneIndex = Math.min(6, Math.floor(dist * 7));
    return String.fromCharCode(65 + zoneIndex); // A=65, B=66, ...
}

  // ---------------------------------------------------------------- clients
  addClient(id: number, send: (data: Uint8Array) => void) {
    this.clients.set(id, {
      send,
      player: null,
      events: [],
      idleSeconds: 0,
      afkPending: false,
      afkSecondsLeft: 0,
      afkLastSent: -1,
      kick: false,
      lastInDx: 0,
      lastInDy: 0,
      lastFlags: 0,
    });
  }

  /**
   * Marks the client as active, restarting the idle countdown.
   */
  private markActive(c: ClientState, canDismiss = false) {
    if (c.afkPending) {
      if (!canDismiss) return;
      c.afkPending = false;
      c.afkSecondsLeft = 0;
      c.idleSeconds = 0;
      this.sendAfkState(c);
      return;
    }
    c.idleSeconds = 0;
  }

  private sendAfkState(c: ClientState) {
    const w = new Writer(4);
    w.u8(S2C.AFK_CHECK)
      .u8(c.afkPending ? 1 : 0)
      .u16(Math.max(0, Math.ceil(c.afkSecondsLeft)));
    c.send(w.bytes());
    c.afkLastSent = c.afkPending ? Math.ceil(c.afkSecondsLeft) : -1;
  }

  private updateAfk(dt: number) {
    for (const c of this.clients.values()) {
      if (!c.player || c.kick) continue;
      if (c.afkPending) {
        c.afkSecondsLeft -= dt;
        if (c.afkSecondsLeft <= 0) {
          c.afkSecondsLeft = 0;
          c.kick = true;
          this.sendAfkState(c);
          continue;
        }
        const secs = Math.ceil(c.afkSecondsLeft);
        if (secs !== c.afkLastSent) this.sendAfkState(c);
        continue;
      }
      c.idleSeconds += dt;
      if (c.idleSeconds >= AFK_IDLE_SECONDS) {
        c.afkPending = true;
        c.afkSecondsLeft = AFK_CHECK_SECONDS;
        this.sendAfkState(c);
        this.sendChatToClient(c, `Are you still there? Click [AFK CHECK] within ${AFK_CHECK_SECONDS}s or you will be disconnected.`, "System", true, false);
      }
    }
  }


/**
 * 玩家墙壁碰撞：不使用 20fps 批量，而是每帧在 updatePlayer() 中通过
 * collider.moveCircle() 做精确的圆-AABB 碰撞（高精度、无批处理延迟）。
 * 生物墙壁碰撞在 updateWorld() 中随更新执行（墙壁向外 +10px）。
 */

  drainKicks(): number[] {
    const ids: number[] = [];
    for (const [id, c] of this.clients) {
      if (c.kick) {
        c.kick = false;
        ids.push(id);
      }
    }
    return ids;
  }

  isAfkPending(id: number): boolean {
    return this.clients.get(id)?.afkPending ?? false;
  }

  removeClient(id: number) {
    const c = this.clients.get(id);
    // 断开前保存玩家数据
    if (c?.player) {
      this.persistCallback(id, this.getSave(id)!);
      const w = this.worlds[c.player.mapId];
      w.mobs = w.mobs.filter((m) => m.ownerId !== c.player!.id);
      if (c.player.squadCode) {
        this.removePlayerFromSquad(c.player);
      }
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
      loadouts: p.loadouts,
    };
  }

  // ------------------------------------------------------------- networking
  handleMessage(clientId: number, data: Uint8Array) {
    const c = this.clients.get(clientId);
    if (!c) return;
    const r = new Reader(data);
    const type = r.u8();
    if (type !== C2S.INPUT && type !== C2S.PING && type !== C2S.BONUS_STATUS) {
      this.markActive(c, type === C2S.AFK_ACK);
    }

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
        const bagCount = Math.min(r.u16(), BAG_MAX);
        if (p.bag.length < bagCount) p.bag.length = bagCount;
        for (let i = 0; i < bagCount; i++) p.bag[i] = readCell(r);
        for (let i = 0; i < p.bag.length; i++) if (p.bag[i] === undefined) p.bag[i] = null;
        const oracleSecLeft = r.u32();
        const tradeSecLeft = r.u32();
        const now = Date.now();
        p.nextOracleAt = oracleSecLeft > 0 ? now + oracleSecLeft * 1000 : 0;
        p.nextTradeAt = tradeSecLeft > 0 ? now + tradeSecLeft * 1000 : 0;
        this.setBonusStatus(p, r.remaining >= 3 ? r.u8() : 1, r.remaining >= 2 ? r.u16() : 0);
        // 载荷末尾的模式字节:1 = 主页面(菜单)模式,不进入世界模拟。
        p.menuMode = r.remaining >= 1 ? r.u8() === 1 : false;
        if (!p.slots.some(Boolean) && !p.secondary.some(Boolean) && !p.bag.some(Boolean)) {
          p.slots[0] = { item: 0, rarity: 0, count: 1 };
          p.slots[1] = { item: 0, rarity: 0, count: 1 };
          p.slots[2] = { item: 1, rarity: 0, count: 1 };
          p.slots[3] = { item: 0, rarity: 0, count: 1 };
          p.secondary[0] = { item: 2, rarity: 0, count: 1 };
          p.secondary[1] = { item: 8, rarity: 0, count: 1 };
        }
        c.player = p;
        this.applyLevel(p);
        if (!p.menuMode) {
          this.rebuildPetals(p);
          this.spawnPlayer(p);
        }
        this.sendWelcome(c, p);
        // Push the current (all-zero on first JOIN) talent bonus snapshot so
        // the client can show an authoritative buff panel without waiting for
        // the player to open the talent tree and trigger C2S.TALENT.
        {
          const tw = new Writer(64);
          tw.u8(S2C.TALENT_BONUSES);
          writeTalentBonuses(tw, p.talentBonuses);
          c.send(tw.bytes());
        }
        break;
      }

      case C2S.INPUT: {
        const p = c.player;
        if (!p) return;
        p.inDx = r.i8() / 100;
        p.inDy = r.i8() / 100;
        p.flags = r.u8();
        if (p.inDx !== c.lastInDx || p.inDy !== c.lastInDy || p.flags !== c.lastFlags) {
          c.lastInDx = p.inDx;
          c.lastInDy = p.inDy;
          c.lastFlags = p.flags;
          this.markActive(c);
        }
        break;
      }

      case C2S.AFK_ACK: {
        break;
      }

      case C2S.TALENT: {
        const p = c.player;
        if (!p) return;
        // 9 × u8 levels in TALENT_KEYS order. Server recomputes bonuses
        // and pushes the authoritative result back to the client so the
        // UI can confirm (or the server can override a tampered value).
        p.talentLevels = readTalentLevels(r);
        p.talentBonuses = computeTalentBonuses(p.talentLevels);
        // Re-apply derived stats that depend on talent multipliers. We
        // touch both `applyLevel` (max HP) and rebuild the petal state so
        // the new reload times take effect on the next spawn.
        this.applyLevel(p);
        if (!p.menuMode) this.rebuildPetals(p);
        const tw = new Writer(64);
        tw.u8(S2C.TALENT_BONUSES);
        writeTalentBonuses(tw, p.talentBonuses);
        c.send(tw.bytes());
        break;
      }

      case C2S.BONUS_STATUS: {
        const p = c.player;
        if (!p || r.remaining < 3) return;
        this.setBonusStatus(p, r.u8(), r.u16());
        break;
      }

      case C2S.SWAP: {
        const p = c.player;
        if (!p) return;
        const from = r.u16();
        const to = r.u16();
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
        this.craft(c, p, r.u8(), r.u8(), r.u16() || CRAFT_CARD_COUNT);
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
        this.trade(c, p, r.u8(), r.u8(), r.u16());
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
        p.shield = 0;
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

      case C2S.CHAT: {
        const p = c.player;
        if (!p) return;
        const msg = r.str();
        this.handleChat(c, p, msg);
        break;
      }

      case C2S.SYNC_LEVEL: {
        const p = c.player;
        if (!p || !p.squadCode) return;
        const level = r.u16();
        const rarity = r.u8();
        // Update squad member data
        const squad = this.squads.get(p.squadCode);
        if (squad) {
          const member = squad.members.get(p.id);
          if (member) {
            member.level = level;
            member.rarity = rarity;
          }
        }
        // Broadcast to all squad members (including the sender for consistency)
        this.broadcastSquadMemberState(p.squadCode, p.id, level, rarity);
        break;
      }

      case C2S.LOADOUT: {
        const p = c.player;
        if (!p) return;

        const op = r.u8();

        switch (op) {
          case LOADOUT_OP.SAVE: {
            const name = r.str();
            const slotCount = r.u8();
            const slots: (Cell | null)[] = [];

            for (let i = 0; i < slotCount; i++) {
              slots.push(readCell(r));
            }

            // 如果已存在同名 loadout，则更新而不是追加
            const existingIdx = p.loadouts.findIndex(lo => lo.name === name);
            if (existingIdx >= 0) {
              p.loadouts[existingIdx] = { name, slots };
            } else {
              p.loadouts.push({ name, slots });
            }
            this.syncLoadouts(p, c);
            break;
          }

          case LOADOUT_OP.LOAD: {
            const index = r.u8();
            this.executeLoadout(p, index, c);
            break;
          }

          case LOADOUT_OP.DELETE: {
            const index = r.u8();
            if (index >= 0 && index < p.loadouts.length) {
              p.loadouts.splice(index, 1);
              this.syncLoadouts(p, c);
            }
            break;
          }
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------------- squad helpers
  private generateSquadCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < SQUAD_CODE_LENGTH; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  private sendChatToClient(c: ClientState, text: string, sender: string, isSystem: boolean, isCraftReport: boolean) {
    const w = new Writer(256);
    w.u8(S2C.CHAT);
    w.str(text.slice(0, 200));
    w.str(sender.slice(0, 30));
    w.u8(isSystem ? 1 : 0);
    w.u8(isCraftReport ? 1 : 0);
    c.send(w.bytes());
  }

  private broadcastChatToSquad(squadCode: string, text: string, sender: string) {
    const squad = this.squads.get(squadCode);
    if (!squad) return;
    for (const member of squad.members.values()) {
      const c = this.clients.get(member.clientId);
      if (c) this.sendChatToClient(c, text, sender, false, false);
    }
  }

  private broadcastChatToMap(mapId: number, text: string, sender: string) {
    for (const c of this.clients.values()) {
      if (c.player && c.player.mapId === mapId) {
        this.sendChatToClient(c, text, sender, false, false);
      }
    }
  }

  private sendSquadUpdate(c: ClientState, squadCode: string) {
    const w = new Writer(16);
    w.u8(S2C.SQUAD_UPDATE);
    w.str(squadCode.slice(0, SQUAD_CODE_LENGTH));
    c.send(w.bytes());
  }

  /**
   * Broadcast a single squad member's level + rarity to every member of that
   * squad. Also used internally to push the initial state to a newly joined
   * member (see sendSquadMemberStatesTo).
   */
  private broadcastSquadMemberState(squadCode: string, playerId: number, level: number, rarity: number) {
    const squad = this.squads.get(squadCode);
    if (!squad) return;
    const w = new Writer(8);
    w.u8(S2C.SQUAD_MEMBER_STATE);
    w.u16(playerId).u16(level).u8(rarity);
    const packet = w.bytes();
    for (const member of squad.members.values()) {
      const c = this.clients.get(member.clientId);
      if (c) c.send(packet);
    }
  }

  /**
   * Send the current level + rarity of every squad member to a specific
   * client. Called when a player joins a squad so they immediately see the
   * existing members' stats.
   */
  private sendSquadMemberStatesTo(c: ClientState, squadCode: string) {
    const squad = this.squads.get(squadCode);
    if (!squad) return;
    for (const member of squad.members.values()) {
      const w = new Writer(8);
      w.u8(S2C.SQUAD_MEMBER_STATE);
      w.u16(member.playerId).u16(member.level).u8(member.rarity);
      c.send(w.bytes());
    }
  }

  private removePlayerFromSquad(p: Player): string | null {
    if (!p.squadCode) return null;
    const squad = this.squads.get(p.squadCode);
    if (!squad) { p.squadCode = ""; return null; }
    squad.members.delete(p.id);
    const oldCode = p.squadCode;
    p.squadCode = "";
    if (squad.members.size === 0) this.squads.delete(oldCode);
    return oldCode;
  }

  private canJoinSquad(p: Player, squad: Squad): string | null {
    if (squad.members.size >= SQUAD_MAX_MEMBERS) return "Squad is full.";
    for (const member of squad.members.values()) {
      if (Math.abs(p.level - member.level) > SQUAD_LEVEL_GAP_MAX) {
        return `Level gap too large (max ${SQUAD_LEVEL_GAP_MAX}).`;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- chat & commands
  private handleChat(c: ClientState, p: Player, msg: string) {
    const trimmed = msg.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("/")) { this.handleCommand(c, p, trimmed); return; }
    this.broadcastChatToMap(p.mapId, trimmed, p.name);
  }

  private handleCommand(c: ClientState, p: Player, cmd: string) {
    const parts = cmd.split(/\s+/);
    const command = parts[0].toLowerCase();
    switch (command) {
      case "/claim":
        this.sendChatToClient(c, "Daily bonus can be claimed from the main menu.", "System", true, false);
        break;
      case "/create_public_squad":
      case "/create_private_squad": {
        if (p.squadCode) { this.sendChatToClient(c, "Already in a squad. Use /leave_squad first.", "System", true, false); return; }
        const key = this.generateSquadCode();
        const sq: Squad = { code: key, isPublic: command === "/create_public_squad", members: new Map(), createdAt: Date.now() };
        sq.members.set(p.id, { clientId: this.getClientIdForPlayer(p), playerId: p.id, name: p.name, level: p.level, rarity: 0 });
        this.squads.set(key, sq);
        p.squadCode = key;
        this.sendChatToClient(c, `${command === "/create_public_squad" ? "Public" : "Private"} squad created! Code: ${key}`, "System", true, false);
        this.sendSquadUpdate(c, key);
        break;
      }
      case "/join_squad": {
        const code = (parts[1] || "").toUpperCase();
        if (!code) { this.sendChatToClient(c, "Usage: /join_squad <CODE>", "System", true, false); return; }
        if (p.squadCode) { this.sendChatToClient(c, "Already in a squad.", "System", true, false); return; }
        const sq = this.squads.get(code);
        if (!sq) { this.sendChatToClient(c, "Squad not found.", "System", true, false); return; }
        const err = this.canJoinSquad(p, sq);
        if (err) { this.sendChatToClient(c, err, "System", true, false); return; }
        sq.members.set(p.id, { clientId: this.getClientIdForPlayer(p), playerId: p.id, name: p.name, level: p.level, rarity: 0 });
        p.squadCode = code;
        this.sendChatToClient(c, `Joined squad! Code: ${code} (${sq.members.size} members)`, "System", true, false);
        this.sendSquadUpdate(c, code);
        // Send existing members' states to the new joiner
        this.sendSquadMemberStatesTo(c, code);
        this.broadcastChatToSquad(code, `System: ${p.name} joined the squad.`, "System");
        break;
      }
      case "/leave_squad": {
        if (!p.squadCode) { this.sendChatToClient(c, "Not in a squad.", "System", true, false); return; }
        const old = p.squadCode;
        const sq = this.squads.get(old);
        this.removePlayerFromSquad(p);
        this.sendChatToClient(c, "Left the squad.", "System", true, false);
        this.sendSquadUpdate(c, "");
        if (sq && sq.members.size > 0) this.broadcastChatToSquad(old, `System: ${p.name} left.`, "System");
        break;
      }
      case "/find_public_squad": {
        if (p.squadCode) { this.sendChatToClient(c, "Already in a squad.", "System", true, false); return; }
        const candidates: Squad[] = [];
        for (const sq of this.squads.values()) {
          if (!sq.isPublic || sq.members.size >= SQUAD_MAX_MEMBERS) continue;
          if (!this.canJoinSquad(p, sq)) candidates.push(sq);
        }
        if (!candidates.length) { this.sendChatToClient(c, "No available public squads found.", "System", true, false); return; }
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        chosen.members.set(p.id, { clientId: this.getClientIdForPlayer(p), playerId: p.id, name: p.name, level: p.level, rarity: 0 });
        p.squadCode = chosen.code;
        this.sendChatToClient(c, `Auto-joined public squad! Code: ${chosen.code} (${chosen.members.size} members)`, "System", true, false);
        this.sendSquadUpdate(c, chosen.code);
        this.sendSquadMemberStatesTo(c, chosen.code);
        this.broadcastChatToSquad(chosen.code, `System: ${p.name} joined.`, "System");
        break;
      }
      case "/help": {
        const commands = [
          "/claim — Daily bonus from main menu",
          "/create_public_squad — Create a public squad",
          "/create_private_squad — Create a private squad",
          "/join_squad <CODE> — Join a squad by code",
          "/leave_squad — Leave current squad",
          "/find_public_squad — Auto-join a public squad",
          "/find_player — Show player count per map",
          "/help — Show this help message",
        ];
        for (const line of commands) {
          this.sendChatToClient(c, line, "System", true, false);
        }
        break;
      }
      case "/find_player": {
        const mapCounts = new Map<number, number>();
        for (const client of this.clients.values()) {
          if (client.player) {
            mapCounts.set(client.player.mapId, (mapCounts.get(client.player.mapId) || 0) + 1);
          }
        }
        let total = 0;
        for (const map of MAPS) {
          const count = mapCounts.get(map.id) || 0;
          total += count;
          this.sendChatToClient(c, `${map.name}: ${count} player${count === 1 ? "" : "s"}`, "System", true, false);
        }
        this.sendChatToClient(c, `Total: ${total} player${total === 1 ? "" : "s"}`, "System", true, false);
        break;
      }
      default:
        this.sendChatToClient(c, `Unknown command: ${command}`, "System", true, false);
    }
  }

  private getClientIdForPlayer(p: Player): number {
    for (const [id, c] of this.clients.entries()) { if (c.player === p) return id; }
    return 0;
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

  /**
   * Push a floating-text event onto a client's outbound queue.
   * Public: `PoisonManager.updateAll` consumes `GameServerLike`, which requires
   * `pushEvent`/`clientOf` to be part of the server's public surface.
   */
  pushEvent(c: ClientState, kind: number, x: number, y: number, value: number, item = EMPTY_ITEM, rarity = 0) {
    const w = new Writer(16);
    w.u8(S2C.EVENT).u8(kind).i16(Math.round(x)).i16(Math.round(y)).u32(Math.max(0, Math.round(value))).u8(item).u8(rarity);
    c.events.push(w.bytes());
  }

  /** Resolve the client state that owns a player id, or null. Public: see `pushEvent`. */
  clientOf(playerId: number): ClientState | null {
    for (const c of this.clients.values()) if (c.player && c.player.id === playerId) return c;
    return null;
  }

  // ------------------------------------------------------------- inventory
  private cellAt(p: Player, idx: number): Cell | null {
    if (isMainCell(idx)) return p.slots[idx] ?? null;
    if (idx < HOTBAR_CELLS) return p.secondary[idx - SLOT_COUNT] ?? null;
    return p.bag[idx - HOTBAR_CELLS] ?? null;
  }

  private setCell(p: Player, idx: number, cell: Cell | null) {
    if (isMainCell(idx)) { p.slots[idx] = cell; return; }
    if (idx < HOTBAR_CELLS) { p.secondary[idx - SLOT_COUNT] = cell; return; }
    const bagIdx = idx - HOTBAR_CELLS;
    while (p.bag.length <= bagIdx) p.bag.push(null);
    p.bag[bagIdx] = cell;
  }

  private swapCells(p: Player, a: number, b: number) {
    if (a === b || a >= TOTAL_CELLS || b >= TOTAL_CELLS) return;
    const ca = this.cellAt(p, a);
    const cb = this.cellAt(p, b);
    // 快捷栏(主行+副行)卡片禁止叠加:两个快捷栏格之间即使相同稀有度/
    // 相同种类也只交换不合并。背包格之间的合并、快捷栏→背包的合并
    // (拖入背包自动堆叠)不受影响。
    const bothHotbar = isHotbarCell(a) && isHotbarCell(b);
    if (!bothHotbar && ca && cb && ca.item === cb.item && ca.rarity === cb.rarity) {
      cb.count += ca.count;
      this.setCell(p, a, null);
    } else {
      this.setCell(p, a, cb);
      this.setCell(p, b, ca);
    }
    if (isMainCell(a) || isMainCell(b)) this.rebuildPetals(p);
    p.dirty = true;
  }

  private swapRowSlot(p: Player, slot: number) {
    if (slot < 0 || slot >= Math.min(SLOT_COUNT, SECONDARY_SLOT_COUNT)) return;
    const main = p.slots[slot] ?? null;
    const backup = p.secondary[slot] ?? null;
    if (!main && !backup) return;
    p.slots[slot] = backup;
    p.secondary[slot] = main;
    this.rebuildPetals(p);
    this.startReload(p, slot);
    p.dirty = true;
  }

  private swapAllRows(p: Player) {
    const n = Math.min(SLOT_COUNT, SECONDARY_SLOT_COUNT);
    let touched = false;
    for (let i = 0; i < n; i++) {
      const m = p.slots[i] ?? null;
      const b = p.secondary[i] ?? null;
      if (!m && !b) continue;
      p.slots[i] = b;
      p.secondary[i] = m;
      touched = true;
    }
    if (!touched) return;
    this.rebuildPetals(p);
    for (let i = 0; i < n; i++) this.startReload(p, i);
    p.dirty = true;
  }

  private startReload(p: Player, slot: number) {
    const cell = p.slots[slot];
    const st = p.petals[slot];
    if (!cell || !st) return;
    const def = ITEMS[cell.item];
    if (!def || !orbitsAsPetal(def.kind)) return;
    st.alive = false;
    st.timer = def.reload > 0 ? this.applyTalentReload(p, def.reload) : 0.001;
  }

  private moveOneFromBag(p: Player, from: number, to: number) {
    if (from === to || !isBagCell(from) || to >= TOTAL_CELLS) return;
    const source = this.cellAt(p, from);
    if (!source || source.count <= 0) return;
    const one: Cell = { item: source.item, rarity: source.rarity, count: 1 };
    const target = this.cellAt(p, to);
    if (isHotbarCell(to)) {
      if (target && !this.addItem(p, target.item, target.rarity, target.count)) return;
      this.setCell(p, to, one);
      if (isMainCell(to)) this.rebuildPetals(p);
    } else {
      if (target && (target.item !== one.item || target.rarity !== one.rarity || target.count >= 999)) return;
      if (target) target.count += 1;
      else this.setCell(p, to, one);
    }
    source.count -= 1;
    if (source.count === 0) this.setCell(p, from, null);
    p.dirty = true;
  }

  addItem(p: Player, item: number, rarity: number, count = 1): boolean {
    if (count <= 0) return true;
    let left = count;
    for (const cell of p.bag) {
      if (left <= 0) break;
      if (cell && cell.item === item && cell.rarity === rarity && cell.count < 999) {
        const room = 999 - cell.count;
        const put = Math.min(room, left);
        cell.count += put;
        left -= put;
      }
    }
    while (left > 0) {
      let idx = p.bag.indexOf(null);
      if (idx < 0) {
        if (p.bag.length >= BAG_MAX) { p.dirty = true; return false; }
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

  // ================================================================
  // Loadout system
  // ================================================================

  /**
   * 执行 Loadout 加载（原子操作）。
   * 1. 容量预检查（背包满且快捷栏有物品时拒绝）
   * 2. 快捷栏 → 背包（清空当前）
   * 3. 背包 → 快捷栏（填充目标配置）
   * 4. 触发同步与花瓣重建
   */
  private executeLoadout(p: Player, index: number, c: ClientState) {
    if (index < 0 || index >= p.loadouts.length) return;
    const config = p.loadouts[index];

    // --- 步骤 1: 容量预检查 ---
    let currentBagItems = 0;
    for (const cell of p.bag) if (cell) currentBagItems++;

    let itemsOnBar = 0;
    for (const cell of p.slots) if (cell) itemsOnBar++;

    // 保守策略：如果背包满，且快捷栏有东西要放回，则拒绝操作
    if (currentBagItems >= BAG_MAX && itemsOnBar > 0) {
      this.sendChatToClient(c, "Bag full! Cannot switch loadout.", "System", true, false);
      return;
    }

    // --- 步骤 2: 将快捷栏中不在 loadout 配置里的物品移回背包 ---
    // 先收集 loadout 需要的 (item, rarity) 集合
    const loadoutKeys = new Set<string>();
    for (const target of config.slots) {
      if (target) loadoutKeys.add(`${target.item}|${target.rarity}`);
    }

    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = p.slots[i];
      if (!cell) continue;
      // 如果该物品在 loadout 配置中，不要移走（稍后会被放到正确位置）
      if (loadoutKeys.has(`${cell.item}|${cell.rarity}`)) continue;
      this.addItem(p, cell.item, cell.rarity, cell.count);
      p.slots[i] = null;
    }

    // --- 步骤 3: 背包 → 快捷栏（填充目标） ---
    for (let i = 0; i < Math.min(config.slots.length, SLOT_COUNT); i++) {
      const target = config.slots[i];
      if (!target) {
        p.slots[i] = null;
        continue;
      }

      // 如果当前槽位已有匹配物品，保留不动
      const cur = p.slots[i];
      if (cur && cur.item === target.item && cur.rarity === target.rarity && cur.count >= target.count) {
        continue;
      }

      // 从 i 之后搜索匹配物品（避免重复使用已放置的同一物品）
      let found = false;
      for (let j = i; j < SLOT_COUNT; j++) {
        const s = p.slots[j];
        if (s && s.item === target.item && s.rarity === target.rarity && s.count >= target.count) {
          if (i !== j) {
            // 用 swap 避免覆盖目标槽位上的其他物品
            p.slots[i] = p.slots[j];
            p.slots[j] = cur;
          }
          found = true;
          break;
        }
      }
      if (found) continue;

      // 尝试从背包扣除物品
      const taken = this.takeFromBag(p, target.item, target.rarity, target.count);
      if (taken > 0) {
        p.slots[i] = { item: target.item, rarity: target.rarity, count: taken };
      } else {
        p.slots[i] = null; // 背包没有该物品，槽位留空
      }
    }

    // --- 步骤 4: 触发同步与更新 ---
    p.dirty = true; // 触发 INVENTORY 包同步
    this.rebuildPetals(p); // 重建花瓣实体
    this.syncLoadouts(p, c); // 同步 Loadout 状态
  }

  /**
   * 同步 Loadout 列表给客户端（二进制打包）。
   */
  private syncLoadouts(p: Player, c: ClientState) {
    const w = new Writer(512);
    w.u8(S2C.LOADOUT_DATA);
    w.u8(p.loadouts.length);

    for (const lo of p.loadouts) {
      w.str(lo.name);
      w.u8(lo.slots.length);

      for (const cell of lo.slots) {
        writeCell(w, cell);
      }
    }
    c.send(w.bytes());
  }

  private craft(c: ClientState, p: Player, item: number, rarity: number, totalCards: number) {
    if (item >= ITEMS.length) return;
    const successRate = craftChanceFor(rarity);
    if (rarity >= MAX_CRAFT_RARITY || successRate === undefined) return;
    const needed = Math.max(1, totalCards);
    if (this.countOf(p, item, rarity) < needed) return;
    const used = this.takeFromBag(p, item, rarity, needed);
    if (used !== needed) return;
    const attempts = Math.max(1, Math.floor(needed / CRAFT_CARDS_PER_ATTEMPT));
    let successes = 0;
    for (let i = 0; i < attempts; i++) { if (Math.random() < successRate) successes++; }
    if (successes > 0) {
      this.addItem(p, item, rarity + 1, successes);
      this.pushEvent(c, EVT.CRAFT_OK, p.x, p.y, successes, item, rarity + 1);
    } else {
      const kept = 1 + Math.floor(Math.random() * Math.min(4, needed));
      this.addItem(p, item, rarity, kept);
      this.pushEvent(c, EVT.CRAFT_FAIL, p.x, p.y, needed - kept, item, rarity);
    }
    p.dirty = true;
  }

  private oracle(c: ClientState, p: Player, item: number, rarity: number) {
    if (item >= ITEMS.length) return;
    const required = oracleRequiredCount(rarity);
    if (required === undefined || Date.now() < p.nextOracleAt) return;
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

  private trade(c: ClientState, p: Player, item: number, rarity: number, requestedCount: number) {
    if (item >= ITEMS.length || Date.now() < p.nextTradeAt) return;
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
    // 出生点校验与玩家碰撞一致：凹凸多边形精确碰撞器
    const collider = this.playerWallColliders[p.mapId];
    const spawnR = PLAYER_RADIUS + this.soilRadiusBonusOf(p);
    const spawnTiles = findSpawnTiles(p.mapId);
    if (spawnTiles.length > 0) {
      const tile = spawnTiles[Math.floor(Math.random() * spawnTiles.length)];
      const tileW = map.width / BLOCK_GRID_COLS;
      const tileH = map.height / BLOCK_GRID_ROWS;
      for (let tries = 0; tries < 20; tries++) {
        const x = tile.col * tileW + Math.random() * tileW;
        const y = tile.row * tileH + Math.random() * tileH;
        const [cx, cy] = collider.collideCircle(x, y, spawnR);
        if (Math.abs(cx - x) < 0.01 && Math.abs(cy - y) < 0.01) {
          p.x = x; p.y = y; p.hp = p.maxHp; p.alive = true; p.statsDirty = true;
          return;
        }
      }
    }
    // 兜底：尝试随机位置，优先选择不在墙内的；若全部落在墙内，
    // 使用最后一次碰撞修正后的位置（已被弹出墙壁）。
    let fallbackX = 200 + Math.random() * (map.width - 400);
    let fallbackY = 200 + Math.random() * (map.height - 400);
    [fallbackX, fallbackY] = collider.collideCircle(fallbackX, fallbackY, spawnR);
    for (let tries = 0; tries < 60; tries++) {
      const x = 200 + Math.random() * (map.width - 400);
      const y = 200 + Math.random() * (map.height - 400);
      const [cx, cy] = collider.collideCircle(x, y, spawnR);
      if (Math.abs(cx - x) < 0.01 && Math.abs(cy - y) < 0.01) { p.x = x; p.y = y; break; }
      // 记录最后一次修正后的位置作为兜底（被弹出墙壁）。
      fallbackX = cx; fallbackY = cy;
      p.x = fallbackX; p.y = fallbackY;
    }
    p.hp = p.maxHp; p.alive = true; p.statsDirty = true;
  }

  /**
 * 生成一只野生生物。zoneHint 指定后只在该区块内采样（用于补生）；
 * 未指定则在全图 A-G 区块中随机采样。
 * 区块达到 ZONE_MOB_LIMITS 上限时不再生成。
 *
 * @param mapId 地图ID
 * @param zoneHint 区块提示
 * @param x 指定x坐标（可选）
 * @param y 指定y坐标（可选）
 */
private spawnMob(mapId: number, zoneHint = "", x?: number, y?: number) {
    const map = MAPS[mapId];
    const collider = this.wallColliders[mapId];
    const type = pickWeightedMob(mapId, map.mobs);
    const zoneCounts = this.zoneMobCounts[mapId];
    let rarity = 0, spawnX = 0, spawnY = 0, zone = "", placed = false;

    // 如果指定了位置，直接使用
    if (x !== undefined && y !== undefined) {
        // 验证位置是否有效
        zone = getBlockAt(mapId, x, y);
        if (zone === "1" || zone < "A" || zone > "G") {
            return; // 位置无效（墙壁或未知区块）
        }
        // 检查该区块是否已达生成上限
        if (this.zoneFull(mapId, zone)) return;

        const cr = rollZoneRarity(zone);
        const crRadius = MOBS[type].radius * mobSizeMult(cr);
        const [cx, cy] = collider.collideCircle(x, y, crRadius + 6, undefined, MOB_WALL_INFLATE);

        if (Math.abs(cx - x) < 0.01 && Math.abs(cy - y) < 0.01) {
            spawnX = x;
            spawnY = y;
            rarity = cr;
            placed = true;
        }
    } else {
        // 原有逻辑：在区块内随机采样
        // 收集候选瓦片：zoneHint 非空时只收集该区块的瓦片
        const grid = MAP_GRIDS[mapId];
        const tileW = map.width / BLOCK_GRID_COLS;
        const tileH = map.height / BLOCK_GRID_ROWS;
        const tiles: { col: number; row: number }[] = [];

        if (grid) {
            for (let row = 0; row < BLOCK_GRID_ROWS; row++) {
                for (let col = 0; col < BLOCK_GRID_COLS; col++) {
                    const ch = grid[row]?.[col] ?? "1";
                    const letter = ch === "2" ? "A" : ch;
                    if (letter === "1") continue;
                    if (zoneHint && letter !== zoneHint) continue;
                    tiles.push({ col, row });
                }
            }
        }

        if (tiles.length > 0) {
            // 优先：按区块瓦片均匀采样（200×200 一格）
            for (let tries = 0; tries < 60; tries++) {
                const tile = tiles[(Math.random() * tiles.length) | 0];
                spawnX = tile.col * tileW + Math.random() * tileW;
                spawnY = tile.row * tileH + Math.random() * tileH;
                zone = getBlockAt(mapId, spawnX, spawnY);
                if (this.zoneFull(mapId, zone)) continue;
                const cr = rollZoneRarity(zone);
                const crRadius = MOBS[type].radius * mobSizeMult(cr);
                const [cx, cy] = collider.collideCircle(spawnX, spawnY, crRadius + 6, undefined, MOB_WALL_INFLATE);
                if (Math.abs(cx - spawnX) >= 0.01 || Math.abs(cy - spawnY) >= 0.01) continue;
                rarity = cr;
                placed = true;
                break;
            }
        } else {
            // 兜底：无区块网格时按原逻辑随机采样
            for (let tries = 0; tries < 80; tries++) {
                spawnX = 200 + Math.random() * (map.width - 400);
                spawnY = 200 + Math.random() * (map.height - 400);
                zone = getBlockAt(mapId, spawnX, spawnY);
                if (zone < "A" || zone > "G") continue;
                if (zoneHint && zone !== zoneHint) continue;
                if (this.zoneFull(mapId, zone)) continue;
                const cr = rollZoneRarity(zone);
                const crRadius = MOBS[type].radius * mobSizeMult(cr);
                const [cx, cy] = collider.collideCircle(spawnX, spawnY, crRadius + 6, undefined, MOB_WALL_INFLATE);
                if (Math.abs(cx - spawnX) >= 0.01 || Math.abs(cy - spawnY) >= 0.01) continue;
                rarity = cr;
                placed = true;
                break;
            }
        }
    }

    if (!placed) return;
    zoneCounts.set(zone, (zoneCounts.get(zone) || 0) + 1);
    this.worlds[mapId].mobs.push(new Mob(this.nextId++, type, mapId, spawnX, spawnY, rarity));
}

  /** 获取某位置所在区块的字母（A-G），若不在有效区块内返回空字符串。 */
  private zoneAt(mapId: number, x: number, y: number): string {
    const z = getBlockAt(mapId, x, y);
    return (z >= "A" && z <= "G") ? z : "";
  }

  /** 减少某区块的活跃生物计数（生物死亡/休眠时调用）。 */
  private decZoneCount(mapId: number, zone: string) {
    if (!zone) return;
    const counts = this.zoneMobCounts[mapId];
    const cur = counts.get(zone) || 0;
    if (cur > 0) counts.set(zone, cur - 1);
  }

  /** 增加某区块的活跃生物计数（生物唤醒时调用）。 */
  private incZoneCount(mapId: number, zone: string) {
    if (!zone) return;
    const counts = this.zoneMobCounts[mapId];
    counts.set(zone, (counts.get(zone) || 0) + 1);
  }

  /** 区块是否已达到生成上限（达到后不再生成新生物）。 */
  private zoneFull(mapId: number, zone: string): boolean {
    if (!zone) return false;
    const limit = ZONE_MOB_LIMITS[zone];
    if (limit === undefined) return false;
    return (this.zoneMobCounts[mapId].get(zone) || 0) >= limit;
  }

  /**
   * 区块补生检查（每 ZONE_REFILL_INTERVAL 秒执行一次），带视野裁剪：
   * 只对进入过玩家视野的区块补生 1 只；视野外的区块不生成、不更新（由休眠系统管理）。
   * 达到上限的区块不再生成；只有生物减少（死亡/休眠）导致计数低于上限时，才会补生。
   */
  private refillZoneMobs(mapId: number, players: Player[]) {
    let hostiles = 0;
    for (const m of this.worlds[mapId].mobs) if (!m.friendly) hostiles++;
    if (hostiles >= this.mobCapForMap(mapId)) return;

    // 收集当前地图的玩家位置（含死亡位置，与 updateWorld 保持一致）
    const positions: { x: number; y: number }[] = [];
    for (const p of players) {
      if (p.mapId !== mapId) continue;
      positions.push(p.alive ? { x: p.x, y: p.y } : { x: p.deathX, y: p.deathY });
    }
    if (positions.length === 0) return; // 地图上无玩家：视野外不生成

    // 标记进入过玩家视野的区块（区块内任一瓦片与任一玩家距离 < 视野半径）
    const grid = MAP_GRIDS[mapId];
    if (!grid) return;
    const map = MAPS[mapId];
    const tileW = map.width / BLOCK_GRID_COLS;
    const tileH = map.height / BLOCK_GRID_ROWS;
    const viewRadius = 1400 / this.viewScale;
    const viewRadiusSq = viewRadius * viewRadius;
    const inViewZones = new Set<string>();
    for (let row = 0; row < BLOCK_GRID_ROWS; row++) {
      for (let col = 0; col < BLOCK_GRID_COLS; col++) {
        const ch = grid[row]?.[col] ?? "1";
        const letter = ch === "2" ? "A" : ch;
        if (letter === "1" || inViewZones.has(letter)) continue;
        const tx = (col + 0.5) * tileW;
        const ty = (row + 0.5) * tileH;
        for (const pos of positions) {
          const dx = tx - pos.x;
          const dy = ty - pos.y;
          if (dx * dx + dy * dy < viewRadiusSq) { inViewZones.add(letter); break; }
        }
      }
    }

    for (let i = 0; i < ZONE_LETTERS.length; i++) {
      const zone = ZONE_LETTERS[i];
      if (!inViewZones.has(zone)) continue; // 视野外不生成
      if (!this.zoneFull(mapId, zone)) this.spawnMob(mapId, zone);
    }
  }

  /**
   * 生物卡进墙壁时：直接在相同区块（不是出生点）的随机地方刷新。
   *
   * 策略：
   *  1. 先沿 8 个方向由近及远（5~50px 步进）搜索最近的安全位置，
   *     找到则直接移动过去并施加反向弹力（保留原有"微调弹出"行为，
   *     适用于只是轻微嵌入墙边的情形）。
   *  2. 若 8 方向均找不到安全位置（彻底卡死），则在当前所在区块内
   *     随机选取一个非墙壁瓦片，在该瓦片范围内随机落点并校验碰撞，
   *     通过则传送过去。这避免了"卡死后传送回出生点"导致生物
   *     脱离原区块、区块计数错乱的问题。
   *  3. 仍失败则回退到地图随机出生瓦片（最终兜底）。
   */
  private pushOutOfWall(mob: Mob, mapId: number): boolean {
    const map = MAPS[mapId];
    const collider = this.wallColliders[mapId];
    const r = mob.radius;
    const ox = mob.x;
    const oy = mob.y;
    const angles = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (deg * Math.PI) / 180);

    // ---- Step 1: 8 方向微调弹出 ----
    for (let step = 5; step <= 50; step += 5) {
      for (const angle of angles) {
        const tx = ox + Math.cos(angle) * step;
        const ty = oy + Math.sin(angle) * step;
        if (tx < r || tx > map.width - r || ty < r || ty > map.height - r) continue;
        if (collider.isFree(tx, ty, r, MOB_WALL_INFLATE)) {
          mob.x = tx;
          mob.y = ty;
          mob.vx = Math.cos(angle + Math.PI) * 5;
          mob.vy = Math.sin(angle + Math.PI) * 5;
          return true;
        }
      }
    }

    // ---- Step 2: 在相同区块内随机刷新 ----
    // 获取当前所在区块字母（A-G），在该区块的所有瓦片中随机选取。
    const zone = this.zoneAt(mapId, ox, oy);
    const grid = MAP_GRIDS[mapId];
    if (grid && zone) {
      const tileW = map.width / BLOCK_GRID_COLS;
      const tileH = map.height / BLOCK_GRID_ROWS;
      // 收集同区块所有可通行瓦片
      const candidates: { row: number; col: number }[] = [];
      for (let row = 0; row < BLOCK_GRID_ROWS; row++) {
        for (let col = 0; col < BLOCK_GRID_COLS; col++) {
          const ch = grid[row]?.[col] ?? "1";
          // '2'（出生点）在 getBlockAt 中视为 'A'，此处同样匹配
          const tileZone = ch === "2" ? "A" : ch;
          if (tileZone === zone) candidates.push({ row, col });
        }
      }
      // 随机尝试若干个瓦片，每个瓦片内再随机落点
      for (let tries = 0; tries < 30; tries++) {
        if (candidates.length === 0) break;
        const tile = candidates[(Math.random() * candidates.length) | 0];
        const tx = (tile.col + 0.5) * tileW + (Math.random() - 0.5) * tileW * 0.8;
        const ty = (tile.row + 0.5) * tileH + (Math.random() - 0.5) * tileH * 0.8;
        const cx = Math.max(r, Math.min(map.width - r, tx));
        const cy = Math.max(r, Math.min(map.height - r, ty));
        if (collider.isFree(cx, cy, r, MOB_WALL_INFLATE)) {
          mob.x = cx;
          mob.y = cy;
          mob.vx = 0;
          mob.vy = 0;
          return true;
        }
      }
    }

    // ---- Step 3: 兜底——传送到地图随机出生瓦片 ----
    const spawnTiles = findSpawnTiles(mapId);
    if (spawnTiles.length > 0) {
      const tile = spawnTiles[(Math.random() * spawnTiles.length) | 0];
      const tx = (tile.col + 0.5) * (map.width / BLOCK_GRID_COLS);
      const ty = (tile.row + 0.5) * (map.height / BLOCK_GRID_ROWS);
      const [cx, cy] = collider.collideCircle(tx, ty, r, undefined, MOB_WALL_INFLATE);
      mob.x = cx;
      mob.y = cy;
    }
    mob.vx = 0;
    mob.vy = 0;
    return false;
  }

  /**
   * 轻量级"玩家卡墙推出"安全网：每帧调用一次，几乎不消耗性能。
   *
   * 设计目标：在 updatePlayer() 的 moveCircle() 之外再加一道兜底，保证玩家
   * 绝不会停留在墙内（传送/出生点/玩家互推/边界 bug 等异常情形下生效）。
   *
   * 性能策略（"几乎不消耗性能"的关键）：
   *  1. 先用 circleNeedsPreciseCheck（O(1) 粗筛，只查 9 个空间格子）跳过
   *     远离任何墙的玩家——这是 99% 的常见情形，零碰撞开销，仅记录安全位置；
   *  2. 仅当玩家靠近墙时才调用一次 collideCircle 做圆-边推挤修正；
   *     修正量 < PUSH_OUT_THRESHOLD 视为正常贴墙移动，应用并记录安全位置；
   *  3. 修正量 ≥ 阈值视为"深度卡墙"（圆心远离所有墙边，边碰撞失效），
   *     回退到上次记录的安全位置；若无安全记录则传送到出生瓦片兜底。
   *
   * 与 mob 版 pushOutOfWall 的区别：不做 8 方向搜索 / 区块随机刷新
   * （那些是 O(n) 级别的重操作），仅用 O(1) 粗筛 + 单次 collideCircle，
   * 因此可以每帧对每个玩家调用而几乎不增加 tick 开销。
   */
  private pushPlayerOutOfWall(p: Player): void {
    if (!p.alive) return;
    const collider = this.playerWallColliders[p.mapId];
    if (!collider) return;
    const r = PLAYER_RADIUS + this.soilRadiusBonusOf(p);

    // O(1) 粗筛：远离任何墙则记录安全位置并返回（常见路径，零碰撞开销）
    if (!collider.circleNeedsPreciseCheck(p.x, p.y, r)) {
      p.lastSafeX = p.x;
      p.lastSafeY = p.y;
      return;
    }

    // 靠近墙：一次 collideCircle 既检测又修正（单次调用，开销极低）
    const [nx, ny] = collider.collideCircle(p.x, p.y, r, this.collisionCounter);
    const disp = Math.abs(nx - p.x) + Math.abs(ny - p.y);

    // 修正量小：正常贴墙/浅嵌入，应用修正并记录安全位置
    if (disp < PUSH_OUT_THRESHOLD) {
      p.x = nx;
      p.y = ny;
      p.lastSafeX = p.x;
      p.lastSafeY = p.y;
      return;
    }

    // 修正量大：深度卡墙（圆心远离所有墙边，边碰撞无法推出），回退到上次安全位置
    if (p.lastSafeX !== 0 || p.lastSafeY !== 0) {
      p.x = p.lastSafeX;
      p.y = p.lastSafeY;
    } else {
      // 无安全位置记录：传送到出生瓦片兜底
      const spawnTiles = findSpawnTiles(p.mapId);
      if (spawnTiles.length > 0) {
        const tile = spawnTiles[(Math.random() * spawnTiles.length) | 0];
        const map = MAPS[p.mapId];
        p.x = (tile.col + 0.5) * (map.width / BLOCK_GRID_COLS);
        p.y = (tile.row + 0.5) * (map.height / BLOCK_GRID_ROWS);
        const [cx, cy] = collider.collideCircle(p.x, p.y, r);
        p.x = cx;
        p.y = cy;
      }
    }
    // 卡墙后清零速度，避免立即再次冲入
    p.vx = 0;
    p.vy = 0;
  }

  private healthBonusOf(p: Player): number {
    let bonus = 0;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = p.slots[i];
      if (!cell) continue;
      const def = ITEMS[cell.item];
      if (def?.healthBonus) bonus += def.healthBonus * rarityMult(cell.rarity);
    }
    return bonus;
  }

  private soilRadiusBonusOf(p: Player): number {
    let bonus = 0;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = p.slots[i];
      if (!cell) continue;
      const def = ITEMS[cell.item];
      if ((def?.name ?? "").toLowerCase() === "soil") {
        bonus += 10 + cell.rarity * 2;
      }
    }
    return bonus;
  }

  /**
   * Apply talent-tree reload modifier to a petal's base reload time. The
   * `reload` branch is a flat fractional reduction (e.g. level 7 → 0.35
   * off, capped at 0.5). The result is clamped so a fully-stacked
   * allocation can never make reload negative or zero (which would brick
   * the petal). Used by every place that writes `st.timer = def.reload`.
   */
  private applyTalentReload(p: Player, baseReload: number): number {
    if (baseReload <= 0) return baseReload;
    const t = p.talentBonuses;
    const scaled = baseReload * (1 - t.reloadReduction);
    return scaled < 0.05 ? 0.05 : scaled;
  }

  private applyLevel(p: Player) {
    const lvl = levelFromXp(p.xp);
    const maxHp = Math.round(
      (110 + lvl * 16 + this.healthBonusOf(p)) * p.talentBonuses.healthMult,
    );
    if (maxHp !== p.maxHp) {
      const ratio = p.hp / p.maxHp;
      p.maxHp = maxHp;
      p.hp = Math.min(maxHp, Math.max(1, ratio * maxHp));
      if (p.shield > maxHp) p.shield = maxHp;
      p.statsDirty = true;
    }
    if (lvl !== p.level) { p.level = lvl; p.statsDirty = true; }
  }

  private despawnPets(p: Player, slot: number) {
    const pets = p.pets[slot] || [];
    for (const pet of pets) {
      const w = this.worlds[pet.mapId];
      if (w) w.mobs = w.mobs.filter((m) => m !== pet);
    }
    p.pets[slot] = [];
  }

  private rebuildPetals(p: Player) {
    // 主页面(菜单)模式:不激活快捷栏更新(不生成/重建花瓣),
    // 物品操作(快捷栏切换等)照常可用,进入游戏时随 JOIN 重新构建。
    if (p.menuMode) return;
    const oldPetals = p.petals;
    const petals: PetalState[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const old = oldPetals[i];
      const cell = p.slots[i];
      const def = cell ? ITEMS[cell.item] : null;
      const orbits = !!def && orbitsAsPetal(def.kind);

      // 宠物召唤逻辑：无论是否变化都要检查，防止召唤物不一致
      const pets = p.pets[i] || [];
      const sameSummon = !!cell && !!def && def.kind === "summon" &&
        pets.every((pet) => pet.type === def.petMob && pet.sourceItem === cell.item && pet.sourceRarity === cell.rarity);
      if (pets.length > 0 && !sameSummon) this.despawnPets(p, i);

      // 判断槽位内容是否真的变了（物品ID 或稀有度不同，或之前没有状态）
      const cellChanged =
        !old ||
        !cell ||
        old.item !== cell.item ||
        old.rarity !== cell.rarity;

      if (!cellChanged) {
        // 槽位没变：保留旧状态（HP、reload 进度、目标锁定等全部保留）
        petals.push(old);
        continue;
      }

      // 槽位变了：创建新花瓣状态，重置所有计时器
      const maxHp = orbits ? def!.health * rarityMult(cell!.rarity) : 1;
      petals.push({
        id: old?.id ?? this.nextId++,
        item: cell?.item ?? EMPTY_ITEM,
        rarity: cell?.rarity ?? 0,
        alive: orbits,
        hp: maxHp,
        maxHp,
        timer: 0,
        x: p.x,
        y: p.y,
        hitCd: 0,
        specialTimer: cell && isAbsorbItem(cell.item) ? ROSE_HEAL_DELAY : 0,
        absorbTimer: 0,
        // 目标搜索降频：随机初值让各花瓣错开搜索帧
        targetCheckTimer: (Math.random() * PETAL_TARGET_RECHECK_FRAMES) | 0,
        targetId: 0,
        // 弹射物发射计时器：Missile 等远程花瓣用，初始 0 表示可立即发射
        fireTimer: 0,
      });
    }
    p.petals = petals;
  }

  // ------------------------------------------------------------------ tick
  // 碰撞逻辑已迁移到 C++ 服务器，此处不再执行碰撞检测
  tick(dt: number) {
    this.tickCount++;
    this.updateAfk(dt);
    const players: Player[] = [];
    // 主页面(菜单)模式的玩家不参与世界模拟:不移动、不生成花瓣、不拾取
    // 掉落、不被生物攻击;其物品操作(合成/交易/快捷栏切换)仍可正常进行。
    for (const c of this.clients.values()) if (c.player && !c.player.menuMode) players.push(c.player);
    for (const p of players) this.updatePlayer(p, dt, players);
    for (let m = 0; m < MAPS.length; m++) this.updateWorld(m, dt, players);
    // 每 5 秒检查一次：只给进入玩家视野的区块补生，视野外不生成、不更新
    this.zoneRefillTimer += dt;
    if (this.zoneRefillTimer >= ZONE_REFILL_INTERVAL) {
      this.zoneRefillTimer = 0;
      for (let m = 0; m < MAPS.length; m++) this.refillZoneMobs(m, players);
    }
    for (const p of players) this.updatePetals(p, dt);
    for (const p of players) this.pickupDrops(p, dt);
    // 弹射物系统：生物与花瓣共用的远程攻击更新
    for (let m = 0; m < MAPS.length; m++) this.updateProjectiles(m, dt, players);
    // 毒伤系统：所有活跃毒伤按 100ms tick 节奏结算一次伤害
    this.poisonManager.updateAll(this);
    for (const c of this.clients.values()) this.sendState(c);
    // 持久化：每 30 秒保存一次所有在线玩家的数据
    this.persistTimer += dt;
    if (this.persistTimer >= 30) {
      this.persistTimer = 0;
      for (const [id, c] of this.clients) {
        if (c.player) {
          this.persistCallback(id, this.getSave(id)!);
        }
      }
    }
  }

  // 碰撞逻辑已迁移到 C++ 服务器，此处仅做基础移动，不做碰撞检测
  private updatePlayer(p: Player, dt: number, players: Player[]) {
    if (!p.alive) return;
    const map = MAPS[p.mapId];
    let speedBonus = 0;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = p.slots[i];
      if (!cell) continue;
      const def = ITEMS[cell.item];
      const alive = orbitsAsPetal(def.kind) ? p.petals[i]?.alive : true;
      if (!alive) continue;
      if (def.speed) speedBonus += def.speed * (1 + cell.rarity * 0.12);
    }
    const speed = (190 + p.level * 0.8) * (1 + speedBonus / 100) * p.talentBonuses.speedMult;
    p.currentSpeed = speed;
    const mag = Math.hypot(p.inDx, p.inDy);
    const nx = mag > 1 ? p.inDx / mag : p.inDx;
    const ny = mag > 1 ? p.inDy / mag : p.inDy;
    p.vx += (nx * speed - p.vx) * Math.min(1, dt * 9);
    p.vy += (ny * speed - p.vy) * Math.min(1, dt * 9);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.x = clamp(p.x, 0, map.width);
    p.y = clamp(p.y, 0, map.height);
    p.hurtCd = Math.max(0, p.hurtCd - dt);
    const attack = (p.flags & 1) !== 0;
    const defend = (p.flags & 2) !== 0;

    // Bubble: trigger on rising edge of defend (Shift/Contract key)
    if (defend && !p.wasDefending) {
      this.breakBubbles(p);
    }
    p.wasDefending = defend;

    // Third Eye petals expand the orbit range. The bonus is added to the
    // spread (attack) target so the smooth interpolation still works with spread/defend modes.
    const eyeBonus = thirdEyeOrbitBonus(p.slots);
    const targetOrbit = attack ? 118 + eyeBonus : defend ? 34 : 62;
    p.orbit += (targetOrbit - p.orbit) * Math.min(1, dt * 6);
    p.baseAngle += dt * (attack ? 3.4 : 2.2);
    this.applyLevel(p);
  }

  /**
   * Break all active Bubble petals when the player presses Defend (Shift/Contract).
   * Each bubble applies a rarity-scaled push force away from the player.
   */
  private breakBubbles(p: Player) {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = p.slots[i];
      if (!cell) continue;
      const def = ITEMS[cell.item];
      if (!def || def.name !== "Bubble") continue;
      const st = p.petals[i];
      if (!st || !st.alive) continue;

      // Calculate push force based on rarity (mirrors rarityMult scaling)
      const mult = rarityMult(cell.rarity);
      const basePush = 800;
      const pushForce = basePush * Math.min(4.0, mult);

      const dx = p.x - st.x;
      const dy = p.y - st.y;
      const dist = Math.hypot(dx, dy);

      let vx: number;
      let vy: number;
      if (dist > 0.01) {
        vx = (dx / dist) * pushForce;
        vy = (dy / dist) * pushForce;
      } else {
        const angle = Math.random() * Math.PI * 2;
        vx = Math.cos(angle) * pushForce;
        vy = Math.sin(angle) * pushForce;
      }

      // Apply impulse to player velocity
      p.vx += vx;
      p.vy += vy;

      // Also apply the push to any alive Moon petal. Petals have no velocity
      // field (they interpolate toward their orbit target), so we apply the
      // push as a position displacement; the orbit interpolation will spring
      // the Moon back toward its orbit over the next few frames, producing a
      // visible "knocked away then returns" effect.
      for (let j = 0; j < SLOT_COUNT; j++) {
        if (j === i) continue;
        const mcell = p.slots[j];
        if (!mcell) continue;
        const mdef = ITEMS[mcell.item];
        if (!mdef || !(mdef.name ?? "").toLowerCase().includes("moon")) continue;
        const mst = p.petals[j];
        if (!mst || !mst.alive) continue;
        mst.x += vx * 0.1;
        mst.y += vy * 0.1;
      }

      // Break the bubble: kill petal and start reload
      st.alive = false;
      st.hp = 0;
      st.timer = def.reload > 0 ? this.applyTalentReload(p, def.reload) : 0.001;
    }
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

    // -----------------------------------------------------------------
    // Moon orbit center: if the player has a Moon petal, every other
    // petal orbits around the Moon instead of around the player body.
    // The Moon itself still orbits the player. We snapshot the Moon's
    // current position here (1-frame lag, imperceptible) so the order
    // in which petals are processed does not matter.
    // -----------------------------------------------------------------
    let moonSt: PetalState | null = null;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = p.slots[i];
      if (!cell) continue;
      const def = ITEMS[cell.item];
      if ((def.name ?? "").toLowerCase().includes("moon")) {
        moonSt = p.petals[i];
        break;
      }
    }
    const moonAlive = !!moonSt && moonSt.alive;
    const orbitCenterX = moonAlive ? moonSt!.x : p.x;
    const orbitCenterY = moonAlive ? moonSt!.y : p.y;

    let index = 0;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = p.slots[i];
      const st = p.petals[i];
      if (!cell || !st) continue;
      const def = ITEMS[cell.item];
      const isSummon = def.kind === "summon";
      if (!orbitsAsPetal(def.kind)) continue;
      if (isSummon) this.cleanupPets(p, i);
      const slotAngle = p.baseAngle + (index / Math.max(1, liveCount)) * Math.PI * 2;
      index++;
      st.hitCd = Math.max(0, st.hitCd - dt);

      // Pre-calculate orbit parameters (needed for both revival and movement)
      const absorbs = isAbsorbItem(cell.item) && (!!def.heal || !!def.shield);
      const staysTight = isSummon || (def.name ?? "").toLowerCase().includes("magnet") || (def.name ?? "").toLowerCase().includes("bubble");
      const orbitRadius = (absorbs || staysTight) ? Math.min(p.orbit, 62) : p.orbit;
      const isMoon = (def.name ?? "").toLowerCase().includes("moon");
      const cx = isMoon ? p.x : orbitCenterX;
      const cy = isMoon ? p.y : orbitCenterY;
      const tx = cx + Math.cos(slotAngle) * orbitRadius;
      const ty = cy + Math.sin(slotAngle) * orbitRadius;

      if (!st.alive) {
        st.timer -= dt;
        if (st.timer <= 0) {
          st.alive = true;
          st.maxHp = def.health * rarityMult(cell.rarity);
          st.hp = st.maxHp;
          st.specialTimer = isAbsorbItem(cell.item) ? ROSE_HEAL_DELAY : 0;
          st.absorbTimer = 0;
          // 复活前检查目标轨道位置是否安全（不卡墙）
          const collider = this.wallColliders[p.mapId];
          const petalR = def.radius * (1 + cell.rarity * 0.06);
          if (collider.isFree(tx, ty, petalR + 1)) {
            st.x = tx;
            st.y = ty;
          } else {
            // 目标位置卡墙，回退到玩家身上
            st.x = p.x;
            st.y = p.y;
          }
        }
        continue;
      }
      if (isSummon && (p.pets[i]?.length ?? 0) < getSummonCount(cell.item)) {
        this.hatchPet(p, i, cell);
        st.alive = false; st.hp = 0; st.timer = this.applyTalentReload(p, def.reload);
        continue;
      }
      if (absorbs) {
        const missing = def.heal ? Math.max(0, p.maxHp - p.hp) : Math.max(0, p.maxHp - p.shield);
        st.specialTimer = Math.max(0, st.specialTimer - dt);
        if (st.absorbTimer > 0) {
          const travelStep = Math.min(1, dt / Math.max(dt, st.absorbTimer));
          st.x += (p.x - st.x) * travelStep;
          st.y += (p.y - st.y) * travelStep;
          st.absorbTimer = Math.max(0, st.absorbTimer - dt);
          if (st.absorbTimer <= 0 && missing > 0) {
            const amount = Math.min(missing, (def.heal ?? def.shield ?? 0) * rarityMult(cell.rarity));
            if (def.heal) p.hp += amount; else p.shield += amount;
            p.statsDirty = true;
            const owner = this.clientOf(p.id);
            if (owner) this.pushEvent(owner, EVT.HEAL, p.x, p.y, Math.round(amount), cell.item, cell.rarity);
            st.alive = false; st.hp = 0; st.timer = this.applyTalentReload(p, def.reload);
          }
          continue;
        }
        st.x += (tx - st.x) * Math.min(1, dt * 14);
        st.y += (ty - st.y) * Math.min(1, dt * 14);
        if (st.specialTimer <= 0 && missing > 0) { st.absorbTimer = ROSE_ABSORB_TIME; continue; }
      } else {
        st.x += (tx - st.x) * Math.min(1, dt * 14);
        st.y += (ty - st.y) * Math.min(1, dt * 14);
      }
      if (def.healPerSec && p.hp < p.maxHp) {
        const threshold = def.healPerSecThreshold ?? 1;
        if (p.hp / p.maxHp < threshold) {
          const restored = Math.min(p.maxHp - p.hp, def.healPerSec * rarityMult(cell.rarity) * dt);
          if (restored > 0) { p.hp += restored; p.statsDirty = true; }
        }
      }
      if (def.shieldPerSec) {
        const maxShield = p.maxHp;
        if (p.shield < maxShield) { p.shield = Math.min(maxShield, p.shield + def.shieldPerSec * rarityMult(cell.rarity) * dt); p.statsDirty = true; }
      }
      // 花瓣碰撞/伤害逻辑已迁移到 C++ 服务器
    }
  }
/**
 * 使用空间网格高效获取玩家视野内的敌对生物
 */
private getNearbyHostilesOptimized(p: Player, world: World, viewRadiusSq: number): Mob[] {
    const MOB_CELL_SIZE = 250;
    const result: Mob[] = [];

    // 使用空间网格快速定位视野内的生物
    const minX = Math.floor((p.x - Math.sqrt(viewRadiusSq)) / MOB_CELL_SIZE);
    const maxX = Math.floor((p.x + Math.sqrt(viewRadiusSq)) / MOB_CELL_SIZE);
    const minY = Math.floor((p.y - Math.sqrt(viewRadiusSq)) / MOB_CELL_SIZE);
    const maxY = Math.floor((p.y + Math.sqrt(viewRadiusSq)) / MOB_CELL_SIZE);

    // 构建临时网格（如果还没有）
    const grid = new Map<string, Mob[]>();
    for (const mob of world.mobs) {
        if (mob.friendly) continue;
        const key = `${Math.floor(mob.x / MOB_CELL_SIZE)},${Math.floor(mob.y / MOB_CELL_SIZE)}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key)!.push(mob);
    }

    // 只检查视野范围内的网格单元
    for (let gx = minX; gx <= maxX; gx++) {
        for (let gy = minY; gy <= maxY; gy++) {
            const key = `${gx},${gy}`;
            const cells = grid.get(key);
            if (!cells) continue;

            for (const mob of cells) {
                const dx = mob.x - p.x;
                const dy = mob.y - p.y;
                if (dx * dx + dy * dy < viewRadiusSq) {
                    result.push(mob);
                }
            }
        }
    }

    return result;
}

/**
 * 从候选列表中获取指定半径内的生物（进一步裁剪）
 */
private getMobsInRadius(x: number, y: number, radius: number, candidates: Mob[]): Mob[] {
    const radiusSq = radius * radius;
    const result: Mob[] = [];
    for (const mob of candidates) {
        const dx = mob.x - x;
        const dy = mob.y - y;
        if (dx * dx + dy * dy < radiusSq) {
            result.push(mob);
        }
    }
    return result;
}

  private cleanupPets(p: Player, slot: number) {
    const pets = p.pets[slot] || [];
    const active: Mob[] = [];
    for (const pet of pets) {
      if (pet && pet.hp > 0 && pet.mapId === p.mapId) active.push(pet);
      else if (pet) { const w = this.worlds[pet.mapId]; if (w) w.mobs = w.mobs.filter((m) => m !== pet); }
    }
    p.pets[slot] = active;
  }

  private hatchPet(p: Player, slot: number, cell: Cell) {
    const def = ITEMS[cell.item];
    if (def.petMob === undefined) return;
    const pets = p.pets[slot] || [];
    const room = getSummonCount(cell.item) - pets.length;
    const toSpawn = Math.min(getSummonBatch(cell.item), Math.max(0, room));
    if (toSpawn <= 0) return;
    const rarity = this.getSummonRarityWithDna(p, cell);
    const protection = getSpawnProtection(cell.item);
    const map = MAPS[p.mapId];
    const collider = this.wallColliders[p.mapId];
    const petRadius = MOBS[def.petMob].radius * friendlyMobSizeMult(rarity);
    for (let i = 0; i < toSpawn; i++) {
      // 尝试多次找到一个不在墙壁内的生成位置；
      // 若所有尝试都落在墙里，则使用最后一次碰撞修正后的位置（被弹出墙壁）。
      let sx = p.x, sy = p.y;
      let placed = false;
      for (let tries = 0; tries < 12; tries++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 40 + Math.random() * 30;
        let tx = clamp(p.x + Math.cos(angle) * dist, petRadius + 4, map.width - petRadius - 4);
        let ty = clamp(p.y + Math.sin(angle) * dist, petRadius + 4, map.height - petRadius - 4);
        const [rx, ry] = collider.collideCircle(tx, ty, petRadius + 4, undefined, MOB_WALL_INFLATE);
        // 如果碰撞修正没有移动位置，说明该位置不在墙内，可用。
        if (Math.abs(rx - tx) < 0.01 && Math.abs(ry - ty) < 0.01) {
          sx = tx; sy = ty; placed = true; break;
        }
        // 记录最后一次修正后的位置作为兜底（被弹出墙壁）。
        sx = rx; sy = ry;
      }
      // placed=true 表示找到了不在墙内的位置；否则 sx/sy 已被弹出墙壁。
      const m = new Mob(this.nextId++, def.petMob, p.mapId, sx, sy, rarity, true);
      m.ownerId = p.id; m.ownerSlot = slot; m.sourceItem = cell.item; m.sourceRarity = cell.rarity;
      // Apply summonHpMult talent: extra 1.4× base, then talent multiplier.
      const summonHpScale = 1.4 * p.talentBonuses.summonHpMult;
      m.maxHp = Math.max(1, Math.round(m.maxHp * summonHpScale));
      m.hp = m.maxHp;
      // Apply summonDmgMult talent: summons get a 1.5× base speed bump, and
      // their damage is bumped proportionally to the player's damage mult.
      m.damage = m.damage * p.talentBonuses.summonDmgMult;
      if (m.speed > 0) m.speed = Math.max(70, m.speed * 1.5);
      m.spawnProtection = protection;
      this.worlds[p.mapId].mobs.push(m);
      pets.push(m);
    }
    p.pets[slot] = pets;
  }

  private getSummonRarityWithDna(p: Player, cell: Cell): number {
    const def = ITEMS[cell.item];
    if (!def || def.kind !== "summon") return 0;
    const summonRarity = Math.max(0, Math.min(MAX_RARITY, cell.rarity));
    const mappedRarity = def.noDowngrade ? summonRarity : mapRarityToSummonRarity(summonRarity);
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
  // 碰撞逻辑（墙壁/生物间/生物-玩家）已迁移到 C++ 服务器

  // ===== ✅ 视野裁剪范围 =====
  // VIEW_RADIUS 需要除以 viewScale，以匹配客户端相机缩放后的实际可见范围。
  const VIEW_RADIUS = 1300 / this.viewScale; // 只处理玩家视野内的生物
  const VIEW_RADIUS_SQ = VIEW_RADIUS * VIEW_RADIUS;

  // ===== 构建玩家位置集合（包含死亡的玩家，使死亡位置周围的生物仍能更新） =====
  const playerPositions = players
    .filter((p) => p.mapId === mapId)
    .map((p) => p.alive ? { x: p.x, y: p.y } : { x: p.deathX, y: p.deathY });

  // ===== 空间网格 =====
  const MOB_CELL_SIZE = 250;
  const mobGrid = new Map<string, Mob[]>();
  const getKey = (x: number, y: number) => `${Math.floor(x / MOB_CELL_SIZE)},${Math.floor(y / MOB_CELL_SIZE)}`;

  for (const mob of world.mobs) {
    const k = getKey(mob.x, mob.y);
    if (!mobGrid.has(k)) mobGrid.set(k, []);
    mobGrid.get(k)!.push(mob);
  }

  const getNearby = (x: number, y: number) => {
    const cx = Math.floor(x / MOB_CELL_SIZE), cy = Math.floor(y / MOB_CELL_SIZE);
    const r: Mob[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const c = mobGrid.get(`${cx + dx},${cy + dy}`);
        if (c) r.push(...c);
      }
    }
    return r;
  };

  // ===== 休眠系统：将不在任何玩家视野内的生物移入休眠池 =====
  const toDormant: DormantMob[] = [];
  for (let i = world.mobs.length - 1; i >= 0; i--) {
    const mob = world.mobs[i];
    let inView = false;
    if (mob.ownerId !== 0) {
      inView = true;
    } else {
      for (const pos of playerPositions) {
        const dx = mob.x - pos.x;
        const dy = mob.y - pos.y;
        if (dx * dx + dy * dy < VIEW_RADIUS_SQ) {
          inView = true;
          break;
        }
      }
    }
    if (!inView) {
      // 减少该区块计数（仅非友好生物计入区块限制）
      if (!mob.friendly) this.decZoneCount(mapId, this.zoneAt(mapId, mob.x, mob.y));
      toDormant.push({
        type: mob.type, rarity: mob.rarity,
        x: mob.x, y: mob.y, vx: mob.vx, vy: mob.vy,
        health: mob.hp, maxHealth: mob.maxHp,
        lastHitBy: mob.lastHitBy,
        damageByPlayer: Array.from(mob.damageByPlayer.entries()),
        spawnedThresholds: Array.from(mob.spawnedThresholds),
      });
      world.mobs.splice(i, 1);
    }
  }
  world.dormantMobs.push(...toDormant);

  // ===== 唤醒系统：检查休眠生物是否进入玩家视野 =====
  const wakeUp: DormantMob[] = [];
  const stillDormant: DormantMob[] = [];
  for (const d of world.dormantMobs) {
    let inView = false;
    for (const pos of playerPositions) {
      const dx = d.x - pos.x;
      const dy = d.y - pos.y;
      if (dx * dx + dy * dy < VIEW_RADIUS_SQ) {
        inView = true;
        break;
      }
    }
    if (inView) {
      wakeUp.push(d);
    } else {
      stillDormant.push(d);
    }
  }
  world.dormantMobs = stillDormant;

  // 唤醒生物：恢复完整状态
  for (const d of wakeUp) {
    const mob = new Mob(this.nextId++, d.type, mapId, d.x, d.y, d.rarity);
    mob.hp = d.health;
    mob.maxHp = d.maxHealth;
    mob.vx = d.vx;
    mob.vy = d.vy;
    mob.lastHitBy = d.lastHitBy;
    for (const [pid, dmg] of d.damageByPlayer) {
      mob.damageByPlayer.set(pid, dmg);
    }
    for (const t of d.spawnedThresholds) {
      mob.spawnedThresholds.add(t);
    }
    world.mobs.push(mob);
    // 增加该区块计数
    this.incZoneCount(mapId, this.zoneAt(mapId, mob.x, mob.y));
  }

  // ===== 更新所有活跃生物 =====
  // 区域划分：只有玩家所在区域及其相邻区域的生物才进行完整更新
  const REGION_SIZE = 2000; // 每个区域 2000x2000 像素
  const playerRegionKeys = new Set<string>();
  for (const pos of playerPositions) {
    const rx = Math.floor(pos.x / REGION_SIZE);
    const ry = Math.floor(pos.y / REGION_SIZE);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        playerRegionKeys.add(`${rx + dx},${ry + dy}`);
      }
    }
  }
  for (let i = world.mobs.length - 1; i >= 0; i--) {
    const mob = world.mobs[i];

    // ===== 视野内的生物：完整更新 =====
    mob.hitCd = Math.max(0, mob.hitCd - dt);
    mob.spawnProtection = Math.max(0, mob.spawnProtection - dt);
    mob.thinkTimer -= dt;

    // 区域检查：仅玩家所在区域及其相邻区域的生物做完整更新
    const mobRegionKey = `${Math.floor(mob.x / REGION_SIZE)},${Math.floor(mob.y / REGION_SIZE)}`;
    const inPlayerRegion = playerRegionKeys.has(mobRegionKey);

    // 非玩家区域生物：仅做基础维护，跳过目标寻找和复杂决策
    if (!inPlayerRegion) {
      // 基础移动（减速漂移）
      if (mob.speed > 0) {
        mob.vx *= 0.98;
        mob.vy *= 0.98;
      }
      // 基础移动（减速漂移）
      if (mob.speed > 0 && mob.targetId !== 0) {
        mob.vx += ((Math.cos(mob.angle) * mob.speed * 0.3 - mob.vx)) * Math.min(1, dt * 1.5);
        mob.vy += ((Math.sin(mob.angle) * mob.speed * 0.3 - mob.vy)) * Math.min(1, dt * 1.5);
      } else if (mob.speed > 0) {
        mob.vx *= 0.95;
        mob.vy *= 0.95;
      } else {
        mob.vx *= 0.9;
        mob.vy *= 0.9;
      }
      // 位置更新
      mob.x += mob.vx * dt;
      mob.y += mob.vy * dt;
      mob.x = clamp(mob.x, mob.radius, map.width - mob.radius);
      mob.y = clamp(mob.y, mob.radius, map.height - mob.radius);
      // ---- 墙壁碰撞已迁移到 C++ 服务器 ----
      // 死亡检查（非活跃区域生物仍需要清理）
      if (mob.hp <= 0) {
        if (!mob.friendly) { this.decZoneCount(mapId, this.zoneAt(mapId, mob.x, mob.y)); }
        world.mobs.splice(i, 1);
        if (mob.friendly && mob.ownerSlot >= 0) {
          const owner = here.find(p => p.id === mob.ownerId);
          if (owner) owner.pets[mob.ownerSlot] = (owner.pets[mob.ownerSlot] || []).filter(m => m !== mob);
        }
      }
      continue;
    }

    // ---- 目标寻找（降频至每 MOB_THINK_INTERVAL 秒） ----
    let target: { x: number; y: number; id: number } | null = null;
    let best = Infinity;

    if (mob.thinkTimer <= 0) {
      mob.thinkTimer = MOB_THINK_INTERVAL + Math.random() * 0.05; // 0.2s + 随机偏移，错开各生物

      if (mob.friendly) {
        for (const other of world.mobs) {
          if (!other.friendly) {
            const d = Math.hypot(other.x - mob.x, other.y - mob.y);
            if (d < 520 && d < best) { best = d; target = other; }
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
          if (d < 460 && d < best) { best = d; target = { x: p.x, y: p.y, id: p.id }; }
        }
        for (const other of world.mobs) {
          if (other.friendly) {
            const d = Math.hypot(other.x - mob.x, other.y - mob.y);
            if (d < 380 && d < best) { best = d; target = other; }
          }
        }
      }
      // 缓存目标
      if (target) {
        mob.targetId = target.id;
        mob.cachedTargetX = target.x;
        mob.cachedTargetY = target.y;
      } else {
        mob.targetId = 0;
      }
    } else {
      // 降频帧：复用缓存目标
      if (mob.targetId !== 0) {
        // 尝试从当前玩家列表中找到目标
        if (mob.friendly) {
          const other = world.mobs.find(m => m.id === mob.targetId && !m.friendly && m.hp > 0);
          if (other) {
            target = { x: other.x, y: other.y, id: other.id };
          } else {
            const owner = here.find((p) => p.id === mob.ownerId);
            if (owner) target = { x: owner.x, y: owner.y, id: owner.id };
            else mob.targetId = 0;
          }
        } else {
          const pTarget = here.find(p => p.id === mob.targetId);
          if (pTarget) {
            target = { x: pTarget.x, y: pTarget.y, id: pTarget.id };
          } else {
            const other = world.mobs.find(m => m.id === mob.targetId && m.friendly && m.hp > 0);
            if (other) target = { x: other.x, y: other.y, id: other.id };
            else mob.targetId = 0;
          }
        }
      }
    }

    // ---- 移动 ----
    if (target && mob.speed > 0) {
      const dx = target.x - mob.x, dy = target.y - mob.y, d = Math.hypot(dx, dy) || 1;
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

    // ---- 位置更新 ----
    mob.x += mob.vx * dt;
    mob.y += mob.vy * dt;
    mob.x = clamp(mob.x, mob.radius, map.width - mob.radius);
    mob.y = clamp(mob.y, mob.radius, map.height - mob.radius);

    // ---- 墙壁碰撞已迁移到 C++ 服务器 ----

    // ---- Hornet 远程攻击：朝玩家发射导弹（身体已通过 mob.angle 转向目标）----
    // Hornet（type 16）有目标玩家且在射程内时，每隔 HORNET_MISSILE_INTERVAL 秒
    // 朝目标方向发射一枚导弹。导弹由 Projectile 系统统一更新与渲染。
    if (mob.type === 16 && target && !mob.friendly) {
      mob.missileTimer -= dt;
      if (mob.missileTimer <= 0) {
        const tdx = target.x - mob.x;
        const tdy = target.y - mob.y;
        const tdist = Math.hypot(tdx, tdy);
        if (tdist < HORNET_MISSILE_RANGE) {
          mob.missileTimer = HORNET_MISSILE_INTERVAL;
          // 身体转向目标（确保发射时朝向玩家）
          mob.angle = Math.atan2(tdy, tdx);
          // 发射点略前移，避免出生即撞自身
          const muzzleX = mob.x + Math.cos(mob.angle) * (mob.radius + 6);
          const muzzleY = mob.y + Math.sin(mob.angle) * (mob.radius + 6);
          // 伤害随稀有度递增
          const dmg = mob.damage * 0.6 * (1 + mob.rarity * 0.25);
          this.fireProjectile(
            mapId,
            muzzleX,
            muzzleY,
            mob.angle,
            MISSILE_SPEED,
            dmg,
            TEAM.HOSTILE,
            mob.id,
            mob.type,
            mob.rarity,
            10,
          );
        }
      }
    }

    // ---- Scorpion 远程攻击：发射穿透性毒针（穿墙、穿目标，按距离/血量销毁）----
    // Scorpion 有目标玩家且在射程内时，每隔 SCORPION_MISSILE_INTERVAL 秒
    // 朝目标方向发射一枚穿透毒针。毒针可穿墙、穿生物/玩家/花瓣，
    // 每次命中扣减自身 1 点血量，飞行超过 SCORPION_PROJECTILE_MAX_DISTANCE 自动销毁。
    if (mob.type === SCORPION_TYPE && target && !mob.friendly) {
      mob.missileTimer -= dt;
      if (mob.missileTimer <= 0) {
        const tdx = target.x - mob.x;
        const tdy = target.y - mob.y;
        const tdist = Math.hypot(tdx, tdy);
        if (tdist < SCORPION_MISSILE_RANGE) {
          mob.missileTimer = SCORPION_MISSILE_INTERVAL;
          mob.angle = Math.atan2(tdy, tdx);
          const muzzleX = mob.x + Math.cos(mob.angle) * (mob.radius + 6);
          const muzzleY = mob.y + Math.sin(mob.angle) * (mob.radius + 6);
          const dmg = mob.damage * 0.5 * (1 + mob.rarity * 0.2);
          this.fireProjectile(
            mapId,
            muzzleX,
            muzzleY,
            mob.angle,
            SCORPION_MISSILE_SPEED,
            dmg,
            TEAM.HOSTILE,
            mob.id,
            mob.type,
            mob.rarity,
            8,
            true,                       // isPiercing = true（穿墙穿目标）
            SCORPION_PROJECTILE_MAX_DISTANCE, // maxDistance = 1000px
            Math.round(SCORPION_PROJECTILE_BASE_HP * rarityMult(mob.rarity)),
          );
        }
      }
    }

    // ---- 生物间碰撞 / 生物攻击玩家 已迁移到 C++ 服务器 ----

    // ---- Spawner 逻辑 ----
    if (!mob.friendly) {
      const mobDef = MOBS[mob.type];
      if (mobDef.spawner) {
        const hpPct = mob.hp / mob.maxHp;
        for (const threshold of mobDef.spawner.thresholds) {
          if (hpPct <= threshold && !mob.spawnedThresholds.has(threshold)) {
            mob.spawnedThresholds.add(threshold);
            for (const spawnId of mobDef.spawner.spawnMobs(mob.rarity)) {
              const spawnDef = MOBS[spawnId];
              if (!spawnDef) continue;
              // 碰撞已迁移到 C++ 服务器，生成位置不做墙壁碰撞检测
              const angle = Math.random() * Math.PI * 2;
              const dist = mob.radius + spawnDef.radius + 12 + Math.random() * 28;
              const sx = clamp(mob.x + Math.cos(angle) * dist, spawnDef.radius + 4, map.width - spawnDef.radius - 4);
              const sy = clamp(mob.y + Math.sin(angle) * dist, spawnDef.radius + 4, map.height - spawnDef.radius - 4);
              // 【原始逻辑】巢穴衍生物不受区块上限限制，按阈值正常生成
              world.mobs.push(new Mob(this.nextId++, spawnId, mapId, sx, sy, mob.rarity));
            }
          }
        }
      }
    }

    // ---- 死亡处理 ----
    if (mob.hp <= 0) {
      // 减少该区块计数（非友好生物才计入区块限制）
      if (!mob.friendly) {
        this.decZoneCount(mapId, this.zoneAt(mapId, mob.x, mob.y));
      }
      world.mobs.splice(i, 1);
      if (mob.friendly) {
        const owner = here.find((p) => p.id === mob.ownerId);
        if (owner && mob.ownerSlot >= 0) {
          owner.pets[mob.ownerSlot] = (owner.pets[mob.ownerSlot] || []).filter((m) => m !== mob);
        }
        continue;
      }
      this.onMobKilled(mob, mapId);
      continue;
    }
  }

  // ---- 掉落物更新 ----
  for (let i = world.drops.length - 1; i >= 0; i--) {
    const d = world.drops[i];
    d.ttl -= dt;
    if (d.groundTimer > 0) {
      d.groundTimer = Math.max(0, d.groundTimer - dt);
    }
    if (d.suctionTimer > 0) {
      d.suctionTimer = Math.max(0, d.suctionTimer - dt);
    }
    if (d.ttl <= 0) world.drops.splice(i, 1);
  }

  // ---- 生成新生物 ----
  // 生成逻辑改为每 ZONE_REFILL_INTERVAL 秒由 refillZoneMobs() 统一检查：
  // 区块达到 ZONE_MOB_LIMITS 上限时不再生成，只有生物减少后才补生。
}
  private setBonusStatus(p: Player, multiplier: number, seconds: number) {
    const safeMultiplier = Math.max(1, Math.min(5, Math.floor(multiplier)));
    const safeSeconds = Math.max(0, Math.min(60 * 60, Math.floor(seconds)));
    p.bonusMultiplier = safeSeconds > 0 ? safeMultiplier : 1;
    p.bonusEndsAt = safeSeconds > 0 ? Date.now() + safeSeconds * 1000 : 0;
  }

  private dropMultiplierFor(p: Player | null): number {
    if (!p || p.bonusEndsAt <= Date.now()) return 1;
    return p.bonusMultiplier;
  }

  private magicCoreRarity(p: Player | null): number {
    if (!p || MAGIC_CORE_ITEM < 0) return -1;
    let best = -1;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = p.slots[i];
      if (cell && cell.item === MAGIC_CORE_ITEM && cell.rarity > best) best = cell.rarity;
    }
    return best;
  }

  private computeEligibleLooters(mob: Mob): Set<number> {
    const eligible = new Set<number>();
    const maxHp = mob.maxHp > 0 ? mob.maxHp : 1;
    const perPlayerThreshold = maxHp * 0.05;
    const playerToSquadCode = new Map<number, string>();
    for (const [code, squad] of this.squads.entries()) { for (const pid of squad.members.keys()) playerToSquadCode.set(pid, code); }
    for (const squad of this.squads.values()) {
      const memberIds = Array.from(squad.members.keys());
      if (memberIds.length === 0) continue;
      let total = 0;
      for (const pid of memberIds) total += mob.damageByPlayer.get(pid) || 0;
      const required = perPlayerThreshold * memberIds.length;
      if (total >= required) { for (const pid of memberIds) eligible.add(pid); }
    }
    for (const [pid, dmg] of mob.damageByPlayer.entries()) {
      if (playerToSquadCode.has(pid)) continue;
      if (dmg >= perPlayerThreshold) eligible.add(pid);
    }
    return eligible;
  }

  private onMobKilled(mob: Mob, mapId: number) {
    if (mob.friendly) return;
    const def = MOBS[mob.type];
    const world = this.worlds[mapId];
    const killerClient = mob.lastHitBy ? this.clientOf(mob.lastHitBy) : null;
    const killer = killerClient?.player ?? null;
    if (killer) {
      const xp = Math.round(def.xp * (1 + mob.rarity * 0.9));
      killer.xp += xp; this.applyLevel(killer); killer.statsDirty = true;
      this.pushEvent(killerClient!, EVT.XP, mob.x, mob.y, xp);
      this.pushEvent(killerClient!, EVT.KILL, mob.x, mob.y, mob.type, EMPTY_ITEM, mob.rarity);
    }

    // Ultra+ rarity kill announcement in chat
    const ULTRA_RARITY_INDEX = RARITIES.findIndex(r => r.name === "Ultra");
    if (mob.rarity >= ULTRA_RARITY_INDEX && ULTRA_RARITY_INDEX >= 0) {
      let maxDamage = 0;
      let topPlayerId = 0;
      for (const [pid, dmg] of mob.damageByPlayer.entries()) {
        if (dmg > maxDamage) {
          maxDamage = dmg;
          topPlayerId = pid;
        }
      }
      if (topPlayerId > 0) {
        const topClient = this.clientOf(topPlayerId);
        const topPlayer = topClient?.player;
        if (topPlayer) {
// 保留2位小数，上限 100.00
const damagePercent = Math.min(1, maxDamage / Math.max(1, mob.maxHp));
const percentDisplay = (damagePercent * 100).toFixed(2); // "87.35" 或 "100.00"
          const mobRarityName = RARITIES[mob.rarity]?.name ?? "Unknown";
           const mobName = MOBS[mob.type]?.name ?? "Unknown";
          const message = `a ${mobRarityName} ${mobName} has been defeated by ${topPlayer.name} with ${percentDisplay}% damage!`;
          for (const c of this.clients.values()) {
            if (c.player && c.player.mapId === mapId) {
              this.sendChatToClient(c, message, "System", true, false);
            }
          }
        }
      }
    }

    if (world.drops.length >= MAX_DROPPED_CARDS) { world.drops.splice(0, DROP_TRIM_COUNT); }
    const mobRarityIndex = Math.max(0, Math.min(MAX_RARITY, mob.rarity));
    const mobRarityName = RARITIES[mobRarityIndex].name;
    const rarityIndexOf = (name: string) => Math.max(0, Math.min(MAX_RARITY, RARITIES.findIndex((r) => r.name === name)));
    // Per-player loot: each eligible looter gets their own private copy of every
    // drop. Non-squad players only see their own drops; squad members each get
    // an independent copy so everyone gets loot without stealing.
    const eligibleLooters = this.computeEligibleLooters(mob);
    if (eligibleLooters.size === 0) return;
    for (const looterId of eligibleLooters) {
      const looterClient = this.clientOf(looterId);
      const looterPlayer = looterClient?.player ?? null;
      const looterDropMult = this.dropMultiplierFor(looterPlayer);
      const looterCoreRarity = this.magicCoreRarity(looterPlayer);
      const rolled: { item: number; rarity: number; dropNum: number }[] = [];
      for (const drop of def.drops) {
        for (let i = 0; i < looterDropMult; i++) {
          let item = drop.item;
          let rarity = rarityIndexOf(getDropRarityByItem(drop.item, mobRarityName, drop.chance));
          const magicItem = MAGIC_ITEM_MAP[drop.item];
          if (magicItem !== undefined && looterCoreRarity >= 0) {
            const magicRarity = rarityIndexOf(getDropRarityByItem(magicItem, mobRarityName, drop.chance));
            if (magicRarity > 0) { item = magicItem; rarity = Math.min(magicRarity, looterCoreRarity); }
          }
          rolled.push({ item, rarity, dropNum: i });
        }
      }
      rolled.forEach((roll) => {
        const angle = Math.random() * Math.PI * 2;
        const distance = (Math.random() * 20 + 10) * (1 + roll.dropNum * 0.5);
        const x = mob.x + Math.cos(angle) * distance;
        const y = mob.y + Math.sin(angle) * distance;
        // Private drop: only this looter can see and loot it.
        this.spawnDrop(mapId, roll.item, roll.rarity, x, y, looterId, new Set([looterId]));
      });
    }
  }

  private setsEqual(a: Set<number> | null, b: Set<number> | null): boolean {
    if (a === b) return true; if (!a || !b) return false; if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }

  private spawnDrop(mapId: number, item: number, rarity: number, x: number, y: number, ownerId: number, allowed: Set<number> | null = null) {
    const world = this.worlds[mapId];
    for (const d of world.drops) {
      if (d.item !== item || d.rarity !== rarity || d.count >= DROP_STACK_MAX) continue;
      if (Math.hypot(d.x - x, d.y - y) > DROP_STACK_RADIUS) continue;
      if (!this.setsEqual(d.allowedPlayerIds, allowed)) continue;
      d.count++; d.ttl = Math.max(d.ttl, 45);
      d.groundTimer = 0.8;
      d.suctionTimer = 0;
      if (d.ownerId !== ownerId) d.ownerId = 0;
      return;
    }
    const nd = new Drop(this.nextId++, mapId, x, y, item, rarity, ownerId);
    nd.allowedPlayerIds = allowed ? new Set(allowed) : null;
    world.drops.push(nd);
  }

  private killPlayer(p: Player) {
    p.alive = false; p.hp = 0; p.shield = 0; p.statsDirty = true;
    // 保存死亡位置，用于死亡后仍然更新该位置周围的生物
    p.deathX = p.x; p.deathY = p.y;
    const world = this.worlds[p.mapId];
    world.mobs = world.mobs.filter((m) => m.ownerId !== p.id);
    for (let i = 0; i < SLOT_COUNT; i++) p.pets[i] = [];
    // 死亡时清除身上可能残留的毒伤(防止 map key 一直挂着死掉的 player 引用)
    this.poisonManager.clearPoison(p);
    const c = this.clientOf(p.id);
    if (c) this.pushEvent(c, EVT.DEATH, p.x, p.y, p.level);
  }

  private magnetRangeFor(p: Player): number {
    const MAGNET_RARITY_BONUS = [0, 1, 1.2, 2, 2.5, 3, 4.5, 6, 9, 14, 14];
    let total = 0;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = p.slots[i];
      if (!cell) continue;
      const def = ITEMS[cell.item];
      if (!def.magnetRange) continue;
      const st = p.petals[i];
      if (st && !st.alive) continue;
      const bonus = MAGNET_RARITY_BONUS[Math.min(cell.rarity, MAGNET_RARITY_BONUS.length - 1)] ?? 0;
      total += Math.round(def.magnetRange + bonus * 150);
    }
    return total;
  }

  private pickupDrops(p: Player, dt: number) {
    if (!p.alive) return;
    const world = this.worlds[p.mapId];
    const magnetRange = this.magnetRangeFor(p);
    let looted = 0;
    for (let i = world.drops.length - 1; i >= 0; i--) {
      const d = world.drops[i];
      // Per-player filtering: if the drop has an allow-list, only that player
      // can see and loot it. null = legacy/anyone (shouldn't happen in new code).
      if (d.allowedPlayerIds !== null && d.allowedPlayerIds !== undefined && !d.allowedPlayerIds.has(p.id)) continue;

      // 地面停留期间：不可被 magnet 影响，也不可拾取
      if (d.groundTimer > 0) continue;

      const dist = Math.hypot(d.x - p.x, d.y - p.y);

      // Magnet 快速吸取：0.5 秒直达玩家中心
      if (magnetRange > 0 && dist < magnetRange) {
        if (d.suctionTimer <= 0) {
          d.suctionTimer = 0.2;
        }
        const move = dist * dt / Math.max(d.suctionTimer, dt);
        if (dist > 0.001) {
          d.x += ((p.x - d.x) / dist) * move;
          d.y += ((p.y - d.y) / dist) * move;
        }

        // 吸取到达或足够近时自动拾取
        if (dist < 20 || d.suctionTimer <= dt) {
          if (this.addItem(p, d.item, d.rarity, d.count)) {
            world.drops.splice(i, 1);
            const c = this.clientOf(p.id);
            if (c) this.pushEvent(c, EVT.LOOT, p.x, p.y - (looted++ % 3) * 18, 0, d.item, d.rarity);
          }
          continue;
        }
      } else {
        // 离开 magnet 范围，重置吸取状态
        d.suctionTimer = 0;
      }

      // 无 magnet 时的正常拾取
      if (dist < 50) {
        if (this.addItem(p, d.item, d.rarity, d.count)) {
          world.drops.splice(i, 1);
          const c = this.clientOf(p.id);
          if (c) this.pushEvent(c, EVT.LOOT, d.x, d.y - (looted++ % 3) * 18, 0, d.item, d.rarity);
        }
      }
    }
  }

  // ----------------------------------------------------- projectile system
  /**
   * 弹射物系统更新：生物与花瓣共用。
   *
   * 处理流程：
   *  1. 存活时间衰减，到期销毁；
   *  2. 位置积分（vx/vy * dt）；
   *  3. 墙壁碰撞——撞墙即销毁（导弹类不穿透墙壁）；
   *  4. 边界检查——越界销毁；
   *  5. 命中判定——按 team 区分目标：
   *     - TEAM.HOSTILE：命中玩家（含花瓣护盾）；
   *     - TEAM.FRIENDLY：命中敌对生物。
   *  6. 命中冷却递减。
   */
  // 弹射物碰撞逻辑已迁移到 C++ 服务器
  private updateProjectiles(mapId: number, dt: number, players: Player[]) {
    const world = this.worlds[mapId];
    const map = MAPS[mapId];
    const proj = world.projectiles;

    for (let i = proj.length - 1; i >= 0; i--) {
      const p = proj[i];
      // ---- TTL 衰减 ----
      p.ttl -= dt;
      if (p.ttl <= 0) {
        proj.splice(i, 1);
        continue;
      }

      // ---- 位置积分 + 距离累计 ----
      const prevX = p.x;
      const prevY = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.distanceTraveled += Math.hypot(p.x - prevX, p.y - prevY);
      if (p.maxDistance > 0 && p.distanceTraveled >= p.maxDistance) {
        proj.splice(i, 1);
        continue;
      }

      // ---- 边界检查 ----
      if (p.x < p.radius || p.x > map.width - p.radius || p.y < p.radius || p.y > map.height - p.radius) {
        proj.splice(i, 1);
        continue;
      }
    }
  }

  /**
   * 发射弹射物（生物与花瓣共用入口）。
   * @param mapId     地图 ID
   * @param x         发射点 X
   * @param y         发射点 Y
   * @param angle     发射方向（弧度）
   * @param speed     飞行速度（像素/秒）
   * @param damage    命中伤害
   * @param team      阵营（TEAM.HOSTILE / TEAM.FRIENDLY）
   * @param ownerId   发射者 ID（mob.id 或 player.id）
   * @param sourceType 发射来源类型（mob.type 或 item id）
   * @param rarity    稀有度
   * @param radius    碰撞半径
   */
  private fireProjectile(
    mapId: number,
    x: number,
    y: number,
    angle: number,
    speed: number,
    damage: number,
    team: number,
    ownerId: number,
    sourceType: number,
    rarity: number,
    radius = 10,
    isPiercing = false,
    maxDistance = 0,
    projHp = 1,
  ) {
    const world = this.worlds[mapId];
    world.projectiles.push(
      new Projectile(this.nextId++, mapId, x, y, angle, speed, damage, team, ownerId, sourceType, rarity, radius, isPiercing, maxDistance, projHp),
    );
  }

  // ------------------------------------------------------------ state sync
  private sendState(c: ClientState) {
    const p = c.player;
    if (!p) return;
    // 主页面(菜单)模式的玩家不需要世界快照,只接收背包/合成结果等
    // INVENTORY / STATS / 事件数据(见下方 dirty 分支)。
    if (!p.menuMode) {
    const world = this.worlds[p.mapId];
    const w = new Writer(64);
    w.u8(S2C.SNAPSHOT).u32(this.tickCount);
    let count = 0;
    const viewX = 1300;
    const viewY = 950;
    const inView = (x: number, y: number) => Math.abs(x - p.x) < viewX && Math.abs(y - p.y) < viewY;
    const body = new Writer(65536);
    for (const other of this.clients.values()) {
      const op = other.player;
      if (!op || op.mapId !== p.mapId || !op.alive) continue;
      if (op !== p && !inView(op.x, op.y)) continue;
      const opRadius = PLAYER_RADIUS + this.soilRadiusBonusOf(op);
      body.u8(ENT.PLAYER).u16(op.id).u8(op.flags).u8(op === p ? TEAM.SELF : TEAM.FRIENDLY)
        .i16(Math.round(op.x)).i16(Math.round(op.y))
        .u16(Math.round(((op.baseAngle % (Math.PI * 2)) / (Math.PI * 2)) * 65535))
        .u8(Math.round(opRadius)).u8(Math.round((op.hp / op.maxHp) * 255)).str(op.name);
      count++;
      for (let i = 0; i < SLOT_COUNT; i++) {
        const cell = op.slots[i];
        const st = op.petals[i];
        if (!cell || !st || !st.alive) continue;
        if (!orbitsAsPetal(ITEMS[cell.item].kind)) continue;
        body.u8(ENT.PETAL).u16(st.id).u8(cell.item).u8(cell.rarity)
          .i16(Math.round(st.x)).i16(Math.round(st.y)).u16(0)
          .u8(Math.round(ITEMS[cell.item].radius * (1 + cell.rarity * 0.06) * ((ITEMS[cell.item].name ?? "").toLowerCase().includes("moon") ? 4 : 1)))
          .u8(Math.round((st.hp / st.maxHp) * 255));
        count++;
      }
    }
    for (const mob of world.mobs) {
      if (!inView(mob.x, mob.y)) continue;
      body.u8(ENT.MOB).u16(mob.id).u8(mob.type)
        .u8(mob.friendly ? (mob.ownerId === p.id ? TEAM.SELF : TEAM.FRIENDLY) : TEAM.HOSTILE)
        .i16(Math.round(mob.x)).i16(Math.round(mob.y))
        .u16(Math.round((((mob.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2)) * 65535))
        .u16(Math.min(65535, Math.round(mob.radius)))
        .u8(Math.max(0, Math.round((mob.hp / mob.maxHp) * 255))).u8(mob.rarity);
      count++;
    }
    // Drops: only send those the player is allowed to see/loot.
    for (const d of world.drops) {
      if (!inView(d.x, d.y)) continue;
      // Per-player drops: skip this drop if the player is not in its allow-list.
      if (d.allowedPlayerIds !== null && d.allowedPlayerIds !== undefined && !d.allowedPlayerIds.has(p.id)) continue;
      // 正在被磁铁吸取（suctionTimer > 0）时，radius 字节最高位置 1；
      // 客户端据此只在"确定被吸"时才让掉落物缩小淡出。
      const dropRadius = d.suctionTimer > 0 ? (12 | 0x80) : 12;
      body.u8(ENT.DROP).u16(d.id).u8(d.item).u8(d.rarity)
        .i16(Math.round(d.x)).i16(Math.round(d.y)).u16(0).u8(dropRadius).u8(Math.min(255, d.count));
      count++;
    }
    // Projectiles: send to the client so it can render them. The client
    // filters by team (FRIENDLY for the owning player, HOSTILE for everyone).
    for (const proj of world.projectiles) {
      if (proj.mapId !== p.mapId) continue;
      if (!inView(proj.x, proj.y)) continue;
      body.u8(ENT.PROJECTILE)
        .u16(proj.id)
        .u8(proj.sourceType)
        .u8(proj.team)
        .i16(Math.round(proj.x))
        .i16(Math.round(proj.y))
        .u16(Math.round(((proj.angle % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2)) * 65535))
        .u8(Math.round(proj.radius))
        .u8(Math.max(0, Math.min(255, Math.round((proj.hp / Math.max(1, proj.maxHp)) * 255))))
        .u8(proj.rarity);
      count++;
    }
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = p.slots[i];
      const st = p.petals[i];
      const def = cell ? ITEMS[cell.item] : null;
      if (!cell || !st || !def || !orbitsAsPetal(def.kind) || st.alive) { body.u8(255); continue; }
      const total = def.reload > 0 ? def.reload : 1;
      body.u8(Math.round((1 - Math.max(0, Math.min(1, st.timer / total))) * 255));
    }
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = p.slots[i];
      const st = p.petals[i];
      if (!cell || !st || !st.alive) { body.u8(255); continue; }
      body.u8(Math.max(0, Math.min(255, Math.round((st.hp / Math.max(1, st.maxHp)) * 255))));
    }
    w.u16(count);
    const head = w.bytes(), tail = body.bytes();
    const packet = new Uint8Array(head.length + tail.length);
    packet.set(head, 0); packet.set(tail, head.length);
    c.send(packet);
    }
    if (p.dirty) {
      p.dirty = false;
      const iw = new Writer(256);
      iw.u8(S2C.INVENTORY).u8(SLOT_COUNT);
      for (const cell of p.slots) writeCell(iw, cell);
      iw.u8(SECONDARY_SLOT_COUNT);
      for (let i = 0; i < SECONDARY_SLOT_COUNT; i++) writeCell(iw, p.secondary[i] ?? null);
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
      const sw = new Writer(28);
      sw.u8(S2C.STATS).u32(p.xp).u16(p.level).u16(Math.max(0, Math.round(p.hp))).u16(Math.round(p.maxHp))
        .u8(p.mapId).u8(p.alive ? 1 : 0).u32(oracleSecLeft).u32(tradeSecLeft).u16(Math.max(0, Math.round(p.shield)));
      c.send(sw.bytes());
    }
    if (this.tickCount % 20 === 0) {
      // DEBUG payload: collision checks (u32), total entities (u16),
      // total players (u16), owning player's current move speed (f32, px/s).
      // Speed is the only per-player field — everything else is global —
      // so we put it at the tail to keep the legacy prefix stable for
      // older clients that ignore trailing bytes.
      const dw = new Writer(14);
      dw.u8(S2C.DEBUG)
        .u32(this.collisionCounter.n)
        .u16(Math.min(65535, this.entityCount()))
        .u16(Math.min(65535, this.playerCount()))
        .f32(p.currentSpeed);
      c.send(dw.bytes());
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
