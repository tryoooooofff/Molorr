/**
 * TALENT SYSTEM (客户端天赋树面板)
 * ------------------------------------------------------------
 * 天赋点来源：玩家等级（每级 1 点）。
 * 面板布局：左下角 500×600 硬裁剪区，中心为玩家花朵，
 * 7 条天赋分支以旋转星形绽开，滚轮/触摸拖动旋转视角。
 * 存档：localStorage("talent_system_v2")。
 *
 * 遵循 tsconfig（strict / ES2017 / isolatedModules），所有成员显式类型化。
 *
 * ─────────────────────────────────────────────────────────────
 * 2026-08 裁剪说明
 * 早先的 9 分支里有 `reloadTime`（重新读作「reload speed」）
 * 与 `fluidSpeed`。两者都没在 sim 里实际生效 ——
 * `reload` 分支本身已经按 1 − reduction 处理 reload 时长，
 * 不需要再叠一个乘子；fluid 是早期原型留下的字段，从未在
 * 任一调用点被读取。
 * 所以这两个分支在 v3 里被一并删除，UI 旋转星也收成 7 瓣。
 * 存档读路径里遇到旧版本的 `reloadTime` / `fluidSpeed` 等级
 * 会当作无效 key 忽略（不会破坏已有存档），但 getLevels()
 * 不再暴露这两个 key。
 * ─────────────────────────────────────────────────────────────
 */

import { CloudStorage } from "./storage";

// =====================================================================
// 宿主接口：GameClient 实现，天赋系统通过它读写玩家属性
// =====================================================================

/** 天赋系统所需的最小玩家属性视图（客户端服务器权威，故用读写回调）。 */
export interface TalentHost {
  /** 当前玩家等级（天赋点上限来源）。 */
  getLevel(): number;
  /** 当前生命值。 */
  getHp(): number;
  /** 当前最大生命值。 */
  getMaxHp(): number;
  /** 是否处于游戏场景（用于 load 后的延迟同步）。 */
  isInGame(): boolean;
  /** 玩家造成的身体接触伤害（无则返回 0）。 */
  getBodyDamage(): number;
  /** 宠物/召唤物列表（客户端为网络实体，通常为空）。 */
  getPetals(): TalentPetalLike[];
  /** 天赋加成应用后的回调（写回客户端可读字段，供渲染使用）。 */
  onTalentApplied?(b: TalentBonuses): void;
}

/** 客户端花瓣的最小结构（服务器权威，本地无此对象时为空数组）。 */
export interface TalentPetalLike {
  attackPower?: number;
  _basePetalAttack?: number;
  baseReloadTime?: number;
  reloadTime?: number;
}

/**
 * 天赋系统计算出的全部加成，供宿主写回/渲染。
 * 字段集必须和 sim.ts `TalentBonuses` + protocol.ts `TALENT_KEYS` 严格同步：
 * 服务器读取的 `TALENT_KEYS` 顺序就是这里的 wire 顺序，UI 上看到的星形
 * 顺序也由这张表驱动——任一处漂移都会导致模拟和服务端读到的等级对不上。
 */
export interface TalentBonuses {
  /** 减法：reload 时长直接扣掉这个比例（0..0.5）。 */
  reloadReduction: number;
  /** 乘子：花瓣伤害。 */
  petalDmgMult: number;
  /** 乘子：召唤物伤害。 */
  summonDmgMult: number;
  /** 乘子：召唤物最大生命。 */
  summonHpMult: number;
  /** 乘子：玩家最大生命。 */
  healthMult: number;
  /** 乘子：玩家移速。 */
  speedMult: number;
  /** 乘子：玩家身体接触伤害。 */
  bodyDamageMult: number;
}

// =====================================================================
// 天赋树内部数据结构
// =====================================================================

interface TalentNode {
  level: number;
  randAngleOffset: number;
  randDistOffset: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
}

interface TalentBranch {
  label: string;
  emoji: string;
  maxLevel: number;
  level: number;
  effect: number;
  desc: string;
  color: string;
  slotAngle: number;
  /** 当前旋转基角（每帧由 draw 更新）。 */
  baseAngle: number;
  /** 深度 0..1，<0.45 表示滑入背面压缩态（虚线束）。 */
  depth: number;
  nodes: TalentNode[];
}

interface TalentAnimation {
  x: number;
  y: number;
  start: number;
  duration: number;
  key: string;
  lv: number;
}

interface TalentParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

interface NodeRect {
  x: number;
  y: number;
  r: number;
  key: string;
  lv: number;
}

type Rect4 = [number, number, number, number];

// =====================================================================
// TalentSystem
// =====================================================================

export class TalentSystem {
  private host: TalentHost | null;
  private panelOpen = false;
  private talentPoints = 0;
  private hoveredNode: string | null = null;
  private panelX = 10;
  private panelY = window.innerHeight / 5;

  // ── 手机适配：响应式缩放因子 ──
  /** 当前绘制缩放比例（1.0 = 原始大小，手机端自动 <1）。 */
  private _scale = 1;

  // ── 面板区域大小 ──
  private readonly W = 500;
  private readonly H = 600;

  // ── 旋转及物理控制 ──
  private rot = 0;
  private rotTarget = 0;
  private readonly NODE_RADIUS = 22;
  private readonly MIN_DIST = this.NODE_RADIUS * 2 + 10;
  private readonly TOP_PADDING = this.NODE_RADIUS + 6;

  // ── 动画与粒子存储 ──
  private animations: TalentAnimation[] = [];
  private particles: TalentParticle[] = [];
  private _nodeRects: Record<string, NodeRect> = {};
  private _btnRects: Record<string, Rect4> = {};

  // ── 鼠标/触摸状态 ──
  private mouseX = 0;
  private mouseY = 0;
  private _lastTouchY: number | null = null;
  private _isDragging = false;

  // ── 等级同步 ──
  private _pendingSync = false;

  // ── 原始天赋树数据定义 ──
  // 7 分支（v3）：reload / petalDamage / summonDamage / summonHealth / health / speed / bodyDamage
  // 删除了 v2 的 reloadTime + fluidSpeed（见文件头说明）。
  private trees: Record<string, TalentBranch> = {
    reload:       { label: "Reload",     emoji: "RED", maxLevel: 7, level: 0, effect: 0.05, desc: "–5% reload time per level",   color: "", slotAngle: 0, baseAngle: 0, depth: 0, nodes: [] },
    petalDamage:  { label: "Petal Dmg",  emoji: "DMG", maxLevel: 7, level: 0, effect: 0.05, desc: "+5% petal damage per level",  color: "", slotAngle: 0, baseAngle: 0, depth: 0, nodes: [] },
    summonDamage: { label: "Summon Dmg", emoji: "SDM", maxLevel: 7, level: 0, effect: 0.05, desc: "+5% summon damage per level", color: "", slotAngle: 0, baseAngle: 0, depth: 0, nodes: [] },
    summonHealth: { label: "Summon HP",  emoji: "SHP", maxLevel: 7, level: 0, effect: 0.05, desc: "+5% summon health per level", color: "", slotAngle: 0, baseAngle: 0, depth: 0, nodes: [] },
    health:       { label: "Health",     emoji: "HP",  maxLevel: 7, level: 0, effect: 0.05, desc: "+5% max health per level",    color: "", slotAngle: 0, baseAngle: 0, depth: 0, nodes: [] },
    speed:        { label: "Speed",      emoji: "SPE", maxLevel: 7, level: 0, effect: 0.05, desc: "+5% move speed per level",    color: "", slotAngle: 0, baseAngle: 0, depth: 0, nodes: [] },
    bodyDamage:   { label: "Body Dmg",   emoji: "BDY", maxLevel: 7, level: 0, effect: 0.04, desc: "+4% body damage per level",   color: "", slotAngle: 0, baseAngle: 0, depth: 0, nodes: [] },
  };

  private readonly TIER_PALETTES: (null | { fill: string; glow: string })[] = [
    null,
    { fill: "#1a5c2a", glow: "#2ecc71" },
    { fill: "#1a3a6a", glow: "#3498db" },
    { fill: "#2a1a5a", glow: "#9b59b6" },
    { fill: "#5a3a00", glow: "#f39c12" },
    { fill: "#5a0000", glow: "#e74c3c" },
  ];

  constructor(host: TalentHost | null = null) {
    this.host = host;
    const keys = Object.keys(this.trees);
    const numTrees = keys.length;

    // 注入确定性伪随机种子：赋予每个点独特的随机生长个性
    keys.forEach((key, i) => {
      const branch = this.trees[key];
      const branchSeed = i * 45;
      branch.color = this._getThemeColor(key);
      branch.slotAngle = Math.PI / 2 + (i - (numTrees - 1) / 2) * (6 * Math.PI / 180);
      for (let lv = 1; lv <= 7; lv++) {
        branch.nodes.push({
          level: lv,
          randAngleOffset: (this._seededRandom(branchSeed + lv * 12) - 0.5) * 1.0,
          randDistOffset: (this._seededRandom(branchSeed + lv * 77) - 0.5) * 40,
          x: this.W / 2,
          y: this.H - 70,
          targetX: this.W / 2,
          targetY: this.H - 70,
        });
      }
    });

    this.load();
  }

  // ──────────────────────────────────────────────────
  // 确定性随机数生成器
  // ──────────────────────────────────────────────────
  private _seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  private _getThemeColor(key: string): string {
    // 7 分支配色（v3）。reloadTime / fluidSpeed 已删除，不再分配颜色。
    const colors: Record<string, string> = {
      reload: "#b085e6", petalDamage: "#61cb85", summonDamage: "#46cdcf",
      summonHealth: "#8ca1ad", health: "#3d72de", speed: "#e36387",
      bodyDamage: "#ff6b6b",
    };
    return colors[key] || "#ffffff";
  }

  // ──────────────────────────────────────────────────
  // 手机适配：动态计算缩放与居中
  // ──────────────────────────────────────────────────
  /** 根据当前视口宽度和高度计算缩放比例，并在需要时自动居中面板。 */
  private _updateLayout(): void {
    const padding = 16;
    const availableWidth = window.innerWidth - padding * 2;
    const availableHeight = window.innerHeight - padding * 2;
    const desiredWidth = this.W;
    const desiredHeight = this.H;

    const scaleX = availableWidth / desiredWidth;
    const scaleY = availableHeight / desiredHeight;

    // 手机端判断：基于屏幕宽度和高度，任一维度不足即触发缩放适配
    if (scaleX < 1 || scaleY < 1) {
      this._scale = Math.min(scaleX, scaleY);
      this.panelX = Math.floor((window.innerWidth - desiredWidth * this._scale) / 2);
      this.panelY = Math.max(10, Math.floor((window.innerHeight - desiredHeight * this._scale) / 2));
    } else {
      this._scale = 1;
      this.panelX = 10;
      this.panelY = window.innerHeight / 5;
    }
  }

  // ──────────────────────────────────────────────────
  // Cost 逻辑与 Save / Load
  // ──────────────────────────────────────────────────
  getCostToLevel(lv: number): number {
    let t = 0;
    for (let i = 1; i <= lv; i++) t += 2 * i - 1;
    return t;
  }

  getNextLevelCost(lv: number): number {
    return lv >= 10 ? 0 : 2 * (lv + 1) - 1;
  }

  getTotalSpent(): number {
    return Object.values(this.trees).reduce((s, t) => s + this.getCostToLevel(t.level), 0);
  }

  getMaxTalentPointsForLevel(): number {
    return this.host?.getLevel() ?? 0;
  }

  getTierIndex(level: number): number {
    if (level === 0) return 0;
    if (level <= 2) return 1;
    if (level <= 4) return 2;
    if (level <= 6) return 3;
    if (level <= 8) return 4;
    return 5;
  }

  save(): void {
    const data = {
      talentPoints: this.talentPoints,
      trees: {} as Record<string, number>,
      version: 3,
    };
    for (const [k, t] of Object.entries(this.trees)) {
      data.trees[k] = t.level;
    }
    try {
      localStorage.setItem("talent_system_v2", JSON.stringify(data));
    } catch (e) {
      console.error("❌ 保存天赋失败:", e);
    }
    // Sync to cloud storage
    if (CloudStorage.isReady) {
      CloudStorage.instance.set("talent_system_v2", data);
    }
  }

  load(): void {
    try {
      const raw = localStorage.getItem("talent_system_v2") || localStorage.getItem("talent_system");
      if (!raw) {
        this.talentPoints = 0;
        return;
      }
      const data = JSON.parse(raw) as { talentPoints?: number; trees?: Record<string, number> };
      this.talentPoints = data.talentPoints || 0;
      for (const [k, v] of Object.entries(data.trees || {})) {
        // 仅接受当前 trees 里实际存在的 key —— 旧版本的 reloadTime /
        // fluidSpeed 等级会自然被忽略，不会回填到新分支。
        if (this.trees[k]) {
          this.trees[k].level = Math.min(v, this.trees[k].maxLevel);
        }
      }
      if (this.host?.isInGame()) {
        this.syncWithLevel();
      } else {
        this._pendingSync = true;
      }
    } catch (e) {
      console.error("❌ 加载天赋失败:", e);
      this.talentPoints = 0;
    }
  }

  /** 在游戏开始时调用（客户端进入 game 场景时）。 */
  onGameStart(): void {
    if (this._pendingSync) {
      this.syncWithLevel();
      this._pendingSync = false;
    }
  }

  syncWithLevel(): void {
    if (!this.host) return;
    const max = this.getMaxTalentPointsForLevel();
    const spent = this.getTotalSpent();
    if (spent > max) this.rollbackToPoints(max);
    const expected = max;
    const actual = this.talentPoints + this.getTotalSpent();
    if (actual !== expected) {
      this.talentPoints = Math.max(0, expected - this.getTotalSpent());
      this.save();
    }
    this.applyToPlayer();
  }

  rollbackToPoints(target: number): void {
    let spent = this.getTotalSpent();
    if (spent <= target) return;
    let refund = spent - target;
    const sorted = Object.entries(this.trees).sort((a, b) => b[1].level - a[1].level);
    for (const [, tree] of sorted) {
      while (tree.level > 0 && refund > 0) {
        const cost = this.getCostToLevel(tree.level) - this.getCostToLevel(tree.level - 1);
        if (refund >= cost) {
          tree.level--;
          refund -= cost;
        } else break;
      }
      if (refund <= 0) break;
    }
    this.save();
    this.applyToPlayer();
  }

  levelUp(key: string, requestedLevel: number): boolean {
    const tree = this.trees[key];
    if (!tree) return false;
    if (requestedLevel !== tree.level + 1) return false;
    if (tree.level >= tree.maxLevel) return false;

    const cost = this.getNextLevelCost(tree.level);
    if (this.talentPoints < cost) return false;
    if (this.getTotalSpent() + cost > this.getMaxTalentPointsForLevel()) return false;

    this.talentPoints -= cost;
    tree.level++;

    const nd = this._nodeRects[`${key}_${requestedLevel}`];
    if (nd) {
      this.animations.push({
        x: nd.x, y: nd.y,
        start: Date.now(),
        duration: 600,
        key, lv: requestedLevel,
      });
    }

    this.save();
    this.applyToPlayer();
    return true;
  }

  resetAll(): void {
    const max = this.getMaxTalentPointsForLevel();
    for (const t of Object.values(this.trees)) t.level = 0;
    this.talentPoints = max;
    this.save();
    this.applyToPlayer();
  }

  addPoints(n = 1): void {
    this.talentPoints += n;
    this.save();
  }

  onLevelUp(): void {
    this.addPoints(1);
    this.syncWithLevel();
  }

  // ──────────────────────────────────────────────────
  // 玩家属性加成映射引擎
  // ──────────────────────────────────────────────────
  applyToPlayer(): void {
    if (!this.host) return;

    // 7 分支 → TalentBonuses 字段顺序（与 sim.ts / protocol.ts 保持一致）。
    // reloadReduction 是「减法」语义：level × 0.05，封顶 0.5。
    const reloadLvl = this.trees.reload?.level ?? 0;
    const reloadReduction = Math.min(0.5, reloadLvl * (this.trees.reload?.effect ?? 0.05));

    const bonuses: TalentBonuses = {
      reloadReduction,
      petalDmgMult: 1 + (this.trees.petalDamage?.level ?? 0) * (this.trees.petalDamage?.effect ?? 0.05),
      summonDmgMult: 1 + (this.trees.summonDamage?.level ?? 0) * (this.trees.summonDamage?.effect ?? 0.05),
      summonHpMult: 1 + (this.trees.summonHealth?.level ?? 0) * (this.trees.summonHealth?.effect ?? 0.05),
      healthMult: 1 + (this.trees.health?.level ?? 0) * (this.trees.health?.effect ?? 0.05),
      speedMult: 1 + (this.trees.speed?.level ?? 0) * (this.trees.speed?.effect ?? 0.05),
      bodyDamageMult: 1 + (this.trees.bodyDamage?.level ?? 0) * (this.trees.bodyDamage?.effect ?? 0.04),
    };

    this.host.onTalentApplied?.(bonuses);
  }

  // ──────────────────────────────────────────────────
  // 高级空间物理防撞与隐藏多虚线分流引擎
  // ──────────────────────────────────────────────────
  private _updateEngine(cx: number, cy: number): void {
    const keys = Object.keys(this.trees);

    keys.forEach((key, ti) => {
      const branch = this.trees[key];
      const isDashed = branch.depth < 0.45;

      const isRightCorner = Math.cos(branch.baseAngle) > 0;
      const cornerBaseX = isRightCorner ? this.W - 10 : 10;
      const cornerBaseY = this.H - 10;

      branch.nodes.forEach((node, lv) => {
        if (isDashed) {
          const dashLen = lv * 12;
          node.targetX = cornerBaseX + Math.cos(branch.slotAngle) * dashLen * (isRightCorner ? -1 : 1);
          node.targetY = cornerBaseY - Math.abs(Math.sin(branch.slotAngle) * dashLen);
          node.x += (node.targetX - node.x) * 0.25;
          node.y += (node.targetY - node.y) * 0.25;
        } else {
          const finalRandomAngle = branch.baseAngle + node.randAngleOffset;
          const finalRandomDist = 70 + lv * 70 + node.randDistOffset;
          node.targetX = cx + Math.cos(finalRandomAngle) * finalRandomDist;
          node.targetY = cy + Math.sin(finalRandomAngle) * finalRandomDist;
          node.x += (node.targetX - node.x) * 0.15;
          node.y += (node.targetY - node.y) * 0.15;
        }
      });
    });

    // 2D 多体防碰撞纠偏迭代（仅卡住天花板和地板，左右交给全局 Clip 裁剪）
    for (let iter = 0; iter < 5; iter++) {
      keys.forEach(k1 => {
        const b1 = this.trees[k1];
        if (b1.depth < 0.45) return;
        b1.nodes.forEach(n1 => {
          if (n1.y < this.TOP_PADDING) n1.y = this.TOP_PADDING;
          if (n1.y > this.H - this.TOP_PADDING) n1.y = this.H - this.TOP_PADDING;

          keys.forEach(k2 => {
            const b2 = this.trees[k2];
            if (b2.depth < 0.45) return;
            b2.nodes.forEach(n2 => {
              if (n1 === n2) return;
              const dx = n2.x - n1.x;
              const dy = n2.y - n1.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < this.MIN_DIST && dist > 0) {
                const overlap = this.MIN_DIST - dist;
                const pushX = (dx / dist) * overlap * 0.5;
                const pushY = (dy / dist) * overlap * 0.5;
                n1.x -= pushX; n1.y -= pushY;
                n2.x += pushX; n2.y += pushY;
              }
            });
          });
        });
      });
    }
  }

  // ──────────────────────────────────────────────────
  // 动态链表无缝穿针引线渲染器
  // ──────────────────────────────────────────────────
  private _processAndDrawBranch(ctx: CanvasRenderingContext2D, cx: number, cy: number, branch: TalentBranch, now: number): void {
    const isDashed = branch.depth < 0.45;
    const branchKey = Object.keys(this.trees).find(k => this.trees[k] === branch) || "";
    const seed = Object.keys(this.trees).indexOf(branchKey) * 67;

    let prevX = cx;
    let prevY = cy;

    branch.nodes.forEach((pt, lv) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(prevX, prevY);

      if (isDashed) {
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
        ctx.lineWidth = 1.5;
        ctx.lineTo(pt.x, pt.y);
      } else {
        const isActive = pt.level <= branch.level;
        ctx.setLineDash([]);
        ctx.strokeStyle = isActive ? branch.color : "rgba(255, 255, 255, 0.7)";
        ctx.lineWidth = isActive ? 3.5 : 1.8;

        const ctrlX = (prevX + pt.x) / 2 + (this._seededRandom(seed + lv) - 0.5) * 15;
        const ctrlY = (prevY + pt.y) / 2 + (this._seededRandom(seed + lv + 1) - 0.5) * 15;
        ctx.quadraticCurveTo(ctrlX, ctrlY, pt.x, pt.y);
      }
      ctx.stroke();
      ctx.restore();

      prevX = pt.x;
      prevY = pt.y;
    });

    if (isDashed) return;

    branch.nodes.forEach((pt) => {
      const isActive = pt.level <= branch.level;
      const isNext = pt.level === branch.level + 1;

      let currentR = this.NODE_RADIUS;
      const activeAni = this.animations.find(a => a.key === branchKey && a.lv === pt.level);
      if (activeAni) {
        const elapsed = now - activeAni.start;
        const progress = Math.min(1, elapsed / activeAni.duration);
        currentR *= 1 + Math.sin(progress * Math.PI * 4) * 0.25;
      }

      this._drawNodeCircle(ctx, pt.x, pt.y, currentR, isActive, isNext, branch, pt.level);

      if (isNext || isActive) {
        this._nodeRects[`${branchKey}_${pt.level}`] = {
          x: pt.x, y: pt.y, r: currentR, key: branchKey, lv: pt.level,
        };
      }

      if (pt.level === branch.nodes.length) {
        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
        ctx.shadowBlur = 3;
        let textY = pt.y - currentR - 10;
        if (pt.y < 30) textY = pt.y + currentR + 12;
        ctx.fillText(branch.label, pt.x, textY);
        ctx.restore();
      }
    });
  }

  // ──────────────────────────────────────────────────
  // 原始渲染辅助函数群
  // ──────────────────────────────────────────────────
  private drawStrokedText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    fontSize = 20,
    textAlign: CanvasTextAlign = "center",
    fillColor = "white"
  ): void {
    ctx.save();
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = textAlign;
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "black";
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fillColor;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  private drawStyledButton(ctx: CanvasRenderingContext2D, text: string, rect: Rect4, baseColor: number[], fontSize = 16): void {
    const adj = (rgb: number[], f: number): number[] => rgb.map(c => Math.min(255, Math.max(0, Math.floor(c * f))));
    const [x, y, w, h] = rect;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fillStyle = `rgb(${baseColor.join(",")})`;
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.clip();
    ctx.fillStyle = `rgb(${adj(baseColor, 0.72).join(",")})`;
    ctx.fillRect(x, y, w, h / 2);
    ctx.restore();
    ctx.strokeStyle = `rgb(${adj(baseColor, 0.45).join(",")})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.stroke();
    if (text) this.drawStrokedText(ctx, text, x + w / 2, y + h / 2, fontSize);
  }

  /** 面板中心的玩家花朵：双层底色 + 极坐标眼睛追踪 + 血量嘴形。 */
  private _drawPlayerCenter(ctx: CanvasRenderingContext2D, x: number, y: number, mousePos: [number, number]): void {
    const r = 28;
    const p = this.host;

    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.fillStyle = "#999900";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, Math.PI * 2);
    ctx.fillStyle = "#F6E476";
    ctx.fill();

    let angle = 0;
    if (mousePos && Array.isArray(mousePos)) {
      angle = Math.atan2(mousePos[1] - this.panelY - y, mousePos[0] - this.panelX - x);
    }

    [{ x: x - 7, y: y - 5 }, { x: x + 7, y: y - 5 }].forEach(eye => {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(eye.x, eye.y, 2.5, 6, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#000000";
      ctx.fill();
      ctx.clip();

      ctx.beginPath();
      ctx.arc(eye.x + Math.cos(angle) * 1.5, eye.y + Math.sin(angle) * 3.0, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.restore();
    });

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    const maxHp = p?.getMaxHp() ?? 1;
    const hp = p?.getHp() ?? maxHp;
    const hpPct = maxHp > 0 ? hp / maxHp : 1.0;

    if (hpPct < 0.35) {
      // 低血量：悲伤嘴形（下弯弧线）
      ctx.arc(x, y + 14, 6, 1.2 * Math.PI, 1.8 * Math.PI);
    } else {
      ctx.arc(x, y + 5, 6, 0.2 * Math.PI, 0.8 * Math.PI);
    }
    ctx.stroke();
  }

  private _drawNodeCircle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    active: boolean,
    next: boolean,
    branch: TalentBranch,
    lv: number
  ): void {
    const tier = this.getTierIndex(lv);
    const pal = this.TIER_PALETTES[tier] ?? { fill: "#4a5b6a", glow: "#5b8fb9" };

    ctx.save();
    ctx.fillStyle = active ? pal.glow : (next ? "#7d8a95" : "#5d6a75");
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "white";
    ctx.strokeStyle = "white";
    ctx.lineWidth = 3 * (r / 18);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.globalAlpha = active ? 1 : 0.3;

    const symR = r * 0.65;
    const keyMap = Object.keys(this.trees).find(k => this.trees[k] === branch) || "";

    switch (keyMap) {
      case "summonHealth":
        ctx.beginPath();
        ctx.ellipse(0, 0, symR * 0.7, symR * 1.0, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case "summonDamage":
        ctx.beginPath();
        ctx.ellipse(0, 0, symR * 0.7, symR * 1.0, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case "reload":
        ctx.beginPath();
        ctx.arc(0, 0, symR * 0.8, -Math.PI / 4, Math.PI * 1.5, false);
        const arrowSize = symR * 0.3;
        ctx.moveTo(0, -symR * 0.8);
        ctx.lineTo(-arrowSize, -symR * 0.8 - arrowSize);
        ctx.moveTo(0, -symR * 0.8);
        ctx.lineTo(-arrowSize, -symR * 0.8 + arrowSize);
        ctx.stroke();
        break;
      case "bodyDamage":
        ctx.beginPath();
        ctx.moveTo(0, -symR);
        ctx.lineTo(symR * 0.75, -symR * 0.5);
        ctx.lineTo(symR * 0.75, symR * 0.1);
        ctx.quadraticCurveTo(symR * 0.4, symR * 0.85, 0, symR);
        ctx.quadraticCurveTo(-symR * 0.4, symR * 0.85, -symR * 0.75, symR * 0.1);
        ctx.lineTo(-symR * 0.75, -symR * 0.5);
        ctx.closePath();
        ctx.stroke();
        break;
      case "health":
        ctx.beginPath();
        ctx.moveTo(0, -symR);
        ctx.lineTo(0, symR);
        ctx.moveTo(-symR, 0);
        ctx.lineTo(symR, 0);
        ctx.stroke();
        break;
      case "speed":
        ctx.beginPath();
        {
          const barSpacing = symR * 0.8;
          for (let i = -1; i <= 1; i++) {
            ctx.moveTo(-symR * 0.8 + i * barSpacing * 0.5, symR * 0.8 + i * barSpacing * 0.5);
            ctx.lineTo(symR * 0.8 + i * barSpacing * 0.5, -symR * 0.8 + i * barSpacing * 0.5);
          }
        }
        ctx.stroke();
        break;
      case "petalDamage":
        ctx.beginPath();
        ctx.arc(0, 0, symR * 0.3, 0, Math.PI * 2);
        ctx.fill();
        break;
      default:
        ctx.font = `bold ${r * 0.8}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", 0, 0);
        break;
    }
    ctx.restore();

    if (active || next) {
      this.drawStrokedText(ctx, `${lv}`, x + r * 0.7, y - r * 0.7, 12, "center", active ? "#ff4444" : "#ffffff");
    }
    ctx.restore();
  }

  private _drawFixedUI(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    this.drawStrokedText(ctx, `${this.talentPoints}`, 35, 40, 36, "center", "white");
    this.drawStrokedText(ctx, "TP", 65, 40, 18, "left", "white");

    const maxHp = this.host?.getMaxHp() ?? 0;
    const bodyDamage = this.host?.getBodyDamage() ?? 0;
    this.drawStrokedText(ctx, `HP: ${Math.floor(maxHp).toLocaleString()}`, 20, H - 35, 14, "left", "#ff6666");
    this.drawStrokedText(ctx, `Body Dmg: ${Math.floor(bodyDamage).toLocaleString()}`, 20, H - 15, 14, "left", "#88aaff");

    const resetRect: Rect4 = [W - 95, H - 45, 80, 32];
    this._btnRects["reset"] = resetRect;
    this.drawStyledButton(ctx, "Reset", resetRect, [160, 80, 70], 14);

    const closeRect: Rect4 = [W - 45, 15, 30, 30];
    this._btnRects["close"] = closeRect;
    this.drawStyledButton(ctx, "✕", closeRect, [180, 100, 100], 16);
  }

  private _drawTooltip(ctx: CanvasRenderingContext2D, nd: NodeRect): void {
    const tree = this.trees[nd.key];
    if (!tree) return;
    const tw = 180;
    const th = 75;
    let tx = nd.x - tw / 2;
    let ty = nd.y - nd.r - th - 10;

    tx = Math.max(10, Math.min(this.W - tw - 10, tx));
    if (ty < 10) ty = nd.y + nd.r + 10;

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.68)";
    ctx.beginPath();
    ctx.roundRect(tx, ty, tw, th, 8);
    ctx.fill();
    this.drawStrokedText(ctx, tree.label, tx + tw / 2, ty + 15, 12, "center", "#ffffff");
    this.drawStrokedText(ctx, `Level: ${tree.level} / ${tree.maxLevel}`, tx + tw / 2, ty + 32, 10, "center", "#b085e6");
    this.drawStrokedText(ctx, tree.desc, tx + tw / 2, ty + 48, 9, "center", "#aaaaaa");
    if (tree.level < tree.maxLevel) {
      const cost = this.getNextLevelCost(tree.level);
      this.drawStrokedText(ctx, `Next: ${cost} TP`, tx + tw / 2, ty + 60, 10, "center", "#ffffff");
    } else {
      this.drawStrokedText(ctx, "MAXED", tx + tw / 2, ty + 60, 10, "center", "#ffffff");
    }
    ctx.restore();
  }

  // ──────────────────────────────────────────────────
  // 综合大一统 Draw 主周期函数
  // ──────────────────────────────────────────────────
  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.panelOpen) return;

    // 手机适配：每帧根据屏幕大小重新计算缩放与位置
    this._updateLayout();

    const now = Date.now();
    const cx = this.W / 2;
    const cy = this.H - 75;

    this.rot += (this.rotTarget - this.rot) * 0.15;
    this._nodeRects = {};
    const keys = Object.keys(this.trees);

    keys.forEach((key, i) => {
      const branch = this.trees[key];
      const baseAngle = this.rot + (i / keys.length) * Math.PI * 2 - Math.PI / 2 + Math.PI;
      const depth = (Math.sin(baseAngle - Math.PI) + 1) / 2;
      branch.baseAngle = baseAngle;
      branch.depth = depth;
    });

    this._updateEngine(cx, cy);

    // 开启全局独立图层，平移至左下角
    ctx.save();
    ctx.translate(this.panelX, this.panelY);

    // 手机适配：应用缩放（所有内部坐标保持 500×600 不变）
    ctx.scale(this._scale, this._scale);

    // 基于虚拟 500x600 的硬裁剪死区
    ctx.beginPath();
    ctx.rect(0, 0, this.W, this.H);
    ctx.clip();

    // 绘制粉红背景与暗红内衬边框
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.fillStyle = "#d3665a";
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.strokeStyle = "#A54C42";
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, this.W, this.H);

    // 后续渲染自动享受 translate 的加持
    const sortedBranches = [...Object.values(this.trees)].sort((a, b) => a.depth - b.depth);
    sortedBranches.forEach(branch => {
      this._processAndDrawBranch(ctx, cx, cy, branch, now);
    });

    this._drawPlayerCenter(ctx, cx, cy, [this.mouseX, this.mouseY]);

    // 动画和烟花粒子
    this.animations = this.animations.filter(ani => {
      const elapsed = now - ani.start;
      if (elapsed < ani.duration) return true;
      for (let i = 0; i < 12; i++) {
        const pAngle = (Math.PI * 2 / 12) * i;
        const pSpeed = 1.5 + Math.random() * 2.5;
        this.particles.push({
          x: ani.x, y: ani.y,
          vx: Math.cos(pAngle) * pSpeed,
          vy: Math.sin(pAngle) * pSpeed,
          life: 1.0,
          color: this._getThemeColor(ani.key),
        });
      }
      return false;
    });

    this.particles = this.particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12;
      p.life -= 0.03;
      if (p.life > 0) {
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return true;
      }
      return false;
    });

    this._drawFixedUI(ctx, this.W, this.H);

    if (this.hoveredNode && this._nodeRects[this.hoveredNode]) {
      this._drawTooltip(ctx, this._nodeRects[this.hoveredNode]);
    }

    ctx.restore(); // 释放 scale、裁剪区和平移矩阵
  }

  // ──────────────────────────────────────────────────
  // 精准重构的输入处理系统（支持触控、滚动旋转）
  // ──────────────────────────────────────────────────
  handleClick(pos: [number, number]): string | null {
    if (!this.panelOpen) return null;
    // 点击面板外 → 返回 null（宿主关闭面板），面板内点击才被面板消费。
    if (!this.contains(pos[0], pos[1])) return null;

    // 手机适配：屏幕坐标 → 虚拟坐标（除以缩放比例）
    const mx = (pos[0] - this.panelX) / this._scale;
    const my = (pos[1] - this.panelY) / this._scale;

    // 1. 优先检测功能按钮
    for (const [key, rect] of Object.entries(this._btnRects)) {
      const [bx, by, bw, bh] = rect;
      if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) {
        this.hoveredNode = null;
        if (key === "close") {
          this.panelOpen = false;
          return "talent_close";
        }
        if (key === "reset") {
          this.resetAll();
          return "talent_reset";
        }
      }
    }

    // 2. 节点两击升级判定
    for (const [id, nd] of Object.entries(this._nodeRects)) {
      const dx = mx - nd.x;
      const dy = my - nd.y;
      if (dx * dx + dy * dy <= nd.r * nd.r) {
        if (this.hoveredNode !== id) {
          this.hoveredNode = id;
          return "talent_select";
        }
        const ok = this.levelUp(nd.key, nd.lv);
        if (ok) {
          this.hoveredNode = null;
          return "talent_levelup";
        }
        return "talent_no_points";
      }
    }

    this.hoveredNode = null;
    return "talent_panel_click";
  }

  handleMouseMove(pos: [number, number]): void {
    if (!this.panelOpen) return;
    this.mouseX = pos[0];
    this.mouseY = pos[1];

    // 手机适配：屏幕坐标 → 虚拟坐标
    const mx = (pos[0] - this.panelX) / this._scale;
    const my = (pos[1] - this.panelY) / this._scale;

    for (const [key, rect] of Object.entries(this._btnRects)) {
      const [bx, by, bw, bh] = rect;
      if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) {
        this.hoveredNode = key;
        return;
      }
    }

    for (const [id, nd] of Object.entries(this._nodeRects)) {
      const dx = mx - nd.x;
      const dy = my - nd.y;
      if (dx * dx + dy * dy <= nd.r * nd.r) {
        this.hoveredNode = id;
        return;
      }
    }
    this.hoveredNode = null;
  }

  /** 将原来的 tilt 滚动全面转换为平滑的天赋旋转。 */
  handleScroll(deltaY: number): boolean {
    if (!this.panelOpen) return false;
    this.rotTarget -= deltaY * 0.003;
    return true;
  }

  handleTouchStart(y: number): boolean {
    if (!this.panelOpen) return false;
    this._lastTouchY = y;
    this._isDragging = true;
    return true;
  }

  handleTouchMove(y: number): boolean {
    if (!this.panelOpen || !this._isDragging) return false;
    if (this._lastTouchY !== null) {
      const dy = y - this._lastTouchY;
      this.handleScroll(-dy * 2.5);
    }
    this._lastTouchY = y;
    return true;
  }

  handleTouchEnd(): boolean {
    this._isDragging = false;
    this._lastTouchY = null;
    return true;
  }

  open(): void {
    this.panelOpen = true;
    this.rot = 0;
    this.rotTarget = 0;
  }

  close(): void {
    this.panelOpen = false;
  }

  toggle(): void {
    if (this.panelOpen) this.close();
    else this.open();
  }

  /** 面板是否打开（供 GameClient 输入路由判断）。 */
  get isOpen(): boolean {
    return this.panelOpen;
  }

  /** 面板区域（屏幕坐标 [x,y,w,h]），供点击判定。 */
  get panelRect(): Rect4 {
    // 手机适配：返回缩放后的实际屏幕占用
    return [this.panelX, this.panelY, this.W * this._scale, this.H * this._scale];
  }

  /** 面板是否包含某屏幕坐标（供滚轮/点击路由判断）。 */
  contains(sx: number, sy: number): boolean {
    // 手机适配：使用缩放后的实际边界
    return sx >= this.panelX && sx <= this.panelX + this.W * this._scale &&
           sy >= this.panelY && sy <= this.panelY + this.H * this._scale;
  }

  /** 天赋等级汇总（调试/存档展示用）。仅返回当前 trees 中实际存在的分支。 */
  getLevels(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, t] of Object.entries(this.trees)) out[k] = t.level;
    return out;
  }
}

/** 供宿主读取单件实例（GameClient 在构造时设置）。 */
export function createTalentSystem(host: TalentHost | null = null): TalentSystem {
  return new TalentSystem(host);
}