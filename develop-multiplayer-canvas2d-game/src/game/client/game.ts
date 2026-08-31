/**
 * CLIENT MAIN FILE
 * ----------------
 * Everything the player sees is painted with canvas2d (no DOM/CSS UI):
 * main menu, account panel, world, HUD, inventory bag, crafting panel,
 * drag & drop of item cards, panel/scene animations.
 */
 //IMPORTANT: always follow {   "compilerOptions": {     "target": "ES2017",     "lib": [       "dom",       "dom.iterable",       "esnext"     ],     "allowJs": false,     "skipLibCheck": true,     "strict": true,     "noEmit": true,     "esModuleInterop": true,     "module": "esnext",     "moduleResolution": "bundler",     "resolveJsonModule": true,     "isolatedModules": true,     "jsx": "react-jsx",     "incremental": true,     "baseUrl": ".",     "paths": {       "@/*": [         "./src/*"       ]     },     "plugins": [       {         "name": "next"       }     ]   },   "include": [     "next-env.d.ts",     "**/*.ts",     "**/*.tsx",     ".next/types/**/*.ts",     ".next/dev/types/**/*.ts"   ],   "exclude": [     "node_modules"   ] }
import {
  AFK_CHECK_SECONDS,
  AFK_CLOSE_CODE,
  SNAPSHOT_STALL_SECONDS,
  SNAPSHOT_STALL_NOTICE_SECONDS,
  BAG_COUNT,
  BAG_MAX,
  CRAFT_CARD_COUNT,
  EMPTY_ITEM,
  ENEMY_DROP_TABLE,
  HOTBAR_CELLS,
  ITEM_STATS,
  ITEMS,
  MAPS,
  MAX_CRAFT_RARITY,
  MAX_RARITY,
  MOBS,
  ORACLE_SKIP,
  RARITIES,
  ROSE_HEAL_DELAY,
  SHELL_ITEM,
  isAbsorbItem,
  SECONDARY_SLOT_COUNT,
  SLOT_COUNT,
  Wall,
  bagCellIndex,
  isBagCell,
  isHotbarCell,
  isMainCell,
  craftChanceFor,
  getSummonCount,
  mapRarityToSummonRarity,
  oracleRequiredCount,
  xpForLevel,
  antennaeViewBonus,
  thirdEyeOrbitBonus,
  ANTENNAE_ITEM,
  THIRD_EYE_ITEM,
} from "../shared/defs";
import { C2S, ENT, EVT, LOADOUT_OP, Reader, S2C, SWAP_ROW_ALL, TEAM, Writer } from "../shared/protocol";
import type { Cell, LoadoutConfig } from "../shared/sim";
import { PLAYER_RADIUS, ArrayWallCollider, PolygonWallCollider } from "../shared/sim";
import { createTransport, Transport } from "./transport";
import {
  button,
  craftBurst,
  craftPad,
  drawCard,
  drawDamageOverlay,
  drawDefaultSkin,
  drawFlower,
  drawItemIcon,
  drawMob,
  drawMobHealthLabel,
  drawPlayerAntennae,
  drawPlayerThirdEye,
  drawFaster,
  drawThirdEyeIcon,
  dropdownField,
  dropdownList,
  ease,
  FONT_FAMILY,
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
import { QuickSlot, QuickSlotHost } from "./quickSlot";
import { BonusSystem } from "./bonus";
import { MobGallery } from "./mobGallery";
import { TalentSystem } from "./talent";
import type { TalentBonuses, TalentHost, TalentPetalLike } from "./talent";
import { ArenaPanel } from "./arenaPanel";
import type { PlayerBrief, RoomBrief } from "./arenaPanel";
import { CloudStorage } from "./storage";

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
  /** Lagging health used to draw the "damage taken" flash on mob health bars. */
  displayHp: number;
  rarity: number;
  /** True while the server is magnet-sucking this drop toward its owner (drop only shrinks when set). */
  suction?: boolean;
  name: string;
  seen: number;
  /** Snapshot generation in which this entity was last present. */
  seenSnapshot: number;
  hurt: number;
  spawn: number;
  spreadMode?: boolean;
  contractMode?: boolean;
  mousePosition?: { x: number; y: number };
  health?: number;
  maxHealth?: number;
  spreadAnim?: number;
  contractAnim?: number;
  /** Segment colliders for segmented mobs (Leech). Built client-side from position history. */
  segmentColliders?: { physicsBody: { position: { x: number; y: number }; radius: number } }[];
  /** Position history for segmented mobs (Leech). Stores recent world-space positions. */
  positionHistory?: { x: number; y: number }[];
  /** Squad member's level, received via S2C.SQUAD_MEMBER_STATE. */
  squadLevel?: number;
  /** Squad member's highest petal rarity, received via S2C.SQUAD_MEMBER_STATE. */
  squadRarity?: number;
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
  /** Secondary (backup) hotbar row. Optional so old saves still load. */
  secondary?: (Cell | null)[];
  bag: (Cell | null)[];
  xp: number;
  mapId: number;
  nextOracleAt?: number;
  nextTradeAt?: number;
  craftPetals?: number;
  craftCrafted?: number;
  craftBurned?: number;
  craftAttempts?: number;
  /** 商店星星(⭐)货币。旧存档没有此字段时默认 10。 */
  stars?: number;
}

const SAVE_KEY = "petalia.save";
const AUTH_KEY = "petalia.auth";
const LOADOUT_SAVE_KEY = "petalia.loadouts";

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
        let dropBiomes = map.get(drop.item);
        if (!dropBiomes) {
          dropBiomes = new Set();
          map.set(drop.item, dropBiomes);
        }
        dropBiomes.add(m.name);
      }
    }
  }
  return map;
}

function emptyCells(n: number): (Cell | null)[] {
  return new Array(n).fill(null);
}

/** Formats a byte count for the debug overlay's throughput readout (e.g. "1.2 KB", "980 B"). */
function formatDebugBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function generateWallData(worldW: number, worldH: number, walls: {x: number, y: number, w: number, h: number}[]) {
  const size = Math.round(worldW / 64);
  const cellW = worldW / size;
  const cellH = worldH / size;
  const grid = new Array(size * size).fill('0');
  for (const wall of walls) {
    const startX = Math.floor(wall.x / cellW);
    const endX = Math.ceil((wall.x + wall.w) / cellW);
    const startY = Math.floor(wall.y / cellH);
    const endY = Math.ceil((wall.y + wall.h) / cellH);
    for (let y = Math.max(0, startY); y < Math.min(size, endY); y++) {
      for (let x = Math.max(0, startX); x < Math.min(size, endX); x++) {
        grid[y * size + x] = '1';
      }
    }
  }
  return grid.join('');
}

const BIOME_BACKGROUNDS: Record<string, { wall_color: [number, number, number], ground_color: [number, number, number] }> = {
  Garden: {
    wall_color: [14, 87, 49],
    ground_color: [30, 174, 99],
  },
  Desert: {
    wall_color: [160, 110, 40],
    ground_color: [224, 171, 69],
  },
  Ocean: {
    wall_color: [15, 60, 100],
    ground_color: [42, 115, 166],
  }
};

class SettingsSystem {
    showHitbox: boolean = false;
    showRarity: boolean = true;
    showDamage: boolean = true;
    showParticles: boolean = true;
    showEnhancedHealthBar: boolean = true;
    showEnemyPanel: boolean = true;
    showDamageNumbers: boolean = true;
    showFPS: boolean = true;
    showProjectileHitbox: boolean = false;
    showAdvancedDPS: boolean = false;
    showMovementHelper: boolean = true;  // 移动指示器
    /** Manual override: force the canvas virtual keyboard on any touch device
     *  even when auto-detection (detectMobile) misses it. */
    virtualKeyboard: boolean = false;
    /** Debug overlay (ping, throughput, object count, FPS, collision checks) in the bottom-right corner. */
    showDebugInfo: boolean = false;
    maxMagicAnts: number = 20;
    maxParticles: number = 200;
    performanceMode: string = "auto";
    photoHardware: boolean = false;
    collisionUpdateSkip: number = 0;
    lowQualityWall: boolean = false;
    /** Cache the ground + walls into an off-screen canvas and re-draw the
     *  cached bitmap each frame. Drastically reduces per-frame work for
     *  static visuals; the cache is rebuilt only when the camera moves
     *  beyond the dirty rect or when the biome / wall set changes. */
    cacheCanvas: boolean = false;

    // UI状态
    panelOpen: boolean = false;
    /** 面板划入动画进度(0=关闭,1=完全展开;参考背包 bagAnim,由 GameClient.update 驱动)。 */
    openAnim: number = 0;
    panelRect: [number, number, number, number] | null = null;
    /** Design-space scale factor (design coords → screen coords). */
    panelScale: number = 1;
    /** Screen-space origin (top-left) of the scaled panel. */
    panelOriginX: number = 0;
    panelOriginY: number = 0;
    onChange: (() => void) | null = null;

    // 滚动相关
    scrollOffset: number = 0;
    maxScrollOffset: number = 0;
    isDraggingScroll: boolean = false;
    dragStartY: number = 0;
    dragStartOffset: number = 0;

    // 保存 canvas 标识
    canvasId: string;
    _eventsInitialized: boolean = false; // 防重复绑定锁

    _onHandleDownAction: ((e: any) => void) | null = null;
    _onHandleMouseMove: ((e: any) => void) | null = null;
    _onHandleTouchMove: ((e: any) => void) | null = null;
    _onHandleUpAction: ((e: any) => void) | null = null;
    _onHandleWheel: ((e: any) => void) | null = null;

    _minusRect: [number, number, number, number] | null = null;
    _plusRect: [number, number, number, number] | null = null;
    _sliderRect: [number, number, number, number] | null = null;
    _particleSliderRect: [number, number, number, number] | null = null;
    _scrollBarRect: [number, number, number, number] | null = null;
    _scrollThumbRect: [number, number, number, number] | null = null;

    constructor(onChangeCallback: (() => void) | null = null, canvasId: string = 'gameCanvas') {
        this.canvasId = canvasId;
        this.onChange = onChangeCallback;
        this.load();
        this._initEventBindings();
    }

    _initEventBindings() {
        if (typeof window === 'undefined') return;
        const canvas = document.getElementById(this.canvasId) as HTMLCanvasElement | null;
        if (!canvas) {
            window.addEventListener('DOMContentLoaded', () => this._initEventBindings());
            return;
        }

        const getCanvasMousePos = (e: any) => {
            const currentCanvas = document.getElementById(this.canvasId) as HTMLCanvasElement | null;
            if (!currentCanvas) return { x: 0, y: 0 };
            const rect = currentCanvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            // Game UI coordinates are CSS pixels; the canvas backing store may
            // be DPR-scaled, but GameClient resets the context transform.
            return {
                x: clientX - rect.left,
                y: clientY - rect.top
            };
        };

        // 临时变量
        let touchStartY = 0;
        let touchStartOffset = 0;

        // 按下事件
        this._onHandleDownAction = (e: any) => {
            if (!this.panelOpen) return;
            const pos = getCanvasMousePos(e);

            let insidePanel = false;
            if (this.panelRect) {
                const [px, py, pw, ph] = this.panelRect;
                if (pos.x >= px && pos.x <= px + pw && pos.y >= py && pos.y <= py + ph) {
                    insidePanel = true;
                    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                    touchStartY = clientY;
                    touchStartOffset = this.scrollOffset;
                }
            }

            if (insidePanel) {
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();
            }
        };

        // 鼠标移动
        this._onHandleMouseMove = (e: any) => {
            if (!this.panelOpen || !this.isDraggingScroll) return;
            const pos = getCanvasMousePos(e);
            this.handleMouseMove(pos.x, pos.y);
        };

        // 触屏滑动
        this._onHandleTouchMove = (e: any) => {
            if (!this.panelOpen || !this.panelRect || !e.touches) return;
            const pos = getCanvasMousePos(e);
            const [px, py, pw, ph] = this.panelRect;

            if (pos.x >= px && pos.x <= px + pw && pos.y >= py && pos.y <= py + ph) {
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();

                // scrollOffset is in design pixels; convert the screen-space
                // drag delta to design space by dividing by the panel scale.
                const scale = this.panelScale || 1;
                const deltaY = (e.touches[0].clientY - touchStartY) / scale;

                this.scrollOffset = Math.max(0, Math.min(
                    this.maxScrollOffset,
                    touchStartOffset - deltaY
                ));
                this._forceRedraw();
            }
        };

        // 弹起
        this._onHandleUpAction = (e: any) => {
            if (!this.panelOpen) return;
            if (this.handleMouseUp()) {
                e.stopPropagation();
            }
        };

        // 滚轮
        this._onHandleWheel = (e: any) => {
            if (!this.panelOpen || !this.panelRect) return;
            const pos = getCanvasMousePos(e);
            const [px, py, pw, ph] = this.panelRect;

            if (pos.x >= px && pos.x <= px + pw && pos.y >= py && pos.y <= py + ph) {
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                this.handleWheel(e.deltaY);
            }
        };

        // 核心防御：移除旧事件
        if (this._onHandleDownAction) {
            canvas.removeEventListener('mousedown', this._onHandleDownAction);
            canvas.removeEventListener('touchstart', this._onHandleDownAction);
        }
        if (this._onHandleMouseMove) {
            window.removeEventListener('mousemove', this._onHandleMouseMove);
        }
        if (this._onHandleTouchMove) {
            canvas.removeEventListener('touchmove', this._onHandleTouchMove);
        }
        if (this._onHandleUpAction) {
            window.removeEventListener('mouseup', this._onHandleUpAction);
            canvas.removeEventListener('touchend', this._onHandleUpAction);
        }
        if (this._onHandleWheel) {
            canvas.removeEventListener('wheel', this._onHandleWheel);
        }

        canvas.addEventListener('mousedown', this._onHandleDownAction);
        canvas.addEventListener('touchstart', this._onHandleDownAction, { passive: false });
        window.addEventListener('mousemove', this._onHandleMouseMove);
        window.addEventListener('mouseup', this._onHandleUpAction);
        canvas.addEventListener('touchend', this._onHandleUpAction);

        canvas.addEventListener('touchmove', this._onHandleTouchMove, { passive: false });
        canvas.addEventListener('wheel', this._onHandleWheel, { passive: false });
    }

    load() {
        if (typeof window === 'undefined') return;
        try {
            const saved = localStorage.getItem('game_settings');
            if (saved) {
                const data = JSON.parse(saved);
                this.showHitbox = data.showHitbox || false;
                this.showRarity = data.showRarity !== undefined ? data.showRarity : true;
                this.showDamage = data.showDamage !== undefined ? data.showDamage : true;
                this.showParticles = data.showParticles !== undefined ? data.showParticles : true;
                this.showEnhancedHealthBar = data.showEnhancedHealthBar !== undefined ? data.showEnhancedHealthBar : true;
                this.showEnemyPanel = data.showEnemyPanel !== undefined ? data.showEnemyPanel : true;
                this.showDamageNumbers = data.showDamageNumbers !== undefined ? data.showDamageNumbers : true;
                this.showFPS = data.showFPS !== undefined ? data.showFPS : true;
                this.maxMagicAnts = data.maxMagicAnts !== undefined ? data.maxMagicAnts : 20;
                this.maxParticles = data.maxParticles !== undefined ? data.maxParticles : 200;
                this.showProjectileHitbox = data.showProjectileHitbox || false;
                this.performanceMode = data.performanceMode || "auto";
                this.showAdvancedDPS = data.showAdvancedDPS !== undefined ? data.showAdvancedDPS : false;
                this.photoHardware = data.photoHardware || false;
                this.lowQualityWall = data.lowQualityWall !== undefined ? data.lowQualityWall : false;
                this.showMovementHelper = data.showMovementHelper !== undefined ? data.showMovementHelper : true;
                this.showDebugInfo = data.showDebugInfo !== undefined ? data.showDebugInfo : false;
                this.cacheCanvas = data.cacheCanvas !== undefined ? data.cacheCanvas : false;
                this.virtualKeyboard = data.virtualKeyboard !== undefined ? data.virtualKeyboard : false;
            }
        } catch(e) {}
        this._forceRedraw();
    }

    save() {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem('game_settings', JSON.stringify({
                showHitbox: this.showHitbox,
                showRarity: this.showRarity,
                showDamage: this.showDamage,
                showParticles: this.showParticles,
                showEnhancedHealthBar: this.showEnhancedHealthBar,
                showEnemyPanel: this.showEnemyPanel,
                showDamageNumbers: this.showDamageNumbers,
                showFPS: this.showFPS,
                showProjectileHitbox: this.showProjectileHitbox,
                maxMagicAnts: this.maxMagicAnts,
                maxParticles: this.maxParticles,
                showAdvancedDPS: this.showAdvancedDPS,
                photoHardware: this.photoHardware,
                lowQualityWall: this.lowQualityWall,
                performanceMode: this.performanceMode,
                showMovementHelper: this.showMovementHelper,
                showDebugInfo: this.showDebugInfo,
                cacheCanvas: this.cacheCanvas,
                virtualKeyboard: this.virtualKeyboard
            }));
        } catch(e) {}
        this.cloudSave();
        this._forceRedraw();
    }

  cloudSave() {
    if (typeof window === 'undefined' || !CloudStorage.isReady) return;
    try {
      CloudStorage.instance.set('game_settings', {
        showHitbox: this.showHitbox,
        showRarity: this.showRarity,
        showDamage: this.showDamage,
        showParticles: this.showParticles,
        showEnhancedHealthBar: this.showEnhancedHealthBar,
        showEnemyPanel: this.showEnemyPanel,
        showDamageNumbers: this.showDamageNumbers,
        showFPS: this.showFPS,
        showProjectileHitbox: this.showProjectileHitbox,
        showAdvancedDPS: this.showAdvancedDPS,
        showMovementHelper: this.showMovementHelper,
        showDebugInfo: this.showDebugInfo,
        maxMagicAnts: this.maxMagicAnts,
        maxParticles: this.maxParticles,
        performanceMode: this.performanceMode,
        photoHardware: this.photoHardware,
        lowQualityWall: this.lowQualityWall,
        cacheCanvas: this.cacheCanvas,
        virtualKeyboard: this.virtualKeyboard,
      });
    } catch {}
  }

    _forceRedraw() {
        this.forceRedraw();
    }

    forceRedraw() {
        if (this.onChange) this.onChange();
        if (typeof window === 'undefined') return;
        const canvas = document.getElementById(this.canvasId) as HTMLCanvasElement | null;
        if (canvas && canvas.getContext) {
            const ctx = canvas.getContext('2d');
            const game = (window as any).gameInstance;
            if (ctx && game) {
              if (game.draw) game.draw(ctx);
              else if (game.renderGame) {
                // If it's the main gameInstance, trigger a draw update
              }
            }
        }
    }

    toggle(key: string) {
        if ((this as any)[key] !== undefined) {
            (this as any)[key] = !(this as any)[key];
            this.save();
            const game = (window as any).gameInstance;
            if (game) {
                game[key] = (this as any)[key];
                if (game.mainMenu) game.mainMenu[key] = (this as any)[key];
            }
            this.forceRedraw();
            return true;
        }
        return false;
    }

    togglePhotoHardware() {
        this.photoHardware = !this.photoHardware;
        this.save();
        if (this.onChange) this.onChange();
        return this.photoHardware;
    }

    getCollisionUpdateInterval() {
        return this.photoHardware ? 2 : 0;
    }

    setMaxMagicAnts(value: number) {
        this.maxMagicAnts = Math.max(1, Math.min(100, value));
        this.save();
        const game = (window as any).gameInstance;
        if (game?.player) {
            for (const petal of game.player.petals) {
                if (petal.magicSoldierAntList) petal.maxMagicSoldierAnts = this.maxMagicAnts;
            }
        }
        this._forceRedraw();
        return this.maxMagicAnts;
    }

    setMaxParticles(value: number) {
        this.maxParticles = Math.max(50, Math.min(500, value));
        this.save();
        const game = (window as any).gameInstance;
        if (game) game.maxParticles = this.maxParticles;
        this._forceRedraw();
        return this.maxParticles;
    }

    setPerformanceMode(mode: string) {
        const modes = ["auto", "low", "medium", "high"];
        if (!modes.includes(mode)) return false;
        this.performanceMode = mode;
        this.save();
        const game = (window as any).gameInstance;
        if (game) {
            switch(mode) {
                case "low": game.maxParticles = 50; game.enemyUpdateSkip = 2; break;
                case "medium": game.maxParticles = 100; game.enemyUpdateSkip = 1; break;
                case "high": game.maxParticles = 200; game.enemyUpdateSkip = 0; break;
                case "auto": game.maxParticles = this.maxParticles; game.enemyUpdateSkip = 0; break;
            }
        }
        this._forceRedraw();
        return true;
    }

    draw(ctx: CanvasRenderingContext2D, x: number, y: number) {
        if (!this.panelOpen) return;

        const viewW = x * 2;
        const viewH = y * 2;
        // Mobile: narrower panel so it doesn't cover the whole screen.
        const isMobileView = viewW < 640;
        // Portrait screens (tall & narrow) get a taller design height so the
        // panel doesn't shrink too aggressively — the width-limited scale
        // factor (280/320 ≈ 0.88) still applies, but a larger DESIGN_H means
        // the actual rendered height = DESIGN_H × scale is comfortably tall.
        const isPortrait = viewH >= viewW;
        const DESIGN_W = 320;
        const DESIGN_H = isPortrait ? 540 : 480;
        const maxW = Math.min(isMobileView ? 280 : 320, Math.max(isMobileView ? 200 : 240, viewW - 24));
        const maxH_cap = isPortrait ? 540 : 480;
        const maxH = Math.max(140, Math.min(maxH_cap, viewH - (viewH <= 600 ? 8 : 24)));
        const scale = Math.min(maxW / DESIGN_W, maxH / DESIGN_H);
        const actualW = DESIGN_W * scale;
        const actualH = DESIGN_H * scale;
        const panelX = Math.min(118, Math.max(12, viewW - actualW - 12));
        const panelY = viewH <= 600 ? 8 : 16;
        // Draw in design coordinates — the scale transform handles shrinking.
        const panelW = DESIGN_W;
        const panelH = DESIGN_H;
        this.panelRect = [panelX, panelY, actualW, actualH];
        this.panelScale = scale;
        this.panelOriginX = panelX;
        this.panelOriginY = panelY;

        const totalContentHeight = 952;
        const contentY = panelY + 70;
        const contentH = panelH - 90;
        this.maxScrollOffset = Math.max(0, totalContentHeight - contentH);

        ctx.save();
        // 划入动画:淡入 + 从屏幕底部滑入(ease.outCubic,与背包面板一致)
        ctx.globalAlpha = Math.min(1, this.openAnim * 1.6);
        ctx.lineJoin = "round";
        // Scale the entire panel + contents uniformly around the panel's
        // top-left corner. We translate to the corner, scale, then translate
        // back so all existing drawing code (which uses panelX/panelY) keeps
        // working — every point is just scaled toward (panelX, panelY).
        ctx.translate(panelX, panelY);
        ctx.scale(scale, scale);
        ctx.translate(-panelX, -panelY);
        ctx.translate(0, (1 - ease.outCubic(this.openAnim)) * (viewH + 20));

        // 背景
        ctx.fillStyle = '#B4B4B4';
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(panelX, panelY, panelW, panelH, 5);
        } else {
            ctx.rect(panelX, panelY, panelW, panelH);
        }
        ctx.fill();
        ctx.strokeStyle = '#888888';
        ctx.lineWidth = 4;
        ctx.stroke();

        // 标题
        const drawStrokeText = (text: string, tx: number, ty: number, fontSize = 20, textAlign: CanvasTextAlign = 'center') => {
            const fontFamily = typeof FONT_FAMILY !== 'undefined' ? FONT_FAMILY : 'sans-serif';
            ctx.font = `${fontSize}px ${fontFamily}`;
            ctx.textAlign = textAlign;
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 5;
            ctx.strokeText(text, tx, ty);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(text, tx, ty);
        };

        drawStrokeText('Settings', panelX + panelW / 2, panelY + 35, 28);

        // 裁剪区域
        const contentX = panelX + 10;
        const contentW = panelW - 20;

        ctx.save();
        ctx.beginPath();
        ctx.rect(contentX, contentY, contentW, contentH);
        ctx.clip();

        // 内容偏移
        ctx.save();
        ctx.translate(0, -this.scrollOffset);

        let curY = contentY;

        // 分隔线 Game
        ctx.strokeStyle = '#aaaaaa';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(panelX + 20, curY); ctx.lineTo(panelX + panelW - 20, curY);
        ctx.stroke();
        drawStrokeText('Game', panelX + panelW / 2, curY + 8, 20);
        curY += 35;

        // 复选框部分
        const items = ['showHitbox', 'showRarity', 'showDamageNumbers', 'showParticles',
                       'showEnhancedHealthBar', 'showEnemyPanel', 'showFPS',
                       'showProjectileHitbox', 'showAdvancedDPS', 'photoHardware',
                       'showMovementHelper','lowQualityWall','showDebugInfo','cacheCanvas','virtualKeyboard'];
        const labels = ['Show Hitbox', 'Show Rarity', 'Show Damage', 'Show Particles',
                        'Health Bar', 'Enemy Panel', 'Show FPS', 'Show Projectile Hitbox',
                        'Show Advanced DPS', 'Potato Hardware', 'Movement Helper','Low Quality Wall','Debug Info','Cache Canvas','Virtual Keyboard'];

        items.forEach((item, i) => {
            const itemY = curY + i * 32;
            const checkX = panelX + 25, checkSize = 20;

            ctx.fillStyle = '#555555';
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(checkX, itemY - 8, checkSize, checkSize, 4);
            } else {
                ctx.rect(checkX, itemY - 8, checkSize, checkSize);
            }
            ctx.fill();
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.stroke();

            if ((this as any)[item]) {
                ctx.fillStyle = '#cccccc';
                ctx.fillRect(checkX + 4, itemY - 4, checkSize - 8, checkSize - 8);
            }

            drawStrokeText(labels[i], checkX + 32, itemY + 4, 16, 'left');
        });

        curY += items.length * 32 + 15;

        // 分隔线 Performance
        ctx.strokeStyle = '#aaaaaa';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(panelX + 20, curY); ctx.lineTo(panelX + panelW - 20, curY);
        ctx.stroke();
        drawStrokeText('Performance', panelX + panelW / 2, curY + 8, 20);
        curY += 35;

        // 1. Magic Ants
        drawStrokeText(`Magic Ants: ${this.maxMagicAnts}`, panelX + 25, curY, 16, 'left');
        const sliderW = panelW - 130, sliderH = 12;
        const sx = panelX + 25, sy = curY + 10;

        ctx.fillStyle = '#444444';
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(sx, sy, sliderW, sliderH, 6);
        } else {
            ctx.rect(sx, sy, sliderW, sliderH);
        }
        ctx.fill();

        const antPct = (this.maxMagicAnts - 1) / 99;
        ctx.fillStyle = '#3498db';
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(sx, sy, sliderW * antPct, sliderH, 6);
        } else {
            ctx.rect(sx, sy, sliderW * antPct, sliderH);
        }
        ctx.fill();

        const bx = sx + sliderW + 10, by = sy - 5;

        this._minusRect = [bx, by - this.scrollOffset, 22, 22];
        this._plusRect = [bx + 30, by - this.scrollOffset, 22, 22];

        [bx, bx + 30].forEach((rx, idx) => {
            ctx.fillStyle = idx === 0 ? '#e74c3c' : '#2ecc71';
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(rx, by, 22, 22, 5);
            } else {
                ctx.rect(rx, by, 22, 22);
            }
            ctx.fill();
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.stroke();
            drawStrokeText(idx === 0 ? '-' : '+', rx + 11, by + 13, 18);
        });

        this._sliderRect = [sx, sy - this.scrollOffset, sliderW, sliderH];

        curY += 55;

        // 2. Particles
        drawStrokeText(`Particles: ${this.maxParticles}`, panelX + 25, curY, 16, 'left');
        const psx = panelX + 25, psy = curY + 10, psw = panelW - 50;

        ctx.fillStyle = '#444444';
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(psx, psy, psw, sliderH, 6);
        } else {
            ctx.rect(psx, psy, psw, sliderH);
        }
        ctx.fill();

        const partPct = (this.maxParticles - 50) / 450;
        ctx.fillStyle = '#9b59b6';
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(psx, psy, psw * partPct, sliderH, 6);
        } else {
            ctx.rect(psx, psy, psw * partPct, sliderH);
        }
        ctx.fill();

        this._particleSliderRect = [psx, psy - this.scrollOffset, psw, sliderH];

        curY += 55;

        // 分隔线 About
        ctx.strokeStyle = '#aaaaaa';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(panelX + 20, curY); ctx.lineTo(panelX + panelW - 20, curY);
        ctx.stroke();
        drawStrokeText('About', panelX + panelW / 2, curY + 8, 20);
        curY += 35;

        // 1. 版本号
        drawStrokeText('Version 0.3.2', panelX + panelW / 2, curY + 10, 16, 'center');
        curY += 40;

        const aboutText = "This is a game which inspire by Zorr.pro. Special thanks: flower1998  cbx12345.";

        const maxWidth = panelW - 50;
        const lineHeight = 23;
        const fontFamily = typeof FONT_FAMILY !== 'undefined' ? FONT_FAMILY : 'sans-serif';
        ctx.font = `15px ${fontFamily}`;
        ctx.textAlign = 'center';

        // 自动换行
        let words = aboutText.split(' ');
        let currentLine = '';

        for (let n = 0; n < words.length; n++) {
            let testLine = currentLine + words[n] + ' ';
            let metrics = ctx.measureText(testLine);
            let testWidth = metrics.width;

            if (testWidth > maxWidth && n > 0) {
                drawStrokeText(currentLine.trim(), panelX + panelW / 2, curY, 14, 'center');
                currentLine = words[n] + ' ';
                curY += lineHeight;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine.length > 0) {
            drawStrokeText(currentLine.trim(), panelX + panelW / 2, curY, 14, 'center');
            curY += lineHeight;
        }

        curY += 20;
        ctx.restore(); // 弹出 translate 偏移
        ctx.restore(); // 弹出 clip

        // 滚动条
        if (this.maxScrollOffset > 0) {
            const scrollBarW = 9;
            const scrollBarX = panelX + panelW - 15;
            const scrollBarY = contentY + 4;
            const scrollBarH = contentH - 8;
            const thumbH = Math.max(25, (contentH / totalContentHeight) * scrollBarH);
            const thumbY = scrollBarY + (this.scrollOffset / this.maxScrollOffset) * (scrollBarH - thumbH);

            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(scrollBarX, scrollBarY, scrollBarW, scrollBarH, 3);
            } else {
                ctx.rect(scrollBarX, scrollBarY, scrollBarW, scrollBarH);
            }
            ctx.fill();

            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(scrollBarX, thumbY, scrollBarW, thumbH, 3);
            } else {
                ctx.rect(scrollBarX, thumbY, scrollBarW, thumbH);
            }
            ctx.fill();

            this._scrollBarRect = [scrollBarX, scrollBarY, scrollBarW, scrollBarH];
            this._scrollThumbRect = [scrollBarX, thumbY, scrollBarW, thumbH];
        } else {
            this._scrollBarRect = null;
            this._scrollThumbRect = null;
        }

        // 关闭按钮(与成就面板同款:红色渐变圆角按钮)
        const closeX = panelX + panelW - 35, closeY = panelY + 10, closeSize = 25;
        const closeR: [number, number, number, number] = [closeX, closeY, closeSize, closeSize];
        const closeC = [220, 80, 80];
        const adjC = (f: number) => `rgb(${closeC.map(c => Math.min(255, Math.max(0, Math.floor(c * f)))).join(",")})`;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(...closeR, 8); else ctx.rect(...closeR);
        ctx.fillStyle = adjC(1);
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(...closeR, 8); else ctx.rect(...closeR);
        ctx.clip();
        ctx.fillStyle = adjC(0.85);
        ctx.fillRect(closeX, closeY, closeSize, closeSize / 2);
        ctx.restore();
        ctx.strokeStyle = adjC(0.5);
        ctx.lineWidth = 3;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(...closeR, 8); else ctx.rect(...closeR);
        ctx.stroke();
        drawStrokeText('×', closeX + 12.5, closeY + 18, 18);

        ctx.restore();
    }

    handleClick(x: number, y: number) {
        if (!this.panelOpen || !this.panelRect) return false;

        // The panel is drawn in a scaled design coordinate space (see draw()).
        // Convert the incoming screen coords back to design coords so all the
        // stored rects (which are in design space) can be tested directly.
        const scale = this.panelScale || 1;
        const ox = this.panelOriginX;
        const oy = this.panelOriginY;
        const dx = ox + (x - ox) / scale;
        const dy = oy + (y - oy) / scale;
        // Design-space panel rect (panelW/panelH are the unscaled 320×480).
        const [px, py] = this.panelRect;
        const pw = (this.panelRect[2] || 0) / scale;
        const ph = (this.panelRect[3] || 0) / scale;

        // 1. 关闭按钮
        const closeX = px + pw - 35, closeY = py + 10, closeSize = 25;
        if (dx >= closeX && dx <= closeX + closeSize && dy >= closeY && dy <= closeY + closeSize) {
            this.panelOpen = false;
            this._forceRedraw();
            return true;
        }

        // 2. 滚动条拖拽开始 — test the thumb before the track because
        // the thumb sits inside the track rectangle.
        if (this._scrollThumbRect) {
            const [tx, ty, tw, th] = this._scrollThumbRect;
            if (dx >= tx && dx <= tx + tw && dy >= ty && dy <= ty + th) {
                this.isDraggingScroll = true;
                this.dragStartY = dy;
                this.dragStartOffset = this.scrollOffset;
                return true;
            }
        }

        // 3. 滚动条点击
        if (this._scrollBarRect) {
            const [sx, sy, sw, sh] = this._scrollBarRect;
            if (dx >= sx && dx <= sx + sw && dy >= sy && dy <= sy + sh) {
                const relativeY = dy - sy;
                const ratio = relativeY / sh;
                this.scrollOffset = Math.max(0, Math.min(this.maxScrollOffset, ratio * this.maxScrollOffset));
                this._forceRedraw();
                return true;
            }
        }

        // 4. 复选框
        const contentY = py + 70;
        const checkYStart = contentY + 35;
        const itemH = 32;

        const items = ['showHitbox', 'showRarity', 'showDamageNumbers', 'showParticles',
                       'showEnhancedHealthBar', 'showEnemyPanel', 'showFPS',
                       'showProjectileHitbox', 'showAdvancedDPS', 'photoHardware',
                       'showMovementHelper','lowQualityWall','showDebugInfo','cacheCanvas','virtualKeyboard'];

        for (let i = 0; i < items.length; i++) {
            const itemY = checkYStart + i * itemH - this.scrollOffset;
            const checkX = px + 25;
            const checkSize = 20;

            const hitX = checkX - 8;
            const hitY = itemY - 10;
            const hitW = checkSize + 16;
            const hitH = itemH + 8;

            const isHit = dx >= hitX && dx <= hitX + hitW && dy >= hitY && dy <= hitY + hitH;

            if (isHit) {
                this.toggle(items[i]);
                this._forceRedraw();
                return true;
            }
        }

        // 5. 减号按钮
        if (this._minusRect) {
            const [rx, ry, rw, rh] = this._minusRect;
            if (dx >= rx && dx <= rx + rw && dy >= ry && dy <= ry + rh) {
                this.setMaxMagicAnts(this.maxMagicAnts - 5);
                return true;
            }
        }

        // 6. 加号按钮
        if (this._plusRect) {
            const [rx, ry, rw, rh] = this._plusRect;
            if (dx >= rx && dx <= rx + rw && dy >= ry && dy <= ry + rh) {
                this.setMaxMagicAnts(this.maxMagicAnts + 5);
                return true;
            }
        }

        // 7. Magic Ants 滑块
        if (this._sliderRect) {
            const [rx, ry, rw, rh] = this._sliderRect;
            if (dx >= rx && dx <= rx + rw && dy >= ry && dy <= ry + rh) {
                const percent = (dx - rx) / rw;
                this.setMaxMagicAnts(Math.floor(1 + percent * 99));
                return true;
            }
        }

        // 8. Particles 滑块
        if (this._particleSliderRect) {
            const [rx, ry, rw, rh] = this._particleSliderRect;
            if (dx >= rx && dx <= rx + rw && dy >= ry && dy <= ry + rh) {
                const percent = (dx - rx) / rw;
                this.setMaxParticles(Math.floor(50 + percent * 450));
                return true;
            }
        }

        // Consume the click: any press inside the settings panel (even on its
        // background) must NOT fall through to UI below. The only way out is
        // the close button (handled above) or pressing the toggle key again.
        return true;
    }

    handleMouseMove(x: number, y: number) {
        if (!this.panelOpen) return;
        if (this.isDraggingScroll && this._scrollThumbRect && this._scrollBarRect) {
            // Convert screen coords to design coords (same as handleClick).
            const scale = this.panelScale || 1;
            const ox = this.panelOriginX;
            const oy = this.panelOriginY;
            const dy = oy + (y - oy) / scale - this.dragStartY;

            const th = this._scrollThumbRect[3];
            const scrollBarH = this._scrollBarRect[3];
            const maxTrack = scrollBarH - th;
            if (maxTrack > 0) {
                const ratio = dy / maxTrack;
                this.scrollOffset = Math.max(0, Math.min(this.maxScrollOffset, this.dragStartOffset + ratio * this.maxScrollOffset));
                this._forceRedraw();
            }
        }
    }

    handleMouseUp() {
        if (this.isDraggingScroll) {
            this.isDraggingScroll = false;
            return true;
        }
        return false;
    }

    handleWheel(deltaY: number) {
        if (!this.panelOpen) return;
        const scrollSpeed = deltaY > 0 ? 22 : -22;
        this.scrollOffset = Math.max(0, Math.min(this.maxScrollOffset, this.scrollOffset + scrollSpeed));
        this._forceRedraw();
    }

    open() {
        this.panelOpen = true;
        this.scrollOffset = 0;
        this._forceRedraw();
    }
    close() {
        this.panelOpen = false;
        this._forceRedraw();
    }
    togglePanel() {
        this.panelOpen = !this.panelOpen;
        if (this.panelOpen) this.scrollOffset = 0;
        this._forceRedraw();
    }

    /** 面板划入动画进度推进(目标 = panelOpen)。 */
    updateOpenAnim(dt: number) {
        this.openAnim += ((this.panelOpen ? 1 : 0) - this.openAnim) * Math.min(1, dt * 10);
    }
}

// =====================================================================
// Chat System
// =====================================================================

interface ChatMessage {
  text: string;
  sender: string;
  timestamp: number;
  isSystem: boolean;
  isCraftReport: boolean;
  isSelf: boolean;
}

class ChatSystem {
  messages: ChatMessage[] = [];
  inputText = "";
  inputActive = false;
  visible = true;
  width = 200;
  height = 30;
  /** Last computed panel rect from draw(), used by handleClick so hit-testing
   *  and rendering always use the same coordinates. */
  lastPanelRect: Rect | null = null;

  addMessage(text: string, sender: string, isSystem = false, isCraftReport = false, isSelf = false) {
    this.messages.push({
      text,
      sender,
      timestamp: Date.now(),
      isSystem,
      isCraftReport,
      isSelf,
    });
    // Keep last 50 messages in memory
    if (this.messages.length > 50) this.messages.shift();
  }

  /** Send the current input text. Returns the text to send, then clears input. */
  sendInput(): string {
    const msg = this.inputText.trim();
    this.inputText = "";
    this.inputActive = false;
    return msg;
  }

  /** Compute the chat panel rectangle using the same logic as draw(). */
  private computePanelRect(screenHeight: number): Rect {
    const isMobile = (window.innerHeight || 0) < 640;
    const panelX = 15 * (isMobile ? 5 : 1);
    const panelY = screenHeight - this.height - 20 * (isMobile ? 4 : 1);
    const panelW = this.width * (isMobile ? 0.9 : 0.8);
    const panelH = this.height * (isMobile ? 0.8 : 1.1);
    return { x: panelX, y: panelY, w: panelW, h: panelH };
  }

  /** Hit-test the chat panel. Returns true when the pointer is inside the
   *  same rectangle that draw() uses, and activates the input. */
  handleClick(mx: number, my: number, screenHeight: number): boolean {
    const rect = this.computePanelRect(screenHeight);
    this.lastPanelRect = rect;
    if (hit(rect, mx, my)) {
      this.inputActive = true;
      this.inputText = "";
      return true;
    }
    return false;
  }

  draw(ctx: CanvasRenderingContext2D, screenHeight: number) {
    if (!this.visible) return;
    if (!this.messages) this.messages = [];
    const now = Date.now();
    this.messages = this.messages.filter(msg => now - msg.timestamp < 30000);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = Math.min(2, (window.devicePixelRatio || 1));
    ctx.scale(dpr, dpr);

    const rect = this.computePanelRect(screenHeight);
    this.lastPanelRect = rect;
    const panelX = rect.x;
    const panelY = rect.y;
    const panelW = rect.w;
    const panelH = rect.h;

    const padding = 15;
    ctx.fillStyle = 'rgba(50, 50, 50, 0.5)';
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, 5);
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.textAlign = 'left';
    const visibleMsgs = this.messages.slice(-6);
    const lineHeight = 16;
    const baseX = panelX + padding;
    ctx.font = `16px ${FONT_FAMILY || 'Arial'}`;
    ctx.textBaseline = 'top';

    const rarityColors: Record<string, string> = {
      "Mythic": "#00cccc",
      "Ultra": "#cc5490",
      "Super": "#74bf74",
      "Omega": "#b31fa3",
      "Eternal": "#ffd700",
      "Unique": "#ffffff",
      "Legendary": "#cc0000",
      "Epic": "#9932cc",
      "Rare": "#0066cc",
      "Unusual": "#cccc00",
      "Common": "#66C057",
    };

    const itemNames = Object.keys(ITEM_STATS || {});
    const bioNames = Object.keys(ENEMY_DROP_TABLE || {});
    const allNames = [...itemNames, ...bioNames];
    const sortedNames = allNames.sort((a, b) => b.length - a.length);

    visibleMsgs.forEach((msg, i) => {
      const y = panelY - 22 - i * lineHeight;
      let displayText = msg.text || '';

      if (msg.sender === 'System' || msg.isSystem || msg.isCraftReport) {
        let xOffset = baseX;
        let remaining = displayText;
        let currentColor = '#ffffff';

        while (remaining.length > 0) {
          let found = false;

          // 1. Find rarity
          for (const [rarity, color] of Object.entries(rarityColors)) {
            if (remaining.startsWith(rarity)) {
              currentColor = color;
              ctx.strokeStyle = '#000000';
              ctx.lineWidth = 3;
              ctx.strokeText(rarity, xOffset, y);
              ctx.fillStyle = color;
              ctx.fillText(rarity, xOffset, y);
              xOffset += ctx.measureText(rarity).width;
              remaining = remaining.substring(rarity.length);
              found = true;
              break;
            }
          }

          // 2. Find item or mob name
          if (!found) {
            for (const name of sortedNames) {
              if (remaining.startsWith(name)) {
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 3;
                ctx.strokeText(name, xOffset, y);
                ctx.fillStyle = currentColor;
                ctx.fillText(name, xOffset, y);
                xOffset += ctx.measureText(name).width;
                remaining = remaining.substring(name.length);
                found = true;
                break;
              }
            }
          }

          // 3. Numbers (use upcoming rarity color)
          if (!found && /^\d/.test(remaining)) {
            const match = remaining.match(/^(\d+)(x)?/);
            if (match) {
              const number = match[1];
              const hasX = match[2] === 'x';
              const numberStartOffset = xOffset;
              let tempRemaining = remaining.substring(number.length);
              if (hasX) tempRemaining = tempRemaining.substring(1);
              const hadSpace = tempRemaining.startsWith(' ');
              if (hadSpace) tempRemaining = tempRemaining.substring(1);

              let numberColor = '#ffffff';
              for (const [rarity, color] of Object.entries(rarityColors)) {
                if (tempRemaining.startsWith(rarity)) {
                  numberColor = color;
                  break;
                }
              }

              ctx.strokeStyle = '#000000';
              ctx.lineWidth = 3;
              ctx.strokeText(number, numberStartOffset, y);
              ctx.fillStyle = numberColor;
              ctx.fillText(number, numberStartOffset, y);
              xOffset += ctx.measureText(number).width;

              if (hasX) {
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 3;
                ctx.strokeText('x', xOffset, y);
                ctx.fillStyle = numberColor;
                ctx.fillText('x', xOffset, y);
                xOffset += ctx.measureText('x').width;
              }

              // Only render a trailing space if one was originally present
              // (prevents gaps in alphanumeric codes like squad codes)
              if (hadSpace) {
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 3;
                ctx.strokeText(' ', xOffset, y);
                ctx.fillStyle = numberColor;
                ctx.fillText(' ', xOffset, y);
                xOffset += ctx.measureText(' ').width;
              }

              remaining = tempRemaining;
              found = true;
            }
          }

          // 4. Space
          if (!found && remaining[0] === ' ') {
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 3;
            ctx.strokeText(' ', xOffset, y);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(' ', xOffset, y);
            xOffset += ctx.measureText(' ').width;
            remaining = remaining.substring(1);
            found = true;
          }

          // 5. Plain character
          if (!found) {
            const char = remaining[0];
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 3;
            ctx.strokeText(char, xOffset, y);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(char, xOffset, y);
            xOffset += ctx.measureText(char).width;
            remaining = remaining.substring(1);
          }
        }
      }
      // Normal chat message
      else {
        const fullText = `${msg.sender}: ${msg.text || ''}`;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText(fullText, baseX, y);
        ctx.fillStyle = msg.isSelf ? '#70e0f0' : '#ffffff';
        ctx.fillText(fullText, baseX, y);
      }
    });

    // Input line
    const inputY = panelY + panelH - 26;
    ctx.font = `16px ${FONT_FAMILY || 'Arial'}`;
    ctx.textBaseline = 'middle';
    const display = this.inputActive
      ? '> ' + (this.inputText || '') + (Math.floor(Date.now() / 500) % 2 ? '_' : '')
      : '[Enter] to chat';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3.5;
    ctx.strokeText(display, baseX, inputY + 14);
    ctx.fillStyle = '#cccccc';
    ctx.fillText(display, baseX, inputY + 14);
    ctx.restore();
  }
}

/**
 * Shared, florr-style item tooltip used by the hotbar, bag, and craft browser.
 * Text uses a heavy black outline so every stat remains readable over gameplay.
 */
class TooltipSystem {
  static readonly STYLES = {
    NAME: "#ffffff",
    HEALTH: "#ff5e5e",
    DAMAGE: "#7dc6ff",
    MANA: "#4a90e2",
    HEAL: "#ffcc66",
    SPECIAL: "#ffcc66",
    RELOAD: "#7dc6ff",
    WHITE: "#ffffff",
    BLACK: "#000000",
  } as const;

  static drawItemTooltip(
    ctx: CanvasRenderingContext2D,
    cell: Cell,
    anchorX: number,
    anchorY: number,
    viewWidth: number,
    viewHeight: number,
    talentBonuses?: TalentBonuses | null,
  ) {
    const def = ITEMS[cell.item];
    const rarity = RARITIES[cell.rarity];
    if (!def || !rarity) return;

    const width = Math.min(400, Math.max(240, viewWidth - 16));
    const innerWidth = width - 36;
    const descriptionLines = this.wrapText(ctx, def.desc, innerWidth, 13);
    const statLines: Array<{
      text: string;
      color: string;
      suffix?: { text: string; color: string };
    }> = [];
    const mult = rarity.mult;

    // ---- Talent-modulated effective values for petals ----
    // The `reload` branch subtracts a flat fraction of the base reload, and
    // the `petalDamage` branch is a straight multiplier on petal damage. The
    // server applies the same numbers authoritatively (see sim.ts
    // `applyTalentReload` and the petal-damage line in the petal update),
    // so this is purely a UI-side display that mirrors what the player
    // actually gets at the moment.
    const reloadReduction = Math.max(0, Math.min(0.5, talentBonuses?.reloadReduction ?? 0));
    const petalDmgMult = talentBonuses?.petalDmgMult ?? 1;
    const effectiveReload = def.reload > 0 ? def.reload * (1 - reloadReduction) : 0;

    if (def.kind !== "trinket") {
      if (def.damage > 0) {
        const baseDmg = def.damage * mult;
        const finalDmg = baseDmg * petalDmgMult;
        // Show "+x% talent damage" suffix whenever the talent actually
        // moves the needle, so a +0% (default) tooltip stays clean.
        const suffix = petalDmgMult > 1.0001
          ? { text: `  (+${Math.round((petalDmgMult - 1) * 100)}% talent)`, color: this.STYLES.SPECIAL }
          : undefined;
        statLines.push({ text: `Damage: ${finalDmg.toFixed(0)}`, color: this.STYLES.DAMAGE, suffix });
      }
      if (def.health > 0) statLines.push({ text: `Health: ${(def.health * mult).toFixed(0)}`, color: this.STYLES.HEALTH });
    }
    if (def.heal) {
      statLines.push({
        text: `Heal: ${(def.heal * mult).toFixed(def.heal * mult % 1 ? 1 : 0)} HP`,
        color: this.STYLES.HEAL,
      });
    }
    if (def.shield) {
      statLines.push({
        text: `Shield: ${(def.shield * mult).toFixed(def.shield * mult % 1 ? 1 : 0)}`,
        color: this.STYLES.MANA,
      });
    }
    if (def.healthBonus) {
      statLines.push({
        text: `Max Health: +${(def.healthBonus * mult).toFixed(0)}`,
        color: this.STYLES.HEALTH,
      });
    }
    if (def.heal || def.shield) {
      statLines.push({ text: `Absorbs after ${ROSE_HEAL_DELAY.toFixed(1)}s, then reloads`, color: this.STYLES.SPECIAL });
    }
    if (def.speed) statLines.push({ text: `Speed: +${def.speed}%`, color: this.STYLES.SPECIAL });

    if (def.kind === "summon") {
      const summonCount = getSummonCount(def.id);
      const summonRarity = def.noDowngrade ? cell.rarity : mapRarityToSummonRarity(cell.rarity);
      const mobName = MOBS[def.petMob ?? 0]?.name ?? "Unknown";
      const base = `×${summonCount} ${mobName}`;
      statLines.push({
        text: base,
        color: this.STYLES.WHITE,
        suffix: { text: ` (${RARITIES[summonRarity]?.name ?? "Common"})`, color: RARITIES[summonRarity]?.color ?? this.STYLES.WHITE },
      });
    } else if (def.kind === "trinket") {
      statLines.push({ text: "a special item which you can use", color: this.STYLES.SPECIAL });
    }

    const descriptionHeight = descriptionLines.length * 20;
    const statsHeight = statLines.length * 22;
    const height = 76 + descriptionHeight + (descriptionLines.length ? 8 : 0) + statsHeight + 12;
    let x = anchorX;
    let y = anchorY;
    if (x + width > viewWidth - 8) x = anchorX - width - 28;
    x = Math.max(8, Math.min(x, viewWidth - width - 8));
    y = Math.max(8, Math.min(y, viewHeight - height - 8));

    ctx.save();
    roundRect(ctx, x, y, width, height, 6);
    ctx.fillStyle = "rgba(30,30,30,0.82)";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.lineWidth = 3;
    ctx.stroke();

    const left = x + 18;
    const right = x + width - 18;
    let currentY = y + 24;
    this.drawStrokedText(ctx, def.name, left, currentY, 22, "left", this.STYLES.NAME, 5);
    if (def.reload > 0) {
      // Effective reload after the `reload` talent branch, mirrored from
      // sim.ts `applyTalentReload`. Showing the talent-modified value keeps
      // the tooltip honest about how fast the petal will actually fire.
      this.drawStrokedText(ctx, `${effectiveReload.toFixed(1)}s ⟳`, right, currentY, 14, "right", this.STYLES.RELOAD, 4);
    }

    currentY += 28;
    this.drawStrokedText(ctx, rarity.name, left, currentY, 13, "left", rarity.color, 5);
    currentY += 24;

    for (const line of descriptionLines) {
      this.drawStrokedText(ctx, line, left, currentY, 13, "left", this.STYLES.WHITE, 4);
      currentY += 20;
    }
    if (descriptionLines.length) currentY += 8;

    for (const line of statLines) {
      this.drawStrokedText(ctx, line.text, left, currentY, 12, "left", line.color, 4);
      if (line.suffix) {
        ctx.font = `900 12px ${FONT_FAMILY}`;
        const suffixX = left + ctx.measureText(line.text).width;
        this.drawStrokedText(ctx, line.suffix.text, suffixX, currentY, 12, "left", line.suffix.color, 4);
      }
      currentY += 22;
    }
    ctx.restore();
  }

  private static drawStrokedText(
    ctx: CanvasRenderingContext2D,
    value: string,
    x: number,
    y: number,
    fontSize: number,
    align: CanvasTextAlign,
    fillColor: string,
    strokeWidth: number,
  ) {
    ctx.save();
    ctx.font = `900 ${fontSize}px ${FONT_FAMILY}`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.strokeStyle = this.STYLES.BLACK;
    ctx.lineWidth = strokeWidth;
    ctx.strokeText(value, x, y);
    ctx.fillStyle = fillColor;
    ctx.fillText(value, x, y);
    ctx.restore();
  }

  private static wrapText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number, fontSize: number): string[] {
    ctx.save();
    ctx.font = `900 ${fontSize}px ${FONT_FAMILY}`;
    const words = value.trim().split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      current = word;
      // Split an unusually long unbroken token so it cannot escape the panel.
      while (ctx.measureText(current).width > maxWidth && current.length > 1) {
        let cut = current.length - 1;
        while (cut > 1 && ctx.measureText(current.slice(0, cut)).width > maxWidth) cut--;
        lines.push(current.slice(0, cut));
        current = current.slice(cut);
      }
    }
    if (current) lines.push(current);
    ctx.restore();
    return lines;
  }
}

/**
 * VirtualKeyboard — a canvas-drawn on-screen keyboard for mobile.
 * Appears when the user taps a search field or chat input on mobile.
 * Dismissed by tapping outside the keyboard or pressing Done.
 */
class VirtualKeyboard {
  active = false;
  /** Which input to feed: 'bagSearch' | 'craftSearch' | 'chat' | 'redeem' | 'shopSearch' */
  target: 'bagSearch' | 'craftSearch' | 'chat' | 'redeem' | 'shopSearch' | 'playerName' | 'accountInput' = 'bagSearch';
  numMode = false;

  private readonly keysNormal = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', '_'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm', '/', '(', ')'],
  ];
  private readonly keysNum = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
    ['.', ',', '?', '!', "'", '`', '~', '%', '^', '*'],
  ];

  private keyRects: { label: string; rect: Rect; action?: string }[] = [];

  layout(w: number, h: number) {
    this.keyRects = [];
    const kbW = Math.min(420, w - 16);
    const kbH = 200;
    const kx = (w - kbW) / 2;
    const ky = h - kbH - 10;
    const gap = 4;
    const keys = this.numMode ? this.keysNum : this.keysNormal;

    const rowCount = keys.length;
    for (let ri = 0; ri < rowCount; ri++) {
      const row = keys[ri];
      const totalGap = (row.length - 1) * gap;
      const keyW = (kbW - totalGap) / row.length;
      const keyH = 38;
      const rowY = ky + ri * (keyH + gap);
      const rowOffset = (kbW - (row.length * keyW + totalGap)) / 2;
      for (let ci = 0; ci < row.length; ci++) {
        const kx2 = kx + rowOffset + ci * (keyW + gap);
        this.keyRects.push({ label: row[ci], rect: { x: kx2, y: rowY, w: keyW, h: keyH } });
      }
    }

    // Bottom row: 123/ABC toggle, Space, Done
    const bottomY = ky + rowCount * (38 + gap);
    const toggleW = 56;
    const spaceW = kbW - toggleW * 2 - gap * 2;
    this.keyRects.push({
      label: this.numMode ? 'ABC' : '123',
      rect: { x: kx, y: bottomY, w: toggleW, h: 38 },
      action: 'toggle',
    });
    this.keyRects.push({
      label: ' ',
      rect: { x: kx + toggleW + gap, y: bottomY, w: spaceW, h: 38 },
      action: 'space',
    });
    this.keyRects.push({
      label: 'Done',
      rect: { x: kx + toggleW + gap + spaceW + gap, y: bottomY, w: toggleW, h: 38 },
      action: 'done',
    });

    // Backspace: add to the right of the last letter row
    if (!this.numMode) {
      const lastRow = this.keyRects.filter(r => !r.action);
      if (lastRow.length > 0) {
        const last = lastRow[lastRow.length - 1];
        this.keyRects.push({
          label: '⌫',
          rect: { x: last.rect.x + last.rect.w + gap, y: last.rect.y, w: 52, h: 38 },
          action: 'backspace',
        });
      }
    } else {
      // For num mode, add backspace at the end of the last row
      const last = this.keyRects[this.keyRects.length - 1];
      if (last && !last.action) {
        this.keyRects.push({
          label: '⌫',
          rect: { x: last.rect.x + last.rect.w + gap, y: last.rect.y, w: 52, h: 38 },
          action: 'backspace',
        });
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (!this.active) return;
    this.layout(w, h);

    // Semi-transparent backdrop
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, w, h);

    // Keyboard background
    const kbW = Math.min(420, w - 16);
    const kbH = 200;
    const kx = (w - kbW) / 2;
    const ky = h - kbH - 10;
    ctx.fillStyle = '#2a2a2e';
    roundRect(ctx, kx - 4, ky - 4, kbW + 8, kbH + 52 + 8, 5);
    ctx.fill();

    for (const kr of this.keyRects) {
      const r = kr.rect;
      const isAction = !!kr.action;
      ctx.fillStyle = isAction ? '#4a4a50' : '#3a3a3e';
      roundRect(ctx, r.x, r.y, r.w, r.h, 6);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${kr.label === ' ' ? 10 : 16}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(kr.label, r.x + r.w / 2, r.y + r.h / 2);
    }
  }

  handleClick(mx: number, my: number): { handled: boolean; key?: string } {
    if (!this.active) return { handled: false };
    for (const kr of this.keyRects) {
      if (hit(kr.rect, mx, my)) {
        if (kr.action === 'done') {
          // Chat mode: Done = Enter (send message)
          if (this.target === 'chat') {
            return { handled: true, key: 'Enter' };
          }
          this.active = false;
          return { handled: true };
        }
        if (kr.action === 'toggle') {
          this.numMode = !this.numMode;
          return { handled: true };
        }
        if (kr.action === 'backspace') {
          return { handled: true, key: 'Backspace' };
        }
        if (kr.action === 'space') {
          return { handled: true, key: ' ' };
        }
        return { handled: true, key: kr.label };
      }
    }
    // Click outside keyboard area → dismiss
    const kbW = Math.min(420, this.keyRects.length > 0 ? 420 : 0);
    const kx = (this.keyRects.length > 0 ? this.keyRects[0].rect.x : 0);
    const ky = (this.keyRects.length > 0 ? this.keyRects[0].rect.y : 0);
    const kbRect: Rect = { x: kx - 8, y: ky - 8, w: kbW + 16, h: 260 };
    if (!hit(kbRect, mx, my)) {
      this.active = false;
      return { handled: true };
    }
    return { handled: false };
  }
}

export class AccountSystem {
  [k: string]: any;

  currentUser: string | null;
  users: Map<string, any>;
  STORAGE_KEY = "flwrr_accounts_data";
  LAST_USER_KEY = "flwrr_last_user";
  LOGIN_COUNT_KEY = "flwrr_login_counts";
  SESSION_STATS_KEY = "flwrr_session_stats";

  panelOpen = false;
  /** 面板划入动画进度(0=关闭,1=完全展开;参考背包 bagAnim,由 GameClient.update 驱动)。 */
  openAnim = 0;
  /** 最近一次 draw() 的屏幕高度(供 _drawPanel 计算滑入距离)。 */
  private _animH = 600;
  panelW = 480;
  panelH = 650;
  panelX = 0;
  panelY = 0;
  screen: "menu" | "login" | "register" | "profile" = "menu";
  hoveredBtn: string | null = null;
  message: { text: string; color: string; ttl: number } | null = null;

  _panelScale = 1;
  _panelCX = 0;
  _panelCY = 0;
  _uiK = 1;
  _isLandscape = false;

  private _conv(mx: number, my: number): [number, number] {
    if (this._panelScale === 1) return [mx, my];
    return [
      this._panelCX + (mx - this._panelCX) / this._panelScale,
      this._panelCY + (my - this._panelCY) / this._panelScale,
    ];
  }

  inputs: Record<string, any> = {
    login_user:  { value: "", focused: false, label: "Username",         type: "text" },
    login_pass:  { value: "", focused: false, label: "Password",         type: "password" },
    reg_user:    { value: "", focused: false, label: "Username",         type: "text" },
    reg_pass:    { value: "", focused: false, label: "Password",         type: "password" },
    reg_confirm: { value: "", focused: false, label: "Confirm Password", type: "password" },
  };
  showPassLogin = false;
  showPassReg = false;
  showPassConfirm = false;

  _btns: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
  _sessionStart: number | null = null;
  _profileScrollOffset = 0;
  _profileMaxOffset = 0;
  _draggingScroll = false;
  _dragStartY = 0;
  _dragStartOffset = 0;

  _statsUpdateTimer: any = null;
  _cloudSaveTimer: any = null;
  _justFocusedAt = 0;
  loginCounts: Record<string, number> = {};

  constructor() {
    this.currentUser = null;
    this.users = new Map();
    this.loadAllUsers();
    this.loadLoginCounts();
    this.loadSessionStats();
    setInterval(() => {
      if (this.currentUser) { this.saveSessionStats(); this.saveAllUsers(); }
    }, 30000);
    setTimeout(() => this.autoLogin(), 500);
    this._startStatsUpdate();
  }

  _startStatsUpdate() {
    if (this._statsUpdateTimer) clearInterval(this._statsUpdateTimer);
    this._statsUpdateTimer = setInterval(() => {
      if (this.currentUser && this.panelOpen && this.screen === "profile") {
        this.updateCurrentSessionStats();
      }
    }, 10000);
  }

  updateCurrentSessionStats() {
    if (!this.currentUser) return;
    const ud = this.users.get(this.currentUser);
    if (!ud) return;
    const game: any = (window as any).gameInstance;
    if (this._sessionStart) {
      ud.stats.totalPlayTime = (ud.stats.totalPlayTime || 0) + (Date.now() - this._sessionStart);
      this._sessionStart = Date.now();
    }
    if (game) {
      if ((game.score || 0) > (ud.stats.highestScore || 0)) ud.stats.highestScore = game.score;
      if (game.enemiesKilled !== undefined) {
        const diff = game.enemiesKilled - (ud.stats.lastSyncedKills || 0);
        if (diff > 0) { ud.stats.totalKills = (ud.stats.totalKills || 0) + diff; ud.stats.lastSyncedKills = game.enemiesKilled; }
      }
      if (game.player?.xp !== undefined) {
        const diff = game.player.xp - (ud.stats.lastSyncedXp || 0);
        if (diff > 0) { ud.stats.totalXp = (ud.stats.totalXp || 0) + diff; ud.stats.lastSyncedXp = game.player.xp; }
      }
      if (game.player?.inventory?.craftingSystem) {
        const cs = game.player.inventory.craftingSystem;
        if ((cs.totalCrafted || 0) > (ud.stats.petalsCrafted || 0)) ud.stats.petalsCrafted = cs.totalCrafted;
        if ((cs.totalBurned  || 0) > (ud.stats.petalsBurned  || 0)) ud.stats.petalsBurned  = cs.totalBurned;
      }
    }
    this.saveAllUsers();
  }

  saveSessionStats() {
    if (!this.currentUser) return;
    const ud = this.users.get(this.currentUser);
    if (!ud) return;
    if (this._sessionStart) {
      ud.stats.totalPlayTime = (ud.stats.totalPlayTime || 0) + (Date.now() - this._sessionStart);
      this._sessionStart = Date.now();
    }
    this.saveAllUsers();
  }

  loadSessionStats() {
    try { if (localStorage.getItem(this.SESSION_STATS_KEY)) JSON.parse(localStorage.getItem(this.SESSION_STATS_KEY) || "{}"); } catch(_e) {}
  }

  openPanel() {
    this.panelOpen = true;
    this.screen = this.currentUser ? "profile" : "menu";
    this.message = null;
    this._profileScrollOffset = 0;
    this._clearInputs();
    if (this.currentUser) this.updateCurrentSessionStats();
  }

  closePanel() {
    this.panelOpen = false;
    this.screen = "menu";
    this.message = null;
    this._clearInputs();
    if (this.currentUser) this.saveSessionStats();
  }

  /** 面板划入动画进度推进(目标 = panelOpen)。 */
  updateOpenAnim(dt: number) {
    this.openAnim += ((this.panelOpen ? 1 : 0) - this.openAnim) * Math.min(1, dt * 10);
  }

  _clearInputs() {
    for (const k of Object.keys(this.inputs)) { this.inputs[k].value = ""; this.inputs[k].focused = false; }
    this.showPassLogin = this.showPassReg = this.showPassConfirm = false;
    (window as any).hideMobileKeyboard?.();
    const game: any = (window as any).gameInstance;
    if (game?.vk) game.vk.active = false;
  }

  _focusInput(key: string | null) {
    for (const k of Object.keys(this.inputs)) this.inputs[k].focused = false;
    if (key) {
      this.inputs[key].focused = true;
      this._justFocusedAt = Date.now();
      const inp = this.inputs[key];
      (window as any).showMobileKeyboard?.(inp.value, (val: string) => { inp.value = val; });
      // Activate the canvas virtual keyboard on mobile / when forced via settings
      const game: any = (window as any).gameInstance;
      if (game && (game.isMobile || game.settings?.virtualKeyboard)) {
        game.vk.active = true;
        game.vk.target = 'accountInput';
        game.vk.numMode = false;
      }
    } else {
      (window as any).hideMobileKeyboard?.();
      const game: any = (window as any).gameInstance;
      if (game?.vk) game.vk.active = false;
    }
  }

  _focusedKey(): string | null { return Object.keys(this.inputs).find(k => this.inputs[k].focused) || null; }

  updateUIAfterLogin() {
    const el = document.getElementById("current-user");
    if (el) { el.style.display = "block"; el.innerHTML = `👤 ${this.currentUser}`; }
    (window as any).gameInstance?.mainMenu?.recalculatePositions?.();
  }

  clearAutoLogin() { localStorage.removeItem(this.LAST_USER_KEY); }

  draw(ctx: CanvasRenderingContext2D) {
    if (!this.panelOpen) return;
    const W = (window as any).WIDTH || (window as any).innerWidth || ctx.canvas.width;
    const H = (window as any).HEIGHT || (window as any).innerHeight || ctx.canvas.height;
    this._animH = H;

    const isMobileView = H < 640;
    this._isLandscape = isMobileView && W > H;
    const margin = isMobileView ? 12 : 40;

    let maxW: number, maxH: number;
    if (this._isLandscape) { maxW = 700; maxH = 340; }
    else { maxW = isMobileView ? 350 : 480; maxH = 650; }

    this.panelW = Math.min(maxW, W - margin);
    this.panelH = Math.min(maxH, H - margin);
    this.panelX = Math.floor((W - this.panelW) / 2);
    this.panelY = Math.floor((H - this.panelH) / 2);

    if (this._isLandscape) { this._panelScale = 0.95; this._uiK = 0.82; }
    else if (isMobileView) { this._panelScale = 0.9; this._uiK = 0.8; }
    else { this._panelScale = 1; this._uiK = 1; }

    this._panelCX = this.panelX + this.panelW / 2;
    this._panelCY = this.panelY + this.panelH / 2;

    this._btns = [];
    if (this.message) { this.message.ttl -= 16; if (this.message.ttl <= 0) this.message = null; }

    this._drawPanel(ctx);
  }

  _drawPanel(ctx: CanvasRenderingContext2D) {
    const { panelX: px, panelY: py, panelW: pw, panelH: ph } = this;
    ctx.save();
    // 划入动画:淡入 + 从屏幕底部滑入(ease.outCubic,与背包面板一致)
    ctx.globalAlpha = Math.min(1, this.openAnim * 1.6);

    if (this._panelScale !== 1) {
      ctx.translate(this._panelCX, this._panelCY);
      ctx.scale(this._panelScale, this._panelScale);
      ctx.translate(-this._panelCX, -this._panelCY);
    }
    ctx.translate(0, (1 - ease.outCubic(this.openAnim)) * (this._animH + 20));

    ctx.fillStyle = "#d94b4b";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(px, py, pw, ph, 5); else ctx.rect(px, py, pw, ph);
    ctx.fill();

    ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 6;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(px, py, pw, ph, 5); else ctx.rect(px, py, pw, ph);
    ctx.stroke();

    const hdrH = 52;
    ctx.fillStyle = "#c83f3f";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(px, py, pw, hdrH, [16, 16, 0, 0]); else ctx.rect(px, py, pw, hdrH);
    ctx.fill();

    ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px + 10, py + hdrH); ctx.lineTo(px + pw - 10, py + hdrH); ctx.stroke();

    this.drawStrokedText(ctx, "Account", px + pw / 2, py + hdrH / 2, 20, "center", "white");

    this._drawStyledButton(ctx, "✕", [px + pw - 38, py + 10, 28, 28], [220, 80, 80], 16);
    this._registerBtn("close", px + pw - 38, py + 10, 28, 28);

    const contentY = py + hdrH + 10;
    const contentH = ph - hdrH - 10;
    ctx.save();
    ctx.beginPath(); ctx.rect(px, py + hdrH, pw, contentH); ctx.clip();

    if      (this.screen === "menu")     this._drawMenu(ctx, px, contentY, pw, contentH);
    else if (this.screen === "login")    this._drawLogin(ctx, px, contentY, pw, contentH);
    else if (this.screen === "register") this._drawRegister(ctx, px, contentY, pw, contentH);
    else if (this.screen === "profile")  this._drawProfile(ctx, px, contentY, pw, contentH);

    if (this.message) {
      const fade = Math.min(1, this.message.ttl / 400);
      const isErr = this.message.color === "error";
      const mw = pw - 40, mh = 36 * this._uiK, mx = px + 20;
      const my = this._isLandscape ? py + ph - 80 : py + ph - 56;
      ctx.globalAlpha = fade;
      ctx.fillStyle = isErr ? "rgba(180,30,30,0.92)" : "rgba(30,130,60,0.92)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(mx, my, mw, mh, 8); else ctx.rect(mx, my, mw, mh);
      ctx.fill();
      this.drawStrokedText(ctx, this.message.text, mx + mw / 2, my + mh / 2, 12 * this._uiK, "center", "white");
      ctx.globalAlpha = 1;
    }

    ctx.restore();
    ctx.restore();
  }

  // --- Menu screen -----------------------------------------------------
  _drawMenu(ctx: CanvasRenderingContext2D, px: number, py: number, pw: number, ph: number) {
    const cx = px + pw / 2;
    if (this._isLandscape) {
      const leftCX = px + pw * 0.22;
      this.drawStrokedText(ctx, "lol", leftCX, py + ph * 0.28, 40, "center", "white");
      this.drawStrokedText(ctx, "Flwrr Account", leftCX, py + ph * 0.50, 18, "center", "white");
      this.drawStrokedText(ctx, "Sign in to save your progress", leftCX, py + ph * 0.70, 10, "center", "rgba(255,255,255,0.5)");

      ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px + pw * 0.42, py + 20); ctx.lineTo(px + pw * 0.42, py + ph - 20); ctx.stroke();

      const bw = pw * 0.48, bh = 36, bx = px + pw * 0.5;
      const by1 = py + ph * 0.28, by2 = py + ph * 0.58;
      this._drawStyledButton(ctx, "Sign In",  [bx, by1, bw, bh], [36, 113, 163], 15);
      this._registerBtn("menu_login",    bx, by1, bw, bh);
      this._drawStyledButton(ctx, "Register", [bx, by2, bw, bh], [30, 132, 73],  15);
      this._registerBtn("menu_register", bx, by2, bw, bh);

      this.drawStrokedText(ctx, "Your data is stored locally on this device", cx, py + ph - 14, 10, "center", "rgba(255,255,255,0.3)");
    } else {
      this.drawStrokedText(ctx, "lol", cx, py + 45, 48, "center", "white");
      this.drawStrokedText(ctx, "Flwrr Account", cx, py + 95, 22, "center", "white");
      this.drawStrokedText(ctx, "Sign in to save your progress", cx, py + 125, 12, "center", "rgba(255,255,255,0.5)");
      const bw = pw - 80, bh = 42, bx = px + 40;
      this._drawStyledButton(ctx, "Sign In",  [bx, py + 165, bw, bh], [36, 113, 163], 16);
      this._registerBtn("menu_login",    bx, py + 165, bw, bh);
      this._drawStyledButton(ctx, "Register", [bx, py + 215, bw, bh], [30, 132, 73],  16);
      this._registerBtn("menu_register", bx, py + 215, bw, bh);
      ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px + 30, py + 275); ctx.lineTo(px + pw - 30, py + 275); ctx.stroke();
      this.drawStrokedText(ctx, "Your data is stored locally on this device", cx, py + 295, 11, "center", "rgba(255,255,255,0.3)");
    }
  }

  // --- Login screen ----------------------------------------------------
  _drawLogin(ctx: CanvasRenderingContext2D, px: number, py: number, pw: number, ph: number) {
    const cx = px + pw / 2;
    if (this._isLandscape) {
      this._drawStyledButton(ctx, "←", [px + 10, py + 4, 24, 24], [100, 100, 120], 14);
      this._registerBtn("back", px + 10, py + 4, 24, 24);
      this.drawStrokedText(ctx, "Sign In", cx, py + 22, 16, "center", "white");
      const colW = Math.floor((pw - 52) / 2);
      const iy = py + 42;
      this._drawInput(ctx, px + 16, iy, colW - 8, "login_user", false);
      this._drawInput(ctx, px + 28 + colW, iy, colW - 8, "login_pass", true, this.showPassLogin, "toggle_pass_login");
      const btnW = Math.min(180, pw * 0.35);
      const btnX = px + (pw - btnW) / 2;
      const btnY = iy + 52;
      this._drawStyledButton(ctx, "Sign In", [btnX, btnY, btnW, 34], [36, 113, 163], 15);
      this._registerBtn("do_login", btnX, btnY, btnW, 34);
    } else {
      this._drawStyledButton(ctx, "←", [px + 16, py + 5, 28, 28], [100, 100, 120], 16);
      this._registerBtn("back", px + 16, py + 5, 28, 28);
      this.drawStrokedText(ctx, "Sign In", cx, py + 35, 18, "center", "white");
      let iy = py + 65;
      iy = this._drawInput(ctx, px + 24, iy, pw - 48, "login_user", false) + 12;
      iy = this._drawInput(ctx, px + 24, iy, pw - 48, "login_pass", true, this.showPassLogin, "toggle_pass_login") + 20;
      this._drawStyledButton(ctx, "Sign In", [px + 24, iy, pw - 48, 42], [36, 113, 163], 16);
      this._registerBtn("do_login", px + 24, iy, pw - 48, 42);
    }
  }

  // --- Register screen -------------------------------------------------
  _drawRegister(ctx: CanvasRenderingContext2D, px: number, py: number, pw: number, ph: number) {
    const cx = px + pw / 2;
    if (this._isLandscape) {
      this._drawStyledButton(ctx, "←", [px + 10, py + 4, 24, 24], [100, 100, 120], 14);
      this._registerBtn("back", px + 10, py + 4, 24, 24);
      this.drawStrokedText(ctx, "Create Account", cx, py + 22, 16, "center", "white");
      const colW = Math.floor((pw - 52) / 2);
      const iy = py + 42;
      this._drawInput(ctx, px + 16, iy, colW - 8, "reg_user", false);
      this._drawInput(ctx, px + 28 + colW, iy, colW - 8, "reg_pass", true, this.showPassReg, "toggle_pass_reg");
      const iy2 = iy + 52;
      this._drawInput(ctx, px + 16, iy2, colW - 8, "reg_confirm", true, this.showPassConfirm, "toggle_pass_confirm");
      const btnW = colW - 8, btnX = px + 28 + colW;
      this._drawStyledButton(ctx, "Create Account", [btnX, iy2 + 4, btnW, 34], [30, 132, 73], 14);
      this._registerBtn("do_register", btnX, iy2 + 4, btnW, 34);
    } else {
      this._drawStyledButton(ctx, "←", [px + 16, py + 5, 28, 28], [100, 100, 120], 16);
      this._registerBtn("back", px + 16, py + 5, 28, 28);
      this.drawStrokedText(ctx, "Create Account", cx, py + 35, 18, "center", "white");
      let iy = py + 65;
      iy = this._drawInput(ctx, px + 24, iy, pw - 48, "reg_user",    false) + 12;
      iy = this._drawInput(ctx, px + 24, iy, pw - 48, "reg_pass",    true, this.showPassReg,     "toggle_pass_reg")     + 12;
      iy = this._drawInput(ctx, px + 24, iy, pw - 48, "reg_confirm", true, this.showPassConfirm, "toggle_pass_confirm") + 20;
      this._drawStyledButton(ctx, "Create Account", [px + 24, iy, pw - 48, 42], [30, 132, 73], 16);
      this._registerBtn("do_register", px + 24, iy, pw - 48, 42);
    }
  }

  // --- Profile screen --------------------------------------------------
  _drawProfile(ctx: CanvasRenderingContext2D, px: number, py: number, pw: number, ph: number) {
    const cx = px + pw / 2;
    const ud: any    = this.currentUser ? this.users.get(this.currentUser) || {} : {};
    const stats: any = ud.stats || {};
    const now   = Date.now();
    const sessionMs   = this._sessionStart ? (now - this._sessionStart) : 0;
    const totalPlayMs = (stats.totalPlayTime || 0) + sessionMs;

    const statItems = [
      { label: "Time Joined",    value: this._formatDate(ud.createdAt) },
      { label: "Time Played",    value: this._formatDuration(totalPlayMs) },
      { label: "XP",            value: this._formatNum(stats.totalXp) },
      { label: "Games Played",  value: this._formatNum(stats.gamesPlayed) },
      { label: "Mobs Killed",    value: this._formatNum(stats.totalKills) },
      { label: "Petals Picked", value: this._formatNum(stats.petalsPicked) },
      { label: "Petals Crafted",value: this._formatNum(stats.petalsCrafted) },
      { label: "Petals Burned", value: this._formatNum(stats.petalsBurned) },
      { label: "Max Score",     value: this._formatNum(stats.highestScore) },
    ];

    if (this._isLandscape) {
      const leftW = Math.floor(pw * 0.26);
      const avR = 26, avX = px + leftW / 2, avY = py + ph * 0.35;
      ctx.save();
      ctx.fillStyle = "#e74c3c";
      ctx.beginPath(); ctx.arc(avX, avY, avR, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#C82B19"; ctx.lineWidth = 3; ctx.stroke();
      this._drawStar(ctx, avX, avY, 5, 14, 7, "#9C0000");
      ctx.restore();
      this.drawStrokedText(ctx, this.currentUser || "", avX, py + ph * 0.62, 13, "center", "#ffffff");

      ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px + leftW + 4, py + 10); ctx.lineTo(px + leftW + 4, py + ph - 10); ctx.stroke();

      const rightX = px + leftW + 14;
      const rightW = pw - leftW - 24;
      const cols = 3;
      const cellW = Math.floor((rightW - 16) / cols);
      const cellH = Math.floor((ph - 60) / 3);
      const gridTop = py + 10;

      this._profileMaxOffset = 0;
      this._profileScrollOffset = 0;

      for (let i = 0; i < statItems.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const item = statItems[i];
        const cx2 = rightX + col * cellW;
        const cy2 = gridTop + row * cellH;
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(cx2, cy2, cellW - 8, cellH - 8, 8); else ctx.rect(cx2, cy2, cellW - 8, cellH - 8);
        ctx.fill();
        this.drawStrokedText(ctx, item.label, cx2 + (cellW-8)/2, cy2 + 14, 10, "center", "rgba(255,255,255,0.6)");
        this.drawStrokedText(ctx, item.value,  cx2 + (cellW-8)/2, cy2 + 32, 12, "center", "white");
      }

      const btnY = py + ph - 40;
      const btnH = 30;
      const gap = 6;
      const btnW = Math.floor((rightW - gap * 3) / 4);

      this._drawStyledButton(ctx, "Export",   [rightX,                     btnY, btnW, btnH], [41, 128, 185], 12);
      this._registerBtn("export_items", rightX, btnY, btnW, btnH);
      this._drawStyledButton(ctx, "Import",   [rightX + btnW + gap,        btnY, btnW, btnH], [39, 174, 96],  12);
      this._registerBtn("import_items", rightX + btnW + gap, btnY, btnW, btnH);
      this._drawStyledButton(ctx, "Clear",    [rightX + (btnW + gap) * 2,  btnY, btnW, btnH], [146, 43, 33],  12);
      this._registerBtn("clear_items", rightX + (btnW + gap) * 2, btnY, btnW, btnH);
      this._drawStyledButton(ctx, "Sign Out", [rightX + (btnW + gap) * 3,  btnY, btnW, btnH], [93, 109, 126], 12);
      this._registerBtn("do_logout", rightX + (btnW + gap) * 3, btnY, btnW, btnH);
    } else {
      const avR = 34, avX = cx, avY = py + 38;
      ctx.save();
      ctx.fillStyle = "#e74c3c";
      ctx.beginPath(); ctx.arc(avX, avY, avR, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#C82B19"; ctx.lineWidth = 4; ctx.stroke();
      this._drawStar(ctx, avX, avY, 5, 18, 9, "#9C0000");
      ctx.restore();
      this.drawStrokedText(ctx, this.currentUser || "", cx, py + 80, 18, "center", "#ffffff");

      const cols = 2;
      const cellW = Math.floor((pw - 40) / cols);
      const cellH = 52;
      const rows = Math.ceil(statItems.length / cols);
      const totalCH = rows * cellH;
      const btnAreaH = 4 * 36 + 3 * 6 + 12;
      const gridTop = py + 105;
      const gridH = ph - (gridTop - py) - btnAreaH;

      this._profileMaxOffset = Math.max(0, totalCH - gridH);
      this._profileScrollOffset = Math.max(0, Math.min(this._profileMaxOffset, this._profileScrollOffset));

      ctx.save();
      ctx.beginPath(); ctx.rect(px + 10, gridTop, pw - 20, gridH); ctx.clip();
      const oy = -this._profileScrollOffset;
      for (let i = 0; i < statItems.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const item = statItems[i];
        const cx2 = px + 20 + col * cellW;
        const cy2 = gridTop + oy + row * cellH;
        if (cy2 + cellH < gridTop || cy2 > gridTop + gridH) continue;
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(cx2, cy2, cellW - 8, cellH - 8, 8); else ctx.rect(cx2, cy2, cellW - 8, cellH - 8);
        ctx.fill();
        this.drawStrokedText(ctx, item.label, cx2 + (cellW-8)/2, cy2 + 16, 11, "center", "rgba(255,255,255,0.6)");
        this.drawStrokedText(ctx, item.value,  cx2 + (cellW-8)/2, cy2 + 36, 13, "center", "white");
      }
      if (this._profileMaxOffset > 0) {
        const sbX = px + pw - 14;
        const thumbH = Math.max(28, (gridH / totalCH) * gridH);
        const thumbY = gridTop + (this._profileScrollOffset / this._profileMaxOffset) * (gridH - thumbH);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(sbX, gridTop, 8, gridH, 4); else ctx.rect(sbX, gridTop, 8, gridH);
        ctx.fill();
        ctx.fillStyle = this.hoveredBtn === "scrollbar" ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.35)";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(sbX, thumbY, 8, thumbH, 4); else ctx.rect(sbX, thumbY, 8, thumbH);
        ctx.fill();
        this._registerBtn("scrollbar", sbX - 4, gridTop, 16, gridH);
      }
      ctx.restore();

      const btnY0 = gridTop + gridH + 8;
      const btnH = 36;
      const gap = 6;
      const half = Math.floor((pw - 56) / 2);
      this._drawStyledButton(ctx, "Export", [px + 18,         btnY0,              half, btnH], [41, 128, 185], 13);
      this._registerBtn("export_items", px + 18, btnY0, half, btnH);
      this._drawStyledButton(ctx, "Import", [px + 20 + half,  btnY0,              half, btnH], [39, 174, 96],  13);
      this._registerBtn("import_items", px + 20 + half, btnY0, half, btnH);
      this._drawStyledButton(ctx, "Clear All Items", [px + 18, btnY0 + (btnH+gap),   pw - 36, btnH], [146, 43, 33], 13);
      this._registerBtn("clear_items", px + 18, btnY0 + (btnH+gap), pw - 36, btnH);
      this._drawStyledButton(ctx, "Sign Out",        [px + 18, btnY0 + (btnH+gap)*2, pw - 36, btnH], [93, 109, 126], 13);
      this._registerBtn("do_logout", px + 18, btnY0 + (btnH+gap)*2, pw - 36, btnH);
    }
  }

  // ====================================================================
  //  Draw helpers
  // ====================================================================
  _drawStyledButton(ctx: CanvasRenderingContext2D, text: string, rect: [number, number, number, number], baseColor: [number, number, number], fontSize = 16) {
    let [x, y, w, h] = rect;
    let fs = fontSize;
    const k = this._uiK;
    if (k !== 1) {
      x = x + w / 2 - (w * k) / 2;
      y = y + h / 2 - (h * k) / 2;
      w *= k; h *= k; fs *= k;
    }
    const adj    = (rgb: number[], f: number) => rgb.map(c => Math.min(255, Math.max(0, Math.floor(c * f))));
    const dark   = `rgb(${adj(baseColor, 0.82).join(",")})`;
    const light  = `rgb(${baseColor.join(",")})`;
    const stroke = `rgb(${adj(baseColor, 0.5).join(",")})`;

    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 5); else ctx.rect(x, y, w, h);
    ctx.fillStyle = light; ctx.fill();

    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 5); else ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = dark; ctx.fillRect(x, y, w, h / 2);
    ctx.restore();

    ctx.strokeStyle = stroke; ctx.lineWidth = 4;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 10); else ctx.rect(x, y, w, h);
    ctx.stroke();

    if (text) {
      ctx.font = ` ${fs}px ${FONT_FAMILY}`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.strokeStyle = "black"; ctx.lineWidth = 4; ctx.lineJoin = "round";
      ctx.strokeText(text, x + w / 2, y + h / 2);
      ctx.fillStyle = "white"; ctx.fillText(text, x + w / 2, y + h / 2);
    }
  }

  drawStrokedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fontSize: number, textAlign: CanvasTextAlign = "center", fillColor: string = "white") {
    ctx.save();
    ctx.font = ` ${fontSize}px ${FONT_FAMILY}`;
    ctx.textAlign = textAlign; ctx.textBaseline = "middle";
    ctx.strokeStyle = "black"; ctx.lineWidth = 3; ctx.lineJoin = "round";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fillColor; ctx.fillText(text, x, y);
    ctx.restore();
  }

  _drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, _spikes: number, outer: number, inner: number, _color: string) {
    // 统一为金铜色五角星样式(参考 drawStarIcon)。
    drawStarIcon(ctx, cx, cy, outer, inner);
  }

  _drawInput(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, key: string, isPassword: boolean, showPlain = false, toggleId: string | null = null) {
    const inp = this.inputs[key];
    const k = this._uiK;
    const h = 42 * k, isFoc = inp.focused;
    this.drawStrokedText(ctx, inp.label.toUpperCase(), x, y + 2, 9 * k, "left",
      isFoc ? "#f1c40f" : "rgba(255,255,255,0.5)");
    const bx = x, by = y + 8;
    ctx.fillStyle   = isFoc ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.04)";
    ctx.strokeStyle = isFoc ? "rgba(241,196,15,0.7)"   : "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, w, h, 8); else ctx.rect(bx, by, w, h);
    ctx.fill(); ctx.stroke();
    this._registerBtn(key + "_box", bx, by, w, h);
    const display = isPassword && !showPlain ? "•".repeat(inp.value.length) : inp.value;
    const empty   = inp.value.length === 0;
    ctx.font = `${14 * k}px ${FONT_FAMILY}`;
    ctx.fillStyle = empty ? "rgba(255,255,255,0.2)" : "white";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(empty ? inp.label : display, bx + 12, by + h / 2);
    if (isFoc && !empty && (Date.now() % 1000 < 500)) {
      const tw = ctx.measureText(display).width;
      ctx.fillStyle = "#f1c40f";
      ctx.fillRect(bx + 12 + tw + 2, by + 10, 2, h - 20);
    }
    if (isPassword && toggleId) {
      const ex = bx + w - 32, ey = by + (h - 22) / 2;
      this._registerBtn(toggleId, ex, ey, 22, 22);
      ctx.font = `16px ${FONT_FAMILY}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(showPlain ? "🙈" : "👁️", ex + 11, ey + 11);
    }
    return by + h;
  }

  _registerBtn(id: string, x: number, y: number, w: number, h: number) { this._btns.push({ id, x, y, w, h }); }

  _hitTest(mx: number, my: number): string | null {
    for (let i = this._btns.length - 1; i >= 0; i--) {
      const b = this._btns[i];
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) return b.id;
    }
    return null;
  }

  // ====================================================================
  //  Event handling
  // ====================================================================
  handleMouseMove(mx: number, my: number) {
    if (!this.panelOpen) return false;
    [mx, my] = this._conv(mx, my);
    this.hoveredBtn = this._hitTest(mx, my);
    if (this._draggingScroll && this._profileMaxOffset > 0) {
      const trackH = Math.max(1, this.panelH - 52 - 10 - (4*36 + 3*6 + 12) - 200);
      const ratio  = (my - this._dragStartY) / trackH;
      this._profileScrollOffset = Math.max(0, Math.min(this._profileMaxOffset,
        this._dragStartOffset + ratio * this._profileMaxOffset));
    }
    return true;
  }

  handleMouseDown(mx: number, my: number) {
    if (!this.panelOpen) return false;
    [mx, my] = this._conv(mx, my);
    if (this._hitTest(mx, my) === "scrollbar") {
      this._draggingScroll  = true;
      this._dragStartY      = my;
      this._dragStartOffset = this._profileScrollOffset;
      return true;
    }
    return false;
  }

  handleMouseUp() { this._draggingScroll = false; }

  handleWheel(deltaY: number) {
    if (!this.panelOpen || this.screen !== "profile") return false;
    this._profileScrollOffset = Math.max(0, Math.min(this._profileMaxOffset,
      this._profileScrollOffset + (deltaY > 0 ? 40 : -40)));
    return true;
  }

  handleClick(mx: number, my: number) {
    if (!this.panelOpen) return false;
    [mx, my] = this._conv(mx, my);
    const id = this._hitTest(mx, my);
    if (!id) {
      if (mx < this.panelX || mx > this.panelX + this.panelW ||
        my < this.panelY || my > this.panelY + this.panelH) this.closePanel();
      return true;
    }
    if (id === "scrollbar") return true;

    if (id === "close") { this.closePanel(); return true; }
    if (id === "back")  { this.screen = "menu"; this._clearInputs(); return true; }

    if (id.endsWith("_box")) { this._focusInput(id.replace("_box", "")); return true; }

    if (id === "toggle_pass_login")   { this.showPassLogin   = !this.showPassLogin;   return true; }
    if (id === "toggle_pass_reg")     { this.showPassReg     = !this.showPassReg;     return true; }
    if (id === "toggle_pass_confirm") { this.showPassConfirm = !this.showPassConfirm; return true; }

    if (id === "menu_login")    { this.screen = "login";    return true; }
    if (id === "menu_register") { this.screen = "register"; return true; }

    if (id === "do_login") {
      const u = this.inputs.login_user.value.trim();
      const p = this.inputs.login_pass.value;
      const res = this.login(u, p);
      if (res.success) {
        this._sessionStart = Date.now();
        this.screen = "profile";
        this.message = { text: `✅ Welcome back, ${u}!`, color: "success", ttl: 2800 };
        this._clearInputs();
        this.updateUIAfterLogin();
        if ((window as any).gameInstance?.onLoginSuccess) (window as any).gameInstance.onLoginSuccess(res.gameData);
      } else {
        this.message = { text: `❌ ${res.message}`, color: "error", ttl: 2800 };
      }
      return true;
    }

    if (id === "do_register") {
      const u = this.inputs.reg_user.value.trim();
      const p = this.inputs.reg_pass.value;
      const p2 = this.inputs.reg_confirm.value;
      if (p !== p2) { this.message = { text: "❌ Passwords do not match", color: "error", ttl: 2800 }; return true; }
      const res = this.createAccount(u, p);
      if (res.success) {
        this.message = { text: "✅ Account created! Signing in…", color: "success", ttl: 2800 };
        setTimeout(() => {
          const lr = this.login(u, p);
          if (lr.success) {
            this._sessionStart = Date.now();
            this.screen = "profile";
            this._clearInputs();
            this.updateUIAfterLogin();
          }
        }, 800);
      } else {
        this.message = { text: `❌ ${res.message}`, color: "error", ttl: 2800 };
      }
      return true;
    }

    if (id === "do_logout") {
      this.saveSessionStats();
      this.logout();
      this.screen = "menu";
      const el = document.getElementById("current-user");
      if (el) el.style.display = "none";
      this.message = { text: "👋 Signed out", color: "success", ttl: 2800 };
      return true;
    }

    if (id === "export_items") { this.closePanel(); (window as any).handleExportItems?.(); return true; }
    if (id === "import_items") { this.closePanel(); (window as any).handleImportItems?.(); return true; }
    if (id === "clear_items")  { (window as any).handleClearAllItems?.(); this.message = { text: "🗑️ All items cleared", color: "error", ttl: 2800 }; return true; }

    return true;
  }

  handleKeyDown(e: KeyboardEvent) {
    if (!this.panelOpen) return false;
    const focused = this._focusedKey();

    if (e.key === "Escape") { this.closePanel(); return true; }

    if (e.key === "Tab") {
      const order = this.screen === "login"    ? ["login_user", "login_pass"] :
                    this.screen === "register" ? ["reg_user", "reg_pass", "reg_confirm"] : [];
      if (order.length) {
        if (focused) this._focusInput(order[(order.indexOf(focused) + 1) % order.length]);
        e.preventDefault();
      }
      return true;
    }

    if (e.key === "Enter") {
      const btnId = this.screen === "login" ? "do_login" : this.screen === "register" ? "do_register" : null;
      if (btnId) { const btn = this._btns.find(b => b.id === btnId); if (btn) this.handleClick(btn.x + 1, btn.y + 1); }
      return true;
    }

    if (!focused) return false;
    if (e.key === "Backspace") { this.inputs[focused].value = this.inputs[focused].value.slice(0, -1); return true; }
    if (e.key.length === 1 && this.inputs[focused].value.length < 24) { this.inputs[focused].value += e.key; return true; }
    return false;
  }

  /** Process a single key from the virtual keyboard (canvas VK, not a DOM KeyboardEvent). */
  handleKeyDownChar(key: string) {
    if (!this.panelOpen) return;
    const focused = this._focusedKey();
    if (!focused) return;
    if (key === "Backspace") {
      this.inputs[focused].value = this.inputs[focused].value.slice(0, -1);
    } else if (key === "Enter") {
      const btnId = this.screen === "login" ? "do_login" : this.screen === "register" ? "do_register" : null;
      if (btnId) { const btn = this._btns.find(b => b.id === btnId); if (btn) this.handleClick(btn.x + 1, btn.y + 1); }
    } else if (key.length === 1 && this.inputs[focused].value.length < 24) {
      this.inputs[focused].value += key;
    }
  }

  // ====================================================================
  //  Formatting
  // ====================================================================
  _formatDate(ts: number) {
    if (!ts) return "—";
    const d = new Date(ts);
    return `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}/${String(d.getFullYear()).slice(2)}`;
  }

  _formatDuration(ms: number) {
    if (!ms || ms <= 0) return "0m";
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m` : "<1m";
  }

  _formatNum(n: number) {
    if (!n) return "0";
    if (n >= 1000000000) return (n / 1000000000).toFixed(2) + "b";
    if (n >= 1000000)     return (n / 1000000).toFixed(2) + "m";
    if (n >= 1000)         return (n / 1000).toFixed(1) + "k";
    return n.toLocaleString();
  }

  // ====================================================================
  //  Core account logic
  // ====================================================================
  loadAllUsers() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      this.users = raw ? new Map(Object.entries(JSON.parse(raw))) : new Map();
      if (!raw) this.saveAllUsers();
    } catch(_e) { this.users = new Map(); }
  }

  loadLoginCounts() {
    try { this.loginCounts = JSON.parse(localStorage.getItem(this.LOGIN_COUNT_KEY) || "{}"); }
    catch(_e) { this.loginCounts = {}; }
  }

  saveLoginCounts() {
    try { localStorage.setItem(this.LOGIN_COUNT_KEY, JSON.stringify(this.loginCounts)); } catch(_e) {}
  }

  recordLogin(username: string) {
    this.loginCounts[username] = (this.loginCounts[username] || 0) + 1;
    this.saveLoginCounts();
    localStorage.setItem(this.LAST_USER_KEY, username);
  }

  getMostUsedAccount(): string | null {
    let best: string | null = null, max = 0;
    for (const [u, c] of Object.entries(this.loginCounts)) {
      if (this.users.has(u) && c > max) { max = c; best = u; }
    }
    return best;
  }

  getLastLoginAccount(): string | null { return localStorage.getItem(this.LAST_USER_KEY); }

  async autoLogin() {
    if (this.currentUser) return;
    const username = this.getLastLoginAccount() || this.getMostUsedAccount();
    if (!username) return;
    const ud = this.users.get(username);
    if (!ud) return;
    this.currentUser   = username;
    ud.lastLogin       = Date.now();
    this._sessionStart = Date.now();

    if ((window as any).showCloudLoading) (window as any).showCloudLoading("Loading save...");
    const remote = await (window as any).cloudLoad?.(username, (window as any).getSaveToken?.(username));
    if ((window as any).hideCloudLoading) (window as any).hideCloudLoading();
    if (remote && remote !== "OFFLINE" && (!ud.gameData || (remote.timestamp || 0) > (ud.gameData.timestamp || 0))) {
      ud.gameData = remote;
    }

    this.saveAllUsers();
    this.updateUIAfterLogin();
    if ((window as any).gameInstance?.onLoginSuccess) (window as any).gameInstance.onLoginSuccess(ud.gameData);
    return { success: true, gameData: ud.gameData };
  }

  saveAllUsers() {
    try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(Object.fromEntries(this.users))); return true; }
    catch(_e) { return false; }
  }

  createAccount(username: string, password: string) {
    if (this.users.has(username)) return { success: false, message: "Username already taken" };
    if (username.length < 3 || username.length > 20) return { success: false, message: "Username must be 3–20 characters" };
    if (password.length < 3 || password.length > 20) return { success: false, message: "Password must be 3–20 characters" };

    this.users.set(username, {
      username,
      password: this.hashPassword(password),
      createdAt: Date.now(),
      lastLogin: null,
      gameData: null,
      stats: {
        totalPlayTime: 0,
        totalKills: 0,
        highestScore: 0,
        gamesPlayed: 0,
        wins: 0,
        multiplayerGames: 0,
        singleGames: 0,
        petalsBurned: 0,
        petalsCrafted: 0,
        petalsPicked: 0,
        totalXp: 0,
        totalDamage: 0,
        lastSyncedKills: 0,
        lastSyncedXp: 0,
      },
    });

    const saved = this.saveAllUsers();
    if (!saved) return { success: false, message: "Save failed, please retry" };

    const loginResult = this.login(username, password);
    if (loginResult.success && (window as any).gameInstance) {
      const gi = (window as any).gameInstance;
      if (gi.player) {
        gi.player.xp = 0;
        if (gi.player.levelSystem) {
          gi.player.levelSystem.level = 1;
          gi.player.levelSystem.currentXp = 0;
        }
      }
      gi.initializeDefaultItems?.();
      gi.syncAllPetalsFromQuickSlot?.();
      gi.requestRedraw?.();
    }

    return { success: true };
  }

  login(username: string, password: string) {
    const ud = this.users.get(username);
    if (!ud) return { success: false, message: "Username not found" };
    if (ud.password !== this.hashPassword(password)) return { success: false, message: "Incorrect password" };

    ud.lastLogin = Date.now();
    ud.stats.gamesPlayed = (ud.stats.gamesPlayed || 0) + 1;
    this.currentUser = username;
    this.saveAllUsers();
    this.recordLogin(username);

    const gi = (window as any).gameInstance;
    if (gi && gi.player) {
      const gameData = ud.gameData;
      if (gameData) {
        this.applyGameData(gi.player, gameData);
      } else {
        gi.player.xp = 0;
        if (gi.player.levelSystem) {
          gi.player.levelSystem.level = 1;
          gi.player.levelSystem.currentXp = 0;
        }
        gi.initializeDefaultItems?.();
      }

      gi.syncAllPetalsFromQuickSlot?.();
      if (gi.player.inventory) gi.player.inventory.cacheDirty = true;
      gi.requestRedraw?.();
    }

    this.updateUIAfterLogin();

    (window as any).cloudLoad?.(username, (window as any).getSaveToken?.(username)).then((remote: any) => {
      if (remote && remote !== "OFFLINE" && (window as any).gameInstance?.player) {
        if (!ud.gameData || (remote.timestamp || 0) > (ud.gameData.timestamp || 0)) {
          ud.gameData = remote;
          this.applyGameData((window as any).gameInstance.player, remote);
          (window as any).gameInstance.syncAllPetalsFromQuickSlot?.();
          if ((window as any).gameInstance.player.inventory) (window as any).gameInstance.player.inventory.cacheDirty = true;
          (window as any).gameInstance.requestRedraw?.();
        }
      }
    });

    return { success: true, gameData: ud.gameData, stats: ud.stats };
  }

  logout() {
    if (this.currentUser) this.saveSessionStats();
    this.currentUser = null; this._sessionStart = null;
  }

  addPlayTime(ms: number) {
    if (!this.currentUser) return;
    const ud = this.users.get(this.currentUser);
    if (ud) ud.stats.totalPlayTime = (ud.stats.totalPlayTime || 0) + ms;
  }

  saveGameData(player: any, gameData: any, craftData: any = {}) {
    if (!this.currentUser) return false;
    const ud = this.users.get(this.currentUser);
    if (!ud) return false;
    if (!ud.stats) ud.stats = {};
    if (gameData) {
      if ((gameData.score||0) > (ud.stats.highestScore||0)) ud.stats.highestScore = gameData.score;
      if (gameData.enemiesKilled) {
        const diff = gameData.enemiesKilled - (ud.stats.lastSyncedKills||0);
        if (diff > 0) { ud.stats.totalKills = (ud.stats.totalKills||0) + diff; ud.stats.lastSyncedKills = gameData.enemiesKilled; }
      }
      if (gameData.xpGained) {
        const diff = gameData.xpGained - (ud.stats.lastSyncedXp||0);
        if (diff > 0) { ud.stats.totalXp = (ud.stats.totalXp||0) + diff; ud.stats.lastSyncedXp = gameData.xpGained; }
      }
      if (gameData.damageDealt) ud.stats.totalDamage = (ud.stats.totalDamage||0) + gameData.damageDealt;
    }
    if (craftData.petalsBurned)  ud.stats.petalsBurned  = (ud.stats.petalsBurned ||0) + craftData.petalsBurned;
    if (craftData.petalsCrafted) ud.stats.petalsCrafted = (ud.stats.petalsCrafted||0) + craftData.petalsCrafted;
    ud.gameData = this.prepareGameData(player, gameData);
    const saved = this.saveAllUsers();

    clearTimeout(this._cloudSaveTimer);
    this._cloudSaveTimer = setTimeout(() => {
      (window as any).cloudSave?.(this.currentUser, (window as any).getSaveToken?.(this.currentUser), ud.gameData);
    }, 4000);

    return saved;
  }

  loadGameData() {
    if (!this.currentUser) return null;
    return this.users.get(this.currentUser)?.gameData || null;
  }

  prepareGameData(player: any, gameData: any) {
    const gi = (window as any).gameInstance;
    const autoSave  = gi?.autoSaveSystem;
    const slotCount = player.getTotalSlotCount?.() ?? 5;
    const compSlots = (slots: any) => {
      if (!slots) return [];
      if (autoSave?.compressSlotsForCloud) return autoSave.compressSlotsForCloud(slots);
      return slots.map((item: any, i: number) => item?.toDict ? { slot_index: i, ...item.toDict() } : null).filter(Boolean);
    };
    return {
      timestamp: Date.now(), slot_count: slotCount, compressed: true,
      player_data: {
        player_rarity: player.playerRarity || "Common", health: player.health || 100,
        max_health: player.maxHealth || 100, petal_count: player.petalCount || 5,
        level: player.levelSystem?.level || 1, current_xp: player.levelSystem?.currentXp || 0,
        total_xp: player.xp || 0,
        player_position: {
          x: player.physicsBody?.position?.x || ((window as any).WORLD_WIDTH||5000)/2,
          y: player.physicsBody?.position?.y || ((window as any).WORLD_HEIGHT||5000)/2,
        },
      },
      inventory: (autoSave?.compressItemsForCloud)
        ? autoSave.compressItemsForCloud(player.inventory?.items || [])
        : (player.inventory?.items || []).map((i: any) => i?.toDict?.()).filter(Boolean),
      quick_slot: compSlots(player.quickSlot?.slots),
      secondary_slot: compSlots(player.quickSlot?.secondarySlots),
      game_data: { score: gameData?.score||0, enemies_killed: gameData?.enemiesKilled||0, current_wave: gameData?.currentWave||1 },
      version: "2.0.0",
    };
  }

  applyGameData(player: any, saveData: any) {
    if (!saveData) return null;
    const gi = (window as any).gameInstance;
    const autoSave    = gi?.autoSaveSystem;
    const isCompressed = saveData.compressed === true;
    const targetCount = Math.max(saveData.slot_count||5, player.getTotalSlotCount?.() ?? 5);

    if (saveData.player_data) {
      const pd = saveData.player_data;
      if (player.levelSystem) {
        player.levelSystem.level     = pd.level || 1;
        player.levelSystem.currentXp = pd.current_xp || 0;
        player.xp        = pd.total_xp || 0;
        player.baseMaxHealth = player.levelSystem.getHpForLevel(player.levelSystem.level);
        player.maxHealth = pd.max_health || player.baseMaxHealth;
        player.health    = Math.min(pd.health || player.maxHealth, player.maxHealth);
      }
      player.petalCount = Math.max(5, pd.petal_count||5, targetCount);
      if (pd.player_rarity) player.playerRarity = pd.player_rarity;
      if (pd.player_position && player.physicsBody) {
        player.physicsBody.position.x = pd.player_position.x || ((window as any).WORLD_WIDTH||5000)/2;
        player.physicsBody.position.y = pd.player_position.y || ((window as any).WORLD_HEIGHT||5000)/2;
      }
    }

    if (player.inventory) player.inventory.items = [];
    if (player.quickSlot) {
      player.quickSlot.slots          = new Array(targetCount).fill(null);
      player.quickSlot.secondarySlots = new Array(targetCount).fill(null);
    }

    const makeItem = (d: any) => {
      if (!d?.type || !d?.rarity) return null;
      try {
        const DNA = (window as any).DNA, Item = (window as any).Item;
        const item = d.type === "DNA" ? new DNA(d.rarity, parseInt(d.level)||1) : new Item(d.type, parseInt(d.level)||1, d.rarity);
        item.count = d.count || 1;
        ["durability","maxDurability","isBroken","reloadTime","baseReloadTime","armor"].forEach(k => { if (d[k] !== undefined) item[k] = d[k]; });
        return item;
      } catch(_e) { return null; }
    };

    if (saveData.inventory && player.inventory)
      player.inventory.items = (isCompressed && autoSave?.decompressItemsForCloud)
        ? autoSave.decompressItemsForCloud(saveData.inventory)
        : saveData.inventory.map(makeItem).filter(Boolean);

    const restoreSlots = (raw: any, slots: any[]) => {
      if (isCompressed && autoSave?.decompressSlotsForCloud) {
        autoSave.decompressSlotsForCloud(raw, targetCount).forEach((item: any, i: number) => { if (item && i < slots.length) slots[i] = item; });
      } else {
        raw.forEach((d: any) => { if (d?.slot_index < slots.length) { const item = makeItem(d); if (item) slots[d.slot_index] = item; } });
      }
    };
    if (saveData.quick_slot     && player.quickSlot) restoreSlots(saveData.quick_slot,     player.quickSlot.slots);
    if (saveData.secondary_slot && player.quickSlot) restoreSlots(saveData.secondary_slot, player.quickSlot.secondarySlots);

    this.recreatePetals(player);
    player.updateStatsFromPetals?.();
    for (let i = 0; i < player.quickSlot.slots.length; i++) player.quickSlot.updatePetalFromSlot(i);
    return saveData.game_data || {};
  }

  recreatePetals(player: any) {
    const qs = player.quickSlot.slots, old = player.petals;
    const Petal = (window as any).Petal;
    if (!Petal) return;
    player.petals = [];
    for (let i = 0; i < player.petalCount; i++) {
      const p = new Petal(player, i, player.petalCount);
      if (i < old.length) { p.stillMode = old[i].stillMode; p.stillPosition = old[i].stillPosition; }
      player.petals.push(p);
      if (i < qs.length && qs[i]) p.updateFromQuickSlot(i);
    }
    player.recalculatePetalAngles?.();
    player.updateStatsFromPetals?.();
  }

  hashPassword(password: string) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) { hash = ((hash << 5) - hash) + password.charCodeAt(i); hash = hash & hash; }
    return hash.toString(36);
  }

  isLoggedIn()      { return this.currentUser !== null; }
  getCurrentUser()  { return this.currentUser; }
  getAllUsers()      { return Array.from(this.users.keys()); }
  getUserStats(u: string)   { return this.users.get(u)?.stats || null; }
  getCurrentStats() { return this.currentUser ? this.getUserStats(this.currentUser) : null; }

  deleteAccount(username: string, password: string) {
    const ud = this.users.get(username);
    if (!ud) return { success: false, message: "Username not found" };
    if (ud.password !== this.hashPassword(password)) return { success: false, message: "Incorrect password" };
    this.users.delete(username);
    if (this.currentUser === username) this.currentUser = null;
    this.saveAllUsers();
    return { success: true };
  }

  exportAccounts() {
    const blob = new Blob([JSON.stringify({ exportTime: Date.now(), accounts: Object.fromEntries(this.users) }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `flwrr_accounts_${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
    return { success: true };
  }

  importAccounts(jsonStr: string) {
    try {
      const data = JSON.parse(jsonStr);
      if (!data.accounts) return { success: false, message: "Invalid file" };
      for (const [u, d] of Object.entries(data.accounts)) this.users.set(u, d);
      this.saveAllUsers();
      return { success: true, message: `Imported ${Object.keys(data.accounts).length} accounts` };
    } catch(e: any) { return { success: false, message: "Import failed: " + e.message }; }
  }

  clearAllAccounts() {
    if (confirm("Delete ALL accounts? This cannot be undone!")) {
      this.users.clear(); this.currentUser = null;
      localStorage.removeItem(this.STORAGE_KEY);
      return true;
    }
    return false;
  }
}

// =====================================================================
// Changelog panel（主菜单浮层：更新日志）
// 实现来源：MainMenu 的 ChangelogPanel —— 绘制 / 自动换行 / 滚动 / 滚动条
// 逻辑原样保留，仅补齐 TypeScript 类型。
// =====================================================================

interface ChangelogLogGroup {
  date: string;
  entries: string[];
}

class ChangelogPanel {
  visible = false;
  /** 面板划入动画进度(0=关闭,1=完全展开;参考背包 bagAnim,由 GameClient.update 驱动)。 */
  openAnim = 0;
  scrollY = 0;
  /** Important notice always pinned at the top of the changelog. Empty = hidden. */
  importantNotice = "The bug on loadout seems to be fixed, but still need testing, which means it is still not safe to put your valuable stuff into loadout";
  logs: ChangelogLogGroup[] = [
      {
      date: "12th October 2026",
      entries: [
        "- player's data now save online once they have signed up",
        "- Added a push to player when they stuck inside the wall",
        "- Added important notice to declare some urgent things",
      ]
    },
      {
      date: "10th & 11th October 2026",
      entries: [
        "- Added Loadout system and panel",
        "- Updated teammate info on left up corner",
        "- Updated mobile ui again"
      ]
    },
      {
      date: "9th October 2026",
      entries: [
        "- Added talent system",
        "- Updated the quick slot and inventory interaction, which should be better",
        "- Added enemy health bar for high rarity mobs, which should be higher than Mythic"
      ]
    },
    {
      date: "8th October 2026",
      entries: [
        "- Added achievement system",
        "- Added shop system and redeem code. If you see here, here is a code for you: M4SVGK",
        "- Balanced the health of mobs","- Increase 50% of the mob spawn rates",
      ]
    },
    {
      date: "7th October 2026",
      entries: [
        "- updated changelog UI, also updated main menu UI",
        "- updated mobile UI in game",
        "- resized the panel and arrangement"
      ]
    },
    {
      date: "6th October 2026",
      entries: [
        "- changelog are not available before",
        "- What are you expected to see here ???"
      ]
    }
  ];
  panelW = 420;
  panelH = 460;
  closeRect: [number, number, number, number] | null = null;
  totalContentH = 0;
  /** 触摸/指针滚动中标志（手机版用手指滑动面板内容）。 */
  touchScrolling = false;
  private touchLastY = 0;

  /**
   * 面板位置：左上角附近（宽 /10、高 /5 处），并 clamp 到屏幕内。
   * W/H 为画布 CSS 尺寸（与点击坐标一致）。
   */
  private panelPos(W: number, H: number): [number, number] {
    this.syncSize(W, H);
    const px = Math.max(8, W / 10 - this.panelW / 2);
    const py = Math.max(8, H / 5 - this.panelH / 2);
    return [px, py];
  }

  /**
   * 面板尺寸按设备自适应：手机版（W < 640）更小，正常版 420×460。
   */
  private syncSize(W: number, H: number) {
    if (H < 640) {
      this.panelW = Math.min(340, W - 16);
      this.panelH = Math.min(420, H - 24);
    } else {
      this.panelW = 420;
      this.panelH = 460;
    }
  }

  /**
   * 按下：命中面板内部（非 ✕）则进入内容滚动状态并返回 true
   * （点击面板不再关闭，仅滚动内容）。
   */
  beginTouch(x: number, y: number, W: number, H: number): boolean {
    if (!this.visible) return false;
    const [px, py] = this.panelPos(W, H);
    if (x < px || x > px + this.panelW || y < py || y > py + this.panelH) return false;
    if (this.closeRect) {
      const [cx, cy, cw, ch] = this.closeRect;
      if (x >= cx && x <= cx + cw && y >= cy && y <= cy + ch) return false;
    }
    this.touchScrolling = true;
    this.touchLastY = y;
    return true;
  }

  /** 移动：手指上下滑动 → 滚动面板内容（复用 handleScroll 逻辑）。 */
  touchMove(y: number) {
    if (!this.touchScrolling) return;
    const delta = this.touchLastY - y;
    this.touchLastY = y;
    this.handleScroll(delta);
  }

  endTouch() {
    this.touchScrolling = false;
  }

  draw(ctx: CanvasRenderingContext2D, W: number, H: number) {
    if (!this.visible) return;

    ctx.save();
    // 划入动画:淡入 + 从屏幕底部滑入(ease.outCubic,与背包面板一致)
    ctx.globalAlpha = Math.min(1, this.openAnim * 1.6);
    ctx.translate(0, (1 - ease.outCubic(this.openAnim)) * (H + 20));

    const panelW = this.panelW;
    const panelH = this.panelH;
    const [px, py] = this.panelPos(W, H);
    // 手机版：面板缩小后，字号/间距/按钮/滚动条等比缩放
    const s = Math.min(1, panelW / 420);

    // --- 背景 ---
    ctx.fillStyle = '#4caf50';
    ctx.beginPath();
    ctx.roundRect(px, py, panelW, panelH, 5 * s);
    ctx.fill();
    ctx.strokeStyle = '#2e7d32';
    ctx.lineWidth = 4 * s;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // --- 标题 ---
    const titleX = px + panelW / 2;
    const titleY = py + 35 * s;

    ctx.font = `${28 * s}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    ctx.lineWidth = 5 * s;
    ctx.strokeStyle = '#000000';
    ctx.strokeText('Changelog', titleX, titleY);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Changelog', titleX, titleY);

    // --- 关闭按钮(与成就面板同款:红色渐变圆角按钮) ---
    const closeSize = 38 * s;
    const closeRect: [number, number, number, number] = [px + panelW - 50 * s, py + 12 * s, closeSize, closeSize];
    this.closeRect = closeRect;
    const closeC = [220, 80, 80];
    const adjC = (f: number) => `rgb(${closeC.map(c => Math.min(255, Math.max(0, Math.floor(c * f)))).join(",")})`;
    ctx.beginPath();
    ctx.roundRect(...closeRect, 8 * s);
    ctx.fillStyle = adjC(1);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(...closeRect, 8 * s);
    ctx.clip();
    ctx.fillStyle = adjC(0.85);
    ctx.fillRect(closeRect[0], closeRect[1], closeRect[2], closeRect[3] / 2);
    ctx.restore();
    ctx.strokeStyle = adjC(0.5);
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.roundRect(...closeRect, 8 * s);
    ctx.stroke();

    ctx.font = `${22 * s}px ${FONT_FAMILY}`;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4 * s;
    ctx.strokeText('✕', px + panelW - 31 * s, py + 31 * s);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('✕', px + panelW - 31 * s, py + 31 * s);

    // --- 内容区 ---
    const contentY = py + 70 * s;
    const contentH = panelH - 85 * s;

    ctx.save();
    ctx.beginPath();
    const paddingRight = 15 * s;
    ctx.rect(px + 10 * s, contentY, panelW - 20 * s - paddingRight, contentH);
    ctx.clip();

    let y = contentY + 10 * s - this.scrollY;
    ctx.textAlign = 'left';

    const drawTextWithStroke = (text: string, x: number, y: number, fontSize: number, fontWeight: string = 'normal') => {
      ctx.font = `${fontWeight} ${fontSize}px ${FONT_FAMILY}`;
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3 * s;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, x, y);
    };
    // --- Important Notice (pinned at top, hidden when empty) ---
    if (this.importantNotice) {
      const noticePad = 10 * s;
      const noticeInnerW = panelW - 20 * s - paddingRight - noticePad * 2;
      const noticeTitleSize = 20 * s;
      const noticeBodySize = 15 * s;
      const noticeTitleH = 26 * s;
      const noticeLineH = 22 * s;

      // Wrap notice text
      ctx.font = `${noticeBodySize}px ${FONT_FAMILY}`;
      const noticeWords = this.importantNotice.split(' ');
      let noticeLines: string[] = [];
      let noticeLine = '';
      for (const word of noticeWords) {
        const test = noticeLine + word + ' ';
        if (ctx.measureText(test).width > noticeInnerW && noticeLine) {
          noticeLines.push(noticeLine.trim());
          noticeLine = word + ' ';
        } else {
          noticeLine = test;
        }
      }
      if (noticeLine) noticeLines.push(noticeLine.trim());

      const noticeBodyH = noticeLines.length * noticeLineH;
      const noticeH = noticePad * 2 + noticeTitleH + 6 * s + noticeBodyH;

      // Draw notice background (warm amber to stand out)
      ctx.fillStyle = '#388e3c';
      ctx.beginPath();
      ctx.roundRect(px + 10 * s + noticePad, y, panelW - 20 * s - paddingRight - noticePad * 2, noticeH, 6 * s);
      ctx.fill();
      ctx.strokeStyle = '#388e3c';
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.roundRect(px + 10 * s + noticePad, y, panelW - 20 * s - paddingRight - noticePad * 2, noticeH, 6 * s);
      ctx.stroke();

      // Draw title
      drawTextWithStroke('Important Notice!', px + 16 * s + noticePad, y + noticePad + 2 * s, noticeTitleSize, 'bold');

      // Draw body lines
      let noticeY = y + noticePad + noticeTitleH + 6 * s;
      for (const line of noticeLines) {
        drawTextWithStroke(line, px + 16 * s + noticePad, noticeY, noticeBodySize);
        noticeY += noticeLineH;
      }

      y += noticeH + 14 * s;
    }

    for (let i = 0; i < this.logs.length; i++) {
      const group = this.logs[i];

      const dateSize = 22 * s;
      drawTextWithStroke(group.date, px + 16 * s, y, dateSize, '');
      y += 32 * s;

      const entrySize = 18 * s;
      for (const entry of group.entries) {
        const words = entry.split(' ');
        let line = '';
        ctx.font = `${entrySize}px ${FONT_FAMILY}`;

        for (const word of words) {
          const test = line + word + ' ';
          const maxWidth = panelW - 40 * s - paddingRight;
          if (ctx.measureText(test).width > maxWidth && line) {
            drawTextWithStroke(line, px + 16 * s, y, entrySize);
            y += 24 * s;
            line = word + ' ';
          } else {
            line = test;
          }
        }
        if (line) {
          drawTextWithStroke(line.trim(), px + 16 * s, y, entrySize);
          y += 24 * s;
        }
        y += 6 * s;
      }

      if (i < this.logs.length - 1) {
        ctx.strokeStyle = '#388e3c';
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.moveTo(px + 15 * s, y + 8 * s);
        ctx.lineTo(px + panelW - 15 * s - paddingRight, y + 8 * s);
        ctx.stroke();
        y += 24 * s;
      }
    }

    this.totalContentH = y + this.scrollY - contentY;
    ctx.restore();

    // --- 滚动条 ---
    const totalContentH_scaled = this.totalContentH;

    if (totalContentH_scaled > contentH) {
      const trackX = px + panelW - 12 * s;
      const trackY = contentY;
      const trackW = Math.max(4, 6 * s);
      const trackH = contentH;

      // 滚动条轨道
      ctx.fillStyle = 'rgba(46, 125, 50, 0.4)';
      ctx.beginPath();
      ctx.roundRect(trackX, trackY, trackW, trackH, trackW / 2);
      ctx.fill();

      // 滑块
      let thumbH = (contentH / totalContentH_scaled) * trackH;
      thumbH = Math.max(20 * s, thumbH);

      const maxScrollY = totalContentH_scaled - contentH;
      const scrollRatio = maxScrollY > 0 ? this.scrollY / maxScrollY : 0;
      const thumbY = trackY + (trackH - thumbH) * scrollRatio;

      ctx.fillStyle = 'rgba(46, 125, 50, 0.6)';
      ctx.beginPath();
      ctx.roundRect(trackX, thumbY, trackW, thumbH, trackW / 2);
      ctx.fill();
    }

    ctx.restore();
  }

  handleClick(x: number, y: number, W: number, H: number): boolean {
    if (!this.visible) return false;

    const [px, py] = this.panelPos(W, H);

    // 点击面板外关闭
    if (x < px || x > px + this.panelW || y < py || y > py + this.panelH) {
      this.visible = false;
      return true;
    }

    // 关闭按钮
    if (this.closeRect) {
      const [cx, cy, cw, ch] = this.closeRect;
      if (x >= cx && x <= cx + cw && y >= cy && y <= cy + ch) {
        this.visible = false;
        return true;
      }
    }

    return true;
  }

  handleWheel(deltaY: number): boolean {
    if (!this.visible) return false;

    const contentH = this.panelH - 85 * Math.min(1, this.panelW / 420);
    const maxScroll = Math.max(0, (this.totalContentH || 0) - contentH);
    this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY + deltaY));
    return true;
  }

  handleScroll(deltaY: number): boolean {
    if (!this.visible) return false;

    const contentH = this.panelH - 85 * Math.min(1, this.panelW / 420);
    const maxScroll = Math.max(0, (this.totalContentH || 0) - contentH);

    const scrollAmount = deltaY * 0.8;
    this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY + scrollAmount));

    return true;
  }

  open() {
    this.visible = true;
    this.scrollY = 0;
  }

  close() {
    this.visible = false;
  }

  toggle() {
    this.visible = !this.visible;
    if (this.visible) this.scrollY = 0;
  }

  /** 面板划入动画进度推进(目标 = visible)。 */
  updateOpenAnim(dt: number) {
    this.openAnim += ((this.visible ? 1 : 0) - this.openAnim) * Math.min(1, dt * 10);
  }
}

// =====================================================================
// AchievementSystem — 成就系统
// 解锁弹窗 / 星星奖励 / 成就面板 (All · Complete · Incomplete 筛选)
// 进度与解锁状态保存在 localStorage (key: achievements_v1)
// =====================================================================

interface AchievementDef {
  id: string;
  group: string;
  stars: number;
  title: string;
  desc: string;
  check: (s: Record<string, any>) => boolean;
}

class AchievementSystem {
  game: GameClient;
  achievements: AchievementDef[];
  unlocked: Set<string>;
  stats: Record<string, any>;
  pendingPopups: AchievementDef[];
  activePopup: AchievementDef | null;
  popupTimer: number;
  POPUP_DURATION = 4.0;
  panelOpen = false;
  /** 面板划入动画进度(0=关闭,1=完全展开;参考背包 bagAnim,由 GameClient.update 驱动)。 */
  openAnim = 0;
  _panelScrollY = 0;
  /** Touch-based scroll state (mobile) — mirrors SettingsSystem. */
  touchScrolling = false;
  private touchStartY = 0;
  private touchStartOffset = 0;
  _filter = "All";
  _playTimeAccum = 0;

  constructor(gameInstance: GameClient) {
    this.game = gameInstance;
    this.achievements = this._buildAchievements();
    this.unlocked = new Set();
    this.stats = this._defaultStats();
    this.pendingPopups = [];
    this.activePopup = null;
    this.popupTimer = 0;
    this.load();
  }

  /** Canvas 实际尺寸(与游戏 HUD 使用同一坐标系)。 */
  _size(): { W: number; H: number } {
    const W = this.game.viewWidth ?? (window as any).WIDTH ?? window.innerWidth;
    const H = this.game.viewHeight ?? (window as any).HEIGHT ?? window.innerHeight;
    return { W, H };
  }

  _buildAchievements(): AchievementDef[] {
    return [
      { id: 'get_rare', group: 'items', stars: 5, title: 'Rare Find', desc: 'Obtain a Rare item', check: s => s.highestRarity >= 2 },
      { id: 'get_epic', group: 'items', stars: 10, title: 'Epic Haul', desc: 'Obtain an Epic item', check: s => s.highestRarity >= 3 },
      { id: 'get_legendary', group: 'items', stars: 20, title: 'Legendary', desc: 'Obtain a Legendary item', check: s => s.highestRarity >= 4 },
      { id: 'get_mythic', group: 'items', stars: 50, title: 'Mythic Power', desc: 'Obtain a Mythic item', check: s => s.highestRarity >= 5 },
      { id: 'get_ultra', group: 'items', stars: 100, title: 'Ultra Rare', desc: 'Obtain an Ultra item', check: s => s.highestRarity >= 6 },
      { id: 'get_super', group: 'items', stars: 200, title: 'Super Human', desc: 'Obtain a Super item', check: s => s.highestRarity >= 7 },
      { id: 'get_omega', group: 'items', stars: 500, title: 'Omega Collector', desc: 'Obtain an Omega item', check: s => s.highestRarity >= 8 },
      { id: 'get_eternal', group: 'items', stars: 2000, title: 'Eternal Chosen', desc: 'Obtain an Eternal item', check: s => s.highestRarity >= 9 },
      { id: 'tunnel', group: 'explore', stars: 30, title: 'Through the Rift', desc: 'Enter a Spacetime Tunnel', check: s => s.tunnelsEntered >= 1 },
      { id: 'dmg_1m', group: 'combat', stars: 50, title: 'Million Dealer', desc: 'Deal 1,000,000 damage to one enemy', check: s => s.maxSingleEnemyDamage >= 1000000 },
      { id: 'tank_10k', group: 'combat', stars: 100, title: 'Iron Petal', desc: 'Take 10,000 damage without dying', check: s => s.damageWithoutDying >= 10000 },
      { id: 'first_digger', group: 'combat', stars: 20, title: 'Grave Robber', desc: 'Kill your first Digger', check: s => s.diggersKilled >= 1 },
      { id: 'massive_killer', group: 'combat', stars: 10, title: 'Massive Killer', desc: 'Kill 1000 mobs', check: s => s.enemiesKilled >= 1000 },
      { id: 'DEVIL', group: 'combat', stars: 300, title: 'DEVIL', desc: 'Kill 1000000 mobs', check: s => s.enemiesKilled >= 1000000 },
      { id: 'kill_10000_enemies', group: 'combat', stars: 100, title: 'Master Hunter', desc: 'Kill 10,000 enemies', check: s => s.enemiesKilled >= 10000 },
      { id: 'play_1h', group: 'time', stars: 30, title: 'Getting Started', desc: 'Play for 1 hour', check: s => s.totalPlayMinutes >= 60 },
      { id: 'play_50h', group: 'time', stars: 100, title: 'Dedicated', desc: 'Play for 50 hours', check: s => s.totalPlayMinutes >= 3000 },
      { id: 'play_100h', group: 'time', stars: 300, title: 'Veteran', desc: 'Play for 100 hours', check: s => s.totalPlayMinutes >= 6000 },
      { id: 'play_500h', group: 'time', stars: 1000, title: 'Legend', desc: 'Play for 500 hours', check: s => s.totalPlayMinutes >= 30000 },
      { id: 'play_1000h', group: 'time', stars: 5000, title: 'Immortal', desc: 'Play for 1000 hours', check: s => s.totalPlayMinutes >= 60000 },
      // ========== 🆕 蜜蜂击杀 ==========
      { id: 'beekeeper', group: 'combat', stars: 30, title: 'Beekeeper', desc: 'Kill 1,000 Bees', check: s => (s.mobKills?.Bee || 0) >= 1000 },
      { id: 'beekeeper_elite', group: 'combat', stars: 100, title: 'Beekeeper???', desc: 'Kill 10,000 Bees', check: s => (s.mobKills?.Bee || 0) >= 10000 },
      { id: 'beekeeper_master', group: 'combat', stars: 150, title: 'Queen Beekeeper', desc: 'Kill 100,000 Bees', check: s => (s.mobKills?.Bee || 0) >= 100000 },
      { id: 'ant_killer', group: 'combat', stars: 50, title: 'Ant Killer', desc: 'Kill 2,000 Ants', check: s => (s.mobKills?.Ant || 0) >= 2000 },
      { id: 'ant_hater', group: 'combat', stars: 80, title: 'Ant Hater', desc: 'Kill 15,000 Ants', check: s => (s.mobKills?.Ant || 0) >= 15000 },
      { id: 'ant_extremist', group: 'combat', stars: 200, title: 'Ant Extremist', desc: 'Kill 100,000 Ants', check: s => (s.mobKills?.Ant || 0) >= 100000 },
      // ========== 🆕 地狱生物击杀 (Hel) ==========
      { id: 'helno', group: 'combat', stars: 150, title: 'HELNO', desc: 'Kill 10,000 Hel creatures', check: s => (s.mobKills?.Hel || 0) >= 10000 },
      { id: 'helno_elite', group: 'combat', stars: 200, title: 'HELNO???', desc: 'Kill 50,000 Hel creatures', check: s => (s.mobKills?.Hel || 0) >= 50000 },
      { id: 'helno_master', group: 'combat', stars: 500, title: 'HELNO MASTER', desc: 'Kill 200,000 Hel creatures', check: s => (s.mobKills?.Hel || 0) >= 200000 },
      { id: 'hater', group: 'combat', stars: 100, title: 'Hater', desc: 'Kill 10,000 of the same type & rarity', check: s => s.maxSameTypeRarityKills >= 10000 },
      { id: 'insanity', group: 'combat', stars: 200, title: 'Insanity', desc: 'Kill 50,000 of the same type & rarity', check: s => s.maxSameTypeRarityKills >= 50000 },
      { id: 'obsession', group: 'combat', stars: 500, title: 'Obsession', desc: 'Kill 200,000 of the same type & rarity', check: s => s.maxSameTypeRarityKills >= 200000 },
      { id: 'level_100', group: 'combat', stars: 10, title: 'Getting Better...', desc: 'Reach player level 100', check: s => (s.playerLevel || 1) >= 100 },
      { id: 'level_200', group: 'combat', stars: 50, title: 'Become a Pro!', desc: 'Reach player level 200', check: s => (s.playerLevel || 1) >= 200 },
      { id: 'level_250', group: 'combat', stars: 150, title: 'NoLife', desc: 'Reach player level 250', check: s => (s.playerLevel || 1) >= 250 },
      { id: 'level_300', group: 'combat', stars: 500, title: 'The Absolutely Best!', desc: 'Reach player level 300', check: s => (s.playerLevel || 1) >= 300 },
      { id: 'level_350', group: 'combat', stars: 1000, title: 'A Semi-Admin!', desc: 'Reach player level 350', check: s => (s.playerLevel || 1) >= 350 },
    ];
  }

  _defaultStats(): Record<string, any> {
    return {
      highestRarity: 0,
      tunnelsEntered: 0,
      maxSingleEnemyDamage: 0,
      damageWithoutDying: 0,
      diggersKilled: 0,
      totalPlayMinutes: 0,
      enemiesKilled: 0,           // ✅ 添加
      itemsCollected: 0,          // ✅ 添加
      playerLevel: 1,             // ✅ 添加
      petalsCrafted: 0,
      mobKills: {},
      highestRarityKilled: 0,
      maxSameTypeRarityKills: 0,
    };
  }

  load() {
    try {
      const raw = localStorage.getItem('achievements_v1');
      if (raw) {
        const data = JSON.parse(raw);
        this.unlocked = new Set(data.unlocked || []);
        this.stats = { ...this._defaultStats(), ...data.stats };
      }
    } catch (e) { /* ignore corrupted save */ }
  }

  save() {
    try {
      localStorage.setItem('achievements_v1', JSON.stringify({
        unlocked: [...this.unlocked],
        stats: this.stats,
      }));
      if (CloudStorage.isReady) {
        CloudStorage.instance.set('achievements_v1', {
          unlocked: [...this.unlocked],
          stats: this.stats,
        });
      }
    } catch (e) { /* storage full / unavailable */ }
  }

  onItemObtained(rarity: string) {
    const RARITY_ORDER = ['Common', 'Unusual', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Ultra', 'Super', 'Omega', 'Eternal'];
    const idx = RARITY_ORDER.indexOf(rarity);
    if (idx > this.stats.highestRarity) {
      this.stats.highestRarity = idx;
      this._checkAll();
      this.save();
    }
  }

  onTunnelEntered() {
    this.stats.tunnelsEntered = (this.stats.tunnelsEntered || 0) + 1;
    this._checkAll();
    this.save();
  }

  /** 服务端不广播“对敌人造成伤害”事件时保持未接线;由未来协议扩展触发。 */
  onDamageDealtToEnemy(enemy: any, amount: number) {
    if (!enemy._achDmg) enemy._achDmg = 0;
    enemy._achDmg += amount;
    if (enemy._achDmg > this.stats.maxSingleEnemyDamage) {
      this.stats.maxSingleEnemyDamage = enemy._achDmg;
      this._checkAll();
      this.save();
    }
  }

  onPlayerTookDamage(amount: number) {
    this.stats.damageWithoutDying = (this.stats.damageWithoutDying || 0) + amount;
    this._checkAll();
  }

  onPlayerDied() {
    this.stats.damageWithoutDying = 0;
  }

  onPlayerLevel(level: number) {
    if (level !== (this.stats.playerLevel || 1)) {
      this.stats.playerLevel = level;
      this._checkAll();
      this.save();
    }
  }

  /**
   * 击杀统计。
   * @param mobType   生物编号 (EVT.KILL 的 value = MOBS 数组下标)
   * @param mobName   生物名称 (MOBS[mobType].name;仅作兜底,部分生物不在本地 defs 中)
   * @param enemyRarity 稀有度名称 (RARITIES[rarity].name)
   */
  onEnemyKilled(mobType: number, mobName: string, enemyRarity: string | null = null) {
    // 通用击杀统计
    this.stats.enemiesKilled = (this.stats.enemiesKilled || 0) + 1;

    // ========== 🆕 特定生物击杀统计 ==========
    // 按编号优先 (defs.ts MOBS),名称兜底(覆盖尚未收录在本地 defs 的生物)
    // 蚂蚁检测 — 编号: Soldier Ant=3, Worker Ant=10, Ant Hole=13
    const antTypeIds = [3, 10, 13];
    const antTypes = ["Worker Ant", "Soldier Ant", "Queen Ant", "WorkerFireAnt", "SoldierFireAnt", "BabyFireAnt", "FireAntOvermind", "GoldenAnt", "Worker Termite", "Soldier Termite"];
    if (antTypeIds.includes(mobType) || antTypes.includes(mobName)) {
      this.stats.mobKills.Ant = (this.stats.mobKills.Ant || 0) + 1;
    }

    // 蜜蜂检测 — 编号: Bee=1, Hive=15, Hornet=16
    const beeTypeIds = [1, 15, 16];
    const beeTypes = ["Bee", "QueenBee", "HelBee", "HelQueenBee", "Wasp", "Hornet", "HelHornet"];
    if (beeTypeIds.includes(mobType) || beeTypes.includes(mobName)) {
      this.stats.mobKills.Bee = (this.stats.mobKills.Bee || 0) + 1;
    }

    // 地狱生物检测 (Hel系列) — 编号未收录在本地 defs,按名称匹配
    const helTypes = ["HelWorm", "HelSpider", "HelBee", "HelHornet", "HelBeetle", "Dragon", "ToxicDragon", "HelJellyfish", "HelQueenBee", "HelDigger", "HelBeekeeper", "HelHive", "FireStorm"];
    if (helTypes.includes(mobName)) {
      this.stats.mobKills.Hel = (this.stats.mobKills.Hel || 0) + 1;
    }

    // 蜘蛛检测 — 编号: Spider=17
    if (mobType === 17 || mobName === "HelSpider" || mobName === "ArcticSpider") {
      this.stats.mobKills.Spider = (this.stats.mobKills.Spider || 0) + 1;
    }

    // 龙检测 — 编号未收录在本地 defs,按名称匹配
    if (mobName === "Dragon" || mobName === "ToxicDragon" || mobName === "Ice Dragon") {
      this.stats.mobKills.Dragon = (this.stats.mobKills.Dragon || 0) + 1;
    }

    // ========== 🆕 同类型同稀有度击杀追踪 ==========
    if (enemyRarity) {
      // 用编号作为键:编号全局唯一,且不受名称拼写影响
      const key = `${mobType}_${enemyRarity}`;
      if (!this.stats._typeRarityKills) this.stats._typeRarityKills = {};
      this.stats._typeRarityKills[key] = (this.stats._typeRarityKills[key] || 0) + 1;

      const current = this.stats._typeRarityKills[key];
      if (current > (this.stats.maxSameTypeRarityKills || 0)) {
        this.stats.maxSameTypeRarityKills = current;
      }
    }

    // Boss检测 (根据稀有度或类型)
    const bossRarities = ["Ultra", "Super", "Omega", "Eternal"];
    if (enemyRarity && bossRarities.includes(enemyRarity)) {
      this.stats.bossKilled = (this.stats.bossKilled || 0) + 1;
    }

    // Digger 类型特殊统计 — 编号未收录在本地 defs,按名称匹配
    const diggerTypes = ["Digger", "TrashDigger", "MudDigger", "Biologist", "PirateDigger", "FrostDigger", "HelDigger", "GraveDigger", "AlienDigger"];
    if (diggerTypes.includes(mobName)) {
      this.stats.diggersKilled = (this.stats.diggersKilled || 0) + 1;
    }

    // 稀有度击杀统计
    if (enemyRarity) {
      const rarityOrder = ["Common", "Unusual", "Rare", "Epic", "Legendary", "Mythic", "Ultra", "Super", "Omega", "Eternal"];
      const idx = rarityOrder.indexOf(enemyRarity);
      if (idx > (this.stats.highestRarityKilled || 0)) {
        this.stats.highestRarityKilled = idx;
      }
    }

    // ✅ 关键修复：每次击杀后立即检查成就并保存
    this._checkAll();
    this.save();
  }

  tickPlayTime(dtSeconds: number) {
    this._playTimeAccum = (this._playTimeAccum || 0) + dtSeconds;
    if (this._playTimeAccum >= 60) {
      this.stats.totalPlayMinutes += Math.floor(this._playTimeAccum / 60);
      this._playTimeAccum %= 60;
      this._checkAll();
      this.save();
    }
  }

  _checkAll() {
    for (const ach of this.achievements) {
      if (!this.unlocked.has(ach.id) && ach.check(this.stats)) {
        this._unlock(ach);
      }
    }
  }

  _unlock(ach: AchievementDef) {
    this.unlocked.add(ach.id);
    this.save();
    const shop = (window as any).gameInstance?.shopSystem;
    if (shop) shop.addStars(ach.stars, true);
    this.pendingPopups.push(ach);
    console.log(`🏆 Achievement unlocked: ${ach.title} (+${ach.stars}⭐)`);
  }

  update(dt: number) {
    this.tickPlayTime(dt);
    this._tickPopups(dt);
  }

  /** 仅推进解锁弹窗计时(不累计游玩时长)。主菜单也调用,避免弹窗冻结。 */
  _tickPopups(dt: number) {
    if (this.activePopup) {
      this.popupTimer -= dt;
      if (this.popupTimer <= 0) {
        this.activePopup = null;
        const next = this.pendingPopups.shift();
        if (next) {
          this.activePopup = next;
          this.popupTimer = this.POPUP_DURATION;
        }
      }
    } else if (this.pendingPopups.length > 0) {
      const next = this.pendingPopups.shift();
      if (next) {
        this.activePopup = next;
        this.popupTimer = this.POPUP_DURATION;
      }
    }
  }

  drawStrokedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fontSize = 14, textAlign: CanvasTextAlign = 'center', fillColor = 'white') {
    ctx.save();
    ctx.font = ` ${fontSize}px "${FONT_FAMILY} Black", ${FONT_FAMILY}`;
    ctx.textAlign = textAlign;
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fillColor;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  drawPopup(ctx: CanvasRenderingContext2D) {
    if (!this.activePopup) return;
    const { W, H } = this._size();
    const ach = this.activePopup;
    const progress = Math.max(0, this.popupTimer / this.POPUP_DURATION);
    const SLIDE_T = 0.25;
    let slideX = 0;
    if (progress > 1 - SLIDE_T) {
      const t = (1 - progress) / SLIDE_T;
      slideX = (1 - Math.pow(1 - t, 3)) * 300;
    } else if (progress < SLIDE_T) {
      const t = progress / SLIDE_T;
      slideX = (1 - Math.pow(1 - t, 3)) * 300;
    }
    const PW = 280, PH = 80;
    const px = W - PW - 20 + slideX;
    const py = H - PH - 90;
    ctx.save();
    ctx.globalAlpha = Math.min(1, progress * 4);
    ctx.fillStyle = 'rgba(10,10,25,0.92)';
    ctx.beginPath(); ctx.roundRect(px, py, PW, PH, 12); ctx.fill();
    ctx.fillStyle = '#ffd700';
    ctx.beginPath(); ctx.roundRect(px, py, 5, PH, [12, 0, 0, 12]); ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,0,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(px, py, PW, PH, 12); ctx.stroke();
    ctx.fillStyle = 'rgba(255,215,0,0.15)';
    ctx.beginPath(); ctx.roundRect(px + 10, py + 10, 60, 60, 8); ctx.fill();
    this.drawStrokedText(ctx, '🏆', px + 40, py + 40, 28, 'center', 'white');
    this.drawStrokedText(ctx, 'Achievement Unlocked!', px + 80, py + 20, 10, 'left', 'rgba(255,215,0,0.9)');
    this.drawStrokedText(ctx, ach.title, px + 80, py + 40, 15, 'left', 'white');
    this.drawStrokedText(ctx, ach.desc, px + 80, py + 57, 9, 'left', 'rgba(200,200,200,0.85)');
    this.drawStrokedText(ctx, `+${this._fmtNum(ach.stars)}`, px + PW - 26, py + 40, 13, 'right', '#ffd700');
    drawStarIcon(ctx, px + PW - 16, py + 40, 7);
    ctx.restore();
  }

  _easeOut(t: number) { return 1 - Math.pow(1 - t, 3); }

  _fmtNum(n: number): string {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toString();
  }

  _getProgress(ach: AchievementDef): number {
    const s = this.stats;
    switch (ach.id) {
      case 'play_1h': return Math.min(1, s.totalPlayMinutes / 60);
      case 'play_50h': return Math.min(1, s.totalPlayMinutes / 3000);
      case 'play_100h': return Math.min(1, s.totalPlayMinutes / 6000);
      case 'play_500h': return Math.min(1, s.totalPlayMinutes / 30000);
      case 'play_1000h': return Math.min(1, s.totalPlayMinutes / 60000);
      case 'dmg_1m': return Math.min(1, s.maxSingleEnemyDamage / 1000000);
      case 'tank_10k': return Math.min(1, s.damageWithoutDying / 10000);
      case 'massive_killer': return Math.min(1, (s.enemiesKilled || 0) / 1000);
      case 'kill_10000_enemies': return Math.min(1, (s.enemiesKilled || 0) / 10000);
      case 'DEVIL': return Math.min(1, (s.enemiesKilled || 0) / 1000000);
      case 'first_digger': return Math.min(1, s.diggersKilled);
      case 'tunnel': return Math.min(1, s.tunnelsEntered);
      case 'level_100': return Math.min(1, (s.playerLevel || 1) / 100);
      case 'level_200': return Math.min(1, (s.playerLevel || 1) / 200);
      case 'level_250': return Math.min(1, (s.playerLevel || 1) / 250);
      case 'level_300': return Math.min(1, (s.playerLevel || 1) / 300);
      case 'level_350': return Math.min(1, (s.playerLevel || 1) / 350);

      // ========== 🆕 添加这些成就的进度 ==========
      case 'beekeeper': return Math.min(1, (s.mobKills?.Bee || 0) / 1000);
      case 'beekeeper_elite': return Math.min(1, (s.mobKills?.Bee || 0) / 10000);
      case 'beekeeper_master': return Math.min(1, (s.mobKills?.Bee || 0) / 100000);
      case 'ant_killer': return Math.min(1, (s.mobKills?.Ant || 0) / 2000);
      case 'ant_hater': return Math.min(1, (s.mobKills?.Ant || 0) / 15000);
      case 'ant_extremist': return Math.min(1, (s.mobKills?.Ant || 0) / 100000);
      case 'helno': return Math.min(1, (s.mobKills?.Hel || 0) / 10000);
      case 'helno_elite': return Math.min(1, (s.mobKills?.Hel || 0) / 50000);
      case 'helno_master': return Math.min(1, (s.mobKills?.Hel || 0) / 200000);
      case 'hater': return Math.min(1, (s.maxSameTypeRarityKills || 0) / 10000);
      case 'insanity': return Math.min(1, (s.maxSameTypeRarityKills || 0) / 50000);
      case 'obsession': return Math.min(1, (s.maxSameTypeRarityKills || 0) / 200000);

      default: return 0;
    }
  }

  drawStyledButton(ctx: CanvasRenderingContext2D, text: string, rect: number[], baseColor: number[], fontSize = 16) {
    const [x, y, w, h] = rect;

    const adjust = (rgb: number[], f: number) => rgb.map(c => Math.max(0, Math.min(255, Math.floor(c * f))));
    const darkColor = `rgb(${adjust(baseColor, 0.85).join(',')})`;
    const lightColor = `rgb(${baseColor.join(',')})`;
    const strokeColor = `rgb(${adjust(baseColor, 0.5).join(',')})`;

    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fillStyle = lightColor;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.clip();
    ctx.fillStyle = darkColor;
    ctx.fillRect(x, y, w, h / 2);
    ctx.restore();

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    if (text) {
      ctx.font = ` ${fontSize}px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'black';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, x + w / 2, y + h / 2);
      ctx.fillStyle = 'white';
      ctx.fillText(text, x + w / 2, y + h / 2);
    }
  }

  _getFilteredList(): AchievementDef[] {
    let list = this.achievements;
    if (this._filter === 'Complete') {
      list = list.filter(a => this.unlocked.has(a.id));
    } else if (this._filter === 'Incomplete') {
      list = list.filter(a => !this.unlocked.has(a.id));
    }
    return list;
  }

  /** 面板几何(屏幕坐标)。小屏幕时整体等比缩小。 */
  _panelRect(W: number, H: number): { x: number; y: number; w: number; h: number; scale: number; PW: number; PH: number } {
    const isMobile = H < 640 || W < 640;
    const PW = isMobile ? 520 : 720;
    const PH = isMobile ? 400 : 640;
    const scale = Math.min(1, W / (PW + 40), H / (PH + 40));
    return { x: W / 2 - (PW * scale) / 2, y: H / 2 - (PH * scale) / 2, w: PW * scale, h: PH * scale, scale, PW, PH };
  }

  /** 命中测试:点击是否落在面板内(含缩放)。 */
  panelContains(x: number, y: number): boolean {
    if (!this.panelOpen) return false;
    const { W, H } = this._size();
    const r = this._panelRect(W, H);
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

    drawPanel(ctx: CanvasRenderingContext2D) {
    if (!this.panelOpen) return;

    const { W, H } = this._size();
    const r = this._panelRect(W, H);
    const scale = r.scale;
    const px = r.x, py = r.y;
    const PW = r.PW, PH = r.PH;
    const isMobile = H < 640 || W < 640;

    ctx.save();
    // 划入动画:淡入 + 从屏幕底部滑入(ease.outCubic,与背包面板一致)
    ctx.globalAlpha = Math.min(1, this.openAnim * 1.6);

    // 小屏幕整体缩放(保持内部坐标不变)
    if (scale < 1) {
      ctx.translate(W / 2, H / 2);
      ctx.scale(scale, scale);
      ctx.translate(-W / 2, -H / 2);
    }
    ctx.translate(0, (1 - ease.outCubic(this.openAnim)) * (H + 20));

    // ───────────── 主背景（更深绿） ─────────────
    ctx.fillStyle = '#1faa66';

    ctx.fillRect(px, py, PW, PH);

    ctx.strokeStyle = '#0d5c3a';
    ctx.lineWidth = 6;
    ctx.strokeRect(px, py, PW, PH);

    // 标题
    this.drawStrokedText(ctx, 'Achievements', px + PW / 2, py + (isMobile ? 32 : 40), isMobile ? 28 : 32);

    // ───────────── 关闭按钮 ─────────────
    const closeBtnSize = isMobile ? 32 : 40;
    const closeBtnH = isMobile ? 28 : 35;
    this.drawStyledButton(
      ctx,
      '✕',
      [px + PW - closeBtnSize - 10, py + 10, closeBtnSize, closeBtnH],
      [220, 80, 80],
      isMobile ? 15 : 18
    );

    // ───────────── 总进度条 ─────────────
    const total = this.achievements.length;
    const unlocked = this.unlocked.size;

    const barW = isMobile ? 320 : 420;
    const barH = isMobile ? 20 : 24;
    const barX = px + (PW - barW) / 2;
    const barY = py + (isMobile ? 58 : 70);
    ctx.fillStyle = '#145a3b';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = '#6df2a3';
    ctx.fillRect(barX, barY, barW * (unlocked / total), barH);
    ctx.strokeStyle = '#064429';
    ctx.lineWidth = 5;
    ctx.strokeRect(barX, barY, barW, barH);
    this.drawStrokedText(
      ctx,
      `unlocked ${unlocked}/${total}`,
      barX + barW / 2,
      barY + barH / 2,
      isMobile ? 14 : 16
    );

    // ───────────── 筛选按钮 ─────────────
    const filters = ['All', 'Complete', 'Incomplete'];
    this._filter = this._filter || 'All';

    const filterBtnW = isMobile ? 72 : 100;
    const filterBtnH = isMobile ? 28 : 34;
    const filterGap = isMobile ? 6 : 8;
    const filterTotalW = filterBtnW * 3 + filterGap * 2;
    const filterStartX = px + (PW - filterTotalW) / 2;
    const filterY = py + (isMobile ? 88 : 110);

    filters.forEach((f, i) => {
      const bx = filterStartX + i * (filterBtnW + filterGap);
      const by = filterY;

      let color = [160, 160, 160];

      if (this._filter === f) {
        if (f === 'All') color = [170, 120, 255];
        if (f === 'Complete') color = [120, 220, 120];
        if (f === 'Incomplete') color = [255, 120, 180];
      }

      this.drawStyledButton(ctx, f, [bx, by, filterBtnW, filterBtnH], color, isMobile ? 12 : 14);
    });

    // ───────────── 成就列表(像素级滚动) ─────────────
    const startY = py + (isMobile ? 128 : 170);
    const itemW = isMobile ? 200 : 300;
    const itemH = isMobile ? 70 : 95;
    const gap = isMobile ? 10 : 14;
    const viewportRows = isMobile ? 3 : 4;
    const titleSize = isMobile ? 12 : 15;
    const starTextSize = isMobile ? 11 : 13;
    const starIconSize = isMobile ? 5 : 7;
    const descSize = isMobile ? 12 : 12;
    const barTextSizeDone = isMobile ? 10 : 12;
    const barTextSizeProgress = isMobile ? 9 : 11;
    const sidePad = isMobile ? 50 : 40;

    let list = this._getFilteredList();

    // 像素级滚动:偏移量直接是像素,与背包面板一致
    const rowH = itemH + gap;
    const contentH = Math.max(0, Math.ceil(list.length / 2) * rowH - gap);
    const viewportH = viewportRows * rowH - gap;
    const maxScroll = Math.max(0, contentH - viewportH);
    this._panelScrollY = Math.max(0, Math.min(maxScroll, this._panelScrollY));

    const startRow = Math.floor(this._panelScrollY / rowH);
    const yOff = -(this._panelScrollY % rowH);
    // 多取一行用于滚动衔接,避免滚动时底部闪空
    list = list.slice(startRow * 2, startRow * 2 + (viewportRows + 1) * 2);

    // 裁剪:滚出视口的卡片不越界
    ctx.save();
    ctx.beginPath();
    ctx.rect(px + sidePad - 2, startY - 2, itemW * 2 + gap + 4, viewportH + 20);
    ctx.clip();

    list.forEach((ach, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);

      const ix = px + sidePad + col * (itemW + gap);
      const iy = startY + row * rowH + yOff;

      const done = this.unlocked.has(ach.id);

      // 卡片背景（深一点）
      ctx.fillStyle = done ? '#3ecf8e' : '#2fa36a';
      ctx.fillRect(ix, iy, itemW, itemH);

      ctx.strokeStyle = '#0d5c3a';
      ctx.lineWidth = 3;
      ctx.strokeRect(ix, iy, itemW, itemH);

      // 标题
      this.drawStrokedText(ctx, ach.title, ix + 12, iy + (isMobile ? 16 : 20), titleSize, 'left');

      // 星星(金铜色图标 + 数量)
      this.drawStrokedText(
        ctx,
        `${this._fmtNum(ach.stars)}`,
        ix + itemW - 24,
        iy + (isMobile ? 16 : 20),
        starTextSize,
        'right',
        '#FFD700'
      );
      drawStarIcon(ctx, ix + itemW - 14, iy + (isMobile ? 16 : 20), starIconSize);

      // 描述
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.font = `${descSize}px ${FONT_FAMILY}`;
      ctx.textAlign = 'left';
      ctx.fillText(ach.desc, ix + 12, iy + (isMobile ? 34 : 42));

      // 进度条
      const pX = ix + 12;
      const pY = iy + (isMobile ? 46 : 60);
      const pW = itemW - 24;
      const pH = barH;

      ctx.fillStyle = '#145a3b';
      ctx.fillRect(pX, pY, pW, pH);

      let progress = done ? 1 : this._getProgress(ach);
      progress = Math.max(0, Math.min(1, progress));

      const padding = 3; // 内边距

      // 实际可用宽度（减去左右padding）
      const innerW = pW - padding * 2;
      const innerH = pH - padding * 2;

      // 进度条（不会贴边）
      ctx.fillStyle = '#7dffb5';
      ctx.fillRect(
        pX + padding,
        pY + padding,
        innerW * progress,
        innerH
      );

      if (done) {
        this.drawStrokedText(ctx, 'DONE', pX + pW / 2, pY + pH / 2, barTextSizeDone);
      } else {
        this.drawStrokedText(
          ctx,
          `${Math.floor(progress * 100)}%`,
          pX + pW / 2,
          pY + pH / 2,
          barTextSizeProgress
        );
      }
    });

    // 结束列表裁剪
    ctx.restore();

    ctx.restore();
  }

  handleClick(x: number, y: number): boolean {
    if (!this.panelOpen) return false;
    const { W, H } = this._size();
    const r = this._panelRect(W, H);

    // 点击在面板外 → 不处理(由 GameClient 关闭面板)
    if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) return false;

    // 屏幕坐标 → 设计坐标(抵消缩放)
    const scale = r.scale;
    const dx = (x - W / 2) / scale + W / 2;
    const dy = (y - H / 2) / scale + H / 2;
    const px = W / 2 - r.PW / 2;
    const py = H / 2 - r.PH / 2;
    const PW = r.PW, PH = r.PH;

    // ───────────── 关闭按钮 ─────────────
    const closeX = px + PW - 50;
    const closeY = py + 10;
    if (dx >= closeX && dx <= closeX + 40 && dy >= closeY && dy <= closeY + 35) {
      this.panelOpen = false;
      return true;
    }

    // ───────────── 筛选按钮 ─────────────
    const filters = ['All', 'Complete', 'Incomplete'];
    for (let i = 0; i < filters.length; i++) {
      const bx = px + PW / 2 - 150 + i * 110;
      const by = py + 110;
      if (dx >= bx && dx <= bx + 100 && dy >= by && dy <= by + 34) {
        this._filter = filters[i];
        this._panelScrollY = 0;
        return true;
      }
    }

    // 面板内部的其他点击(列表区域) → 吞掉,不穿透到游戏世界
    return true;
  }

  handleScroll(deltaY: number) {
    if (!this.panelOpen) return;
    const list = this._getFilteredList();
    const itemH = 95, gap = 14;
    const rowH = itemH + gap;
    const contentH = Math.max(0, Math.ceil(list.length / 2) * rowH - gap);
    const viewportH = 4 * rowH - gap;
    const maxScroll = Math.max(0, contentH - viewportH);
    this._panelScrollY = Math.max(0, Math.min(maxScroll, this._panelScrollY + deltaY));
  }

  togglePanel() { this.panelOpen = !this.panelOpen; }

  /** 面板划入动画进度推进(目标 = panelOpen)。 */
  updateOpenAnim(dt: number) {
    this.openAnim += ((this.panelOpen ? 1 : 0) - this.openAnim) * Math.min(1, dt * 10);
  }

  /** Begin touch scrolling (mobile). Returns true if the press is inside the panel content area. */
  beginTouch(x: number, y: number): boolean {
    if (!this.panelOpen) return false;
    if (!this.panelContains(x, y)) return false;
    const { W, H } = this._size();
    const r = this._panelRect(W, H);
    // Don't start scroll if hitting the close button or filter tabs
    const scale = r.scale;
    const dx = (x - W / 2) / scale + W / 2;
    const dy = (y - H / 2) / scale + H / 2;
    const px = W / 2 - r.PW / 2;
    const py = H / 2 - r.PH / 2;
    const closeX = px + r.PW - 50;
    const closeY = py + 10;
    if (dx >= closeX && dx <= closeX + 40 && dy >= closeY && dy <= closeY + 35) return false;
    const filters = ['All', 'Complete', 'Incomplete'];
    for (let i = 0; i < filters.length; i++) {
      const bx = px + r.PW / 2 - 150 + i * 110;
      const by = py + 110;
      if (dx >= bx && dx <= bx + 100 && dy >= by && dy <= by + 34) return false;
    }
    this.touchScrolling = true;
    this.touchStartY = y;
    this.touchStartOffset = this._panelScrollY;
    return true;
  }

  touchMove(y: number) {
    if (!this.touchScrolling) return;
    const { W, H } = this._size();
    const r = this._panelRect(W, H);
    const scale = r.scale || 1;
    const deltaY = (y - this.touchStartY) / scale;
    const list = this._getFilteredList();
    const itemH = 95, gap = 14;
    const rowH = itemH + gap;
    const contentH = Math.max(0, Math.ceil(list.length / 2) * rowH - gap);
    const viewportH = 4 * rowH - gap;
    const maxScroll = Math.max(0, contentH - viewportH);
    this._panelScrollY = Math.max(0, Math.min(maxScroll, this.touchStartOffset - deltaY));
  }

  endTouch() {
    this.touchScrolling = false;
  }
}

// =====================================================================
// Challenge System — 每日猎杀挑战(参考 HuntingQuestSystem)
// ---------------------------------------------------------------------
// 每天为 Ultra / Super / Omega / Mythic 各生成一个"击杀指定生物"任务:
//  - 击杀目标生物后任务变为可领取,点击 CLAIM 发放星星(⭐)奖励;
//  - 领取后当日该生物不会再出现在同稀有度任务中(completedToday);
//  - 数据存 localStorage,按自然日自动重置。
// 入口：主菜单顶部 Hunting Quest 图标(top_hunting_quest)。
// =====================================================================

/** 单个猎杀任务(与 localStorage 序列化结构一致)。 */
interface HuntingQuest {
  id: string;            // "ultra" | "super" | "omega" | "mythic"
  rarity: string;        // RARITIES 名称("Ultra" 等)
  targetMob: string;     // 目标生物名(ENEMY_DROP_TABLE 键)
  targetCount: number;
  currentCount: number;
  reward: number;        // 星星奖励
  completed: boolean;
  /** 已领取标记。替换新任务时创建全新对象,不携带此字段。 */
  _claimed?: boolean;
}

/** 领取奖励时的爆发粒子。 */
interface QuestParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: [number, number, number];
  alpha: number;
}

class ChallengeSystem {
  game: GameClient;
  quests: HuntingQuest[] = [];
  private completedToday = new Map<string, Set<string>>();
  private lastResetDate: string | null = null;
  private pendingCompletion: HuntingQuest | null = null;
  private particles: QuestParticle[] = [];

  /** 面板状态(主菜单,与成就面板同款交互)。 */
  panelOpen = false;
  /** 面板划入动画进度(0=关闭,1=完全展开;参考背包 bagAnim,由 GameClient.update 驱动)。 */
  openAnim = 0;
  _panelScrollY = 0;
  touchScrolling = false;
  private touchStartY = 0;
  private touchStartOffset = 0;

  /** 最近一次绘制的任务卡矩形(点击命中用,设计坐标)。 */
  private _cardRects: { quest: HuntingQuest; rect: Rect; claimRect: Rect | null }[] = [];

  private readonly SAVE_KEY = "hunting_quests";

  /** 与参考实现一致的稀有度主题色;未知稀有度回退金色。 */
  private static readonly RARITY_COLORS: Record<string, [number, number, number]> = {
    Mythic: [0, 204, 204],
    Ultra: [204, 84, 144],
    Super: [116, 191, 116],
    Omega: [179, 31, 163],
  };

  constructor(gameInstance: GameClient) {
    this.game = gameInstance;
    this.loadQuests();
    this.checkDailyReset();
  }

  _size(): { W: number; H: number } {
    const W = this.game.viewWidth ?? (window as any).WIDTH ?? window.innerWidth;
    const H = this.game.viewHeight ?? (window as any).HEIGHT ?? window.innerHeight;
    return { W, H };
  }

  // ==================== 粒子效果 ====================

  private rarityColor(rarity: string): [number, number, number] {
    return ChallengeSystem.RARITY_COLORS[rarity] ?? [255, 215, 0];
  }

  createParticleEffect(x: number, y: number, rarity: string) {
    const color = this.rarityColor(rarity);
    const particleCount = 60;
    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 6;
      const lifetime = 0.6 + Math.random() * 0.8;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: lifetime,
        maxLife: lifetime,
        size: 3 + Math.random() * 6,
        color,
        alpha: 1,
      });
    }
  }

  updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15; // 重力
      p.life -= dt;
      p.alpha = p.life / p.maxLife;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  drawParticles(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      const alpha = Math.min(1, p.alpha * 1.2);
      ctx.fillStyle = `rgba(${p.color[0]}, ${p.color[1]}, ${p.color[2]}, ${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (p.life / p.maxLife), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  hasActiveParticles(): boolean {
    return this.particles.length > 0;
  }

  // ==================== 任务核心 ====================

  getAvailableMobsByRarity(): Record<string, string[]> {
    const allMobs = Object.keys(ENEMY_DROP_TABLE ?? {});
    const mobsByRarity: Record<string, string[]> = {
      Ultra: [],
      Super: [],
      Omega: [],
      Mythic: [],
    };
    for (const mob of allMobs) {
      if (!mob || mob === "SpacetimeTunnel") continue;
      const completed = this.completedToday.get(mob) ?? new Set<string>();
      if (!completed.has("Ultra")) mobsByRarity["Ultra"].push(mob);
      if (!completed.has("Super")) mobsByRarity["Super"].push(mob);
      if (!completed.has("Omega")) mobsByRarity["Omega"].push(mob);
      if (!completed.has("Mythic")) mobsByRarity["Mythic"].push(mob);
    }
    return mobsByRarity;
  }

  getRandomMob(rarity: string, excludeMob: string | null = null): string | null {
    const mobsByRarity = this.getAvailableMobsByRarity();
    let available = mobsByRarity[rarity] ?? [];
    if (excludeMob) available = available.filter((m) => m !== excludeMob);
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
  }

  initDailyQuests() {
    this.quests = [];
    const specs: { id: string; rarity: string; reward: number }[] = [
      { id: "ultra", rarity: "Ultra", reward: 30 },
      { id: "super", rarity: "Super", reward: 100 },
      { id: "omega", rarity: "Omega", reward: 200 },
      { id: "mythic", rarity: "Mythic", reward: 10 },
    ];
    for (const spec of specs) {
      const targetMob = this.getRandomMob(spec.rarity);
      if (!targetMob) continue;
      this.quests.push({
        id: spec.id,
        rarity: spec.rarity,
        targetMob,
        targetCount: 1,
        currentCount: 0,
        reward: spec.reward,
        completed: false,
      });
    }
    this.saveQuests();
  }

  checkDailyReset() {
    const today = new Date().toDateString();
    if (this.lastResetDate !== today) {
      this.completedToday.clear();
      this.lastResetDate = today;
      this.initDailyQuests();
      this.saveQuests();
    }
  }

  /** 击杀回调:被击杀生物名 + 稀有度名(均由 EVT.KILL 提供)。 */
  updateProgress(killedMob: string, killedRarity: string): boolean {
    if (!killedMob || !killedRarity) return false;
    for (const quest of this.quests) {
      if (quest.completed) continue;
      if (quest.rarity === killedRarity && quest.targetMob === killedMob) {
        quest.currentCount++;
        if (quest.currentCount >= quest.targetCount && !quest.completed) {
          quest.completed = true;
          this.pendingCompletion = quest;
        }
        this.saveQuests();
        return true;
      }
    }
    return false;
  }

  /** 领取奖励:发放星星、粒子、toast,并替换为同稀有度新任务。 */
  claimQuest(questId: string, x?: number, y?: number): boolean {
    const questIndex = this.quests.findIndex((q) => q.id === questId);
    if (questIndex === -1) return false;
    const quest = this.quests[questIndex];
    if (!quest.completed || quest._claimed) return false;

    quest._claimed = true;
    const { W, H } = this._size();
    const rewardX = x !== undefined ? x : W / 2;
    const rewardY = y !== undefined ? y : H / 3;

    // 星星奖励(带动画)
    if (this.game.shopSystem) {
      this.game.shopSystem.addStars(quest.reward, true);
    }

    // 记录今日已完成(该稀有度不再出现同一生物)
    if (!this.completedToday.has(quest.rarity)) this.completedToday.set(quest.rarity, new Set());
    this.completedToday.get(quest.rarity)!.add(quest.targetMob);

    // 粒子 + 飘字反馈
    this.createParticleEffect(rewardX, rewardY, quest.rarity);
    this.game.showMenuToast(`🎉 Quest Complete! +${quest.reward} Stars`);

    // 替换新任务(全新对象,不带 _claimed)
    const newMob = this.getRandomMob(quest.rarity, quest.targetMob);
    if (newMob) {
      this.quests[questIndex] = {
        id: quest.id,
        rarity: quest.rarity,
        targetMob: newMob,
        targetCount: 1,
        currentCount: 0,
        reward: quest.reward,
        completed: false,
      };
    } else {
      this.quests.splice(questIndex, 1);
    }

    this.saveQuests();
    return true;
  }

  getCurrentQuests(): HuntingQuest[] {
    return this.quests;
  }

  getPendingQuest(): HuntingQuest | null {
    return this.pendingCompletion;
  }

  // ==================== 持久化 ====================

  private saveQuests() {
    try {
      localStorage.setItem(this.SAVE_KEY, JSON.stringify({
        quests: this.quests,
        completedToday: Array.from(this.completedToday.entries()).map(([k, v]) => [k, Array.from(v)]),
        lastResetDate: this.lastResetDate,
      }));
      if (CloudStorage.isReady) {
        CloudStorage.instance.set(this.SAVE_KEY, {
          quests: this.quests,
          completedToday: Array.from(this.completedToday.entries()).map(([k, v]) => [k, Array.from(v)]),
          lastResetDate: this.lastResetDate,
        });
      }
    } catch (e) {
      console.error("Failed to save quests:", e);
    }
  }

  private loadQuests() {
    try {
      const saved = localStorage.getItem(this.SAVE_KEY);
      if (saved) {
        const data = JSON.parse(saved) as {
          quests?: HuntingQuest[];
          completedToday?: [string, string[]][];
          lastResetDate?: string | null;
        };
        this.quests = data.quests ?? [];
        this.completedToday = new Map();
        if (data.completedToday) {
          for (const [rarity, mobs] of data.completedToday) {
            this.completedToday.set(rarity, new Set(mobs));
          }
        }
        this.lastResetDate = data.lastResetDate ?? null;
        this.checkDailyReset();
      } else {
        this.initDailyQuests();
      }
    } catch (e) {
      console.error("Failed to load quests:", e);
      this.initDailyQuests();
    }
  }

  // ==================== 面板 ====================

  /** 面板几何(屏幕坐标)。小屏幕时整体等比缩小(与成就面板一致)。 */
  _panelRect(W: number, H: number): { x: number; y: number; w: number; h: number; scale: number; PW: number; PH: number } {
    const isMobile = H < 640 || W < 640;
    const PW = isMobile ? 520 : 720;
    const PH = isMobile ? 430 : 620;
    const scale = Math.min(1, W / (PW + 40), H / (PH + 40));
    return { x: W / 2 - (PW * scale) / 2, y: H / 2 - (PH * scale) / 2, w: PW * scale, h: PH * scale, scale, PW, PH };
  }

  panelContains(x: number, y: number): boolean {
    if (!this.panelOpen) return false;
    const { W, H } = this._size();
    const r = this._panelRect(W, H);
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  togglePanel() {
    this.panelOpen = !this.panelOpen;
    if (this.panelOpen) this._panelScrollY = 0;
  }

  /** 面板划入动画进度推进(目标 = panelOpen)。 */
  updateOpenAnim(dt: number) {
    this.openAnim += ((this.panelOpen ? 1 : 0) - this.openAnim) * Math.min(1, dt * 10);
  }

  private drawStrokedText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    fontSize = 14,
    textAlign: CanvasTextAlign = "center",
    fillColor = "white",
  ) {
    ctx.save();
    ctx.font = ` ${fontSize}px ${FONT_FAMILY}`;
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

  private drawStyledButton(
    ctx: CanvasRenderingContext2D,
    text: string,
    rect: [number, number, number, number],
    baseColor: [number, number, number],
    fontSize = 15,
  ) {
    const [x, y, w, h] = rect;
    const adj = (c: [number, number, number], f: number) => c.map((v) => Math.min(255, Math.max(0, Math.floor(v * f))));
    const dark = `rgb(${adj(baseColor, 0.85).join(",")})`;
    const light = `rgb(${baseColor.join(",")})`;
    const stroke = `rgb(${adj(baseColor, 0.5).join(",")})`;
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, 8);
    ctx.fillStyle = light;
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, 8);
    ctx.clip();
    ctx.fillStyle = dark;
    ctx.fillRect(x, y, w, h / 2);
    ctx.restore();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, 8);
    ctx.stroke();
    if (text) {
      ctx.font = ` ${fontSize}px ${FONT_FAMILY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.strokeStyle = "black";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeText(text, x + w / 2, y + h / 2);
      ctx.fillStyle = "white";
      ctx.fillText(text, x + w / 2, y + h / 2);
    }
  }

  drawPanel(ctx: CanvasRenderingContext2D) {
    if (!this.panelOpen) return;
    this.checkDailyReset();

    const { W, H } = this._size();
    const r = this._panelRect(W, H);
    const scale = r.scale;
    const px = r.x;
    const py = r.y;
    const PW = r.PW;
    const PH = r.PH;
    const isMobile = H < 640 || W < 640;

    ctx.save();
    // 划入动画:淡入 + 从屏幕底部滑入(ease.outCubic,与背包面板一致)
    ctx.globalAlpha = Math.min(1, this.openAnim * 1.6);
    if (scale < 1) {
      ctx.translate(W / 2, H / 2);
      ctx.scale(scale, scale);
      ctx.translate(-W / 2, -H / 2);
    }
    ctx.translate(0, (1 - ease.outCubic(this.openAnim)) * (H + 20));

    // 主背景(深紫蓝主题,与成就面板区分)
    ctx.fillStyle = "#3b3f6e";
    ctx.fillRect(px, py, PW, PH);
    ctx.strokeStyle = "#23264a";
    ctx.lineWidth = 6;
    ctx.strokeRect(px, py, PW, PH);

    // 标题 + 关闭按钮
    this.drawStrokedText(ctx, "Challenges", px + PW / 2, py + (isMobile ? 30 : 40), isMobile ? 26 : 30);
    const closeBtn: [number, number, number, number] = [px + PW - (isMobile ? 42 : 50), py + 10, isMobile ? 32 : 40, isMobile ? 28 : 35];
    this.drawStyledButton(ctx, "✕", closeBtn, [220, 80, 80], isMobile ? 15 : 18);

    // 说明行(每日重置)
    this.drawStrokedText(
      ctx,
      `Daily hunts — reset ${new Date().toDateString()}`,
      px + PW / 2,
      py + (isMobile ? 62 : 78),
      isMobile ? 12 : 14,
      "center",
      "rgba(255,255,255,0.75)",
    );

    // 任务卡网格(2 列 × 2 行,像素级滚动)
    const startY = py + (isMobile ? 82 : 104);
    const sidePad = isMobile ? 14 : 28;
    const gap = isMobile ? 10 : 16;
    const itemW = Math.floor((PW - sidePad * 2 - gap) / 2);
    const itemH = isMobile ? 150 : 190;
    const rowH = itemH + gap;
    const viewportRows = 2;
    const contentH = Math.max(0, Math.ceil(Math.max(1, this.quests.length) / 2) * rowH - gap);
    const viewportH = viewportRows * rowH - gap;
    const maxScroll = Math.max(0, contentH - viewportH);
    this._panelScrollY = Math.max(0, Math.min(maxScroll, this._panelScrollY));

    const list = this.quests.slice();
    const startRow = Math.floor(this._panelScrollY / rowH);
    const yOff = -(this._panelScrollY % rowH);
    const visible = list.slice(startRow * 2, startRow * 2 + (viewportRows + 1) * 2);

    ctx.save();
    ctx.beginPath();
    ctx.rect(px + sidePad - 2, startY - 2, itemW * 2 + gap + 4, viewportH + 8);
    ctx.clip();

    const cardRects: { quest: HuntingQuest; rect: Rect; claimRect: Rect | null }[] = [];
    visible.forEach((quest, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const ix = px + sidePad + col * (itemW + gap);
      const iy = startY + row * rowH + yOff;
      const color = this.rarityColor(quest.rarity);
      const done = quest.completed;

      // 卡片背景
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      roundRect(ctx, ix, iy, itemW, itemH, 10);
      ctx.fill();
      ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},0.9)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      roundRect(ctx, ix, iy, itemW, itemH, 10);
      ctx.stroke();

      // 稀有度徽章(左上)
      ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},0.25)`;
      ctx.beginPath();
      roundRect(ctx, ix + 12, iy + 10, 96, 24, 6);
      ctx.fill();
      this.drawStrokedText(ctx, quest.rarity, ix + 60, iy + 22, isMobile ? 11 : 13, "center", `rgb(${color[0]},${color[1]},${color[2]})`);

      // 奖励(右上 ⭐N)
      this.drawStrokedText(ctx, `+${quest.reward}`, ix + itemW - 30, iy + 22, isMobile ? 11 : 13, "right", "#ffd700");
      drawStarIcon(ctx, ix + itemW - 18, iy + 22, isMobile ? 5 : 7);

      // 目标生物绘制(与 MobGallery 一致,使用 drawMob 画生物本体;找不到则回退名字文本)
      const mobDef = ENEMY_DROP_TABLE[quest.targetMob];
      const mobId = mobDef ? mobDef.id : MOBS.findIndex((m) => m && m.name === quest.targetMob);
      const rarityIdx = Math.max(0, RARITIES.findIndex((r) => r.name === quest.rarity));
      const iconR = isMobile ? 24 : 36;
      const iconCX = ix + itemW / 2;
      const iconCY = iy + (isMobile ? 58 : 68);
      if (mobId >= 0 && typeof drawMob === "function") {
        // 静止绘制:time 固定为 0,与 MobGallery 一致(生物不播放动画)
        drawMob(ctx, mobId, iconCX, iconCY, iconR, 0, 0, false, rarityIdx, 1);
      } else {
        this.drawStrokedText(ctx, "?", iconCX, iconCY, isMobile ? 20 : 26, "center", "white");
      }

      // 生物名(图标下方)
      this.drawStrokedText(ctx, quest.targetMob, ix + itemW / 2, iy + (isMobile ? 88 : 112), isMobile ? 11 : 14, "center", "white");

      // 进度条
      const pX = ix + 14;
      const pY = iy + (isMobile ? 102 : 130);
      const pW = itemW - 28;
      const pH = isMobile ? 12 : 16;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      roundRect(ctx, pX, pY, pW, pH, 6);
      ctx.fill();
      const progress = Math.max(0, Math.min(1, quest.currentCount / Math.max(1, quest.targetCount)));
      ctx.fillStyle = done ? "rgba(255,215,0,0.95)" : `rgba(${color[0]},${color[1]},${color[2]},0.95)`;
      ctx.beginPath();
      roundRect(ctx, pX, pY, Math.max(6, pW * progress), pH, 6);
      ctx.fill();

      // 状态按钮区
      let claimRect: Rect | null = null;
      if (done && !quest._claimed) {
        const btnW = Math.min(120, itemW - 28);
        const btnH = isMobile ? 26 : 32;
        const btnX = ix + itemW / 2 - btnW / 2;
        const btnY = iy + itemH - btnH - 10;
        this.drawStyledButton(ctx, "CLAIM", [btnX, btnY, btnW, btnH], [46, 204, 113], isMobile ? 11 : 13);
        claimRect = { x: btnX, y: btnY, w: btnW, h: btnH };
      } else if (done) {
        this.drawStrokedText(ctx, "✓ Claimed", ix + itemW / 2, iy + itemH - 24, isMobile ? 11 : 13, "center", "rgba(255,215,0,0.9)");
      } else {
        this.drawStrokedText(ctx, `${quest.currentCount}/${quest.targetCount}`, ix + itemW / 2, iy + itemH - 24, isMobile ? 11 : 13, "center", "rgba(255,255,255,0.7)");
      }

      cardRects.push({ quest, rect: { x: ix, y: iy, w: itemW, h: itemH }, claimRect });
    });
    this._cardRects = cardRects;
    ctx.restore();

    // 滚动条
    if (maxScroll > 0) {
      const barX = px + PW - 14;
      const barY = startY;
      const barH = viewportH;
      const thumbH = Math.max(24, barH * (viewportH / contentH));
      const thumbY = barY + (this._panelScrollY / maxScroll) * (barH - thumbH);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      roundRect(ctx, barX, barY, 6, barH, 3);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      roundRect(ctx, barX, thumbY, 6, thumbH, 3);
      ctx.fill();
    }

    // 粒子(设计坐标,随面板缩放)
    this.drawParticles(ctx);

    ctx.restore();
  }

  handleClick(x: number, y: number): boolean {
    if (!this.panelOpen) return false;
    const { W, H } = this._size();
    const r = this._panelRect(W, H);
    if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) return false;

    const scale = r.scale;
    const dx = (x - W / 2) / scale + W / 2;
    const dy = (y - H / 2) / scale + H / 2;
    const px = W / 2 - r.PW / 2;
    const py = H / 2 - r.PH / 2;
    const PW = r.PW;
    const isMobile = H < 640 || W < 640;

    // 关闭按钮
    const closeX = px + PW - (isMobile ? 42 : 50);
    const closeY = py + 10;
    if (dx >= closeX && dx <= closeX + (isMobile ? 32 : 40) && dy >= closeY && dy <= closeY + (isMobile ? 28 : 35)) {
      this.panelOpen = false;
      return true;
    }

    // CLAIM 按钮
    for (const c of this._cardRects) {
      if (c.claimRect && dx >= c.claimRect.x && dx <= c.claimRect.x + c.claimRect.w && dy >= c.claimRect.y && dy <= c.claimRect.y + c.claimRect.h) {
        this.claimQuest(c.quest.id, dx, dy);
        return true;
      }
    }

    // 面板内部其它点击 → 吞掉,不穿透
    return true;
  }

  handleScroll(deltaY: number) {
    if (!this.panelOpen) return;
    const { W, H } = this._size();
    const r = this._panelRect(W, H);
    const isMobile = H < 640 || W < 640;
    const gap = isMobile ? 10 : 16;
    const itemW = Math.floor((r.PW - (isMobile ? 28 : 56) - gap) / 2);
    const itemH = isMobile ? 150 : 190;
    const rowH = itemH + gap;
    const contentH = Math.max(0, Math.ceil(Math.max(1, this.quests.length) / 2) * rowH - gap);
    const viewportH = 2 * rowH - gap;
    const maxScroll = Math.max(0, contentH - viewportH);
    this._panelScrollY = Math.max(0, Math.min(maxScroll, this._panelScrollY + deltaY));
  }

  /** 触摸滚动:面板内按下(避开 ✕ 与 CLAIM 按钮)开始滚动。 */
  beginTouch(x: number, y: number): boolean {
    if (!this.panelOpen) return false;
    if (!this.panelContains(x, y)) return false;
    const { W, H } = this._size();
    const r = this._panelRect(W, H);
    const scale = r.scale;
    const dx = (x - W / 2) / scale + W / 2;
    const dy = (y - H / 2) / scale + H / 2;
    const px = W / 2 - r.PW / 2;
    const py = H / 2 - r.PH / 2;
    const isMobile = H < 640 || W < 640;
    const closeX = px + r.PW - (isMobile ? 42 : 50);
    const closeY = py + 10;
    if (dx >= closeX && dx <= closeX + (isMobile ? 32 : 40) && dy >= closeY && dy <= closeY + (isMobile ? 28 : 35)) return false;
    for (const c of this._cardRects) {
      if (c.claimRect && dx >= c.claimRect.x && dx <= c.claimRect.x + c.claimRect.w && dy >= c.claimRect.y && dy <= c.claimRect.y + c.claimRect.h) return false;
    }
    this.touchScrolling = true;
    this.touchStartY = y;
    this.touchStartOffset = this._panelScrollY;
    return true;
  }

  touchMove(y: number) {
    if (!this.touchScrolling) return;
    const { W, H } = this._size();
    const r = this._panelRect(W, H);
    const scale = r.scale || 1;
    const deltaY = (y - this.touchStartY) / scale;
    const isMobile = H < 640 || W < 640;
    const gap = isMobile ? 10 : 16;
    const itemW = Math.floor((r.PW - (isMobile ? 28 : 56) - gap) / 2);
    const itemH = isMobile ? 150 : 190;
    const rowH = itemH + gap;
    const contentH = Math.max(0, Math.ceil(Math.max(1, this.quests.length) / 2) * rowH - gap);
    const viewportH = 2 * rowH - gap;
    const maxScroll = Math.max(0, contentH - viewportH);
    this._panelScrollY = Math.max(0, Math.min(maxScroll, this.touchStartOffset - deltaY));
  }

  endTouch() {
    this.touchScrolling = false;
  }

  /** 每帧调用:推进粒子、检查跨日重置。 */
  update(dt: number) {
    this.checkDailyReset();
    this.updateParticles(dt);
  }
}

// =====================================================================
// Shop System — 商店(参考 Pasted text(26) 的 ShopSystem / RedeemSystem)
// ---------------------------------------------------------------------
// 适配说明：本项目是多人在线游戏,物品/背包由服务器权威管理,但服务器信任
// 客户端上报的进度(与 xp/背包 JOIN 上报一致)。因此商店保持纯客户端实现:
//  - 星星(⭐)是玩家货币,存入本地存档 SaveData.stars;
//  - 物品购买/兑换码奖励直接写入本地背包 this.bag —— 主菜单场景的背包就是
//    本地存档,点击 PLAY 时随 JOIN 同步到服务器;
//  - 会员存 localStorage,纯本地生效(ruby 会员同步主菜单 Extra Bonus 面板)。
// 入口：主菜单顶部 Shop 图标(top_shop)。
// =====================================================================

type RGB = [number, number, number];

interface MembershipTier {
  id: string;
  label: string;
  price: number;
  color: RGB;
  bonusMinutes: number;
  xpMult: number;
  dropRate: number;
  bonusBuff: number;
  extraBonus: boolean;
  desc: string[];
}

interface ShopListEntry {
  item: number;
  basePrice: number;
}

interface ShopDiscount {
  type: string;
  discountPercent: number;
  multiplier: number;
  omegaOriginalPrice: number;
  omegaDiscountedPrice: number;
  eternalOriginalPrice: number;
  eternalDiscountedPrice: number;
}

interface RedeemReward {
  /** 物品名称(映射到 ITEMS;本游戏没有的物品自动跳过)。 */
  type?: string;
  rarity?: string;
  count?: number;
  /** 星星奖励。 */
  stars?: number;
  /** 会员档位 id。 */
  membership?: string;
  /** 会员时长(天)。 */
  duration?: number;
}

interface RedeemCodeDef {
  items: RedeemReward[];
  expires: number;
  maxUses: number;
}

function rgbArr(c: RGB): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * 金色五角星图标(全游戏统一星星样式,参考 starCanvas 绘制):
 * 暖金 #f5c542 填充 + 深铜 #b07c2b 描边(描边宽 = 外半径/6),圆角连接,尖角朝上。
 */
function drawStarIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, outerRadius: number, innerRadius?: number) {
  const outer = Math.max(1, outerRadius);
  const inner = innerRadius ?? outer * 0.5;
  const startAngle = -Math.PI / 2;
  const step = Math.PI / 5;
  ctx.beginPath();
  ctx.moveTo(cx + outer * Math.cos(startAngle), cy + outer * Math.sin(startAngle));
  for (let i = 1; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = startAngle + i * step;
    ctx.lineTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
  }
  ctx.closePath();
  ctx.fillStyle = '#f5c542';
  ctx.fill();
  ctx.lineWidth = outer / 6;
  ctx.strokeStyle = '#b07c2b';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

class ShopSystem {
  game: GameClient;
  visible = false;
  /** 面板划入动画进度(0=关闭,1=完全展开;参考背包 bagAnim,由 GameClient.update 驱动)。 */
  openAnim = 0;
  currentTab: "buy" | "membership" | "redeem" = "buy";

  message = "";
  messageTimer = 0;
  mouseX = 0;
  mouseY = 0;

  // ---- 滚动 ----
  scrollOffset = 0; // buy 页签
  membershipScrollOffset = 0;

  // ---- 触摸滚动状态(移动端;buy/membership 页签可滚动) ----
  touchScrolling = false;
  private touchStartY = 0;
  private touchStartOffset = 0;

  // ---- 筛选 ----
  filterSearch = "";
  filterSearchActive = false;
  // ---- 兑换 ----
  redeemInputActive = false;
  redeemText = "";
  private codes = new Map<string, RedeemCodeDef>();
  private usedRecords = new Map<string, boolean>();
  private readonly REDEEM_STORAGE_KEY = "redeem_used_records";

  // ---- 会员 ----
  activeMembership: { tierId: string; purchasedAt: number; expiresAt: number } | null = null;
  private readonly MEMBERSHIP_STORAGE_KEY = "flwrr_membership";

  // ---- 布局(设计坐标,绘制时整体缩放) ----
  private readonly PW = 760;
  private readonly PH = 600;
  private panelScale = 1;
  private screenRectVal: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private closeBtn: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private tabRects: Record<string, Rect> = {};
  /** 每张商品卡当前选择的稀有度(itemId → RARITIES 下标,重绘不丢)。 */
  private cardRarities = new Map<number, number>();
  /** 卡片稀有度切换滑动动画(itemId → {t 0..1, dir +1=next/-1=prev, from 旧稀有度})。 */
  private cardSwitchAnim = new Map<number, { t: number; dir: number; from: number }>();
  private _shopCardRects: { entry: ShopListEntry; rarity: number; rect: Rect; buyRect: Rect; prevRect: Rect; nextRect: Rect }[] = [];
  private _membershipRects: { tier: MembershipTier; rect: Rect }[] = [];

  // ---- 商店数据(参考 Pasted text(26) 的 MEMBERSHIP_TIERS / BASE_PRICES) ----
  readonly MEMBERSHIP_TIERS: MembershipTier[] = [
    { id: "bronze", label: "Bronze", price: 10000, color: [176, 106, 52], bonusMinutes: 15, xpMult: 1.05, dropRate: 0, bonusBuff: 0, extraBonus: false, desc: ["+15 min bonus time/day", "×1.05 XP"] },
    { id: "silver", label: "Silver", price: 90000, color: [160, 160, 175], bonusMinutes: 30, xpMult: 1.1, dropRate: 0.02, bonusBuff: 0, extraBonus: false, desc: ["+30 min bonus time/day", "×1.1 XP", "+2% drop rate"] },
    { id: "gold", label: "Gold", price: 200000, color: [220, 180, 40], bonusMinutes: 60, xpMult: 1.3, dropRate: 0.05, bonusBuff: 0, extraBonus: false, desc: ["+1 h bonus time/day", "×1.3 XP", "+5% drop rate"] },
    { id: "platinum", label: "Platinum", price: 900000, color: [100, 210, 230], bonusMinutes: 90, xpMult: 1.4, dropRate: 0.075, bonusBuff: 0, extraBonus: false, desc: ["+1.5 h bonus time/day", "×1.4 XP", "+7.5% drop rate"] },
    { id: "diamond", label: "Diamond", price: 20000000, color: [140, 230, 255], bonusMinutes: 120, xpMult: 1.5, dropRate: 0.1, bonusBuff: 1, extraBonus: false, desc: ["+2 h bonus time/day", "×1.5 XP", "+10% drop rate", "+1 Bonus Buff (3x→4x, base 3x)"] },
    { id: "ruby", label: "Ruby", price: 200000000, color: [220, 40, 80], bonusMinutes: 0, xpMult: 1.7, dropRate: 0.15, bonusBuff: 2, extraBonus: true, desc: ["×1.7 XP", "+15% drop rate", "+2 Bonus Buff (3x→5x)", "Extra Bonus: 1 month"] },
  ];

  /** 与 RARITIES 对齐的稀有度价格倍率(参考 PRICE_MULTIPLIERS)。 */
  private readonly PRICE_MULTIPLIERS: number[] = [1, 2, 3, 4, 5, 100, 2500, 50000, 1500000, 37500000, 37500000];

  /** 本游戏 ITEMS 的基准价格(参考 BASE_PRICES;未列出的物品默认 10)。 */
  private readonly BASE_PRICES: Record<string, number> = {
    Basic: 1, Leaf: 3, Stinger: 8, Rock: 5, Sand: 3, Bubble: 10, Pearl: 5,
    Wing: 5, Stick: 18, Coin: 2, Clover: 5, Corn: 8, Heavy: 5, Moon: 250,
    Pollen: 3, Honey: 3, Starfish: 5, Salt: 3, Jelly: 3, Lightning: 10,
    Claw: 7, Powder: 6, Rose: 8, Light: 8, Glass: 10, Bone: 7, Pincer: 8,
    Iris: 2, Shell: 3, Magnet: 10, Cactus: 4, Antennae: 12, Soil: 6,
    Fang: 5, Orange: 12, "Third Eye": 15, Faster: 12, Missile: 5,
    "Ladybug Egg": 12, "Soldier Ant Egg": 12, "Worker Ant Egg": 10, "Rock Egg": 12,
    "Bee Egg": 12, "Starfish Egg": 15, "Jellyfish Egg": 18, "Crab Egg": 18,
    "Beetle Egg": 15, "Scorpion Egg": 10, "Shell Egg": 22, "Cactus Egg": 12,
    "Ant Hole Egg": 42, "Hornet Egg": 13, "Spider Egg": 12,
  };

  shopItems: ShopListEntry[] = [];
  discountItems: ShopDiscount[] = [];
  private discountEndTime = 0;
  private discountUpdateTime = 0;

  constructor(game: GameClient) {
    this.game = game;
    this.activeMembership = this.loadMembership();
    if (this.activeMembership && this.activeMembership.tierId === "ruby" && this.activeMembership.expiresAt > Date.now()) {
      this.game.setRubyMembership(this.activeMembership.expiresAt);
    }
    for (const def of ITEMS) {
      if (!def) continue;
      this.shopItems.push({ item: def.id, basePrice: this.BASE_PRICES[def.name] ?? 10 });
    }
    this.shopItems.sort((a, b) => a.basePrice - b.basePrice);
    this.refreshDailyDiscounts();
    this.registerCodes();
    this.loadUsedRecords();
  }

  // ===================== 星星 =====================
  addStars(n: number, showAnimation = false) {
    this.game.addStars(n);
    if (n > 0 && showAnimation) this.showMessage(`+${n} Stars`);
    return this.game.stars;
  }

  // ===================== 价格 =====================
  private itemBasePrice(itemId: number): number {
    const def = ITEMS[itemId];
    if (!def) return 10;
    return this.BASE_PRICES[def.name] ?? 10;
  }

  getItemPrice(itemId: number, rarity: number): number {
    const mult = rarity >= 0 && rarity < this.PRICE_MULTIPLIERS.length ? this.PRICE_MULTIPLIERS[rarity] : 1;
    return Math.max(1, Math.round(this.itemBasePrice(itemId) * mult));
  }

  getDiscountedPrice(itemId: number, rarity: number): number {
    if (rarity === 8 || rarity === 9) {
      const def = ITEMS[itemId];
      const d = def ? this.discountItems.find(dd => dd.type === def.name) : undefined;
      if (d) return rarity === 8 ? d.omegaDiscountedPrice : d.eternalDiscountedPrice;
    }
    return this.getItemPrice(itemId, rarity);
  }

  formatPrice(p: number): string {
    if (p >= 1e12) return (p / 1e12).toFixed(2) + "T";
    if (p >= 1e9) return (p / 1e9).toFixed(2) + "B";
    if (p >= 1e6) return (p / 1e6).toFixed(2) + "M";
    if (p >= 1e3) return (p / 1e3).toFixed(2) + "K";
    return p.toString();
  }

  // ===================== 每日折扣 =====================
  private hashCode(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h = h & h;
    }
    return Math.abs(h);
  }

  private seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  refreshDailyDiscounts() {
    this.discountItems = [];
    const seed = this.hashCode(new Date().toDateString());
    const random = this.seededRandom(seed);
    const candidates = this.shopItems.filter(
      i => this.getItemPrice(i.item, 8) > 1000 || this.getItemPrice(i.item, 9) > 1000,
    );
    if (!candidates.length) return;
    const count = Math.min(7, candidates.length);
    const chosen: number[] = [];
    while (chosen.length < count) {
      const idx = Math.floor(random() * candidates.length);
      if (!chosen.includes(idx)) chosen.push(idx);
    }
    for (const idx of chosen) {
      const entry = candidates[idx];
      const def = ITEMS[entry.item];
      if (!def) continue;
      const pct = 5 + Math.floor(random() * 26);
      const mul = (100 - pct) / 100;
      this.discountItems.push({
        type: def.name,
        discountPercent: pct,
        multiplier: mul,
        omegaOriginalPrice: this.getItemPrice(entry.item, 8),
        omegaDiscountedPrice: Math.floor(this.getItemPrice(entry.item, 8) * mul),
        eternalOriginalPrice: this.getItemPrice(entry.item, 9),
        eternalDiscountedPrice: Math.floor(this.getItemPrice(entry.item, 9) * mul),
      });
    }
    this.discountEndTime = Date.now() + 24 * 60 * 60 * 1000;
    this.discountUpdateTime = Date.now();
  }

  private checkDiscountUpdate() {
    const now = Date.now();
    if (now > this.discountEndTime) {
      this.refreshDailyDiscounts();
      return;
    }
    if (new Date(this.discountUpdateTime).toDateString() !== new Date().toDateString()) {
      this.refreshDailyDiscounts();
    }
  }

  // ===================== Buy =====================
  getFilteredItems(): ShopListEntry[] {
    const q = this.filterSearch.trim().toLowerCase();
    return this.shopItems.filter(entry => {
      if (q) {
        const name = ITEMS[entry.item]?.name ?? "";
        if (!name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }

  buyItem(entry: ShopListEntry, rarity: number) {
    if (!entry || rarity < 0 || rarity >= this.PRICE_MULTIPLIERS.length) return;
    const price = this.getDiscountedPrice(entry.item, rarity);
    if (this.game.stars < price) {
      this.showMessage(`❌ Need ${this.formatPrice(price)} Stars`);
      return;
    }
    this.game.addStars(-price);
    if (!this.game.grantShopItems(entry.item, rarity, 1)) {
      this.game.addStars(price);
      this.showMessage("❌ Bag full!");
      return;
    }
    this.showMessage(`✅ Purchased: ${RARITIES[rarity]?.name ?? "?"} ${ITEMS[entry.item]?.name ?? "?"}`);
    this.game.saveNow();
  }

  typeSearch(key: string) {
    if (key === "Backspace") {
      this.filterSearch = this.filterSearch.slice(0, -1);
    } else if (key === "Escape" || key === "Enter") {
      this.filterSearchActive = false;
    } else if (key.length === 1 && this.filterSearch.length < 24) {
      this.filterSearch += key;
    }
    this.scrollOffset = 0;
  }

  // ===================== Membership =====================
  private loadMembership(): { tierId: string; purchasedAt: number; expiresAt: number } | null {
    try {
      const raw = localStorage.getItem(this.MEMBERSHIP_STORAGE_KEY);
      if (!raw) return null;
      const m = JSON.parse(raw) as { tierId: string; purchasedAt: number; expiresAt: number };
      if (m.expiresAt && Date.now() > m.expiresAt) return null;
      return m;
    } catch {
      return null;
    }
  }

  private saveMembership(tierId: string, durationDays: number) {
    const m = { tierId, purchasedAt: Date.now(), expiresAt: Date.now() + durationDays * 24 * 60 * 60 * 1000 };
    try {
      localStorage.setItem(this.MEMBERSHIP_STORAGE_KEY, JSON.stringify(m));
      if (CloudStorage.isReady) {
        CloudStorage.instance.set(this.MEMBERSHIP_STORAGE_KEY, m);
      }
    } catch {
      /* ignore */
    }
    this.activeMembership = m;
  }

  getMembershipTier(): MembershipTier | null {
    if (!this.activeMembership) return null;
    return this.MEMBERSHIP_TIERS.find(t => t.id === this.activeMembership?.tierId) ?? null;
  }

  private purchaseMembership(tier: MembershipTier) {
    if (this.game.stars < tier.price) {
      this.showMessage(`❌ Need ${this.formatPrice(tier.price)} Stars for ${tier.label}`);
      return;
    }
    const cur = this.getMembershipTier();
    if (cur) {
      const ci = this.MEMBERSHIP_TIERS.findIndex(t => t.id === cur.id);
      const ni = this.MEMBERSHIP_TIERS.findIndex(t => t.id === tier.id);
      if (ni <= ci) {
        this.showMessage(`❌ Already have ${cur.label} or higher`);
        return;
      }
    }
    this.game.addStars(-tier.price);
    this.saveMembership(tier.id, 30);
    this.showMessage(`✅ ${tier.label} Membership activated! (30 days)`);
    if (tier.id === "ruby" && this.activeMembership) this.game.setRubyMembership(this.activeMembership.expiresAt);
    this.game.saveNow();
  }

  // ===================== Redeem =====================
  private registerCodes() {
    const add = (code: string, items: RedeemReward[], expireDays = 30) => {
      this.codes.set(code.toUpperCase(), {
        items,
        expires: Date.now() + expireDays * 24 * 60 * 60 * 1000,
        maxUses: 1,
      });
    };
    add("123TRY", [{ type: "Fang", rarity: "Ultra", count: 1 }, { type: "Leaf", rarity: "Super", count: 1 }], 30);
    add("MOBILE", [{ type: "Fang", rarity: "Ultra", count: 1 }, { type: "Stick", rarity: "Ultra", count: 3 }, { type: "Air", rarity: "Super", count: 1 }, { stars: 10000 }], 30);
    add("M4SVGK", [{ type: "Wing", rarity: "Legendary", count: 1 }, { type: "Leaf", rarity: "Legendary", count: 1 }, { type: "Coin", rarity: "Mythic", count: 1 }, { stars: 1145 }], 10);
    add("XXY30391F", [{ stars: 100000 }], 30);
    add("WELCOME", [{ type: "Wing", rarity: "Epic", count: 5 }, { type: "Leaf", rarity: "Epic", count: 3 }, { stars: 50 }], 30);
    add("1354679", [{ membership: "ruby", duration: 10, stars: 5000 }], 30);
    add("MMMMMM", [{ membership: "platinum", duration: 20, stars: 5000 }], 30);
    add("12354", [{ membership: "diamond", duration: 30, stars: 2000 }], 30);
    add("9178", [{ membership: "diamond", duration: 20, stars: 78 }], 30);
    add("114514", [{ membership: "silver", duration: 30, stars: 200 }], 30);
    add("GOLD2029", [{ membership: "gold", duration: 15, stars: 500 }], 30);
    add("TEST", [{ membership: "Ruby", duration: 5, stars: 100 }], 30);
  }

  private loadUsedRecords() {
    try {
      const saved = localStorage.getItem(this.REDEEM_STORAGE_KEY);
      this.usedRecords = saved ? new Map(Object.entries(JSON.parse(saved) as Record<string, boolean>)) : new Map();
    } catch {
      this.usedRecords = new Map();
    }
  }

  private saveUsedRecords() {
    try {
      localStorage.setItem(this.REDEEM_STORAGE_KEY, JSON.stringify(Object.fromEntries(this.usedRecords)));
      if (CloudStorage.isReady) {
        CloudStorage.instance.set(this.REDEEM_STORAGE_KEY, Object.fromEntries(this.usedRecords));
      }
    } catch {
      /* ignore */
    }
  }

  private itemIdByName(name: string): number {
    for (const def of ITEMS) {
      if (def && def.name === name) return def.id;
    }
    return -1;
  }

  private rarityIndexByName(name: string): number {
    const idx = RARITIES.findIndex(r => r.name === name);
    return idx >= 0 ? idx : 0;
  }

  redeem(code: string) {
    const upper = code.toUpperCase().trim();
    const def = this.codes.get(upper);
    if (!def) {
      this.showMessage("❌ Invalid code", 3000);
      return;
    }
    if (Date.now() > def.expires) {
      this.codes.delete(upper);
      this.showMessage("❌ Code expired", 3000);
      return;
    }
    const playerId = this.game.playerIdentity();
    const key = `${upper}_${playerId}`;
    if (this.usedRecords.has(key)) {
      this.showMessage("❌ You already used this code", 3000);
      return;
    }
    let totalUsed = 0;
    for (const k of this.usedRecords.keys()) {
      if (k.startsWith(upper + "_")) totalUsed++;
    }
    if (totalUsed >= def.maxUses) {
      this.showMessage("❌ Code used up", 3000);
      return;
    }

    const rewards: string[] = [];
    let totalStars = 0;
    let membershipTier: string | null = null;
    let membershipDuration = 30;

    for (const rw of def.items) {
      if (rw.stars) totalStars += rw.stars;
      if (rw.membership) {
        membershipTier = rw.membership.toLowerCase();
        membershipDuration = rw.duration || 30;
      }
      if (rw.type) {
        const itemId = this.itemIdByName(rw.type);
        if (itemId < 0) continue; // 本游戏没有的物品,跳过
        const rarity = Math.min(this.rarityIndexByName(rw.rarity ?? "Common"), MAX_RARITY);
        const count = Math.max(1, Math.min(99, rw.count || 1));
        if (this.game.grantShopItems(itemId, rarity, count)) {
          rewards.push(`${count} ${RARITIES[rarity]?.name ?? "?"} ${rw.type}`);
        }
      }
    }
    if (totalStars > 0) {
      this.game.addStars(totalStars);
      rewards.push(`${totalStars} Stars`);
    }
    if (membershipTier) {
      const tier = this.MEMBERSHIP_TIERS.find(t => t.id === membershipTier);
      if (tier) {
        this.saveMembership(tier.id, membershipDuration);
        if (tier.id === "ruby" && this.activeMembership) this.game.setRubyMembership(this.activeMembership.expiresAt);
        rewards.push(`${tier.label} membership ${membershipDuration}d`);
      }
    }

    this.usedRecords.set(key, true);
    this.saveUsedRecords();
    this.game.saveNow();
    this.showMessage(`✅ Got: ${rewards.length ? rewards.join(", ") : "nothing"}`, 5000);
  }

  typeRedeem(key: string) {
    if (key === "Backspace") {
      this.redeemText = this.redeemText.slice(0, -1);
    } else if (key === "Enter") {
      const code = this.redeemText;
      this.redeemText = "";
      this.redeemInputActive = false;
      this.redeem(code);
    } else if (key === "Escape") {
      this.redeemInputActive = false;
      this.redeemText = "";
    } else if (key.length === 1 && /[a-zA-Z0-9]/.test(key) && this.redeemText.length < 16) {
      this.redeemText += key.toUpperCase();
    }
  }

  // ===================== 消息 =====================
  showMessage(msg: string, duration = 3) {
    this.message = msg;
    this.messageTimer = duration;
  }

  /** 更新鼠标位置(用于卡片 hover 效果;由 GameClient renderMenu 每帧传入)。 */
  setMouse(mx: number, my: number) {
    this.mouseX = mx;
    this.mouseY = my;
  }

  // ===================== 布局 =====================
  layout(W: number, H: number) {
    const scale = Math.min(1, W / (this.PW + 40), H / (this.PH + 40));
    this.panelScale = scale;
    this.screenRectVal = {
      x: W / 2 - (this.PW * scale) / 2,
      y: H / 2 - (this.PH * scale) / 2,
      w: this.PW * scale,
      h: this.PH * scale,
    };
    const px = W / 2 - this.PW / 2; // 设计坐标
    const py = H / 2 - this.PH / 2;
    this.closeBtn = { x: px + this.PW - 46, y: py + 8, w: 36, h: 36 };
    const tabW = 102;
    const tabH = 34;
    const gap = 6;
    const tabX = px + 22;
    const tabY = py + 54;
    this.tabRects = {
      buy: { x: tabX, y: tabY, w: tabW, h: tabH },
      membership: { x: tabX + tabW + gap, y: tabY, w: tabW, h: tabH },
      redeem: { x: tabX + (tabW + gap) * 2, y: tabY, w: tabW, h: tabH },
    };
    return { scale, px, py };
  }

  screenRect(): Rect {
    return this.screenRectVal;
  }

  private hitRect(r: Rect, x: number, y: number): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  // ===================== 交互 =====================
  handleClick(mx: number, my: number, W: number, H: number): boolean {
    if (!this.visible) return false;
    this.layout(W, H);
    const s = this.panelScale;
    const dx = W / 2 + (mx - W / 2) / s;
    const dy = H / 2 + (my - H / 2) / s;
    const px = W / 2 - this.PW / 2;
    const py = H / 2 - this.PH / 2;

    // 点击面板外关闭
    if (dx < px || dx > px + this.PW || dy < py || dy > py + this.PH) {
      this.close();
      return false;
    }

    // 关闭按钮
    if (this.hitRect(this.closeBtn, dx, dy)) {
      this.close();
      return true;
    }

    // 页签
    for (const [tabName, r] of Object.entries(this.tabRects)) {
      if (this.hitRect(r, dx, dy)) {
        this.currentTab = tabName as ShopSystem["currentTab"];
        this.scrollOffset = 0;
        this.membershipScrollOffset = 0;
        this.redeemInputActive = false;
        this.filterSearchActive = false;
        return true;
      }
    }

    if (this.currentTab === "buy") {
      // 搜索框
      if (dx >= px + 20 && dx <= px + 370 && dy >= py + 116 && dy <= py + 146) {
        this.filterSearchActive = true;
        return true;
      }
      // 商品卡:◀▶ 切换稀有度,购买按钮直接购买
      for (const c of this._shopCardRects) {
        if (this.hitRect(c.prevRect, dx, dy)) {
          const from = c.rarity;
          this.cardRarities.set(c.entry.item, (from + 9) % 10);
          this.cardSwitchAnim.set(c.entry.item, { t: 0, dir: -1, from });
          return true;
        }
        if (this.hitRect(c.nextRect, dx, dy)) {
          const from = c.rarity;
          this.cardRarities.set(c.entry.item, (from + 1) % 10);
          this.cardSwitchAnim.set(c.entry.item, { t: 0, dir: 1, from });
          return true;
        }
        if (this.hitRect(c.buyRect, dx, dy)) {
          this.buyItem(c.entry, c.rarity);
          return true;
        }
      }
      return true;
    }

    if (this.currentTab === "membership") {
      for (const m of this._membershipRects) {
        if (this.hitRect(m.rect, dx, dy)) {
          this.purchaseMembership(m.tier);
          return true;
        }
      }
      return true;
    }

    if (this.currentTab === "redeem") {
      const boxW = Math.min(420, this.PW - 120);
      const boxX = px + this.PW / 2 - boxW / 2;
      const boxY = py + 112 + 130;
      const boxH = 44;
      if (dx >= boxX && dx <= boxX + boxW && dy >= boxY && dy <= boxY + boxH) {
        this.redeemInputActive = true;
        return true;
      }
      const btnW = 140;
      const btnH = 40;
      const btnX = px + this.PW / 2 - btnW / 2;
      const btnY = boxY + boxH + 30;
      if (dx >= btnX && dx <= btnX + btnW && dy >= btnY && dy <= btnY + btnH) {
        const code = this.redeemText;
        this.redeemText = "";
        this.redeemInputActive = false;
        this.redeem(code);
        return true;
      }
      return true;
    }

    return true;
  }

  handleWheel(deltaY: number, W: number, H: number) {
    if (!this.visible) return;
    this.layout(W, H);
    const step = deltaY > 0 ? 36 : -36;
    if (this.currentTab === "buy") {
      const rows = Math.ceil(this.getFilteredItems().length / 3);
      const maxOff = Math.max(0, rows * 202 - 2 * 202);
      this.scrollOffset = Math.max(0, Math.min(maxOff, this.scrollOffset + step));
    } else if (this.currentTab === "membership") {
      const rows = Math.ceil(this.MEMBERSHIP_TIERS.length / 2);
      const maxOff = Math.max(0, rows * 364 - (this.PH - 132));
      this.membershipScrollOffset = Math.max(0, Math.min(maxOff, this.membershipScrollOffset + step));
    }
  }

  /** 触摸滚动:面板内按下(避开 ✕/页签/搜索框/兑换输入框)开始滚动。
   *  移动端由 GameClient.onPointerDown → menuClick 转发。 */
  beginTouch(x: number, y: number, W: number, H: number): boolean {
    if (!this.visible) return false;
    const r = this.screenRectVal;
    if (!r || x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) return false;
    const s = this.panelScale || 1;
    const dx = W / 2 + (x - W / 2) / s;
    const dy = H / 2 + (y - H / 2) / s;
    const px = W / 2 - this.PW / 2;
    const py = H / 2 - this.PH / 2;

    // 避开交互元素:关闭按钮、页签
    if (this.hitRect(this.closeBtn, dx, dy)) return false;
    for (const r2 of Object.values(this.tabRects)) {
      if (this.hitRect(r2, dx, dy)) return false;
    }
    // buy 页签:搜索框 + 卡片按钮(◀/▶ 切换稀有度、购买按钮)
    if (this.currentTab === "buy") {
      if (dx >= px + 20 && dx <= px + 370 && dy >= py + 116 && dy <= py + 146) return false;
      for (const c of this._shopCardRects) {
        if (this.hitRect(c.prevRect, dx, dy)) return false;
        if (this.hitRect(c.nextRect, dx, dy)) return false;
        if (this.hitRect(c.buyRect, dx, dy)) return false;
      }
    } else if (this.currentTab === "membership") {
      // 会员卡整体可点击购买
      for (const m of this._membershipRects) {
        if (this.hitRect(m.rect, dx, dy)) return false;
      }
    }
    // redeem 页签:兑换输入框(该页签无滚动,直接放行给点击)
    if (this.currentTab === "redeem") {
      const boxW = Math.min(420, this.PW - 120);
      const boxX = px + this.PW / 2 - boxW / 2;
      const boxY = py + 112 + 130;
      const boxH = 44;
      if (dx >= boxX && dx <= boxX + boxW && dy >= boxY && dy <= boxY + boxH) return false;
    }

    this.touchScrolling = true;
    this.touchStartY = y;
    this.touchStartOffset = this.currentTab === "buy" ? this.scrollOffset : this.membershipScrollOffset;
    return true;
  }

  touchMove(y: number, W: number, H: number) {
    if (!this.touchScrolling) return;
    const s = this.panelScale || 1;
    const deltaY = (y - this.touchStartY) / s;
    const target = Math.max(0, this.touchStartOffset - deltaY);
    if (this.currentTab === "buy") {
      const rows = Math.ceil(this.getFilteredItems().length / 3);
      const maxOff = Math.max(0, rows * 202 - 2 * 202);
      this.scrollOffset = Math.max(0, Math.min(maxOff, target));
    } else if (this.currentTab === "membership") {
      const rows = Math.ceil(this.MEMBERSHIP_TIERS.length / 2);
      const maxOff = Math.max(0, rows * 364 - (this.PH - 132));
      this.membershipScrollOffset = Math.max(0, Math.min(maxOff, target));
    }
  }

  endTouch() {
    this.touchScrolling = false;
  }

  update(dt: number) {
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.message = "";
    }
    // 稀有度切换滑动动画推进(t 0→1 后移除)
    for (const [item, a] of this.cardSwitchAnim) {
      a.t += dt * 5;
      if (a.t >= 1) this.cardSwitchAnim.delete(item);
    }
  }

  open() {
    this.visible = true;
    this.scrollOffset = 0;
    this.membershipScrollOffset = 0;
    this.redeemInputActive = false;
    this.filterSearchActive = false;
  }

  close() {
    this.visible = false;
    this.redeemInputActive = false;
    this.filterSearchActive = false;
  }

  toggle() {
    if (this.visible) this.close();
    else this.open();
  }

  /** 面板划入动画进度推进(目标 = visible)。 */
  updateOpenAnim(dt: number) {
    this.openAnim += ((this.visible ? 1 : 0) - this.openAnim) * Math.min(1, dt * 10);
  }

  // ===================== 绘制 =====================
  private drawStrokedText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    fontSize = 14,
    textAlign: CanvasTextAlign = "center",
    fillColor = "white",
    strokeWidth = 3,
  ) {
    ctx.save();
    ctx.font = ` ${fontSize}px ${FONT_FAMILY}`;
    ctx.textAlign = textAlign;
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "black";
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = "round";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fillColor;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  private drawStyledButton(
    ctx: CanvasRenderingContext2D,
    text: string,
    rect: [number, number, number, number],
    baseColor: RGB,
    fontSize = 16,
  ) {
    const [x, y, w, h] = rect;
    const adj = (rgb: RGB, f: number) => rgb.map(c => Math.min(255, Math.max(0, Math.floor(c * f))));
    const darkColor = `rgb(${adj(baseColor, 0.85).join(",")})`;
    const lightColor = `rgb(${baseColor.join(",")})`;
    const strokeColor = `rgb(${adj(baseColor, 0.5).join(",")})`;

    ctx.beginPath();
    roundRect(ctx, x, y, w, h, 8);
    ctx.fillStyle = lightColor;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, 8);
    ctx.clip();
    ctx.fillStyle = darkColor;
    ctx.fillRect(x, y, w, h / 2);
    ctx.restore();

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, 8);
    ctx.stroke();

    if (text) {
      ctx.font = ` ${fontSize}px ${FONT_FAMILY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.strokeStyle = "black";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeText(text, x + w / 2, y + h / 2);
      ctx.fillStyle = "white";
      ctx.fillText(text, x + w / 2, y + h / 2);
    }
  }

  /** 带金铜色星星图标的按钮(价格按钮统一用这个,替代 "⭐价格" 文本)。 */
  private drawPriceButton(
    ctx: CanvasRenderingContext2D,
    text: string,
    rect: [number, number, number, number],
    baseColor: RGB,
    fontSize = 13,
    starSize = 9,
  ) {
    this.drawStyledButton(ctx, "", rect, baseColor, fontSize);
    const [x, y, w, h] = rect;
    ctx.font = ` ${fontSize}px ${FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(text).width;
    const gap = starSize * 2 + 4;
    const starCX = x + w / 2 - (tw + gap) / 2 + starSize;
    drawStarIcon(ctx, starCX, y + h / 2, starSize);
    const tx = starCX + starSize + 2;
    ctx.strokeStyle = "black";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.strokeText(text, tx, y + h / 2);
    ctx.fillStyle = "white";
    ctx.fillText(text, tx, y + h / 2);
  }

private drawStarShape(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  spikes: number,
  outerRadius: number,
  innerRadius: number,
  color: string,
) {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;

  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(
      cx + Math.cos(rot) * outerRadius,
      cy + Math.sin(rot) * outerRadius,
    );
    rot += step;
    ctx.lineTo(
      cx + Math.cos(rot) * innerRadius,
      cy + Math.sin(rot) * innerRadius,
    );
    rot += step;
  }
  ctx.closePath();

  // fill 用原色
  ctx.fillStyle = color;
  ctx.fill();

  // stroke 用加深后的颜色
  ctx.strokeStyle = this.darkenColor(color, 25); // 加深 25%，可调
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = innerRadius / 4;
  ctx.stroke();
}

/**
 * 将任意 CSS 颜色字符串加深指定百分比
 * 支持 hex / rgb / hsl / 命名色
 */
private darkenColor(color: string, percent: number): string {
  // 借助浏览器原生解析：写入临时 canvas 取 rgba
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = 1;
  const tCtx = tmp.getContext('2d')!;
  tCtx.fillStyle = color;
  tCtx.fillRect(0, 0, 1, 1);
  const [r, g, b] = tCtx.getImageData(0, 0, 1, 1).data;

  const factor = 1 - percent / 100;
  return `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(b * factor)})`;
}

  draw(ctx: CanvasRenderingContext2D, W: number, H: number) {
    if (!this.visible) return;
    this.checkDiscountUpdate();
    const { scale, px, py } = this.layout(W, H);
    // 鼠标坐标转设计坐标(供商品卡 hover 判断;setMouse 传入的是屏幕坐标)。
    this.mouseX = W / 2 + (this.mouseX - W / 2) / scale;
    this.mouseY = H / 2 + (this.mouseY - H / 2) / scale;

    ctx.save();
    // 划入动画:淡入 + 从屏幕底部滑入(ease.outCubic,与背包面板一致)
    ctx.globalAlpha = Math.min(1, this.openAnim * 1.6);
    if (scale < 1) {
      ctx.translate(W / 2, H / 2);
      ctx.scale(scale, scale);
      ctx.translate(-W / 2, -H / 2);
    }
    ctx.translate(0, (1 - ease.outCubic(this.openAnim)) * (H + 20));

    // 主背景(参考 ShopSystem.draw 的青色主题)
    ctx.fillStyle = "#22C1E9";
    ctx.beginPath();
    roundRect(ctx, px, py, this.PW, this.PH, 5);
    ctx.fill();
    ctx.strokeStyle = "#0B7894";
    ctx.lineWidth = 5;
    ctx.beginPath();
    roundRect(ctx, px, py, this.PW, this.PH, 5);
    ctx.stroke();

    // 标题 + 星星(金铜色五角星图标 + 数量文本)
    this.drawStrokedText(ctx, "Shop", px + this.PW / 2, py + 32, 28, "center", "#ffffff");
    drawStarIcon(ctx, px + this.PW - 74, py + 32, 13);
    this.drawStrokedText(ctx, this.formatPrice(this.game.stars), px + this.PW - 16, py + 32, 24, "right", "#ffd700");

    // 关闭按钮(与成就面板同款:红色渐变圆角按钮)
    this.drawStyledButton(
      ctx,
      "✕",
      [this.closeBtn.x, this.closeBtn.y, this.closeBtn.w, this.closeBtn.h],
      [220, 80, 80],
      18,
    );

    // 页签
    const tabs: [string, ShopSystem["currentTab"]][] = [
      ["Buy", "buy"],
      ["Memberships", "membership"],
      ["Redeem", "redeem"],
    ];
    for (const [label, tabName] of tabs) {
      const r = this.tabRects[tabName];
      const active = this.currentTab === tabName;
      const base: RGB =
        tabName === "redeem"
          ? active ? [155, 89, 182] : [108, 52, 131]
          : active ? [255, 215, 0] : [30, 48, 80];
      this.drawStyledButton(ctx, label, [r.x, r.y, r.w, r.h], base, 14);
    }

    if (this.currentTab === "buy") this.drawBuyTab(ctx, px, py);
    else if (this.currentTab === "membership") this.drawMembershipTab(ctx, px, py);
    else this.drawRedeemTab(ctx, px, py);

    // 消息
    if (this.messageTimer > 0) {
      const color = this.message.includes("✅") ? "#2ecc71" : this.message.includes("❌") ? "#e74c3c" : "#ffd700";
      this.drawStrokedText(ctx, this.message, px + this.PW / 2, py + this.PH - 18, 15, "center", color);
    }

    ctx.restore();
  }

  private drawBuyTab(ctx: CanvasRenderingContext2D, px: number, py: number) {
    const sx = px;
    const sw = this.PW;

    // 搜索框(稀有度筛选下拉已移除;卡片上 ◀▶ 切换稀有度)
    const srchX = sx + 20;
    const srchY = py + 116;
    const srchW = 350;
    const srchH = 30;
    ctx.fillStyle = this.filterSearchActive ? "#d2d2d2" : "#ffffff";
    ctx.beginPath();
    roundRect(ctx, srchX, srchY, srchW, srchH, 5);
    ctx.fill();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.beginPath();
    roundRect(ctx, srchX, srchY, srchW, srchH, 5);
    ctx.stroke();
    ctx.font = `15px ${FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = this.filterSearch ? "#000" : "#556677";
    ctx.fillText(this.filterSearch || "Search...", srchX + 8, srchY + srchH / 2);

    const filtered = this.getFilteredItems();
    this.drawStrokedText(ctx, `${filtered.length} items`, sx + sw - 20, py + 132, 14, "right", "#ffffff");

    // 物品卡片网格(用 drawCard 绘制物品卡;卡上 ◀▶ 切换稀有度,购买按钮直接购买)
    const COLS = 3;
    const SLOT_W = 190;
    const SLOT_H = 190;
    const GAP = 12;
    const gridW = COLS * SLOT_W + (COLS - 1) * GAP;
    const gStartX = sx + (sw - gridW) / 2;
    const gStartY = py + 158;
    const viewRows = 2;
    const contentH = viewRows * (SLOT_H + GAP);
    const totalRows = Math.ceil(filtered.length / COLS);
    const totalHeight = totalRows * (SLOT_H + GAP);
    const maxOff = Math.max(0, totalHeight - contentH);
    this.scrollOffset = Math.max(0, Math.min(maxOff, this.scrollOffset));

    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, gStartY, sw, contentH);
    ctx.clip();
    ctx.translate(0, -this.scrollOffset);
    this._shopCardRects = [];
    let hoverTooltip: { item: number; rarity: number } | null = null;
    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i];
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const gx = gStartX + col * (SLOT_W + GAP);
      const gy = gStartY + row * (SLOT_H + GAP);
      const def = ITEMS[entry.item];
      const rarity = Math.min(9, Math.max(0, this.cardRarities.get(entry.item) ?? 0));
      this.cardRarities.set(entry.item, rarity);
      const isDisc = (rarity === 8 || rarity === 9) && def
        ? this.discountItems.some(d => d.type === def.name)
        : false;
      const price = this.getDiscountedPrice(entry.item, rarity);
      const cardScreenRect: Rect = { x: gx, y: gy - this.scrollOffset, w: SLOT_W, h: SLOT_H };
      const hovered = this.hitRect(cardScreenRect, this.mouseX, this.mouseY);
      if (hovered) hoverTooltip = { item: entry.item, rarity };

      // 卡片背景
      ctx.fillStyle = "#78B8C9";
      ctx.beginPath();
      roundRect(ctx, gx, gy, SLOT_W, SLOT_H, 5);
      ctx.fill();
      ctx.strokeStyle = isDisc ? "#ffd700" : "#1a3050";
      ctx.lineWidth = isDisc ? 4 : 2;
      ctx.beginPath();
      roundRect(ctx, gx, gy, SLOT_W, SLOT_H, 5);
      ctx.stroke();

      // 卡片内容(图标+名称+稀有度行)在卡片矩形内 clip;切换稀有度时旧/新两帧水平滑动
      const switchAnim = this.cardSwitchAnim.get(entry.item);
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, gx + 1, gy + 1, SLOT_W - 2, 146, 7);
      ctx.clip();
      if (switchAnim) {
        const e = ease.outCubic(switchAnim.t);
        // 旧稀有度帧:从原位滑出(dir>0 向左,dir<0 向右)
        this.drawCardContent(ctx, gx - Math.round(e * switchAnim.dir * SLOT_W), gy, SLOT_W, entry, switchAnim.from, hovered);
        // 新稀有度帧:从对面滑入
        this.drawCardContent(ctx, gx + Math.round((1 - e) * switchAnim.dir * SLOT_W), gy, SLOT_W, entry, rarity, hovered);
      } else {
        this.drawCardContent(ctx, gx, gy, SLOT_W, entry, rarity, hovered);
      }
      ctx.restore();

      // 折扣角标
      if (isDisc && def) {
        const d = this.discountItems.find(dd => dd.type === def.name);
        if (d) {
          ctx.fillStyle = "#e74c3c";
          ctx.beginPath();
          roundRect(ctx, gx + SLOT_W - 30, gy + 3, 26, 14, 4);
          ctx.fill();
          ctx.font = "9px sans-serif";
          ctx.fillStyle = "#fff";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(`-${d.discountPercent}%`, gx + SLOT_W - 17, gy + 10);
        }
      }

      // 购买按钮(点击直接购买该稀有度的物品,钱够即买)
      const buyRect: Rect = { x: gx + 10, y: gy + 158, w: SLOT_W - 20, h: 26 };
      this.drawPriceButton(ctx, this.formatPrice(price), [buyRect.x, buyRect.y, buyRect.w, buyRect.h], [253, 63, 63], 12, 8);

      this._shopCardRects.push({
        entry,
        rarity,
        rect: cardScreenRect,
        buyRect: { x: buyRect.x, y: buyRect.y - this.scrollOffset, w: buyRect.w, h: buyRect.h },
        prevRect: { x: gx + 14, y: gy + 130 - this.scrollOffset, w: 24, h: 22 },
        nextRect: { x: gx + SLOT_W - 38, y: gy + 130 - this.scrollOffset, w: 24, h: 22 },
      });
    }
    ctx.restore();

    // Hover tooltip (rarity-scaled stats) for the card under the cursor.
    if (hoverTooltip) {
      TooltipSystem.drawItemTooltip(
        ctx,
        { item: hoverTooltip.item, rarity: hoverTooltip.rarity, count: 1 },
        this.mouseX + 14,
        this.mouseY - 10,
        this.PW,
        this.PH,
        null, // talent bonuses are rendered by the main UI tooltip; keep this lightweight
      );
    }

    // 滚动条
    if (maxOff > 0) {
      const barX = sx + sw - 12;
      const barY = gStartY;
      const barH = contentH;
      const thumbH = Math.max(24, barH * (contentH / totalHeight));
      const thumbY = barY + (this.scrollOffset / maxOff) * (barH - thumbH);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      roundRect(ctx, barX, barY, 6, barH, 3);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      roundRect(ctx, barX, thumbY, 6, thumbH, 3);
      ctx.fill();
    }

  }

  /** 商品卡内容(图标+名称+稀有度切换行);供稀有度切换滑动动画双帧绘制。
   *  注意:调用方需已 clip 在卡片矩形内,避免滑动帧越界。 */
  private drawCardContent(
    ctx: CanvasRenderingContext2D,
    gx: number,
    gy: number,
    cardW: number,
    entry: ShopListEntry,
    rarity: number,
    hovered: boolean,
  ) {
    const def = ITEMS[entry.item];
    if (def) {
      drawCard(
        ctx,
        { x: gx + (cardW - 96) / 2, y: gy + 8, w: 96, h: 96 },
        { item: entry.item, rarity, count: 1 },
        { hovered },
      );
    }
    this.drawStrokedText(ctx, def?.name ?? "?", gx + cardW / 2, gy + 116, 12, "center", "#ffffff", 2);
    const rowY = gy + 130;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    roundRect(ctx, gx + 14, rowY, 24, 22, 5);
    ctx.fill();
    ctx.beginPath();
    roundRect(ctx, gx + cardW - 38, rowY, 24, 22, 5);
    ctx.fill();
    this.drawStrokedText(ctx, "◀", gx + 26, rowY + 11, 13, "center", "#ffffff");
    this.drawStrokedText(ctx, "▶", gx + cardW - 26, rowY + 11, 13, "center", "#ffffff");
    const rname = RARITIES[rarity]?.name ?? "?";
    ctx.font = `12px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "black";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.strokeText(rname, gx + cardW / 2, rowY + 11);
    ctx.fillStyle = RARITIES[rarity]?.color ?? "#ffffff";
    ctx.fillText(rname, gx + cardW / 2, rowY + 11);
  }

  private renderMemberCard(ctx: CanvasRenderingContext2D, tier: MembershipTier, cx: number, cy: number, cardW: number, cardH: number) {
    const themeColor = rgbArr(tier.color);
    const active = this.getMembershipTier()?.id === tier.id;

    ctx.fillStyle = "#7EE39B";
    ctx.beginPath();
    roundRect(ctx, cx, cy, cardW, cardH, 15);
    ctx.fill();
    if (active) {
      ctx.strokeStyle = "#ffd700";
      ctx.lineWidth = 4;
      ctx.beginPath();
      roundRect(ctx, cx, cy, cardW, cardH, 15);
      ctx.stroke();
    }

    // 星星装饰
    const starCenterY = cy + 58;
    this.drawStarShape(ctx, cx + cardW / 2 - 45, starCenterY + 20, 5, 32, 16, themeColor);
    this.drawStarShape(ctx, cx + cardW / 2 + 45, starCenterY + 20, 5, 32, 16, themeColor);
    this.drawStarShape(ctx, cx + cardW / 2, starCenterY, 5, 50, 25, themeColor);
    this.drawStrokedText(ctx, tier.label, cx + cardW / 2, starCenterY + 14, 26, "center", "#ffffff");

    // 价格(无粉色标签背景;星星用会员主题色绘制)
    const priceY = cy + 128;
    const priceText = `${this.formatPrice(tier.price)}/mo`;
    ctx.font = `17px ${FONT_FAMILY}`;
    const priceTw = ctx.measureText(priceText).width;
    this.drawStarShape(ctx, cx + cardW / 2 - priceTw / 2 - 12, priceY + 22, 5, 9, 4.5, themeColor);
    this.drawStrokedText(ctx, priceText, cx + cardW / 2 + 2, priceY + 22, 17, "center", "#ffffff");

    // 描述
    const descY = priceY + 48;
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.beginPath();
    roundRect(ctx, cx + 10, descY, cardW - 20, 104, 10);
    ctx.fill();
    tier.desc.forEach((line, i) => {
      this.drawStrokedText(ctx, line, cx + cardW / 2, descY + 22 + i * 22, 13, "center", "#ffffff");
    });

    // 购买按钮
    const btnW = 140;
    const btnH = 34;
    const btnX = cx + cardW / 2 - btnW / 2;
    const btnY = cy + cardH - 48;
    if (active) {
      ctx.fillStyle = "rgba(255,215,0,0.35)";
      ctx.beginPath();
      roundRect(ctx, btnX, btnY, btnW, btnH, 8);
      ctx.fill();
      ctx.strokeStyle = "#ffd700";
      ctx.lineWidth = 2;
      ctx.beginPath();
      roundRect(ctx, btnX, btnY, btnW, btnH, 8);
      ctx.stroke();
      this.drawStrokedText(ctx, "ACTIVE", btnX + btnW / 2, btnY + btnH / 2, 13, "center", "#ffd700");
    } else {
      this.drawStyledButton(ctx, `⭐${this.formatPrice(tier.price)}`, [btnX, btnY, btnW, btnH], [253, 63, 63], 13);
    }
  }

  private drawMembershipTab(ctx: CanvasRenderingContext2D, px: number, py: number) {
    const contentY = py + 112;
    const contentH = this.PH - 132;
    const COLS = 2;
    const CARD_W = 320;
    const CARD_H = 340;
    const GAP = 24;
    const gridX = px + (this.PW - (COLS * CARD_W + (COLS - 1) * GAP)) / 2;
    const gridStartY = contentY + 6;
    const rows = Math.ceil(this.MEMBERSHIP_TIERS.length / COLS);
    const totalHeight = rows * (CARD_H + GAP);
    const maxOff = Math.max(0, totalHeight - contentH);
    this.membershipScrollOffset = Math.max(0, Math.min(maxOff, this.membershipScrollOffset));

    ctx.save();
    ctx.beginPath();
    ctx.rect(px + 8, contentY, this.PW - 16, contentH);
    ctx.clip();
    ctx.translate(0, -this.membershipScrollOffset);
    this._membershipRects = [];
    for (let i = 0; i < this.MEMBERSHIP_TIERS.length; i++) {
      const tier = this.MEMBERSHIP_TIERS[i];
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cx = gridX + col * (CARD_W + GAP);
      const cy = gridStartY + row * (CARD_H + GAP);
      this.renderMemberCard(ctx, tier, cx, cy, CARD_W, CARD_H);
      this._membershipRects.push({ tier, rect: { x: cx, y: cy - this.membershipScrollOffset, w: CARD_W, h: CARD_H } });
    }
    ctx.restore();

    const cur = this.getMembershipTier();
    this.drawStrokedText(
      ctx,
      cur ? `Active: ${cur.label} membership` : "Scroll to see more · Upgrading replaces current tier",
      px + this.PW / 2,
      py + this.PH - 14,
      12,
      "center",
      "#ffffff",
    );

    if (maxOff > 0) {
      const barX = px + this.PW - 12;
      const barY = contentY;
      const barH = contentH;
      const thumbH = Math.max(24, barH * (contentH / totalHeight));
      const thumbY = barY + (this.membershipScrollOffset / maxOff) * (barH - thumbH);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      roundRect(ctx, barX, barY, 6, barH, 3);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      roundRect(ctx, barX, thumbY, 6, thumbH, 3);
      ctx.fill();
    }
  }

  private drawRedeemTab(ctx: CanvasRenderingContext2D, px: number, py: number) {
    const contentY = py + 112;
    const contentH = this.PH - 132;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.beginPath();
    roundRect(ctx, px + 10, contentY, this.PW - 20, contentH, 12);
    ctx.fill();
    ctx.restore();

    this.drawStrokedText(ctx, "Redeem a Code", px + this.PW / 2, contentY + 50, 26, "center", "#ffffff");
    this.drawStrokedText(ctx, "Enter your code below to claim rewards", px + this.PW / 2, contentY + 84, 15, "center", "#dfe6ee");

    const boxW = Math.min(420, this.PW - 120);
    const boxX = px + this.PW / 2 - boxW / 2;
    const boxY = contentY + 130;
    const boxH = 44;
    ctx.fillStyle = this.redeemInputActive ? "#ffffff" : "#e8f0f4";
    ctx.beginPath();
    roundRect(ctx, boxX, boxY, boxW, boxH, 8);
    ctx.fill();
    ctx.strokeStyle = this.redeemInputActive ? "#0B7894" : "#9ab3bf";
    ctx.lineWidth = this.redeemInputActive ? 3 : 2;
    ctx.beginPath();
    roundRect(ctx, boxX, boxY, boxW, boxH, 8);
    ctx.stroke();

    ctx.font = `20px ${FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    if (this.redeemText.length === 0 && !this.redeemInputActive) {
      ctx.fillStyle = "#7f8c8d";
      ctx.fillText("enter the code", boxX + 14, boxY + boxH / 2);
    } else {
      ctx.fillStyle = "#000000";
      const shown = this.redeemText + (this.redeemInputActive && Date.now() % 1000 < 500 ? "|" : "");
      ctx.fillText(shown, boxX + 14, boxY + boxH / 2);
    }

    const btnW = 140;
    const btnH = 40;
    const btnX = px + this.PW / 2 - btnW / 2;
    const btnY = boxY + boxH + 30;
    this.drawStyledButton(ctx, "Confirm", [btnX, btnY, btnW, btnH], [100, 146, 158], 16);
  }
}

/** localStorage key that permanently dismisses the canvas "Phone tip". */
const PHONE_TIP_IGNORED_KEY = "petalia.phoneTipIgnored";

/** True once the player chose "Ignore" on the canvas Phone tip. */
function isCanvasPhoneTipIgnored(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(PHONE_TIP_IGNORED_KEY) === "1";
  } catch {
    return false;
  }
}

export class GameClient {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private last = performance.now();
  private time = 0;
  private w = 800;
  private h = 600;
  /** Public read-only view size (used by overlay systems such as AchievementSystem). */
  get viewWidth(): number { return this.w; }
  get viewHeight(): number { return this.h; }
private wallPolygonsCache: Map<string, { x: number; y: number }[][]> = new Map();
 private _wallDataCache: Map<string, string> = new Map(); // 低质量墙壁缓存
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
  private bonus = new BonusSystem();
  /** 天赋树系统（主菜单 top_talent 按钮打开，等级=天赋点来源）。 */
  private talent: TalentSystem;
  /** 天赋系统最近一次计算的加成（写回宿主，供 HUD/渲染读取）。 */
  private talentBonuses: TalentBonuses | null = null;
  /** Main-menu bestiary; kill counts are tracked locally by mob + rarity. */
  private mobGallery = new MobGallery();
  /** MobGallery 划入动画进度(其在独立文件,由 GameClient 层包装驱动)。 */
  private mobGalleryAnim = 0;
  private changelog = new ChangelogPanel();
  private achievements: AchievementSystem;
  /** 每日猎杀挑战系统(主菜单 Hunting Quest 图标打开面板)。 */
  private challenges: ChallengeSystem;
  private chat = new ChatSystem();
  private vk = new VirtualKeyboard();
  /** Canvas-painted account panel (local-storage based). */
  private accountSystem = new AccountSystem();
  private squadCode = "";
  private arenaPanel = new ArenaPanel();
  private arenaWalls: Wall[] | null = null;
  private arenaSeed = 0;

  private roseParticles: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    color: string;
    size: number;
    life: number;
    maxLife: number;
  }> = [];

  private serverRegion: "eu" | "as" | "hk" = "as";
  private static readonly SERVER_URLS: Record<string, string> = {
    eu: "wss://molorr-server-t34o.onrender.com",
    as: "wss://molorr-server-sg.onrender.com",
    hk: "wss://molorr-server-hk.onrender.com",
  };
  private serverBtnRects: Record<string, { x: number; y: number; w: number; h: number }> = {};

  // net
  private net: Transport | null = null;
  private connected = false;
  private selfId = 0;
  private inputTimer = 0;

  // ---- Debug overlay (Settings → Debug Info) ----
  /** Smoothed frames-per-second, recomputed once a second from real (unclamped) frame deltas. */
  private debugFps = 0;
  private debugFpsAccum = 0;
  private debugFpsFrames = 0;
  /** Round-trip time to the server in milliseconds, measured via C2S.PING / S2C.PONG. */
  private debugPingMs = 0;
  private debugPingTimer = 0;
  private debugPingStamp = 0;
  /** Bytes sent/received since the last throughput sample, and the latest per-second rate. */
  private debugBytesInWindow = 0;
  private debugBytesOutWindow = 0;
  private debugThroughputInWindow = 0;
  private debugThroughputOutWindow = 0;
  private debugThroughputTimer = 0;
  /** Wall/circle collision checks the server performed on its most recent tick. */
  private debugCollisionChecks = 0;
  /** Total simulated entities (players + mobs + petals + drops), server-wide. */
  private debugEntityCount = 0;
  /** Total connected players across every map. */
  private debugPlayerCount = 0;
  /**
   * Owning player's current move speed in px/s, as reported by the
   * server's per-tick DEBUG packet. 0 when not connected / server build
   * is older than the per-player-tail field.
   */
  private debugPlayerSpeed = 0;

  // Packet-loss / stall handling
  /**
   * Seconds since the last SNAPSHOT arrived. While this exceeds
   * SNAPSHOT_STALL_SECONDS the client is missing packets, so it freezes the
   * last known scene instead of letting entities expire and vanish.
   */
  private sinceSnapshot = 0;
  /** True while the snapshot stream is considered stalled. */
  private snapshotStalled = false;
  /** Fades the "waiting for server" notice in after a longer stall. */
  private stallNoticeAnim = 0;

  // AFK check
  /** True while the server wants the [AFK CHECK] button clicked. */
  private afkPending = false;
  /** Seconds left before the AFK kick, mirrored from the server. */
  private afkSecondsLeft = 0;
  /** Locally decremented between server updates so the countdown looks smooth. */
  private afkSmoothSeconds = 0;
  /** Grows while the prompt is up; drives the pulse/scale-in animation. */
  private afkAnim = 0;
  /** Set when the connection closed with AFK_CLOSE_CODE, to explain the kick. */
  private afkKicked = false;

  // world
  private mapId = 0;
  private worldW = 3200;
  private worldH = 3200;
  private walls: Wall[] = [];
  private wallCollider: PolygonWallCollider | null = null;
  private ents = new Map<number, Ent>();
  private snapshotSequence = 0;
  private camX = 0;
  private camY = 0;
  /** Current world->screen zoom, refreshed once per frame in renderGame(). Used to keep
   *  fixed-size overlays (health bars, rarity tags, damage overlays) constant on screen. */
  private viewZoom = 1;

  // Settings and wall rendering caching
  private settings: SettingsSystem;
  private currentBiome = "Garden";
  wallNoisyLoops: { x: number; y: number }[][] = [];
  wallMaxJitterPx = 0;
  _wallEdgeBiome = "";
  _wallPatternBiome = "";
  wallPattern: CanvasPattern | null = null;
  _wallPatternLegacy: CanvasPattern | null = null;
  _wallPatternLegacyBiome = "";
  private _patternCache: Record<string, CanvasPattern> = {};
 private wallPatternCache: Map<string, CanvasPattern> = new Map();
  /** Off-screen canvas used to pre-render the ground + walls once per
   *  cache tick, so per-frame work drops to a single drawImage(). The cache
   *  is rebuilt whenever the camera crosses a tile boundary, the zoom
   *  changes, the biome changes, or the wall list changes. Only used when
   *  Settings.cacheCanvas is enabled. */
  private _groundWallCache: HTMLCanvasElement | null = null;
  private _groundWallCtx: CanvasRenderingContext2D | null = null;
  private _groundWallCacheKey: string = "";
  private _groundWallCacheBiome: string = "";
  private _groundWallCacheMap: number = -1;
  // player state
  private hp = 100;
  private maxHp = 100;
  private shield = 0;
  private xp = 0;
  private level = 1;
  private alive = true;
  /**
   * Player's body-contact damage on direct mob collision. Mirrors
   * sim.ts `Player.bodyDamage` (default 10). Stored on the client so the
   * talent panel can show "Body Dmg: N" and the tooltip can quote the
   * talent-modified number. The server remains authoritative — this is
   * a local mirror that gets updated on JOIN / STATS.
   */
  private bodyDamage = 10;
  private nextOracleAt = 0;
  private nextTradeAt = 0;
  private slots: (Cell | null)[] = emptyCells(SLOT_COUNT);
  /** Secondary hotbar row — backup items that can be hot-swapped into `slots`. */
  private secondary: (Cell | null)[] = emptyCells(SECONDARY_SLOT_COUNT);
  private bag: (Cell | null)[] = emptyCells(BAG_COUNT);
  /** Per-hotbar-slot reload progress (0..1, 1 = ready), streamed with each snapshot. */
  private slotReload: number[] = new Array(SLOT_COUNT).fill(1);
  /** Per-hotbar-slot remaining health (0..1, 1 = full health), streamed with each snapshot. */
  private slotHp: number[] = new Array(SLOT_COUNT).fill(1);
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
  // How many cards are loaded into each of the 5 pentagon slots for the
  // current selection (normal mode only). A plain click distributes 5 cards
  // evenly (1 per slot); shift+click distributes every owned card evenly.
  private craftSlotCounts: number[] = [0, 0, 0, 0, 0];
  private craftSpin = 0;
  private craftMsg = "";
  private craftMsgLife = 0;
  // crafting browser: search/filter plus an item-by-rarity matrix
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
  // NOTE: values follow the requested CraftAnimation class but with increased
  // animation time for more juice.
  private craftPhase: "none" | "rotating" | "waiting" | "showing" = "none";
  private craftRotTime = 0; // seconds elapsed while rotating
  private craftRotDuration = 2.5; // seconds — matches CraftAnimation.startAnimation(duration=2.5)
  private craftAngle = 0; // degrees, accumulates during rotation
  private craftRotDir = 1;
  private craftRotSpeed = 300; // deg/s, accelerates 300 -> 800
  private craftWaitStart = 0; // performance.now() ms
  private craftWaitDuration = 0.5; // seconds before revealing result (slightly longer)
  private craftShowTimer = 0; // seconds the result card is shown
  private craftShowDuration = 3.0; // unused now — result card stays until the player clicks it
  private craftPending: { item: number; rarity: number; count: number } | null = null;
  // Slot-fill animation when a card lands (grow + spin) - smooth cubic ease-out
  private craftFillActive = false;
  private craftFillElapsed = 0; // ms, 0..320
  private craftFillTotal = 320; // ms, longer than original 200 for smoother feel
  // Dedicated result card pulse (when result is visible)
  private craftResultPulse = 0;
  // Particle bursts
  private craftSuccessParticles: CraftParticle[] = [];
  private craftFailParticles: CraftParticle[] = [];
  // Craft log stats (mirrors drawCraftLog)
  private craftLogPetals = 0;
  private craftLogCrafted = 0;
  private craftLogBurned = 0;
  private craftLogAttempts = 0;
  private craftLogLast = "No Result";

  // Mobile touch scrolling for bag/craft panels
  private bagTouchScrolling = false;
  private bagTouchStartY = 0;
  private bagTouchStartOffset = 0;
  private craftTouchScrolling = false;
  private craftTouchStartY = 0;
  private craftTouchStartOffset = 0;

  private drag: { from: number; cell: Cell } | null = null;
  private dragX = 0;
  private dragY = 0;
  private mx = 0;
  private my = 0;
  private mouseDown = false;
  private rightDown = false;
  /** Pointer id that owns `mouseDown`.  On multi-touch screens several fingers
   *  can be down at once; we must only clear `mouseDown` when the SAME finger
   *  that originally pressed the game-world lifts — otherwise lifting the
   *  joystick finger would cancel a still-held game-world press. */
  private mouseDownPointerId: number | null = null;
  private keys = new Set<string>();
  private saveTimer = 0;
  private saveDirty = false;
  /** Periodic squad level/rarity sync timer (seconds). */
  private syncLevelTimer = 0;

  // --- Mobile detection & touch controls ---
  private isMobile = false;
  private mobileJoystick = {
    active: false,
    centerX: 0,
    centerY: 0,
    currX: 0,
    currY: 0,
    radius: 60,
    pointerId: null as number | null,
  };
  private mobileSpreadActive = false;
  private mobileContractActive = false;
  /** Pointer id of the finger currently holding the SPREAD button (if any). */
  private mobileSpreadPointerId: number | null = null;
  /** Pointer id of the finger currently holding the CONTRACT button (if any). */
  private mobileContractPointerId: number | null = null;
  private mobileSpreadRect: Rect | null = null;
  private mobileContractRect: Rect | null = null;
  private mobileJoystickRect: Rect | null = null;
  private mobileFullscreenBtn: Rect | null = null;
  private mobileTipIgnoreBtn: Rect | null = null;
  /** Whether the canvas "Phone tip" was permanently dismissed via Ignore. */
  private phoneTipIgnored = isCanvasPhoneTipIgnored();
  private mobileControlsVisible = false;
  private lastTouchTime = 0;

  // Dual-row quick-slot bar (main + secondary)
  quickSlot: QuickSlot;
  /** 商店系统(主菜单 Shop 图标打开;星星/会员/皮肤/兑换均本地持久化)。 */
  shopSystem: ShopSystem;
  /** 商店星星(⭐)货币,存入本地存档 SaveData.stars。 */
  stars = 10;
  /** 视野内最近的 Ultra+ 生物（rarity >= 6），用于顶部 HUD 血条显示。 */
  private nearestUltraPlus: Ent | null = null;
  /** Drops collected during the current run, displayed on the death panel. */
  private currentRunDrops: any[] = [];
  /** Scroll offset for the death drop panel. */
  private deathScrollOffset = 0;
  /** Touch-based scroll state for death drop panel. */
  private deathTouchScrolling = false;
  private deathTouchStartY = 0;
  private deathTouchStartOffset = 0;
  private deathPanelRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private deathContentRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private deathRespawnRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private deathMenuRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private deathCenterRespawnRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private deathCenterMenuRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private deathMaxScroll = 0;

  // ================================================================
  // Loadout system
  // ================================================================
  private loadouts: LoadoutConfig[] = [];
  private loadoutPanelOpen = false;
  private loadoutInput = "";
  private loadoutScroll = 0;
  private loadoutBtnRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private loadoutCloseRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private loadoutSaveBtnRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private loadoutInputRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private loadoutItemRects: { y: number; row: Rect; load: Rect; del: Rect }[] = [];
  private loadoutScrollUpRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private loadoutScrollDownRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly LOADOUT_BTN_SIZE = 48;
  private readonly LOADOUT_PANEL_W = 500;
  private readonly LOADOUT_PANEL_H = 800;
  private readonly LOADOUT_BUTTON_COLOR: number[] = [70, 74, 96];
  private readonly LOADOUT_BUTTON_HOVER_COLOR: number[] = [155, 89, 182];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("canvas2d unavailable");
    this.ctx = ctx;
    this.quickSlot = new QuickSlot(this.quickSlotHost());
    this.settings = new SettingsSystem(() => {
      // onChange callback
    }, 'gameCanvas');
    if (typeof window !== "undefined") {
      (window as any).gameInstance = this;
    }
    this.talent = new TalentSystem(this.talentHost());
    this.shopSystem = new ShopSystem(this);
    this.achievements = new AchievementSystem(this);
    this.challenges = new ChallengeSystem(this);
    this.loadLocal();
    this.loadLoadoutsLocal();
    // Initialize cloud storage for PostgreSQL sync
    CloudStorage.init({
      getToken: () => this.account?.token ?? null,
    });
  }

  /**
   * TalentSystem 宿主适配器：客户端为服务器权威，天赋加成只计算并写回
   * `talentBonuses` 供渲染读取（面板 UI 与点数系统完全本地运行）。
   */
  private talentHost(): TalentHost {
    return {
      getLevel: () => {
        if (this.arenaPanel.state === 'in-game') return 0; // arena 模式天赋不生效
        return this.level;
      },
      getHp: () => this.hp,
      getMaxHp: () => this.maxHp,
      isInGame: () => this.scene === "game",
      getBodyDamage: () => this.bodyDamage,
      getPetals: (): TalentPetalLike[] => [],
      onTalentApplied: (b: TalentBonuses) => {
        this.talentBonuses = b;
        // Push the current per-branch levels to the server so it can apply
        // the multipliers authoritatively. Cheap to send (9 × u8 + 1 u8 tag).
        this.sendTalent();
      },
    };
  }

  /**
   * Send the current talent-tree allocation to the server via C2S.TALENT.
   * Order MUST match `TALENT_KEYS` in protocol.ts (7 branches after the
   * 2026-08 removal of `reloadTime` + `fluidSpeed`):
   *   reload, petalDamage, summonDamage, summonHealth, health, speed, bodyDamage
   * The server recomputes the multiplier bundle, applies it to sim stats,
   * and echoes S2C.TALENT_BONUSES so the client can confirm.
   */
  private sendTalent() {
    if (!this.net || !this.connected) return;
    const w = new Writer(16);
    w.u8(C2S.TALENT);
    const levels = this.talent.getLevels();
    w.u8(levels.reload ?? 0);
    w.u8(levels.petalDamage ?? 0);
    w.u8(levels.summonDamage ?? 0);
    w.u8(levels.summonHealth ?? 0);
    w.u8(levels.health ?? 0);
    w.u8(levels.speed ?? 0);
    w.u8(levels.bodyDamage ?? 0);
    this.net.send(w.bytes());
  }

  /**
   * Local mirror of sim.ts `updatePlayer`'s speed formula. Used only as a
   * fallback for the debug-overlay "current speed" readout when the server
   * has not pushed a DEBUG packet yet (or the connection is older than the
   * speed-tail field). The server's value is authoritative whenever it is
   * available; this method is best-effort.
   *
   * Returns 0 when the player has no talent bonuses cached yet — the
   * default (speedMult=1) is the safe baseline and matches sim.ts.
   */
  private computeLocalPlayerSpeed(): number {
    const speedMult = this.talentBonuses?.speedMult ?? 1;
    let speedBonus = 0;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = this.slots[i];
      if (!cell) continue;
      const def = ITEMS[cell.item];
      if (!def) continue;
      // Mirror sim.ts: only petals that are currently alive contribute.
      // On the client we don't track `petal.alive` here in the same shape,
      // so we credit every active cell — close enough for a debug readout.
      if (def.speed) speedBonus += def.speed * (1 + cell.rarity * 0.12);
    }
    return (190 + this.level * 0.8) * (1 + speedBonus / 100) * speedMult;
  }

  /**
   * Adapter handed to QuickSlot. The hotbar view reads live cell data and
   * pushes every mutation back through the network, so it never keeps a
   * private copy that could drift from the server.
   */
  private quickSlotHost(): QuickSlotHost {
    return {
      viewWidth: () => this.w,
      viewHeight: () => this.h,
      mainCells: () => this.slots,
      secondaryCells: () => this.secondary,
      reloadProgress: (slot: number) => this.slotReload[slot] ?? 1,
      slotHp: (slot: number) => this.slotHp[slot] ?? 1,
      draggingFrom: () => this.drag?.from ?? -1,
      requestSwapSlot: (slot: number) => this.sendSwapRow(slot),
      requestSwapAll: () => this.sendSwapRow(SWAP_ROW_ALL),
      drawTooltip: (cell: Cell, x: number, y: number) => this.tooltip(cell, x, y),
    };
  }

  // ------------------------------------------------------------- shop API
  /** 增减星星(下限 0),返回最新值。 */
  addStars(n: number): number {
    this.stars = Math.max(0, this.stars + n);
    this.saveDirty = true;
    return this.stars;
  }

  /**
   * 商店/兑换码发放物品：直接写入本地背包。主菜单场景的背包就是本地存档,
   * 点击 PLAY 时随 JOIN 同步到服务器。背包满返回 false。
   */
  grantShopItems(item: number, rarity: number, count: number): boolean {
    if (item < 0 || item >= ITEMS.length || rarity < 0 || rarity > MAX_RARITY || count <= 0) return false;
    let left = count;
    for (const cell of this.bag) {
      if (left <= 0) break;
      if (cell && cell.item === item && cell.rarity === rarity && cell.count < 999) {
        const put = Math.min(999 - cell.count, left);
        cell.count += put;
        left -= put;
      }
    }
    while (left > 0) {
      let idx = this.bag.indexOf(null);
      if (idx < 0) {
        if (this.bag.length >= BAG_MAX) return false;
        idx = this.bag.length;
        this.bag.push(null);
      }
      const put = Math.min(999, left);
      this.bag[idx] = { item, rarity, count: put };
      left -= put;
    }
    this.saveDirty = true;
    return true;
  }

  /** Ruby 会员同步主菜单 Extra Bonus 面板状态。 */
  setRubyMembership(expiresAt: number) {
    this.rubyMembershipActive = true;
    this.extraBonusActive = true;
    this.extraBonusExpireTime = expiresAt;
  }

  /** 立即写盘(商店购买/兑换后调用;主菜单没有周期存档)。 */
  saveNow() {
    this.persist();
  }

  /** 兑换码玩家标识：登录账号或设备指纹。 */
  playerIdentity(): string {
    if (this.accountSystem.currentUser) return "account_" + this.accountSystem.currentUser;
    let id = localStorage.getItem("device_id");
    if (!id) {
      id = "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("device_id", id);
      if (CloudStorage.isReady) {
        CloudStorage.instance.set("device_id", id);
      }
    }
    return "device_" + id;
  }

  private typeIntoShopSearch(key: string) {
    this.shopSystem.typeSearch(key);
  }

  private typeIntoRedeem(key: string) {
    this.shopSystem.typeRedeem(key);
  }

  /**
   * Screen-centre rect for the [AFK CHECK] button. Sized for both mouse and
   * thumb, and kept clear of the hotbar/panels because it is modal anyway.
   */
  private afkButtonRect(): Rect {
    const w = Math.min(300, Math.max(220, this.w * 0.34));
    const h = this.isMobile ? 68 : 62;
    return { x: this.w / 2 - w / 2, y: this.h / 2 - h / 2 + 18, w, h };
  }

  /** Confirms the player is present, clearing the check server-side. */
  private sendAfkAck() {
    if (!this.net || !this.connected) return;
    const w = new Writer(2);
    w.u8(C2S.AFK_ACK);
    this.net.send(w.bytes());
    // Optimistic local clear so the button disappears on the same frame it is
    // clicked; the server echoes an AFK_CHECK(active=0) right after.
    this.afkPending = false;
    this.afkSecondsLeft = 0;
    this.afkSmoothSeconds = 0;
  }

  /** Tells the server to swap one slot (0-based) or, with SWAP_ROW_ALL, both rows. */
  private sendSwapRow(which: number) {
    if (!this.net || !this.connected) return;
    const w = new Writer(4);
    w.u8(C2S.SWAP_ROW).u8(which);
    this.net.send(w.bytes());
  }

  // ------------------------------------------------------------- lifecycle
  start() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onWindowBlur);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    // pointercancel fires when the browser aborts a touch mid-stream (e.g.
    // system gesture, too many fingers, tab switch).  Without this, a
    // cancelled spread finger would leave `mobileSpreadActive` stuck on,
    // and a cancelled joystick finger would leave the knob frozen.
    window.addEventListener("pointercancel", this.onPointerCancel);
    this.canvas.addEventListener("contextmenu", this.onContext);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.resize();
    window.addEventListener("resize", this.resize);
    window.addEventListener("fullscreenchange", this.onFullscreenChange);
    this.loop(performance.now());
    // 刚进入主页面即建立服务器连接:连接建立后主页面同样会进行 AFK 检测
    // (菜单玩家不进入世界模拟,见 sim.ts 的 menuMode;AFK 处理见
    // menuClick/renderMenu 的主菜单分支)。
    this.connect();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onWindowBlur);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("contextmenu", this.onContext);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("resize", this.resize);
    this.net?.close();
  }


  /** 统一的手机检测：窗口宽度 / UA / 触摸能力 / 全屏（进入全屏视为最精确的手机信号）。 */
  private detectMobile(): boolean {
    if (typeof window === "undefined") return false;
    const hasTouch = "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0;
    const uaMobile = /Mobi|Android|iPhone|iPad|iPod|webOS|BlackBerry|Opera Mini|IEMobile|Tablet|SM-T|Kindle|Silk/i.test(navigator.userAgent);
    return (
      window.innerWidth <= 900 ||
      uaMobile ||
      hasTouch ||
      (typeof document !== "undefined" && !!document.fullscreenElement)
    );
  }

  /** Whether the canvas virtual keyboard should appear for text inputs.
   *  True on auto-detected mobile devices OR when the user manually enables
   *  the "Virtual Keyboard" setting as a fallback. */
  private showVirtualKeyboard(): boolean {
    return this.isMobile || this.settings.virtualKeyboard;
  }

  /** 全屏状态变化（进入/退出全屏）→ 重新检测设备并刷新移动端布局。 */
  private onFullscreenChange = () => {
    this.updateMobileLayout();
  };

  private updateMobileLayout() {
    this.isMobile = this.detectMobile();
    if (!this.isMobile) {
      this.mobileControlsVisible = false;
      return;
    }
    // Show mobile controls only in game scene for better UX
    this.mobileControlsVisible = this.scene === "game";
    const hotbarH = this.hotbarHeight();
    const shortLandscape = this.w > this.h && this.h <= 600;
    // Joystick bottom-left
    const joyRadius = shortLandscape
      ? Math.min(52, Math.max(40, this.h * 0.12))
      : Math.min(62, Math.max(48, this.w * 0.13));
    const joyCenterX = shortLandscape ? joyRadius + 18 : 90;
    const joyCenterY = this.h - hotbarH - joyRadius - (shortLandscape ? 10 : 18);
    this.mobileJoystick.radius = joyRadius;
    if (!this.mobileJoystick.active) {
      this.mobileJoystick.centerX = joyCenterX;
      this.mobileJoystick.centerY = joyCenterY;
      this.mobileJoystick.currX = joyCenterX;
      this.mobileJoystick.currY = joyCenterY;
    }
    this.mobileJoystickRect = {
      x: joyCenterX - joyRadius - 16,
      y: joyCenterY - joyRadius - 16,
      w: (joyRadius + 16) * 2,
      h: (joyRadius + 16) * 2,
    };
    // Action buttons bottom-right (Spread = Space, Contract = Shift)
    // Spread +25%, Contract +10%, both circular — then +20% radius on both
    // so the two right-hand action circles are easier to hit on mobile.
    const btnSize = shortLandscape ? 54 : Math.min(70, Math.max(54, this.w * 0.15));
    const spreadBtnSize = Math.round(btnSize * 1.25 * 1.2);
    const contractBtnSize = Math.round(btnSize * 1.10 * 1.2);
    const gap = shortLandscape ? 8 : 12;
    const rightX = this.w - spreadBtnSize - (shortLandscape ? 12 : 18);
    const baseY = this.h - hotbarH - spreadBtnSize - gap - contractBtnSize - (shortLandscape ? 10 : 22);
    this.mobileSpreadRect = { x: rightX, y: baseY, w: spreadBtnSize, h: spreadBtnSize };
    this.mobileContractRect = { x: rightX + (spreadBtnSize - contractBtnSize) / 2, y: baseY + spreadBtnSize + gap, w: contractBtnSize, h: contractBtnSize };
  }

  private tryEnterFullscreen() {
    try {
      const el = document.documentElement as any;
      if (document.fullscreenElement) return;
      if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch {}
  }

  private resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(320, Math.floor(rect.width));
    this.h = Math.max(240, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.w * dpr);
    this.canvas.height = Math.floor(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.updateMobileLayout();
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
      if (nm) {
        try {
          // CloudStorage.set 可能将字符串存储为 JSON（带引号），需要兼容处理
          this.playerName = JSON.parse(nm);
        } catch {
          this.playerName = nm;
        }
      }
      const sr = localStorage.getItem("petalia.server");
      if (sr === "eu" || sr === "as" || sr === "hk") this.serverRegion = sr;
    } catch {
      /* ignore */
    }
  }

  private applySave(data: SaveData) {
    if (!data) return;
    this.slots = emptyCells(SLOT_COUNT);
    this.secondary = emptyCells(SECONDARY_SLOT_COUNT);
    // The bag is unlimited — keep every saved cell, only padding up to BAG_COUNT.
    const savedBag = (data.bag || []).slice(0, BAG_MAX);
    this.bag = emptyCells(Math.max(BAG_COUNT, savedBag.length));
    (data.slots || []).slice(0, SLOT_COUNT).forEach((c, i) => (this.slots[i] = c ?? null));
    // `secondary` is absent in pre-dual-row saves; those just start empty.
    (data.secondary || []).slice(0, SECONDARY_SLOT_COUNT).forEach((c, i) => (this.secondary[i] = c ?? null));
    savedBag.forEach((c, i) => (this.bag[i] = c ?? null));
    this.xp = data.xp || 0;
    this.selectedMap = Math.max(0, Math.min(MAPS.length - 1, data.mapId || 0));
    this.nextOracleAt = data.nextOracleAt || 0;
    this.nextTradeAt = data.nextTradeAt || 0;
    this.craftLogPetals = data.craftPetals || 0;
    this.craftLogCrafted = data.craftCrafted || 0;
    this.craftLogBurned = data.craftBurned || 0;
    this.craftLogAttempts = data.craftAttempts || 0;
    this.stars = data.stars ?? 10;
  }

  private currentSave(): SaveData {
    return {
      slots: this.slots,
      secondary: this.secondary,
      bag: this.bag,
      xp: this.xp,
      mapId: this.mapId,
      nextOracleAt: this.nextOracleAt,
      nextTradeAt: this.nextTradeAt,
      craftPetals: this.craftLogPetals,
      craftCrafted: this.craftLogCrafted,
      craftBurned: this.craftLogBurned,
      craftAttempts: this.craftLogAttempts,
      stars: this.stars,
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
    // Sync all localStorage data to cloud storage
    if (CloudStorage.isReady) {
      CloudStorage.instance.set(SAVE_KEY, data);
      CloudStorage.instance.set("petalia.name", this.playerName);
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
      // Re-initialize CloudStorage with the new token and load all data
      if (CloudStorage.isReady) {
        CloudStorage.instance.set(AUTH_KEY, this.account);
        void CloudStorage.instance.loadAll().then((allData) => {
          // Apply all loaded data to localStorage
          for (const [k, v] of Object.entries(allData)) {
            if (v !== null && v !== undefined) {
              try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
            }
          }
        });
      }
      this.playerName = this.authUser;
      if (json.data) this.applySave(json.data);
      this.authStatus = `Signed in as ${this.authUser}. Progress syncs to the database.`;
    } catch {
      this.authStatus = "Network error.";
    }
  }

  private logout() {
    this.account = null;
    localStorage.removeItem(AUTH_KEY);
    if (CloudStorage.isReady) {
      CloudStorage.instance.remove(AUTH_KEY);
    }
    this.authStatus = "Playing as guest. Progress saved locally.";
  }

  // ------------------------------------------------------------- networking
  private connect() {
    this.net?.close();
    this.ents.clear();
    this.roseParticles.length = 0;
    const net = createTransport(GameClient.SERVER_URLS[this.serverRegion]);
    this.net = net;
    // Wrap `send` once here so every outbound packet is counted for the
    // debug-overlay throughput readout, regardless of which call site sent
    // it — cheaper than threading a counter through every send() call.
    const rawSend = net.send.bind(net);
    net.send = (data: Uint8Array) => {
      this.debugBytesOutWindow += data.byteLength;
      rawSend(data);
    };
    this.afkPending = false;
    this.afkSecondsLeft = 0;
    this.afkSmoothSeconds = 0;
    this.afkAnim = 0;
    this.afkKicked = false;
    this.sinceSnapshot = 0;
    this.snapshotStalled = false;
    this.stallNoticeAnim = 0;
    this.debugPingMs = 0;
    this.debugPingTimer = 0;
    net.onOpen = () => {
      this.connected = true;
      this.sendJoin();
      // 连接成功后立即发送天赋数据
      this.sendTalent();
      // 连接成功后立即发一次 ping
      this.sendPing();
      this.arenaPanel.sendPacket = (data: Uint8Array) => {
        if (this.net && this.connected) this.net.send(data);
      };
    };
    net.onClose = (code?: number) => {
      this.connected = false;
      // Distinguish an AFK kick from a normal drop so the overlay can say why
      // the session ended instead of showing "connecting to server...".
      if (code === AFK_CLOSE_CODE) {
        this.afkKicked = true;
        this.afkPending = false;
      }
    };
    net.onMessage = (data: Uint8Array) => this.handlePacket(new Uint8Array(data));
  }

  /** Sends a ping timestamp; the reply latency drives the debug overlay's ping readout. */
  private sendPing() {
    if (!this.net || !this.connected) return;
    this.debugPingStamp = Date.now() >>> 0;
    const w = new Writer(5);
    w.u8(C2S.PING).u32(this.debugPingStamp);
    this.net.send(w.bytes());
  }

  /**
   * Send the player's current level and highest petal rarity to the server,
   * which relays it to squad members. Called periodically (every 10 s).
   * Scans all hotbar slots (main + secondary) and bag for the highest rarity.
   */
  private sendSyncLevel() {
    if (!this.net || !this.connected || !this.squadCode) return;
    let highestRarity = 0;
    for (const cell of this.slots) {
      if (cell && cell.rarity > highestRarity) highestRarity = cell.rarity;
    }
    for (const cell of this.secondary) {
      if (cell && cell.rarity > highestRarity) highestRarity = cell.rarity;
    }
    for (const cell of this.bag) {
      if (cell && cell.rarity > highestRarity) highestRarity = cell.rarity;
    }
    const w = new Writer(5);
    w.u8(C2S.SYNC_LEVEL).u16(this.level).u8(highestRarity);
    this.net.send(w.bytes());
  }

  /** Rolls the byte counters into a per-second rate once a second has elapsed. */
  private updateDebugThroughput(dt: number) {
    this.debugThroughputTimer += dt;
    if (this.debugThroughputTimer < 1) return;
    this.debugThroughputTimer = 0;
    this.debugThroughputInWindow = this.debugBytesInWindow;
    this.debugThroughputOutWindow = this.debugBytesOutWindow;
    this.debugBytesInWindow = 0;
    this.debugBytesOutWindow = 0;
  }

  private sendJoin() {
    const w = new Writer(256);
    w.u8(C2S.JOIN).str(this.playerName).u8(this.selectedMap).u32(this.xp);
    for (let i = 0; i < SLOT_COUNT; i++) this.writeCell(w, this.slots[i]);
    for (let i = 0; i < SECONDARY_SLOT_COUNT; i++) this.writeCell(w, this.secondary[i]);
    // Unlimited bag: send the real (dynamic) length as u16.
    const bagLen = Math.min(this.bag.length, BAG_MAX);
    w.u16(bagLen);
    for (let i = 0; i < bagLen; i++) this.writeCell(w, this.bag[i]);
    const now = Date.now();
    w.u32(Math.max(0, Math.ceil((this.nextOracleAt - now) / 1000)));
    w.u32(Math.max(0, Math.ceil((this.nextTradeAt - now) / 1000)));
    // The server uses this only to spawn the additional copies; it also tracks
    // the supplied duration so the bonus cannot outlive its one-hour window.
    w.u8(this.bonus.currentMultiplier).u16(this.bonus.remainingSeconds);
    // 模式字节:主页面(菜单)时 = 1,服务端不将其纳入世界模拟/快捷栏更新,
    // 但仍可处理合成/交易/快捷栏切换等物品操作;进入游戏 = 0 正常出生。
    w.u8(this.scene === "menu" ? 1 : 0);
    this.wallPolygonsCache.clear();
    this.net?.send(w.bytes());
  }

  private writeCell(w: Writer, cell: Cell | null) {
    if (!cell || cell.count <= 0) w.u8(EMPTY_ITEM).u8(0).u16(0);
    else w.u8(cell.item).u8(cell.rarity).u16(cell.count);
  }

  private sendBonusStatus() {
    if (!this.connected) return;
    const w = new Writer(4);
    w.u8(C2S.BONUS_STATUS).u8(this.bonus.currentMultiplier).u16(this.bonus.remainingSeconds);
    this.net?.send(w.bytes());
  }

  private sendChat(text: string) {
    if (!this.net || !this.connected) return;
    const w = new Writer(256);
    w.u8(C2S.CHAT).str(text);
    this.net.send(w.bytes());
  }

  // ================================================================
  // Loadout 网络请求
  // ================================================================

  /** 保存当前快捷栏配置 */
  private sendSaveLoadout(name: string) {
    // 先保存到本地（立即持久化，避免服务器返回数据覆盖）
    const slots: (Cell | null)[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      slots.push(this.slots[i] ? { ...this.slots[i]! } : null);
    }
    // 检查是否已存在同名 loadout，若存在则更新
    const existingIdx = this.loadouts.findIndex(lo => lo.name === name);
    if (existingIdx >= 0) {
      this.loadouts[existingIdx] = { name, slots };
    } else {
      this.loadouts.push({ name, slots });
    }
    this.saveLoadoutsLocal();

    if (!this.net || !this.connected) return;
    const w = new Writer(128);
    w.u8(C2S.LOADOUT).u8(LOADOUT_OP.SAVE);
    w.str(name);
    w.u8(SLOT_COUNT);
    for (let i = 0; i < SLOT_COUNT; i++) {
      this.writeCell(w, this.slots[i]);
    }
    this.net.send(w.bytes());
  }

  /** 请求加载某个配置（本地优先，同时向服务器请求） */
  private sendLoadLoadout(index: number) {
    const lo = this.loadouts[index];
    if (lo) {
      // 立即从本地数据应用到快捷栏（即时反馈）
      for (let i = 0; i < SLOT_COUNT && i < lo.slots.length; i++) {
        this.slots[i] = lo.slots[i] ? { ...lo.slots[i]! } : null;
      }
    }
    if (!this.net || !this.connected) return;
    const w = new Writer(4);
    w.u8(C2S.LOADOUT).u8(LOADOUT_OP.LOAD).u8(index);
    this.net.send(w.bytes());
  }

  /** 将所有本地 loadout 同步到服务器（加入游戏时调用） */
  private syncAllLoadoutsToServer() {
    if (!this.net || !this.connected) return;
    for (const lo of this.loadouts) {
      const w = new Writer(128);
      w.u8(C2S.LOADOUT).u8(LOADOUT_OP.SAVE);
      w.str(lo.name);
      w.u8(lo.slots.length);
      for (const cell of lo.slots) {
        this.writeCell(w, cell);
      }
      this.net.send(w.bytes());
    }
  }

  /** 请求删除某个配置 */
  private sendDeleteLoadout(index: number) {
    // 先删除本地数据（立即持久化）
    if (index >= 0 && index < this.loadouts.length) {
      this.loadouts.splice(index, 1);
      this.saveLoadoutsLocal();
    }
    if (!this.net || !this.connected) return;
    const w = new Writer(4);
    w.u8(C2S.LOADOUT).u8(LOADOUT_OP.DELETE).u8(index);
    this.net.send(w.bytes());
  }

  private handlePacket(data: Uint8Array) {
  this.debugBytesInWindow += data.byteLength;
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
      this.wallCollider = new PolygonWallCollider(this.walls, this.worldW, this.worldH, 256);
      this.ents.clear();
      this.roseParticles.length = 0;
      this.mapFlash = 1;
      this.chat.addMessage("Welcome! Press [Enter] to chat. type /help for help", "System", true);
      // 将本地 loadout 同步到服务器（服务器在 JOIN 时创建了空列表）
      this.syncAllLoadoutsToServer();
      break;
    }
    case S2C.SNAPSHOT: {
      r.u32();
      this.sinceSnapshot = 0;
      this.snapshotStalled = false;
      const snapshotSequence = ++this.snapshotSequence;
      const count = r.u16();
      for (let i = 0; i < count; i++) {
        const kind = r.u8();
        const id = r.u16();
        const etype = r.u8();
        const team = r.u8();
        const x = r.i16();
        const y = r.i16();
        const angle = (r.u16() / 65535) * Math.PI * 2;
        // DROP：服务器把"正在被磁铁吸取"的状态编码在 radius 字节的最高位，
        // 客户端只在确定被吸时才对掉落物做缩小淡出。
        let radius = kind === ENT.MOB ? r.u16() : r.u8();
        let suction = false;
        if (kind === ENT.DROP) {
          suction = (radius & 0x80) !== 0;
          radius &= 0x7f;
        }
        const hp = r.u8() / 255;
        let name = "";
        if (kind === ENT.PLAYER) name = r.str();

        // ─── 读取 rarity ───
        let rarity = 0;
        if (kind === ENT.MOB) {
          rarity = r.u8();
        } else if (kind === ENT.PROJECTILE) {
          // PROJECTILE 在序列化时末尾附加了 rarity (u8)
          rarity = r.u8();
        }

        let e = this.ents.get(id);
        if (!e) {
          e = {
            id,
            kind,
            type: etype,
            team,
            x,
            y,
            tx: x,
            ty: y,
            angle,
            radius,
            hp,
            displayHp: hp,
            rarity,
            suction,
            name,
            seen: this.time,
            seenSnapshot: snapshotSequence,
            hurt: 0,
            spawn: 0,
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
        e.rarity = rarity;
        e.suction = suction;
        if (name) e.name = name;
        e.seen = this.time;
        e.seenSnapshot = snapshotSequence;
        if (e.spawn < 1) e.spawn = Math.min(1, e.spawn + 0.12);
      }
      // Petals are authoritative, short-lived entities. Remove one as soon
      // as it is absent so an absorbed Rose does not sit over the player for
      // the generic stale-entity grace period.
      for (const [id, entity] of this.ents) {
        if (entity.kind === ENT.PETAL && entity.seenSnapshot !== snapshotSequence) this.ents.delete(id);
      }
      // Trailing per-slot reload progress, one byte per hotbar slot.
      if (r.remaining >= SLOT_COUNT) {
        for (let i = 0; i < SLOT_COUNT; i++) this.slotReload[i] = r.u8() / 255;
      }
      // Trailing per-slot remaining health, one byte per hotbar slot.
      if (r.remaining >= SLOT_COUNT) {
        for (let i = 0; i < SLOT_COUNT; i++) this.slotHp[i] = r.u8() / 255;
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
      const secCount = r.u8();
      const secondary = emptyCells(SECONDARY_SLOT_COUNT);
      for (let i = 0; i < secCount; i++) {
        const c = this.readCell(r);
        if (i < SECONDARY_SLOT_COUNT) secondary[i] = c;
      }
      const bagCount = Math.min(r.u16(), BAG_MAX);
      const bag = emptyCells(Math.max(BAG_COUNT, bagCount));
      for (let i = 0; i < bagCount; i++) bag[i] = this.readCell(r);
      this.slots = slots;
      this.secondary = secondary;
      this.bag = bag;
      this.saveDirty = true;
      break;
    }
    case S2C.STATS: {
      this.xp = r.u32();
      this.level = r.u16();
      this.achievements.onPlayerLevel(this.level);
      // 天赋点 = 玩家等级：服务器等级更新后同步天赋树并应用加成。
      this.talent.syncWithLevel();
      this.hp = r.u16();
      this.maxHp = r.u16();
      this.mapId = r.u8();
      this.alive = r.u8() === 1;
      const oracleSecLeft = r.u32();
      const tradeSecLeft = r.u32();
      const now = Date.now();
      this.nextOracleAt = oracleSecLeft > 0 ? now + oracleSecLeft * 1000 : 0;
      this.nextTradeAt = tradeSecLeft > 0 ? now + tradeSecLeft * 1000 : 0;
      if (r.remaining >= 2) this.shield = r.u16();
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
    case S2C.CHAT: {
      const text = r.str();
      const sender = r.str();
      const isSystem = r.u8() === 1;
      const isCraftReport = r.u8() === 1;
      const isSelf = sender === this.playerName;
      this.chat.addMessage(text, sender, isSystem, isCraftReport, isSelf);
      break;
    }
    case S2C.AFK_CHECK: {
      const active = r.u8() === 1;
      const secondsLeft = r.u16();
      if (active && !this.afkPending) this.afkAnim = 0;
      this.afkPending = active;
      this.afkSecondsLeft = secondsLeft;
      this.afkSmoothSeconds = secondsLeft;
      break;
    }
    case S2C.SQUAD_UPDATE: {
      this.squadCode = r.str();
      if (this.squadCode) {
        this.chat.addMessage(`Joined squad: ${this.squadCode}`, "System", true);
      } else {
        this.chat.addMessage("Left squad.", "System", true);
      }
      break;
    }
    case S2C.SQUAD_MEMBER_STATE: {
      const playerId = r.u16();
      const squadLevel = r.u16();
      const squadRarity = r.u8();
      const ent = this.ents.get(playerId);
      if (ent) {
        ent.squadLevel = squadLevel;
        ent.squadRarity = squadRarity;
      }
      break;
    }
    case S2C.PONG: {
      const stamp = r.u32();
      const rtt = (Date.now() >>> 0) - stamp;
      if (rtt >= 0 && rtt < 60000) this.debugPingMs = rtt;
      break;
    }
    case S2C.DEBUG: {
      this.debugCollisionChecks = r.u32();
      this.debugEntityCount = r.u16();
      this.debugPlayerCount = r.u16();
      // Trailing per-player f32 added in the latest server build: the
      // owning player's current move speed in px/s. Older servers (no
      // tail) will simply leave this at 0 / last-known.
      this.debugPlayerSpeed = r.remaining >= 4 ? r.f32() : this.debugPlayerSpeed;
      break;
    }
    case S2C.TALENT_BONUSES: {
      // Authoritative server-side multipliers. We just cache them on the
      // local `talentBonuses` slot so any future UI panel (e.g. an HUD
      // buff list) can read them; the canonical recomputation still
      // happens locally in the client TalentSystem for immediate feedback.
      // Payload order matches sim.ts TALENT_KEYS (7 branches; reloadTime +
      // fluidSpeed were removed).
      if (r.remaining >= 7 * 4) {
        this.talentBonuses = {
          reloadReduction: r.f32(),
          petalDmgMult: r.f32(),
          summonDmgMult: r.f32(),
          summonHpMult: r.f32(),
          healthMult: r.f32(),
          speedMult: r.f32(),
          bodyDamageMult: r.f32(),
        };
      }
      break;
    }
    case S2C.LOADOUT_DATA: {
        // 从服务器数据填充 loadout 列表（服务器是权威来源）
        const count = r.u8();
        this.loadouts = [];
        for (let i = 0; i < count; i++) {
          const name = r.str();
          const slotCount = r.u8();
          const slots: (Cell | null)[] = [];
          for (let j = 0; j < slotCount; j++) {
            slots.push(this.readCell(r));
          }
          this.loadouts.push({ name, slots });
        }
        // 同时也保存到本地，作为离线备份
        this.saveLoadoutsLocal();
        break;
      }
    // ── Arena 模式 ──
    case S2C.ARENA_LOBBY: {
      const code = r.str();
      const hostSeat = r.u8();
      const size = r.u8();
      const mode = r.u8();
      const seatCount = r.u8();
      const seats: PlayerBrief[] = [];
      for (let i = 0; i < seatCount; i++) {
        seats.push({
          id: r.u16(), name: r.str(), level: r.u16(), maxRarity: r.u8(),
          team: r.u8(), alive: r.u8() === 1, lives: r.u8(), ready: r.u8() === 1, hasWheel: r.u8() === 1,
        });
      }
      // 找到自己的 seat
      let mySeat = 0;
      for (let i = 0; i < seats.length; i++) { if (seats[i].id === this.selfId) { mySeat = i; break; } }
      this.arenaPanel.onLobbyUpdate({ code, hostSeat, size, mode, seats, mySeat, myTeam: seats[mySeat]?.team ?? 0 });
      break;
    }
    case S2C.ARENA_UPDATE: {
      const type = r.u8();
      const seat = r.u8();
      let payload: any = 0;
      if (type === 2) {
        payload = r.u8();
      } else if (type === 3) {
        // wheel: 读取完整 Cell 数据
        const item = r.u16();
        const rarity = r.u8();
        const count = r.u16();
        payload = { item, rarity, count };
      }
      this.arenaPanel.onUpdate(type, seat, payload);
      break;
    }
    case S2C.ARENA_START: {
      const seed = r.u32();
      const wallCount = r.u16();
      const walls: Wall[] = [];
      for (let i = 0; i < wallCount; i++) {
        walls.push({ x: r.u16(), y: r.u16(), w: r.u16(), h: r.u16() });
      }
      this.arenaPanel.onStart(seed, walls);
      this.arenaWalls = walls;
      this.arenaSeed = seed;
      // 切换到游戏场景，进入竞技场战场
      this.sinceSnapshot = 0;
      this.stallNoticeAnim = 0;
      this.pendingScene = () => {
        this.scene = "game";
        this.alive = true;
        this.settings.close();
        this.mobGallery.close();
        this.shopSystem.close();
        this.challenges.panelOpen = false;
        this.loadoutPanelOpen = false;
        this.updateMobileLayout();
        // 不重新连接，保持现有服务器连接
      };
      break;
    }
    case S2C.ARENA_EVENT: {
      const type = r.u8();
      const seat = r.u8();
      const payload = r.u16();
      if (type === 0) this.arenaPanel.onLifeLost(seat);
      break;
    }
    case S2C.ARENA_RESULT: {
      const winnerTeam = r.u8();
      const cardCount = r.u8();
      const wonCards: Cell[] = [];
      for (let i = 0; i < cardCount; i++) {
        wonCards.push({ item: r.u8(), rarity: r.u8(), count: r.u16() });
      }
      // 胜方：把卡加入 bag
      if (this.arenaPanel.currentRoom?.myTeam === winnerTeam) {
        for (const card of wonCards) {
          if (card.item !== 255) this.bag.push(card);
        }
        this.saveDirty = true;
      }
      // 1.5s 后回主菜单
      setTimeout(() => {
        this.gotoMenu();
        this.arenaPanel.close();
      }, 1500);
      break;
    }
    case S2C.ARENA_LIST: {
      const count = r.u8();
      const rooms: RoomBrief[] = [];
      for (let i = 0; i < count; i++) {
        rooms.push({
          code: r.str(), hostName: r.str(), mode: r.u8(),
          filled: r.u8(), capacity: r.u8(),
        });
      }
      this.arenaPanel.onList(rooms);
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
          vy: -22,
        });
        this.achievements.onItemObtained(RARITIES[rarity]?.name);
        // Track drops for the death panel
        if (!this.currentRunDrops) this.currentRunDrops = [];
        this.currentRunDrops.push({
          type: ITEMS[item]?.name ?? "?",
          rarity: RARITIES[rarity]?.name ?? "Common",
          count: value ?? 1,
        });
        break;
      case EVT.HIT:
        this.floaters.push({ x, y, msg: `-${value}`, color: "#ff6f6f", life: 0.9, vy: -40 });
        // EVT.HIT = 玩家受到伤害(服务端在玩家位置推送,见 sim.ts applyDamage)
        this.achievements.onPlayerTookDamage(value);
        break;
      case EVT.KILL:
        this.killFeed = this.killFeed.slice(0, 5);
        this.mobGallery.recordKill(value, rarity);
        this.achievements.onEnemyKilled(value, MOBS[value]?.name ?? "", RARITIES[rarity]?.name ?? null);
        // 每日猎杀挑战进度(生物名 + 稀有度名)
        this.challenges.updateProgress(MOBS[value]?.name ?? "", RARITIES[rarity]?.name ?? "");
        break;
      case EVT.CRAFT_OK:
        this.craftMsg = value > 1 ? `Crafted ${value}x ${RARITIES[rarity].name} ${ITEMS[item].name}!` : `Crafted ${RARITIES[rarity].name} ${ITEMS[item].name}!`;
        this.craftLogCrafted += value;
        this.craftLogLast = this.craftMsg;
        this.craftResolve({ item, rarity, count: value });
        this.achievements.onItemObtained(RARITIES[rarity]?.name);
        break;
      case EVT.CRAFT_FAIL:
        this.craftMsg = value > 0 ? `Craft failed... ${value} petal${value === 1 ? "" : "s"} lost.` : "Craft failed.";
        this.craftLogBurned += value;
        this.craftLogLast = this.craftMsg;
        this.craftResolve(null);
        break;
      case EVT.ORACLE_OK:
        this.craftMsg = `Oracle success! Created ${RARITIES[rarity].name} ${ITEMS[item].name}!`;
        this.craftLogCrafted += value || 1;
        this.craftLogLast = this.craftMsg;
        this.craftResolve({ item, rarity, count: value || 1 });
        this.achievements.onItemObtained(RARITIES[rarity]?.name);
        break;
      case EVT.ORACLE_FAIL:
        this.craftRefused("Oracle refused — check the requirement and cooldown.");
        break;
      case EVT.TRADE_OK:
        this.craftMsg = `Traded for ${value}x ${RARITIES[rarity].name} Coin!`;
        this.craftLogCrafted += value;
        this.craftLogLast = this.craftMsg;
        this.craftResolve({ item, rarity, count: value });
        break;
      case EVT.TRADE_FAIL:
        this.craftRefused("Trade refused — check the requirement and cooldown.");
        break;
      case EVT.HEAL: {
        // Rose restores HP, Shell plates on shield — same absorb feedback,
        // different label and particle palette.
        if (!isAbsorbItem(item)) break;
        const isShield = item === SHELL_ITEM;
        this.floaters.push({
          x,
          y: y - 18,
          msg: isShield ? `+${value} Shield` : `+${value} HP`,
          color: isShield ? "#f2d96e" : "#ffcc66",
          life: 1.1,
          vy: -28,
        });
        const palette = isShield ? ["#f8e8a0", "#c8a030"] : ["#ff6578", "#d6354a"];
        for (let k = 0; k < 12; k++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 40 + Math.random() * 80;
          this.roseParticles.push({
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color: Math.random() > 0.5 ? palette[0] : palette[1],
            size: 4 + Math.random() * 5,
            life: 0.6,
            maxLife: 0.6,
          });
        }
        break;
      }
      case EVT.DEATH:
        this.alive = false;
        this.floaters.length = 0;
        this.achievements.onPlayerDied();
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
    const rawDt = (now - this.last) / 1000;
    const dt = Math.min(0.05, rawDt);
    this.last = now;
    this.time += dt;
    this.updateDebugFps(rawDt);
    this.update(dt);
    this.render(dt);
  };

  /** 统一推进所有主菜单模态面板的划入动画进度(目标 = 各自的打开状态)。 */
  private updatePanelAnims(dt: number) {
    this.settings.updateOpenAnim(dt);
    this.achievements.updateOpenAnim(dt);
    this.challenges.updateOpenAnim(dt);
    this.shopSystem.updateOpenAnim(dt);
    this.changelog.updateOpenAnim(dt);
    this.accountSystem.updateOpenAnim(dt);
    // MobGallery 在独立文件,由 GameClient 层包装驱动动画
    this.mobGalleryAnim += ((this.mobGallery.visible ? 1 : 0) - this.mobGalleryAnim) * Math.min(1, dt * 10);
  }

  /** Recomputes `debugFps` once a second from real (unclamped) frame deltas. */
  private updateDebugFps(rawDt: number) {
    if (rawDt <= 0 || rawDt > 2) return; // ignore the first frame / tab-hidden gaps
    this.debugFpsFrames++;
    this.debugFpsAccum += rawDt;
    if (this.debugFpsAccum >= 1) {
      this.debugFps = this.debugFpsFrames / this.debugFpsAccum;
      this.debugFpsFrames = 0;
      this.debugFpsAccum = 0;
    }
  }

  private update(dt: number) {
    // 所有主菜单模态面板的划入/划出动画(参考背包 bagAnim 的平滑逼近)
    this.updatePanelAnims(dt);
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
    if (this.bonus.update()) this.sendBonusStatus();

    this.bagAnim += ((this.bagOpen ? 1 : 0) - this.bagAnim) * Math.min(1, dt * 10);
    this.craftAnim += ((this.craftOpen ? 1 : 0) - this.craftAnim) * Math.min(1, dt * 10);
    if (this.craftSpin > 0) this.craftSpin = Math.max(0, this.craftSpin - dt);
    if (this.craftMsgLife > 0) this.craftMsgLife -= dt;
    if (this.craftBurstT > 0) this.craftBurstT = Math.max(0, this.craftBurstT - dt * 1.6);
    if (this.craftShake > 0) this.craftShake = Math.max(0, this.craftShake - dt * 2);
    this.craftGlow += ((this.craftSel ? 1 : 0) - this.craftGlow) * Math.min(1, dt * 8);
    // Keep the complete CraftAnimation port alive even while the panel is sliding.
    // This drives pentagon contraction, fill cards, delayed results, and particles.
    this.craftUpdate(dt);

    // Update Rose arrival particles.
    // Travel into the player is represented by the Rose petal entity itself.
    // This burst starts only after the authoritative HEAL event arrives.
    // Update Rose particles
    for (let i = this.roseParticles.length - 1; i >= 0; i--) {
      const rp = this.roseParticles[i];
      rp.life -= dt;
      rp.x += rp.vx * dt;
      rp.y += rp.vy * dt;
      rp.vx *= 0.92;
      rp.vy *= 0.92;
      if (rp.life <= 0) {
        this.roseParticles.splice(i, 1);
      }
    }

    // Packet-loss detection. Snapshots arrive at the tick rate; when they stop
    // the stream is stalled, and the right thing to do is hold the last scene
    // rather than expire entities that the server never said were gone.
    if (this.scene === "game" && this.connected) {
      this.sinceSnapshot += dt;
      this.snapshotStalled = this.sinceSnapshot > SNAPSHOT_STALL_SECONDS;
    } else {
      this.sinceSnapshot = 0;
      this.snapshotStalled = false;
    }
    const showStallNotice =
      this.snapshotStalled && this.sinceSnapshot > SNAPSHOT_STALL_NOTICE_SECONDS && !this.afkPending;
    this.stallNoticeAnim = showStallNotice
      ? Math.min(1, this.stallNoticeAnim + dt * 3)
      : Math.max(0, this.stallNoticeAnim - dt * 5);

    for (const e of this.ents.values()) {
      const k = Math.min(1, dt * 16);
      e.x += (e.tx - e.x) * k;
      e.y += (e.ty - e.y) * k;
      e.hurt = Math.max(0, e.hurt - dt);
      // Lagging health buffer: eases toward the real health so damage shows
      // as a brief red trail draining off the bar instead of an instant cut.
      if (e.displayHp === undefined) e.displayHp = e.hp;
      e.displayHp += (e.hp - e.displayHp) * Math.min(1, dt * 6);
      // Only expire entities while the stream is healthy. During a stall the
      // absence of an entity means "no news", not "it despawned", so keeping
      // it on screen is what makes lost packets read as a brief freeze.
      // Timestamps are pushed along with the clock so nothing expires in a
      // burst the instant the connection recovers.
      if (this.snapshotStalled) e.seen += dt;
      else if (this.time - e.seen > 0.6) this.ents.delete(e.id);
    }

    // ---- 玩家与墙壁的精确碰撞 ----
    if (this.wallCollider) {
      const me = this.ents.get(this.selfId);
      if (me) {
        const r = PLAYER_RADIUS; // 客户端不追踪 soil radius bonus，使用基础半径
        const [nx, ny] = this.wallCollider.collideCircle(me.x, me.y, r);
        me.x = nx;
        me.y = ny;
      }
    }

    // ---- 检测视野内最近的 Ultra+ 生物（Ultra=6, Super=7, Omega=8, Eternal=9） ----
    {
      let nearest: Ent | null = null;
      let nearestDistSq = Infinity;
      const me = this.ents.get(this.selfId);
      if (me) {
        for (const ent of this.ents.values()) {
          if (ent.kind === ENT.MOB && ent.rarity >= 6) {
            const dx = ent.x - me.x;
            const dy = ent.y - me.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < nearestDistSq) {
              nearestDistSq = distSq;
              nearest = ent;
            }
          }
        }
      }
      this.nearestUltraPlus = nearest;
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

    // AFK prompt: ease the panel in and tick the countdown locally between
    // the once-per-second server updates so the number never looks frozen.
    this.afkAnim = this.afkPending
      ? Math.min(1, this.afkAnim + dt * 4)
      : Math.max(0, this.afkAnim - dt * 6);
    if (this.afkPending && this.afkSmoothSeconds > 0) {
      this.afkSmoothSeconds = Math.max(0, this.afkSmoothSeconds - dt);
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
      // Periodic squad level/rarity sync (every 10 s, 30 s if performance is a concern)
      this.syncLevelTimer -= dt;
      if (this.syncLevelTimer <= 0) {
        this.syncLevelTimer = 10;
        this.sendSyncLevel();
      }
      // Debug overlay: only ping the server while the panel is actually
      // shown, so leaving it off costs nothing on the wire.
      if (this.settings.showDebugInfo && this.connected) {
        this.debugPingTimer -= dt;
        if (this.debugPingTimer <= 0) {
          this.debugPingTimer = 1;
          this.sendPing();
        }
      }
      this.updateDebugThroughput(dt);
      // Achievement popups + play-time tracking (game scene only)
      this.achievements.update(dt);
      // Challenge quests: daily reset + claim particles (both scenes)
      this.challenges.update(dt);
    } else {
      // 主菜单:只推进弹窗计时,不累计游玩时长
      this.achievements._tickPopups(dt);
      this.shopSystem.update(dt);
      // Challenge quests: daily reset + claim particles (both scenes)
      this.challenges.update(dt);
    }
  }

  private sendInput() {
    if (!this.net || !this.connected) return;

    // While the AFK prompt is up the world is frozen for this player: send a
    // neutral packet so a parked mouse/held key can't keep driving the flower
    // (and, since it never changes, it can't satisfy the check either).
    if (this.afkPending) {
      const w = new Writer(8);
      w.u8(C2S.INPUT).i8(0).i8(0).u8(0);
      this.net.send(w.bytes());
      return;
    }

    let dx = 0;
    let dy = 0;
    const uiBusy = this.drag !== null || this.bagAnim > 0.4 || this.craftAnim > 0.4 || this.chat.inputActive;

    if (!uiBusy && this.isMobile && this.mobileJoystick.active) {
      // Joystick overrides mouse movement on phone
      const jdx = this.mobileJoystick.currX - this.mobileJoystick.centerX;
      const jdy = this.mobileJoystick.currY - this.mobileJoystick.centerY;
      const dist = Math.hypot(jdx, jdy);
      if (dist > 4) {
        const maxDist = this.mobileJoystick.radius || 60;
        const norm = Math.min(1, dist / maxDist);
        const angle = Math.atan2(jdy, jdx);
        dx = Math.cos(angle) * norm;
        dy = Math.sin(angle) * norm;
      }
    } else if (this.isMobile) {
      // On mobile, when the joystick is NOT active the player should stand
      // still. Do NOT fall back to mouse-position movement — the last touch
      // point (often the joystick area on the left) would otherwise keep
      // driving the player leftward. Only physical keys (rare on phones)
      // can still move the player here.
      if (!uiBusy) {
        if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) dx -= 1;
        if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) dx += 1;
        if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) dy -= 1;
        if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) dy += 1;
      }
    } else {
      // Desktop: mouse movement is measured from the camera/screen centre
      // (where the player is rendered). The server remains authoritative for
      // acceleration, wall collision, and map bounds; this is only the desired
      // direction. Close to the player, reduce the input so it eases to a stop
      // instead of continuously overshooting the cursor.
      const mouseDx = this.mx - this.w / 2;
      const mouseDy = this.my - this.h / 2;
      const mouseDistance = Math.hypot(mouseDx, mouseDy);
      if (!uiBusy && mouseDistance > 6) {
        const distanceFactor = Math.min(1, mouseDistance / 100);
        dx = (mouseDx / mouseDistance) * distanceFactor;
        dy = (mouseDy / mouseDistance) * distanceFactor;
      } else {
        // Retain WASD/arrow support when the pointer is centred or a panel is
        // open, without letting UI interaction make the player walk.
        if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) dx -= 1;
        if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) dx += 1;
        if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) dy -= 1;
        if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) dy += 1;
      }
    }
    let flags = 0;
    const isSpaceDown = this.keys.has("Space") || this.mobileSpreadActive;
    const isShiftDown = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || this.keys.has("Shift") || this.mobileContractActive;
    // New mapping: Space = spread (attack), Shift = contract (defend)
    // Keep mouse buttons as well for usability: left click = spread, right click = contract
    if ((this.mouseDown && !uiBusy) || isSpaceDown) flags |= 1;
    if (this.rightDown || isShiftDown) flags |= 2;
    const w = new Writer(8);
    w.u8(C2S.INPUT).i8(dx * 100).i8(dy * 100).u8(flags);
    this.net.send(w.bytes());
  }

  // --------------------------------------------------------------- layouts
  /**
   * Height reserved at the bottom of the screen by the dual-row quick-slot
   * bar. Panels use it so they never sit on top of the hotbar.
   */
  private hotbarHeight(): number {
    return this.quickSlot.height();
  }

  private bagPanelRect(): Rect {
    // Landscape phones get a much bigger bag: width +50% and height ×2 so the
    // inventory isn't cramped into a tiny corner. Portrait phones and desktop
    // keep the original proportional sizing.
    const isMobile = this.isMobile || this.w < 640;
    const isLandscape = this.w > this.h;
    const mobileScale = isMobile ? 0.5 : 1;
    const widthMult = isMobile && isLandscape ? 1.5 : 1;   // +50% width
    const heightMult = isMobile && isLandscape ? 2.1 : 1;    // ×2 height
    const w = Math.min(380, this.w * 0.92) * mobileScale * widthMult;
    // 快捷栏在主菜单同样可见可拖拽,背包面板始终为其预留底部高度,
    // 避免背包与快捷栏重叠遮挡(与游戏内一致)。
    const reservedHotbar = this.hotbarHeight();
    const topGap = 18 * mobileScale;
    const bottomGap = 26 * mobileScale;
    const availableH = Math.max(1, this.h - reservedHotbar - topGap - bottomGap);
    let h = Math.min(610, availableH) * mobileScale * heightMult;
    const hidden = this.h + 20;
    const shown = topGap;
    const t = ease.outCubic(this.bagAnim);
    return { x: (this.w - w) / 10, y: hidden + (shown - hidden) * t, w, h };
  }

  /** Geometry for the scrollable item grid + header widgets inside the bag panel. */
private bagLayout() {
  const p = this.bagPanelRect();
  const isMobile = this.isMobile || this.w < 640;
  const scale = Math.min(1, p.w / 380);

  // 【修改】手机端更密集：减少间距
  let gap = 10 * scale;
  let pad = 15 * scale;
  let cols = 5;

  if (isMobile) {
    gap = 6 * scale;
    pad = 10 * scale;
    cols = 6;
  }

  const slotSize = Math.max(28 * scale, Math.floor((p.w - pad * 2 - gap * (cols - 1)) / cols));
  const itemHeight = slotSize + gap;
  const headerH = 44 * scale;
  const barY = p.y + headerH;
  const barH = 28 * scale;
  const dropW = Math.min(120, p.w * 0.3);
  const barGap = 6 * scale;
  const barW = p.w - dropW - barGap - pad * 2;
  const barX = p.x + pad;
  const dropX = barX + barW + barGap;

  // 【修改】手机端降低统计面板高度
  let statsH = 92 * scale;
  if (isMobile) {
    statsH = 72 * scale;  // 从92减小到76
  }

  const gridTop = barY + barH + 12 * scale;
  const gridBottom = p.y + p.h - statsH - 6 * scale;
  const gridH = Math.max(1, gridBottom - gridTop);
  const maxVisibleRows = Math.max(1, Math.floor(gridH / itemHeight));
  const scrollTrack: Rect = { x: p.x + p.w - pad + 2, y: gridTop, w: 6, h: gridH };

  return {
    panel: p,
    compact: false,
    scale,
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
    closeRect: { x: p.x + p.w - 34 * scale, y: p.y + 10 * scale, w: 24 * scale, h: 24 * scale } as Rect,
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
    return bagCellIndex(entry.slot);
  }

  private craftPanelRect(): Rect {
    // Landscape phones get a bigger craft panel: width +25% and height ×2 so
    // the pentagon + grid aren't squished. All mobile gets an extra +10%
    // width / +15% height bump so the craft UI is comfortably large.
    // Portrait phones and desktop keep the original proportional sizing
    // (desktop gets no mobile bump).
    const isMobile = this.isMobile || this.w < 640;
    const isLandscape = this.w > this.h;
    const mobileScale = isMobile ? 0.5 : 1;
    const landscapeW = isMobile && isLandscape ? 1.3 : 1;  // +25% width (landscape)
    const landscapeH = isMobile && isLandscape ? 2 : 1;     // ×2 height (landscape)
    const mobileBumpW = isMobile ? 1.15 : 1;                // +10% width (all mobile)
    const mobileBumpH = isMobile ? 1.2 : 1;                // +15% height (all mobile)
    const widthMult = landscapeW * mobileBumpW;
    const heightMult = landscapeH * mobileBumpH;
    const w = Math.min(800, Math.floor(this.w * 0.92)) * mobileScale * widthMult;
    const reservedHotbar = this.scene === "game" ? this.hotbarHeight() : 0;
    const topGap = 12 * mobileScale;
    const bottomGap = 18 * mobileScale;
    const availableH = Math.max(1, this.h - reservedHotbar - topGap - bottomGap);
    const h = Math.min(560, availableH) * mobileScale * heightMult;
    const t = ease.outCubic(this.craftAnim);
    const hidden = this.w + 20;
    const shown = this.w - w - 16;
    return { x: hidden + (shown - hidden) * t, y: topGap, w, h };
  }
  /**
   * Geometry for the widened crafting panel.
   * - Five 70px craft slots form a compact pentagon near the top
   * - Mode selectors sit in a small top-right row
   * - The action button is vertically centered beside the pentagon
   * - Filters and the item-by-rarity matrix live below the craft area
   */
  private craftLayout() {
    const p = this.craftPanelRect();
    // Scale factor: shrink everything proportionally on smaller panels
    const scale = Math.min(1, p.w / 800);
    const pad = 14 * scale;
    const headerH = 42 * scale;
    const tabsH = 32 * scale;
    const barH = 26 * scale;

    // [Change] 应用 scale 到日志区域
    const logRect: Rect = {
      x: p.x + pad,
      y: p.y + 10 * scale,
      w: Math.min(150, p.w * 0.18) * scale, // [Change] 宽度缩放
      h: 82 * scale,
    };
    const tabsY = p.y + 10 * scale;

    const bigSize = Math.max(30, Math.min(70, p.h * 0.13));
    const radius = Math.max(38, Math.min(80, p.h * 0.14));
    const cx = p.x + p.w * 0.38;
    const cy = p.y + Math.max(82, Math.min(148, p.h * 0.29));

    const bigSlots: Rect[] = [];
    for (let i = 0; i < CRAFT_CARD_COUNT; i++) {
      const ang = (Math.PI / 180) * (-90 + i * (360 / CRAFT_CARD_COUNT));
      const ox = Math.cos(ang) * radius;
      const oy = Math.sin(ang) * radius;
      bigSlots.push({ x: cx + ox - bigSize / 2, y: cy + oy - bigSize / 2, w: bigSize, h: bigSize });
    }
    const singleSlot: Rect = { x: cx - bigSize / 2, y: cy - bigSize / 2, w: bigSize, h: bigSize };

    const resultSize = Math.min(66, Math.max(bigSize * 1.25, 54));
    const resultRect: Rect = { x: cx - resultSize / 2, y: cy - resultSize / 2, w: resultSize, h: resultSize };

    // [Change] 应用 scale 到操作按钮
    const actionW = Math.min(110, p.w * 0.18) * scale; // [Change] 宽度缩放
    const actionH = Math.min(36, p.h * 0.07) * scale;  // [Change] 高度缩放
    const actionRect: Rect = {
      x: p.x + p.w - actionW - (14 * scale), // [Change] 右侧 padding 缩放
      y: cy - actionH / 2,
      w: actionW,
      h: actionH
    };

    // [Change] 应用 scale 到关闭按钮
    const closeRect: Rect = {
      x: p.x + p.w - (34 * scale), // [Change] X 位置缩放
      y: p.y + 10 * scale,
      w: 24 * scale, // [Change] 宽度缩放
      h: 24 / scale  // [Change] 高度缩放
    };

    // [Change 1] Reduced padding from 24 to 10 to lift the bottom bar up
    const craftBottom = cy + radius + bigSize / 2 + 10 * scale;
    const barGap = 8 * scale;
    const dropW = Math.min(110, p.w * 0.2) * scale; // [Change] 下拉框宽度缩放
    const barW = Math.min(210, p.w * 0.34) * scale; // [Change] 搜索条宽度缩放
    const dropX = p.x + pad;
    const barY = craftBottom + 4 * scale;
    const barX = dropX + dropW + barGap;
    const infoY = barY + barH + 10 * scale;

    // [Change 2] Reduced offset from 38 to 10 to expand grid height significantly
    const gridTop = infoY + 10 * scale;

    const gridBottom = p.y + p.h - 10 * scale;

    const cols = RARITIES.length;
    const gapSmall = 6 * scale;
    const maxGridWidth = p.w - pad * 2 - (18 * scale); // [Change] 边距缩放
    const widthLimitedSlot = Math.floor((maxGridWidth - gapSmall * (cols - 1)) / cols);
    const availableGridH = Math.max(1, gridBottom - gridTop);
    const slotSizeSmall = Math.max(18, Math.min(40, widthLimitedSlot, availableGridH));
    const itemHeightSmall = slotSizeSmall + gapSmall;
    const totalGridWidth = cols * (slotSizeSmall + gapSmall) - gapSmall;
    const gridStartX = p.x + p.w / 2 - totalGridWidth / 2;
    const gridH = availableGridH;
    const maxVisibleRows = Math.max(5, Math.floor(gridH / itemHeightSmall));
    const scrollTrack: Rect = {
      x: gridStartX + totalGridWidth + (10 * scale), // [Change] 滚动条间距缩放
      y: gridTop,
      w: 10 * scale, // [Change] 滚动条宽度缩放
      h: gridH
    };

    return {
      panel: p,
      compact: false,
      scale,
      cols,
      gap: gapSmall,
      pad,
      slotSize: slotSizeSmall,
      itemHeight: itemHeightSmall,
      headerH,
      tabsY,
      tabsH,
      barRect: { x: barX, y: barY, w: barW, h: barH } as Rect,
      dropRect: { x: dropX, y: barY, w: dropW, h: barH } as Rect,
      gridTop,
      gridStartX,
      totalGridWidth,
      gridH,
      maxVisibleRows,
      bigSlots,
      singleSlot,
      bigSize,
      resultRect,
      infoY,
      actionRect,
      closeRect,
      scrollTrack,
      cx,
      cy,
      radius,
      craftBottom,
      logRect,
    };
  }



  private craftModeRects(): { mode: "normal" | "oracle" | "trade"; rect: Rect; label: string; color: string }[] {
    const layout = this.craftLayout();
    const gap = 6;
    const h = layout.tabsH;
    const w = h;
    const y = layout.tabsY;
    const modeCount = 3;
    const x0 = layout.closeRect.x - 10 - (w + gap) * modeCount;
    return [
      { mode: "normal", rect: { x: x0, y, w, h }, label: "Cr", color: "#c9762b" },
      { mode: "oracle", rect: { x: x0 + w + gap, y, w, h }, label: "Or", color: "#6a3fb0" },
      { mode: "trade", rect: { x: x0 + (w + gap) * 2, y, w, h }, label: "Tr", color: "#3f8f5a" },
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

  /**
   * Distinct owned item types that pass the filters. Each item is one matrix
   * row, while each rarity index is a fixed matrix column.
   */
  private craftMatrixRows(): number[] {
    const query = this.craftSearchText.trim().toLowerCase();
    const biome = this.craftBiome;
    const seen = new Set<number>();
    for (const { cell } of this.bagEntries()) {
      const def = ITEMS[cell.item];
      if (!def) continue;
      if (query && !def.name.toLowerCase().includes(query)) continue;
      if (biome !== "All" && !this.itemBiomes(cell.item).has(biome)) continue;
      seen.add(cell.item);
    }
    return [...seen].sort((a, b) => {
      const nameA = ITEMS[a]?.name ?? "";
      const nameB = ITEMS[b]?.name ?? "";
      return nameA.localeCompare(nameB);
    });
  }

  /** Cell for an item/rarity matrix coordinate, or null when none is owned.
   *  In normal mode, cards already loaded into the pentagon slots are
   *  subtracted here so the bag visibly loses them as they're clicked.
   */
  private craftMatrixCell(item: number, rarity: number): Cell | null {
    let count = this.countOf(item, rarity);
    if (this.craftMode === "normal" && this.craftSel && this.craftSel.item === item && this.craftSel.rarity === rarity) {
      count -= this.craftTotalLoaded();
    }
    return count > 0 ? { item, rarity, count } : null;
  }

  private craftMaxScroll(): number {
    const layout = this.craftLayout();
    const totalRows = this.craftMatrixRows().length;
    const totalHeight = totalRows * layout.itemHeight;
    const visibleHeight = layout.maxVisibleRows * layout.itemHeight;
    return Math.max(0, totalHeight - visibleHeight);
  }

  private clampCraftScroll() {
    this.craftScrollY = Math.max(0, Math.min(this.craftMaxScroll(), this.craftScrollY));
  }

  private craftScrollThumbRect(layout: ReturnType<GameClient["craftLayout"]>): Rect {
    const track = layout.scrollTrack;
    const totalRows = Math.max(1, this.craftMatrixRows().length);
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
    const totalRows = Math.max(1, this.craftMatrixRows().length);
    const thumbH = Math.max(20, (layout.maxVisibleRows / totalRows) * track.h);
    const maxDrag = track.h - thumbH;
    if (maxDrag <= 0) return;
    const ratio = (my - this.craftThumbDragStartY) / maxDrag;
    this.craftScrollY = Math.max(0, Math.min(maxScroll, this.craftScrollAtDragStart + ratio * maxScroll));
  }

  /** Card under the pointer in the item-row/rarity-column matrix. */
  private craftGridEntryAtPoint(x: number, y: number): { slot: number; cell: Cell } | null {
    const layout = this.craftLayout();
    const p = layout.panel;
    if (x < p.x || x > p.x + p.w || y < layout.gridTop || y > layout.gridTop + layout.gridH) return null;
    this.clampCraftScroll();
    const rows = this.craftMatrixRows();
    const startRow = Math.floor(this.craftScrollY / layout.itemHeight);
    const yOffset = -(this.craftScrollY % layout.itemHeight);
    const relX = x - layout.gridStartX;
    const relY = y - layout.gridTop - yOffset;
    if (relX < 0 || relY < 0) return null;
    const col = Math.floor(relX / (layout.slotSize + layout.gap));
    const rowOffset = Math.floor(relY / (layout.slotSize + layout.gap));
    if (col < 0 || col >= layout.cols || rowOffset < 0) return null;
    const item = rows[startRow + rowOffset];
    if (item === undefined) return null;
    const cell = this.craftMatrixCell(item, col);
    if (!cell) return null;
    const slotX = layout.gridStartX + col * (layout.slotSize + layout.gap);
    const slotY = layout.gridTop + rowOffset * layout.itemHeight + yOffset;
    if (x < slotX || x > slotX + layout.slotSize || y < slotY || y > slotY + layout.slotSize) return null;
    return { slot: -1, cell };
  }

  // ── Ported CraftAnimation helpers (spin / contraction / particles / fill) ──

  /** Local position of the i-th pentagon slot (before rotation/contraction). */
  private craftLocalPos(i: number): [number, number] {
    const { radius } = this.craftLayout();
    const a = (Math.PI / 180) * (-90 + i * (360 / CRAFT_CARD_COUNT));
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

  /** Begin the accelerating spin + contraction animation when a craft is fired.
   *  Mirrors CraftAnimation.startAnimation(duration=2.5) but longer for juice.
   */
  private craftStartRotation() {
    this.craftPhase = "rotating";
    this.craftRotTime = 0;
    this.craftAngle = 0;
    this.craftRotDir = 1;
    this.craftRotSpeed = 300;
    this.craftPending = null;
    this.craftResultPulse = 0;
    this.craftSlotCounts = [0, 0, 0, 0, 0];
    this.craftSuccessParticles.length = 0;
    this.craftFailParticles.length = 0;
  }

  /** Reveal a successful result card immediately + success particles (Oracle/Trade). */
  private craftStartShow(result: { item: number; rarity: number; count: number }) {
    this.craftPhase = "showing";
    this.craftShowTimer = 0;
    this.craftResultPulse = 0;
    this.craftPending = result;
    this.craftSel = null;
    this.craftSpawnSuccessParticles(this.rarityRgb(result.rarity), Math.min(50 * Math.max(1, result.count), 1600));
  }

  /** Accept a server craft response. The result is revealed after the active spin completes. */
  private craftResolve(result: { item: number; rarity: number; count: number } | null) {
    this.craftMsgLife = 3.2;
    this.craftBurstColor = result ? RARITIES[result.rarity]?.color ?? "#ffe763" : "#ff8080";
    if (this.craftPhase === "rotating" || this.craftPhase === "waiting") {
      this.craftPending = result;
      return;
    }
    if (result) this.craftStartShow(result);
    else {
      this.craftSpawnFailParticles();
      this.craftShake = 0.6;
    }
  }

  /** Called once the spin finishes: spawn particles and (optionally) reveal the result card. */
  private craftFinalizeShow() {
    if (this.craftPending) {
      this.craftPhase = "showing";
      this.craftShowTimer = 0;
      this.craftResultPulse = 0;
      this.craftSpawnSuccessParticles(this.rarityRgb(this.craftPending.rarity), Math.min(50 * Math.max(1, this.craftPending.count), 1600));
      this.craftBurstT = 1;
    } else {
      // Nothing crafted — burst failure particles from each pentagon slot.
      this.craftSpawnFailParticles();
      this.craftShake = 0.65;
      this.craftPhase = "none";
    }
    this.craftSel = null;
    this.craftSlotCounts = [0, 0, 0, 0, 0];
  }

  /** Per-frame update for the rotation phase machine, fill animation and particles.
   *  Mirrors CraftAnimation.update(dt) + updateParticles.
   */
  private craftUpdate(dt: number) {
    if (this.craftPhase === "rotating") {
      this.craftRotTime += dt;
      const progress = Math.min(this.craftRotTime / this.craftRotDuration, 1);
      const baseMin = 300, baseMax = 800;
      this.craftRotSpeed = baseMin + (baseMax - baseMin) * progress;
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
      // Result card no longer auto-clears — the player must click it to
      // dismiss it (see handleCraftClick). craftShowTimer still drives the
      // bounded pop-in/idle-bob animation in renderResultCard.
      this.craftShowTimer += dt;
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
    for (let i = 0; i < CRAFT_CARD_COUNT; i++) {
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

  /** Reads any cell by flat index: `[main row][secondary row][bag...]`. */
  private cellAt(index: number): Cell | null {
    if (isMainCell(index)) return this.slots[index] ?? null;
    if (index < HOTBAR_CELLS) return this.secondary[index - SLOT_COUNT] ?? null;
    return this.bag[index - HOTBAR_CELLS] ?? null;
  }

  private cellIndexAtPoint(x: number, y: number): number {
    // Both hotbar rows are valid drag sources and drop targets.
    const slot = this.quickSlot.cellIndexAtPoint(x, y);
    if (slot >= 0) return slot;
    if (this.bagAnim > 0.35) return this.bagSlotAtPoint(x, y);
    return -1;
  }

  /**
   * The HUD button stacks sit directly above the dual-row quick-slot bar, so
   * they follow it instead of using fixed offsets from the bottom edge.
   */
  private hudButtonRowY(row: number): number {
    const isMobileLayout = this.isMobile || this.w < 640;
    const mobileOffset = isMobileLayout ? 130 : 0; // lift above joystick
    const bottom = this.h - this.hotbarHeight() - 34 - mobileOffset;
    if (isMobileLayout) {
      return bottom - (2 - row) * 46 - 38;
    } else {
      return bottom - (1 - row) * 46 - 38;
    }
  }

  private hudButtons(): { id: string; rect: Rect; label: string; color: string }[] {
    const isMobileLayout = this.isMobile || this.w < 640;
    const isLandscapePhone = isMobileLayout && this.w > this.h && this.h <= 600;
    const bw = isMobileLayout ? Math.min(100, this.w * 0.22) : Math.min(120, this.w / 8);
    const bh = isMobileLayout ? 44 : 38;
    const invLabel = isMobileLayout ? "Bag" : "Inventory";
    if (isLandscapePhone) {
      const compactW = Math.min(76, (this.w * 0.42 - 12) / 3);
      const compactH = 34;
      const gap = 6;
      const y = 82;
      return [
        { id: "bag", rect: { x: 12, y, w: compactW, h: compactH }, label: invLabel, color: "#3d8bd6" },
        { id: "craft", rect: { x: 12 + compactW + gap, y, w: compactW, h: compactH }, label: "Craft", color: "#c9762b" },
        { id: "menu", rect: { x: 12 + (compactW + gap) * 2, y, w: compactW, h: compactH }, label: "Menu", color: "#8a4d4d" },
      ];
    }
    if (isMobileLayout) {
      return [
        { id: "bag", rect: { x: 16, y: this.hudButtonRowY(0), w: bw, h: bh }, label: invLabel, color: "#3d8bd6" },
        { id: "craft", rect: { x: 16, y: this.hudButtonRowY(1), w: bw, h: bh }, label: "Craft", color: "#c9762b" },
        { id: "menu", rect: { x: 16, y: this.hudButtonRowY(2), w: bw, h: bh }, label: "Menu", color: "#8a4d4d" },
      ];
    } else {
      return [
        { id: "bag", rect: { x: 16, y: this.hudButtonRowY(0), w: bw, h: bh }, label: invLabel, color: "#3d8bd6" },
        { id: "craft", rect: { x: 16, y: this.hudButtonRowY(1), w: bw, h: bh }, label: "Craft", color: "#c9762b" },
        // Settings is a main-menu-only panel: it is deliberately absent from the
        // in-game HUD (neither the button nor the panel is drawn while playing).
        { id: "menu", rect: { x: this.w - 108, y: this.hudButtonRowY(1), w: 92, h: bh }, label: "Menu", color: "#8a4d4d" },
      ];
    }
  }


  // ---------------------------------------------------------------- events
  private sendNeutralInput() {
    if (!this.net || !this.connected || this.scene !== "game") return;
    const w = new Writer(4);
    w.u8(C2S.INPUT).i8(0).i8(0).u8(0);
    this.net.send(w.bytes());
  }

  /** Stop stale movement immediately when the browser backgrounds this tab. */
  private releaseGameplayInput(send = true) {
    this.keys.clear();
    this.mouseDown = false;
    this.mouseDownPointerId = null;
    this.rightDown = false;
    this.mobileSpreadActive = false;
    this.mobileSpreadPointerId = null;
    this.mobileContractActive = false;
    this.mobileContractPointerId = null;
    this.mobileJoystick.active = false;
    this.mobileJoystick.pointerId = null;
    this.mobileJoystick.currX = this.mobileJoystick.centerX;
    this.mobileJoystick.currY = this.mobileJoystick.centerY;
    if (send) this.sendNeutralInput();
  }

  private onWindowBlur = () => {
    this.releaseGameplayInput(true);
  };

  private onVisibilityChange = () => {
    if (document.hidden) {
      this.releaseGameplayInput(true);
      return;
    }
    // requestAnimationFrame pauses in a hidden tab. Do not feed that elapsed
    // wall-clock gap into camera/UI animation when it resumes.
    this.last = performance.now();
    this.inputTimer = 0;
  };

  private onContext = (e: Event) => e.preventDefault();

  private onKeyDown = (e: KeyboardEvent) => {
    // Account panel captures all keyboard input while open.
    if (this.accountSystem.panelOpen && this.accountSystem.handleKeyDown(e)) {
      e.preventDefault();
      return;
    }
    // Achievement panel: Escape closes it in any scene.
    if (this.achievements.panelOpen && e.code === "Escape") {
      this.achievements.panelOpen = false;
      e.preventDefault();
      return;
    }
    // Challenge panel: Escape closes it in any scene.
    if (this.challenges.panelOpen && e.code === "Escape") {
      this.challenges.panelOpen = false;
      e.preventDefault();
      return;
    }
    // Shop panel (menu): Escape closes; redeem/search input captures keys.
    if (this.scene === "menu" && this.shopSystem.visible) {
      if (e.code === "Escape") {
        this.shopSystem.close();
        e.preventDefault();
        return;
      }
      if (this.shopSystem.redeemInputActive) {
        e.preventDefault();
        this.typeIntoRedeem(e.key);
        return;
      }
      if (this.shopSystem.filterSearchActive) {
        e.preventDefault();
        this.typeIntoShopSearch(e.key);
        return;
      }
    }
    if (this.scene === "menu" && this.mobGallery.handleKey(e.key)) {
      e.preventDefault();
      return;
    }
    if (this.scene === "menu" && this.focus) {
      e.preventDefault();
      this.typeInto(e.key);
      return;
    }
    if (this.bagOpen && this.bagSearchActive) {
      e.preventDefault();
      this.typeIntoBagSearch(e.key);
      return;
    }
    if (this.craftOpen && this.craftSearchActive) {
      e.preventDefault();
      this.typeIntoCraftSearch(e.key);
      return;
    }
    // Chat input mode
    if (this.chat.inputActive) {
      e.preventDefault();
      this.typeIntoChat(e.key);
      return;
    }
    // Loadout 面板输入
    if (this.loadoutPanelOpen) {
      if (e.key === "Backspace") {
        this.loadoutInput = this.loadoutInput.slice(0, -1);
        e.preventDefault();
        return;
      } else if (e.key === "Enter") {
        const name = this.loadoutInput.trim() || `Loadout ${this.loadouts.length + 1}`;
        this.sendSaveLoadout(name);
        this.loadoutInput = "";
        e.preventDefault();
        return;
      } else if (e.key.length === 1 && e.key.match(/[a-zA-Z0-9 ]/)) {
        if (this.loadoutInput.length < 16) {
          this.loadoutInput += e.key;
        }
        e.preventDefault();
        return;
      }
      e.preventDefault();
      return;
    }
    // Arena 搜索框键盘输入
    if (this.arenaPanel.panelOpen && this.arenaPanel.state === 'lobby-list') {
      if (e.key === 'Backspace') { this.arenaPanel.handleKeyInput('\b'); e.preventDefault(); return; }
      else if (e.key.length === 1) { this.arenaPanel.handleKeyInput(e.key); e.preventDefault(); return; }
    }
    this.keys.add(e.code);
    if (e.code === "Space" || e.code.startsWith("Shift")) e.preventDefault();
    if (e.code === "KeyE" || e.code === "KeyI") this.toggleBag();
    if (e.code === "KeyC") this.toggleCraft();
    if (this.scene === "game") {
      // Enter toggles chat input
      if (e.code === "Enter") {
        this.chat.inputActive = !this.chat.inputActive;
        this.chat.inputText = "";
        e.preventDefault();
        return;
      }
      if (e.code === "Escape") this.gotoMenu();
      // QuickSlot hotkeys: 'r' swaps both rows at once; the number keys swap a
      // single main slot with its secondary partner.
      if (e.code === "KeyR") {
        this.quickSlot.swapAllSlots();
        e.preventDefault();
      }
      const slotKey = parseInt(e.key, 10);
      if (slotKey >= 1 && slotKey <= SLOT_COUNT) {
        this.quickSlot.swapSlot(slotKey - 1);
        e.preventDefault();
      }
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

  private typeIntoChat(key: string) {
    if (key === "Backspace") {
      this.chat.inputText = this.chat.inputText.slice(0, -1);
    } else if (key === "Enter") {
      const msg = this.chat.sendInput();
      if (msg) {
        this.sendChat(msg);
        // No local echo — the server broadcasts the message back to everyone,
        // including the sender, which is handled in S2C.CHAT.
      }
    } else if (key === "Escape") {
      this.chat.inputActive = false;
      this.chat.inputText = "";
    } else if (key.length === 1 && this.chat.inputText.length < 200) {
      this.chat.inputText += key;
    }
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
    // Changelog 面板内容触摸滚动（手机/桌面通用）。
    if (this.scene === "menu" && this.changelog.touchScrolling) this.changelog.touchMove(p.y);
    if (this.achievements.touchScrolling) this.achievements.touchMove(p.y);
    if (this.challenges.touchScrolling) this.challenges.touchMove(p.y);
    // Shop 面板内容触摸滚动(手机/桌面通用,仅 buy/membership 页签可滚动)。
    if (this.scene === "menu" && this.shopSystem.visible && this.shopSystem.touchScrolling) {
      this.shopSystem.touchMove(p.y, this.w, this.h);
    }
    // Account panel hover tracking (only when open).
    if (this.accountSystem.panelOpen) this.accountSystem.handleMouseMove(p.x, p.y);
    // Mobile joystick handling: if active, clamp current point to radius.
    // Only follow the pointer that originally started the joystick — other
    // touches (e.g. dragging the Spread/Contract buttons on the right) must
    // not move the joystick knob.
    if (this.isMobile && this.mobileJoystick.active && this.mobileJoystick.pointerId === e.pointerId) {
      const dx = p.x - this.mobileJoystick.centerX;
      const dy = p.y - this.mobileJoystick.centerY;
      const dist = Math.hypot(dx, dy);
      const maxDist = this.mobileJoystick.radius;
      if (dist > maxDist) {
        const angle = Math.atan2(dy, dx);
        this.mobileJoystick.currX = this.mobileJoystick.centerX + Math.cos(angle) * maxDist;
        this.mobileJoystick.currY = this.mobileJoystick.centerY + Math.sin(angle) * maxDist;
      } else {
        this.mobileJoystick.currX = p.x;
        this.mobileJoystick.currY = p.y;
      }
    }
    if (this.drag) {
      this.dragX = p.x;
      this.dragY = p.y;
      // 从背包拖卡片到快捷栏时自动隐藏背包,方便看清落点。
      if (
        this.scene === "game" &&
        isBagCell(this.drag.from) &&
        this.bagOpen &&
        this.quickSlot.cellIndexAtPoint(p.x, p.y) >= 0
      ) {
        this.bagOpen = false;
      }
    }
    if (this.bagDraggingThumb) this.dragBagThumb(p.y);
    if (this.craftDraggingThumb) this.dragCraftThumb(p.y);
    if (this.bagTouchScrolling) {
      const layout = this.bagLayout();
      const scale = layout.scale || 1;
      const deltaY = (p.y - this.bagTouchStartY) / scale;
      const maxScroll = this.bagMaxScroll();
      this.bagScrollY = Math.max(0, Math.min(maxScroll, this.bagTouchStartOffset - deltaY));
    }
    if (this.craftTouchScrolling) {
      const layout = this.craftLayout();
      const scale = layout.scale || 1;
      const deltaY = (p.y - this.craftTouchStartY) / scale;
      const maxScroll = this.craftMaxScroll();
      this.craftScrollY = Math.max(0, Math.min(maxScroll, this.craftTouchStartOffset - deltaY));
    }
    // Death drop panel touch scroll
    if (this.deathTouchScrolling) {
      const deltaY = p.y - this.deathTouchStartY;
      this.deathScrollOffset = Math.max(0, Math.min(this.deathMaxScroll, this.deathTouchStartOffset - deltaY));
    }
    if (this.scene === "menu" && this.mobGallery.visible) this.mobGallery.handleMouseMove(p.x, p.y);
    if (this.settings.panelOpen) this.settings.handleMouseMove(p.x, p.y);
    if (this.arenaPanel.panelOpen) this.arenaPanel.handleMouseMove(p.x, p.y);
    // 天赋面板：鼠标 hover 节点提示 + 触摸拖动旋转。
    if (this.talent.isOpen) {
      this.talent.handleMouseMove([p.x, p.y]);
      this.talent.handleTouchMove(p.y);
    }
    this.quickSlot.handleMouseMove(p.x, p.y);
  };

  private onPointerDown = (e: PointerEvent) => {
    const p = this.pointerPos(e);
    this.mx = p.x;
    this.my = p.y;

    // 天赋面板：按下时记录触摸起点（旋转拖拽用），随后由 gameClick/menuClick
    // 的路由把面板内点击交给 talent.handleClick 处理。
    if (this.talent.isOpen) this.talent.handleTouchStart(p.y);

    // Virtual keyboard (mobile) — intercept clicks when active
    if (this.showVirtualKeyboard() && this.vk.active) {
      const vkResult = this.vk.handleClick(p.x, p.y);
      if (vkResult.handled) {
        if (vkResult.key) {
          // Route the key to the active input
          if (this.vk.target === 'bagSearch') {
            this.typeIntoBagSearch(vkResult.key);
          } else if (this.vk.target === 'craftSearch') {
            this.typeIntoCraftSearch(vkResult.key);
          } else if (this.vk.target === 'chat') {
            this.typeIntoChat(vkResult.key);
          } else if (this.vk.target === 'redeem') {
            this.typeIntoRedeem(vkResult.key);
          } else if (this.vk.target === 'shopSearch') {
            this.typeIntoShopSearch(vkResult.key);
          } else if (this.vk.target === 'playerName') {
            this.typeInto(vkResult.key);
          } else if (this.vk.target === 'accountInput') {
            this.accountSystem.handleKeyDownChar(vkResult.key);
          }
        }
        return;
      }
    }

    // The AFK prompt outranks every other pointer target (mobile joystick,
    // panels, action buttons), which would otherwise swallow the touch.
    // Applies in both scenes — the main page also runs AFK checks while
    // connected, so the prompt must stay clickable there too.
    if (this.afkPending || this.afkKicked) {
      if (e.button === 2) return;
      if (this.scene === "game") this.gameClick(p.x, p.y, e.shiftKey);
      else this.menuClick(p.x, p.y);
      return;
    }
    // Account panel: intercept the press (scrollbar drag or click).
    if (this.accountSystem.panelOpen) {
      if (this.accountSystem.handleMouseDown(p.x, p.y)) return;
      if (this.accountSystem.handleClick(p.x, p.y)) return;
    }
    // Mobile: clicking the chatbox triggers the keyboard (check BEFORE joystick)
    if (this.showVirtualKeyboard() && this.scene === "game" && this.bagAnim < 0.2 && this.craftAnim < 0.2) {
      const chatLift = this.isMobile || this.w < 640 ? 76 : 50;
      const chatScreenHeight = this.h - this.hotbarHeight() + chatLift;
      if (this.chat.handleClick(p.x, p.y, chatScreenHeight)) {
        this.vk.active = true;
        this.vk.target = 'chat';
        this.vk.numMode = false;
        return;
      }
    }

    // Death screen buttons (Respawn / Main menu) outrank the mobile joystick
    // and action buttons. The joystick's "start from any bottom-left touch"
    // fallback would otherwise swallow taps that land on the Respawn button
    // when it overlaps the joystick region, leaving the player unable to
    // respawn. Route the press straight to gameClick so the buttons win.
    if (this.scene === "game" && !this.alive) {
      if (e.button === 2) return;
      this.gameClick(p.x, p.y, e.shiftKey);
      return;
    }

    // Mobile controls: spread (Space) / contract (Shift) / joystick
    if (this.isMobile) {
      if (this.scene === "menu" && this.mobileTipIgnoreBtn && hit(this.mobileTipIgnoreBtn, p.x, p.y)) {
        this.phoneTipIgnored = true;
        try { localStorage.setItem(PHONE_TIP_IGNORED_KEY, "1"); } catch { /* ignore */ }
        this.mobileTipIgnoreBtn = null;
        return;
      }
      if (this.scene === "menu" && this.mobileFullscreenBtn && hit(this.mobileFullscreenBtn, p.x, p.y)) {
        this.tryEnterFullscreen();
        return;
      }
      if (this.scene === "game" && this.bagAnim < 0.2 && this.craftAnim < 0.2) {
        if (this.mobileSpreadRect && hit(this.mobileSpreadRect, p.x, p.y)) {
          this.mobileSpreadActive = true;
          this.mobileSpreadPointerId = e.pointerId;
          this.lastTouchTime = performance.now();
          if (e.cancelable) e.preventDefault();
          return;
        }
        if (this.mobileContractRect && hit(this.mobileContractRect, p.x, p.y)) {
          this.mobileContractActive = true;
          this.mobileContractPointerId = e.pointerId;
          this.lastTouchTime = performance.now();
          if (e.cancelable) e.preventDefault();
          return;
        }
        if (this.mobileJoystickRect && hit(this.mobileJoystickRect, p.x, p.y)) {
          this.mobileJoystick.active = true;
          this.mobileJoystick.pointerId = e.pointerId;
          this.mobileJoystick.currX = p.x;
          this.mobileJoystick.currY = p.y;
          this.lastTouchTime = performance.now();
          // NOTE: do NOT call setPointerCapture here.  On several mobile
          // browsers capturing one pointer can cause the browser to fire
          // pointercancel (or even a stray pointerup with the wrong id)
          // for OTHER active pointers — which would silently release the
          // Spread/Defend button the player is still holding.  We don't
          // need capture anyway: pointermove/pointerup are already bound
          // on `window`, so the joystick keeps tracking the finger even
          // when it slides off the canvas.
          if (e.cancelable) e.preventDefault();
          return;
        }
        // Check if the touch hits any HUD button or Map button first!
        let hitHud = false;
        for (const b of this.hudButtons()) {
          if (hit(b.rect, p.x, p.y)) {
            hitHud = true;
            break;
          }
        }
        // Prevent the joystick fallback from swallowing touches inside the
        // bag panel so mobile players can always drag items from inventory.
        if (this.bagOpen && this.bagAnim > 0.35) {
          const bagRect = this.bagPanelRect();
          if (hit(bagRect, p.x, p.y)) { hitHud = true; }
        }
        if (!hitHud) {
          // Allow starting joystick from any left-bottom touch as fallback
          if (p.x < this.w * 0.45 && p.y > this.h * 0.35) {
            this.mobileJoystick.active = true;
            this.mobileJoystick.pointerId = e.pointerId;
            this.mobileJoystick.centerX = p.x;
            this.mobileJoystick.centerY = p.y;
            this.mobileJoystick.currX = p.x;
            this.mobileJoystick.currY = p.y;
            this.lastTouchTime = performance.now();
            // No setPointerCapture — see comment in the rect-hit branch above.
            if (e.cancelable) e.preventDefault();
            return;
          }
        }
      }
    }
    if (e.button === 2) {
      this.rightDown = true;
      return;
    }
    this.mouseDown = true;
    this.mouseDownPointerId = e.pointerId;
    if (this.scene === "menu") {
      // Changelog 面板内容触摸滚动：按下面板内部（非 ✕）进入滚动状态，
      // 不再走 menuClick，因此点击面板不会关闭它。
      if (
        !this.mobGallery.visible &&
        !this.settings.panelOpen &&
        !this.accountSystem.panelOpen &&
        !this.achievements.panelOpen &&
        !this.challenges.panelOpen &&
        !this.shopSystem.visible &&
        this.changelog.beginTouch(p.x, p.y, this.w, this.h)
      ) return;
      this.menuClick(p.x, p.y);
    } else this.gameClick(p.x, p.y, e.shiftKey);
  };

  /**
   * Shared cleanup for one pointer lifting or being cancelled.
   *
   * Each mobile control (spread, contract, joystick) is only released by the
   * SAME pointer id that originally pressed it — a different finger lifting
   * must never cancel a still-held button.  `mouseDown` is likewise only
   * cleared by its owning pointer.  This is the core rule that keeps the
   * joystick and the Spread/Defend buttons fully independent on multi-touch
   * screens.
   */
  private releaseMobilePointer(e: PointerEvent) {
    if (this.mobileSpreadPointerId !== null && this.mobileSpreadPointerId === e.pointerId) {
      this.mobileSpreadActive = false;
      this.mobileSpreadPointerId = null;
    }
    if (this.mobileContractPointerId !== null && this.mobileContractPointerId === e.pointerId) {
      this.mobileContractActive = false;
      this.mobileContractPointerId = null;
    }
    if (
      this.mobileJoystick.active &&
      (this.mobileJoystick.pointerId === null || this.mobileJoystick.pointerId === e.pointerId)
    ) {
      this.mobileJoystick.active = false;
      this.mobileJoystick.currX = this.mobileJoystick.centerX;
      this.mobileJoystick.currY = this.mobileJoystick.centerY;
      this.mobileJoystick.pointerId = null;
    }
    // Only clear mouseDown for the finger that owns it.  Without this guard,
    // lifting the joystick finger would also clear a game-world press held
    // by a different finger.
    if (this.mouseDownPointerId !== null && this.mouseDownPointerId === e.pointerId) {
      this.mouseDown = false;
      this.mouseDownPointerId = null;
    }
  }

  private onPointerUp = (e: PointerEvent) => {
    // Account panel: release any scrollbar drag.
    if (this.accountSystem.panelOpen) this.accountSystem.handleMouseUp();
    // Release mobile touch buttons (spread / contract / joystick) — each
    // only by its own finger.
    if (this.isMobile) this.releaseMobilePointer(e);
    if (e.button === 2) {
      this.rightDown = false;
      return;
    }
    // On desktop (no touch) mouseDown was set by this same pointer, so the
    // releaseMobilePointer guard above already cleared it.  On touch screens
    // mouseDown is usually not set for control taps, so this is a no-op
    // safety net for the desktop path.
    if (!this.isMobile) {
      this.mouseDown = false;
      this.mouseDownPointerId = null;
    }
    this.bagDraggingThumb = false;
    this.craftDraggingThumb = false;
    this.changelog.endTouch();
    this.achievements.endTouch();
    this.challenges.endTouch();
    this.shopSystem.endTouch();
    this.mobGallery.handleMouseUp();
    this.talent.handleTouchEnd();
    if (this.settings.panelOpen) this.settings.handleMouseUp();
    this.bagTouchScrolling = false;
    this.craftTouchScrolling = false;
    this.deathTouchScrolling = false;
    if (this.drag) this.dropDrag(this.mx, this.my);
  };

  /**
   * pointercancel handler — the browser fires this (instead of pointerup)
   * when it aborts a touch mid-stream: system gesture, too many simultaneous
   * touches, tab switch, etc.  We must run the exact same per-pointer cleanup
   * so a cancelled finger doesn't leave its control stuck on.
   */
  private onPointerCancel = (e: PointerEvent) => {
    if (this.isMobile) this.releaseMobilePointer(e);
  };

  private onWheel = (e: WheelEvent) => {
    // Account panel: scroll the profile stats grid.
    if (this.accountSystem.panelOpen && this.accountSystem.handleWheel(e.deltaY)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Achievement panel: scroll the achievement grid (only while the cursor
    // is over the panel so the wheel keeps working elsewhere).
    if (this.achievements.panelOpen && this.achievements.panelContains(this.mx, this.my)) {
      e.preventDefault();
      e.stopPropagation();
      this.achievements.handleScroll(e.deltaY);
      return;
    }
    // Challenge panel: scroll the quest list (same cursor-over-panel rule).
    if (this.challenges.panelOpen && this.challenges.panelContains(this.mx, this.my)) {
      e.preventDefault();
      e.stopPropagation();
      this.challenges.handleScroll(e.deltaY);
      return;
    }
    // 天赋面板：滚轮旋转天赋树（光标在面板内时）。
    if (this.talent.isOpen && this.talent.contains(this.mx, this.my)) {
      e.preventDefault();
      e.stopPropagation();
      this.talent.handleScroll(e.deltaY);
      return;
    }
    // Shop panel (menu): scroll the active tab (only while the cursor is
    // over the panel so the wheel keeps working elsewhere).
    if (this.scene === "menu" && this.shopSystem.visible) {
      const shopR = this.shopSystem.screenRect();
      if (shopR && this.mx >= shopR.x && this.mx <= shopR.x + shopR.w && this.my >= shopR.y && this.my <= shopR.y + shopR.h) {
        e.preventDefault();
        e.stopPropagation();
        this.shopSystem.handleWheel(e.deltaY, this.w, this.h);
        return;
      }
    }
    if (this.scene === "menu" && this.changelog.visible) {
      this.changelog.handleWheel(e.deltaY);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (this.scene === "menu" && this.mobGallery.handleWheel(e.deltaY)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (this.settings.panelOpen && this.settings.panelRect) {
      const [px, py, pw, ph] = this.settings.panelRect;
      if (this.mx >= px && this.mx <= px + pw && this.my >= py && this.my <= py + ph) {
        e.preventDefault();
        e.stopPropagation();
        this.settings.handleWheel(e.deltaY);
        return;
      }
    }

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

    // Death drop panel scroll
    if (this.scene === "game" && !this.alive) {
      if (hit(this.deathPanelRect, this.mx, this.my)) {
        e.preventDefault();
        const contentH = this.deathContentRect.h || 1;
        this.deathScrollOffset += scrollAmount(contentH);
        this.deathScrollOffset = Math.max(0, Math.min(this.deathMaxScroll, this.deathScrollOffset));
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

  // Floating petals for menu animation
  private menuPetals: { x: number; y: number; size: number; speedX: number; speedY: number; rotation: number; rotationSpeed: number; opacity: number }[] = [];
  private menuBgColor: [number, number, number] = [26, 26, 46];
  private menuTargetBgColor: [number, number, number] = [26, 26, 46];
  private menuHoveredButton: string | null = null;
  /** 主菜单瞬态提示（"Coming soon" 等），到期自动消失。 */
  private menuToast: { text: string; until: number } | null = null;

  /** 主菜单瞬态提示（"Coming soon" 等），到期自动消失。挑战任务领奖也复用此提示。 */
  public showMenuToast(text: string) {
    this.menuToast = { text, until: this.time + 1.4 };
  }

  // ── Bonus 面板（_drawBonusPanel）状态，参考 MainMenu ──
  /** 面板矩形（右上角），每帧在 renderMenu 中重算。 */
  private extraBonusButton: number[] = [0, 0, 180, 165];
  /** Extra Bonus 尚未实现：保持默认未激活（面板显示 inactive，点击 → Coming soon）。 */
  private extraBonusActive = false;
  private extraBonusExpireTime = 0;
  private extraBonusPermanent = false;
  private rubyMembershipActive = false;
  private _bonusClaimRect: number[] | null = null;
  private _bonusExtraRect: number[] | null = null;
  /** 面板/按钮 hover 状态（'bonus_claim' / 'bonus_extra'）。 */
  private hoveredButton: string | null = null;

  /** 命中检测（数组形式矩形 [x,y,w,h]）。 */
  private hitArr(r: number[] | null, mx: number, my: number): boolean {
    if (!r) return false;
    return mx >= r[0] && mx <= r[0] + r[2] && my >= r[1] && my <= r[1] + r[3];
  }

  /** 描边文字（GameClient 实例方法，供主菜单面板使用）。 */
  private drawStrokedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fontSize: number, textAlign: CanvasTextAlign = "center", fillColor: string = "white") {
    ctx.save();
    ctx.font = ` ${fontSize}px ${FONT_FAMILY}`;
    ctx.textAlign = textAlign; ctx.textBaseline = "middle";
    ctx.strokeStyle = "black"; ctx.lineWidth = 3; ctx.lineJoin = "round";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fillColor; ctx.fillText(text, x, y);
    ctx.restore();
  }

  // Biome colors for the 3 maps
  private BIOME_COLORS: Record<string, [number, number, number]> = {
    "Garden": [102, 187, 106],
    "Desert": [255, 202, 128],
    "Ocean": [64, 164, 223],
  };

  private BIOME_HOVER_COLORS: Record<string, [number, number, number]> = {
    "Garden": [67, 160, 71],
    "Desert": [255, 167, 38],
    "Ocean": [0, 105, 148],
  };

  private BIOME_BG_COLORS: Record<string, [number, number, number]> = {
    "Garden": [36, 80, 36],
    "Desert": [90, 70, 20],
    "Ocean": [20, 50, 100],
  };

  private initMenuPetals() {
    this.menuPetals = [];
    for (let i = 0; i < 20; i++) {
      this.menuPetals.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        size: 50 + Math.random() * 40,
        speedX: 20 + Math.random() * 35,
        speedY: 5 + Math.random() * 12,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 1.5,
        opacity: 0.35 + Math.random() * 0.4,
      });
    }
  }

  private updateMenuPetals(dt: number) {
    for (const p of this.menuPetals) {
      p.x += p.speedX * dt;
      p.y += p.speedY * dt;
      p.rotation += p.rotationSpeed * dt;

      if (p.x > this.w + p.size) {
        p.x = -p.size;
        p.y = Math.random() * this.h;
      }
      if (p.y > this.h + p.size) p.y = -p.size;
      else if (p.y < -p.size) p.y = this.h + p.size;
    }
  }

  private updateMenuBgColor(dt: number) {
    for (let i = 0; i < 3; i++) {
      const diff = this.menuTargetBgColor[i] - this.menuBgColor[i];
      if (Math.abs(diff) > 0.1) {
        this.menuBgColor[i] += diff * 2.5 * dt;
      }
    }
  }

  private drawMenuGrid(ctx: CanvasRenderingContext2D, r: number, g: number, b: number) {
    const cell = 48;
    const lr = Math.min(255, r + 18);
    const lg = Math.min(255, g + 18);
    const lb = Math.min(255, b + 18);

    ctx.save();
    ctx.strokeStyle = `rgba(${lr},${lg},${lb},0.40)`;
    ctx.lineWidth = 1;

    for (let x = 0; x <= this.w; x += cell) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.h);
      ctx.stroke();
    }
    for (let y = 0; y <= this.h; y += cell) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.w, y);
      ctx.stroke();
    }

    ctx.fillStyle = `rgba(${lr},${lg},${lb},0.28)`;
    for (let x = 0; x <= this.w; x += cell) {
      for (let y = 0; y <= this.h; y += cell) {
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawMenuPetal(ctx: CanvasRenderingContext2D, petal: typeof this.menuPetals[0]) {
    ctx.save();
    ctx.globalAlpha = petal.opacity;
    ctx.translate(petal.x, petal.y);
    ctx.rotate(petal.rotation);

    // Draw a simple petal shape
    const s = petal.size / 2;
    ctx.fillStyle = `rgba(${this.menuBgColor[0] + 40}, ${this.menuBgColor[1] + 40}, ${this.menuBgColor[2] + 40}, 1)`;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.3, s * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * 顶部栏按钮图标（参考 MainMenu._drawTopBtnIcon）：白色矢量图标居中。
   */
  private _drawTopBtnIcon(ctx: CanvasRenderingContext2D, key: string, rect: { x: number; y: number; w: number; h: number }) {
    const x = rect.x, y = rect.y, w = rect.w, h = rect.h;
    const cx = x + w / 2, cy = y + h / 2;
    const s  = Math.min(w, h) * 0.32;
    ctx.save();
    ctx.strokeStyle = 'white';
    ctx.fillStyle   = 'white';
    ctx.lineWidth   = Math.max(1.5, s * 0.18);
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    switch (key) {
      // Account: circle head + shoulder arc
      case 'account': {
        ctx.beginPath(); ctx.arc(cx, cy - s * 0.5, s * 0.3, 0, Math.PI * 2); ctx.stroke();ctx.fill();
        ctx.beginPath(); ctx.arc(cx, cy + s * 0.8, s * 0.65, 0, Math.PI, true);ctx.closePath();ctx.fill(); ctx.stroke();
        break;
      }
      // Shop: 小房子（屋顶 + 波浪雨棚 + 房体）
      case 'shop': {
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.75, cy - s * 0.15);
        ctx.lineTo(cx - s * 0.55, cy - s * 0.75);
        ctx.lineTo(cx + s * 0.55, cy - s * 0.75);
        ctx.lineTo(cx + s * 0.75, cy - s * 0.15);
        // wavy awning
        ctx.quadraticCurveTo(cx + s * 0.55, cy + s * 0.10, cx + s * 0.35, cy);
        ctx.quadraticCurveTo(cx + s * 0.15, cy + s * 0.18, cx, cy);
        ctx.quadraticCurveTo(cx - s * 0.15, cy + s * 0.18, cx - s * 0.35, cy);
        ctx.quadraticCurveTo(cx - s * 0.55, cy + s * 0.10, cx - s * 0.75, cy - s * 0.15);
        ctx.closePath();
        ctx.fill();
        // building body
        ctx.fillRect(cx - s * 0.45, cy, s * 0.90, s * 0.75);
        break;
      }
      // Hunt: crosshair
      case 'hunting_quest': {
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.65, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.22, 0, Math.PI * 2); ctx.stroke();
        [[0, -1],[0, 1],[-1, 0],[1, 0]].forEach(([dx, dy]) => {
          ctx.beginPath();
          ctx.moveTo(cx + dx * s * 0.32, cy + dy * s * 0.32);
          ctx.lineTo(cx + dx * s * 0.72, cy + dy * s * 0.72);
          ctx.stroke();
        });
        break;
      }
      // Talent: 4-pointed star
      case 'talent': {
        const k = 0.8;
        ctx.beginPath();
        ctx.moveTo(cx, cy - s * k);
        ctx.lineTo(cx + s * 0.3 * k, cy - s * 0.3 * k);
        ctx.lineTo(cx + s * k, cy);
        ctx.lineTo(cx + s * 0.3 * k, cy + s * 0.3 * k);
        ctx.lineTo(cx, cy + s * k);
        ctx.lineTo(cx - s * 0.3 * k, cy + s * 0.3 * k);
        ctx.lineTo(cx - s * k, cy);
        ctx.lineTo(cx - s * 0.3 * k, cy - s * 0.3 * k);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
        break;
      }
      // Gallery: paw (large pad + 3 toe pads)
      case 'mob_gallery': {
        ctx.beginPath(); ctx.arc(cx, cy + s * 0.35, s * 0.42, 0, Math.PI * 2); ctx.stroke();ctx.fill();
        [[-s * 0.52, -s * 0.4],[0, -s * 0.58],[s * 0.52, -s * 0.38]].forEach(([dx, dy]) => {
          ctx.beginPath(); ctx.arc(cx + dx, cy + dy, s * 0.25, 0, Math.PI * 2); ctx.fill();
        });
        break;
      }
      // Achievement: trophy cup
      case 'achievement': {
        const tw = s * 0.7, th = s * 0.8, tx = cx - tw / 2, ty = cy - th * 0.8;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + tw, ty);
        ctx.lineTo(tx + tw * 0.78, ty + th);
        ctx.lineTo(tx + tw * 0.22, ty + th);
        ctx.closePath(); ctx.stroke();ctx.fill();
        ctx.beginPath(); ctx.arc(tx, ty + th * 0.4, s * 0.25, Math.PI * 1.5, Math.PI * 0.5, true); ctx.stroke();
        ctx.beginPath(); ctx.arc(tx + tw, ty + th * 0.4, s * 0.25, Math.PI * 1.5, Math.PI * 0.5, false); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, ty + th); ctx.lineTo(cx, cy + s * 0.58); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - s * 0.4, cy + s * 0.58); ctx.lineTo(cx + s * 0.4, cy + s * 0.58); ctx.stroke();
        break;
      }
      // Settings: gear (16-tooth star + center hole)
      case 'settings': {
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const r = (i % 2 === 0) ? s * 0.80 : s * 0.60;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        // center hole
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.18, 0, Math.PI * 2);
        ctx.fillStyle = "#444";
        ctx.fill();
        break;
      }
      // Changelog: document with 3 lines
      case 'changelog': {
        const dw = s, dh = s * 1.35, dx = cx - dw / 2, dy = cy - dh / 2;
        ctx.beginPath(); ctx.roundRect(dx, dy, dw, dh, s * 0.12); ctx.stroke();
        [0.25, 0.5, 0.75].forEach(t => {
          ctx.beginPath();
          ctx.moveTo(dx + dw * 0.18, dy + dh * t);
          ctx.lineTo(dx + dw * 0.82, dy + dh * t);
          ctx.stroke();
        });
        break;
      }
      // Arena: crossed swords
      case 'arena': {
        // Left sword
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.15, cy - s * 0.85);
        ctx.lineTo(cx - s * 0.45, cy - s * 0.55);
        ctx.lineTo(cx - s * 0.10, cy - s * 0.20);
        ctx.moveTo(cx - s * 0.15, cy - s * 0.85);
        ctx.lineTo(cx - s * 0.05, cy - s * 0.95);
        ctx.lineTo(cx + s * 0.05, cy - s * 0.85);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Right sword
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.15, cy - s * 0.85);
        ctx.lineTo(cx + s * 0.45, cy - s * 0.55);
        ctx.lineTo(cx + s * 0.10, cy - s * 0.20);
        ctx.moveTo(cx + s * 0.15, cy - s * 0.85);
        ctx.lineTo(cx + s * 0.05, cy - s * 0.95);
        ctx.lineTo(cx - s * 0.05, cy - s * 0.85);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Shield
        ctx.beginPath();
        ctx.arc(cx, cy + s * 0.15, s * 0.35, Math.PI * 0.1, Math.PI * 0.9);
        ctx.lineTo(cx, cy + s * 0.70);
        ctx.closePath();
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  /**
   * 左侧栏按钮（参考 MainMenu._drawLeftBtnIcon）：图标居左 + 快捷键标签靠右。
   */
  private _drawLeftBtnIcon(ctx: CanvasRenderingContext2D, key: string, rect: { x: number; y: number; w: number; h: number }) {
    const x = rect.x, y = rect.y, w = rect.w, h = rect.h;
    const cx = x + w * 0.35; // icon positioned left side
    const cy = y + h / 2;
    const s  = h * 0.45;
    const labelX = x + w - 15;
    const labelY = y + h / 2;

    ctx.save();
    ctx.strokeStyle = 'white';
    ctx.fillStyle   = 'white';
    ctx.lineWidth   = Math.max(1.5, s * 0.22);
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    switch (key) {
      case 'inventory': {
        // --- Bag Top (Crown/Frill) ---
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.32, cy - s * 0.604);
        ctx.bezierCurveTo(cx - s * 0.244, cy - s * 0.564, cx - s * 0.204, cy - s * 0.564, cx - s * 0.128, cy - s * 0.624);
        ctx.bezierCurveTo(cx - s * 0.064, cy - s * 0.564, cx + s * 0.064, cy - s * 0.564, cx + s * 0.128, cy - s * 0.624);
        ctx.bezierCurveTo(cx + s * 0.204, cy - s * 0.564, cx + s * 0.244, cy - s * 0.564, cx + s * 0.32, cy - s * 0.604);
        ctx.lineTo(cx + s * 0.224, cy - s * 0.384);
        ctx.lineTo(cx - s * 0.224, cy - s * 0.384);
        ctx.closePath();
        ctx.fill();
        // --- Bag Neck (The collar/tie) ---
        ctx.beginPath();
        ctx.roundRect(cx - s * 0.264, cy - s * 0.356, s * 0.528, s * 0.072, s * 0.036);
        ctx.fill();
        // --- Bag Main Body ---
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.184, cy - s * 0.244);
        ctx.bezierCurveTo(cx - s * 0.464, cy - s * 0.064, cx - s * 0.704, cy + s * 0.336, cx - s * 0.464, cy + s * 0.656);
        ctx.bezierCurveTo(cx - s * 0.304, cy + s * 0.836, cx + s * 0.304, cy + s * 0.836, cx + s * 0.464, cy + s * 0.656);
        ctx.bezierCurveTo(cx + s * 0.704, cy + s * 0.336, cx + s * 0.464, cy - s * 0.064, cx + s * 0.184, cy - s * 0.244);
        ctx.closePath();
        ctx.fill();
        break;
      }
      // Crafting: 分子/原子（带间隙的圆，离屏图层实现）
      case 'crafting': {
        const pad = s * 1.4;
        const layer = document.createElement('canvas');
        layer.width = Math.ceil(pad * 2);
        layer.height = Math.ceil(pad * 2);
        const lctx = layer.getContext('2d');
        if (!lctx) break;
        const gap = s * 0.05;
        const drawAtomWithGap = (atomX: number, atomY: number, atomRadius: number) => {
          lctx.save();
          lctx.fillStyle = '#FFFFFF';
          lctx.globalCompositeOperation = 'destination-out';
          lctx.beginPath();
          lctx.arc(atomX - cx + pad, atomY - cy + pad, atomRadius + gap, 0, Math.PI * 2);
          lctx.fill();
          lctx.restore();
          lctx.beginPath();
          lctx.arc(atomX - cx + pad, atomY - cy + pad, atomRadius, 0, Math.PI * 2);
          lctx.fill();
        };
        drawAtomWithGap(cx - s * 0.1, cy - s * 0.42, s * 0.29);
        drawAtomWithGap(cx - s * 0.4, cy + s * 0.2, s * 0.26);
        drawAtomWithGap(cx - s * 0.04, cy - s * 0.04, s * 0.4);
        drawAtomWithGap(cx + s * 0.39, cy + s * 0.05, s * 0.27);
        ctx.drawImage(layer, cx - pad, cy - pad);
        break;
      }
    }

    // Draw label text (keyboard shortcut hint)
    let label = '';
    if (key === 'inventory') label = '[I]';
    else if (key === 'crafting') label = '[C]';

    ctx.font = `bold ${Math.floor(h * 0.34)}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2;
    ctx.strokeText(label, labelX, labelY);
    ctx.fillStyle = 'white';
    ctx.fillText(label, labelX, labelY);

    ctx.restore();
  }

  private menuLayout() {
    // Mobile responsive: single column on phone, 3 columns on desktop
    const isMobileLayout = this.isMobile || this.w < 640;
    const COLS = isMobileLayout ? 3 : 3;
    const BIOME_W = isMobileLayout ? Math.min(105, (this.w - 32) / 3) : 180;
    const BIOME_H = isMobileLayout ? 38 : 45;
    const BIOME_GAP = isMobileLayout ? 6 : 15;

    const gridW = COLS * BIOME_W + (COLS - 1) * BIOME_GAP;
    const gridX = this.w / 2 - gridW / 2;
    const gridY = isMobileLayout ? (this.h * 0.35) : (this.h / 2 - 80);

    return { gridX, gridY, gridW, BIOME_W, BIOME_H, BIOME_GAP, COLS };
  }

  /** Rects for biome buttons in grid layout */
  private menuBiomeButtons() {
    const layout = this.menuLayout();
    const buttons: Record<number, { x: number; y: number; w: number; h: number }> = {};

    const COLS = layout.COLS;
    const totalRows = Math.ceil(MAPS.length / COLS);

    MAPS.forEach((map, i) => {
      const row = Math.floor(i / COLS);
      const itemsInRow = row === totalRows - 1 ? MAPS.length - row * COLS : COLS;
      const rowOffset = (COLS - itemsInRow) * (layout.BIOME_W + layout.BIOME_GAP) / 2;
      const col = i % COLS;

      buttons[map.id] = {
        x: layout.gridX + rowOffset + col * (layout.BIOME_W + layout.BIOME_GAP),
        y: layout.gridY + row * (layout.BIOME_H + layout.BIOME_GAP),
        w: layout.BIOME_W,
        h: layout.BIOME_H,
      };
    });

    return buttons;
  }

  /**
   * Rects for the main-menu actions — 排版参考 MainMenu：
   *  - 顶部栏：Account / Shop / Hunting Quest / Talent / Mob Gallery /
   *    Achievement / Settings / Changelog（圆角正方形图标）
   *  - 左侧栏：Inventory / Crafting / Bonus（宽按钮：图标居左 + 快捷键标签）
   * 手机端：顶部栏两行四列（网格上方），左侧栏一行三个（底部）。
   */
  private menuActionRects() {
    const W = this.w;
    const H = this.h;
    const buttons: Record<string, { x: number; y: number; w: number; h: number }> = {};
    const isMobileLayout = this.isMobile || W < 640;

    // 顶部栏 8 个图标按钮：全部移到左上角（桌面/手机同一布局，
    // 手机端按钮自动缩小以适应宽度，无需单独分支）。
    const topOrder = ['top_account', 'top_shop', 'top_hunting_quest', 'top_talent', 'top_mob_gallery', 'top_achievement', 'top_arena', 'top_settings', 'top_changelog'];
    const TOP_GAP = 8;
    const topSize = Math.max(32, Math.min(44, (W - 16 - TOP_GAP * (topOrder.length - 1)) / topOrder.length));
    topOrder.forEach((key, i) => {
      buttons[key] = { x: 10 + i * (topSize + TOP_GAP), y: 10, w: topSize, h: topSize };
    });

    // 侧栏（已删除 Multiplayer / Bonus，Bonus 改为常驻面板）：
    // Inventory / Crafting，宽按钮布局以容纳"图标居左 + 快捷键标签靠右"。
    const leftOrder = ['left_inventory', 'left_craft'];
    if (isMobileLayout) {
      // Phone: one compact row of two at the bottom.
      const BTN_W = Math.min(104, (W - 16) / 2);
      const BTN_H = 42;
      const GAP = 6;
      const totalW = BTN_W * 2 + GAP;
      const startX = (W - totalW) / 2;
      const y = H - BTN_H - 12;
      leftOrder.forEach((key, i) => {
        buttons[key] = { x: startX + i * (BTN_W + GAP), y, w: BTN_W, h: BTN_H };
      });
    } else {
      // Desktop: left sidebar (reference MainMenu layout).
      const LEFT_X = 14;
      const LEFT_W = 118;
      const LEFT_H = 46;
      const LEFT_GAP = 10;
      const leftMidY = H / 2 - (LEFT_H * leftOrder.length + LEFT_GAP * (leftOrder.length - 1)) / 2;
      leftOrder.forEach((key, i) => {
        buttons[key] = { x: LEFT_X, y: leftMidY + i * (LEFT_H + LEFT_GAP), w: LEFT_W, h: LEFT_H };
      });
    }

    return buttons;
  }

  private menuClick(mx: number, my: number) {
    // 主页面同样响应 AFK 检测:模态提示优先于一切面板/按钮。
    if (this.afkPending) {
      if (hit(this.afkButtonRect(), mx, my)) this.sendAfkAck();
      return;
    }
    if (this.afkKicked) {
      // 主页面被 AFK 踢出 → 重新连接服务器。
      this.afkKicked = false;
      this.afkPending = false;
      this.afkAnim = 0;
      this.afkSecondsLeft = 0;
      this.afkSmoothSeconds = 0;
      this.connect();
      return;
    }
    // Arena 面板：面板打开时截获点击
    if (this.arenaPanel.panelOpen && this.arenaPanel.handleClick(mx, my)) {
      return;
    }

    // Bonus 面板常驻主菜单：面板区域内的点击一律由面板处理并吞掉，
    // 不会穿透到下方的按钮（防止点开其它面板）。
    // 其它模态面板（画廊/日志/账号/设置/背包/合成）打开时不触发 bonus。
    if (!this.mobGallery.visible && !this.changelog.visible && !this.accountSystem.panelOpen && !this.settings.panelOpen && !this.achievements.panelOpen && !this.challenges.panelOpen && !this.shopSystem.visible && this.bagAnim < 0.4 && this.craftAnim < 0.4) {
      if (this.hitArr(this.extraBonusButton, mx, my)) {
        if (this.hitArr(this._bonusClaimRect, mx, my)) {
          if (this.bonus.canClaim() && this.bonus.claim()) this.sendBonusStatus();
        } else if (this.hitArr(this._bonusExtraRect, mx, my)) {
          this.showMenuToast('Coming soon');
        }
        return;
      }
    }

    // 模态面板打开时严格拦截，不穿透到主菜单
    // 天赋面板：点击面板内由面板处理；点击面板外关闭（同成就/挑战面板模式）。
    if (this.talent.isOpen) {
      if (this.talent.handleClick([mx, my])) return;
      this.talent.close();
      return;
    }
    if (this.accountSystem.panelOpen) {
      this.accountSystem.handleClick(mx, my);
      return;
    }
    if (this.settings.panelOpen) {
      this.settings.handleClick(mx, my);
      return;
    }
    if (this.achievements.panelOpen) {
      if (this.achievements.beginTouch(mx, my)) return;
      if (this.achievements.handleClick(mx, my)) return;
      this.achievements.panelOpen = false;
      return;
    }
    if (this.challenges.panelOpen) {
      if (this.challenges.beginTouch(mx, my)) return;
      if (this.challenges.handleClick(mx, my)) return;
      this.challenges.panelOpen = false;
      return;
    }
    if (this.shopSystem.visible) {
      // 手机端：面板内按下先进入内容滚动(避开按钮/输入框),否则走点击。
      if (this.shopSystem.beginTouch(mx, my, this.w, this.h)) return;
      if (this.shopSystem.handleClick(mx, my, this.w, this.h)) {
        // 手机端：点击搜索框/兑换输入框时唤起虚拟键盘
        if (this.showVirtualKeyboard() && (this.shopSystem.filterSearchActive || this.shopSystem.redeemInputActive)) {
          this.vk.active = true;
          this.vk.target = this.shopSystem.filterSearchActive ? 'shopSearch' : 'redeem';
          this.vk.numMode = false;
        }
      }
      return;
    }
    if (this.mobGallery.visible) {
      if (this.mobGallery.handleClick(mx, my)) return;
      this.mobGallery.close();
      return;
    }
    if (this.changelog.visible) {
      this.changelog.handleClick(mx, my, this.w, this.h);
      return;
    }
    // 主页面快捷栏:命中快捷栏卡片 → 直接开始拖拽(与游戏内一致)。
    // 支持拖动/替换快捷栏物品;背包打开时快捷栏位于其下方(已预留高度),
    // 按下快捷栏卡片不会关闭背包。
    const menuHotbarIdx = this.cellIndexAtPoint(mx, my);
    if (menuHotbarIdx >= 0 && !isBagCell(menuHotbarIdx)) {
      const hotbarCell = this.cellAt(menuHotbarIdx);
      if (hotbarCell) {
        this.drag = { from: menuHotbarIdx, cell: hotbarCell };
        this.dragX = mx;
        this.dragY = my;
        return;
      }
    }
    if (this.bagAnim > 0.4) {
      if (this.handleBagClick(mx, my)) return;
      this.bagOpen = false;
      return;
    }
    if (this.craftAnim > 0.4) {
      if (this.handleCraftClick(mx, my)) return;
      this.craftOpen = false;
      return;
    }

    // Action buttons (top bar and left sidebar)
    const actions = this.menuActionRects();

    // ── Top bar（参考 MainMenu 布局）──
    if (actions.top_mob_gallery && hit(actions.top_mob_gallery, mx, my)) {
      if (this.mobGallery.visible) {
        this.mobGallery.close();
      } else {
        this.focus = null;
        this.bagOpen = false;
        this.craftOpen = false;
        this.settings.close();
        this.changelog.close();
        this.challenges.panelOpen = false;
        this.mobGallery.open();
      }
      return;
    }
    if (actions.top_account && hit(actions.top_account, mx, my)) {
      this.challenges.panelOpen = false;
      this.accountSystem.openPanel();
      return;
    }
    if (actions.top_settings && hit(actions.top_settings, mx, my)) {
      this.challenges.panelOpen = false;
      this.settings.togglePanel();
      return;
    }
    // Changelog 面板：打开/关闭
    if (actions.top_changelog && hit(actions.top_changelog, mx, my)) {
      this.focus = null;
      this.bagOpen = false;
      this.craftOpen = false;
      this.settings.close();
      if (this.mobGallery.visible) this.mobGallery.close();
      this.challenges.panelOpen = false;
      this.changelog.toggle();
      return;
    }
    // 成就面板：主菜单奖杯图标入口（成就面板的唯一入口,游戏内 HUD 不设按钮）。
    if (actions.top_achievement && hit(actions.top_achievement, mx, my)) {
      this.focus = null;
      this.bagOpen = false;
      this.craftOpen = false;
      this.settings.close();
      if (this.mobGallery.visible) this.mobGallery.close();
      this.changelog.close();
      this.challenges.panelOpen = false;
      this.achievements.togglePanel();
      return;
    }
    // 商店：主菜单 Shop 图标打开商店面板(参考 ShopSystem)。
    if (actions.top_shop && hit(actions.top_shop, mx, my)) {
      this.focus = null;
      this.bagOpen = false;
      this.craftOpen = false;
      this.settings.close();
      if (this.mobGallery.visible) this.mobGallery.close();
      this.changelog.close();
      this.achievements.panelOpen = false;
      this.challenges.panelOpen = false;
      this.shopSystem.toggle();
      return;
    }
    // 挑战面板：主菜单 Hunting Quest 图标打开/关闭(参考 HuntingQuestSystem)。
    if (actions.top_hunting_quest && hit(actions.top_hunting_quest, mx, my)) {
      this.focus = null;
      this.bagOpen = false;
      this.craftOpen = false;
      this.settings.close();
      if (this.mobGallery.visible) this.mobGallery.close();
      this.changelog.close();
      this.achievements.panelOpen = false;
      this.shopSystem.close();
      this.challenges.togglePanel();
      return;
    }
    // 天赋面板：主菜单 Talent 图标打开/关闭（唯一入口，游戏内 HUD 不设按钮）。
    if (actions.top_talent && hit(actions.top_talent, mx, my)) {
      this.focus = null;
      this.bagOpen = false;
      this.craftOpen = false;
      this.settings.close();
      if (this.mobGallery.visible) this.mobGallery.close();
      this.changelog.close();
      this.achievements.panelOpen = false;
      this.shopSystem.close();
      this.challenges.panelOpen = false;
      this.loadoutPanelOpen = false;
      // 进入游戏场景后首次打开时执行延迟的等级同步
      this.talent.syncWithLevel();
      this.talent.toggle();
      return;
    }
    // Arena 面板：主菜单 Arena 图标打开/关闭
    if (actions.top_arena && hit(actions.top_arena, mx, my)) {
      this.focus = null;
      this.bagOpen = false;
      this.craftOpen = false;
      this.settings.close();
      if (this.mobGallery.visible) this.mobGallery.close();
      this.changelog.close();
      this.achievements.panelOpen = false;
      this.shopSystem.close();
      this.challenges.panelOpen = false;
      this.loadoutPanelOpen = false;
      this.arenaPanel.toggle();
      return;
    }

    // Loadout 按钮（主菜单也支持）
    if (hit(this.loadoutBtnRect, mx, my)) {
      this.loadoutPanelOpen = !this.loadoutPanelOpen;
      return;
    }

    // Loadout 面板（模态）
    if (this.loadoutPanelOpen) {
      if (hit(this.loadoutCloseRect, mx, my)) {
        this.loadoutPanelOpen = false;
        return;
      }
      if (hit(this.loadoutSaveBtnRect, mx, my)) {
        const name = this.loadoutInput.trim() || `Loadout ${this.loadouts.length + 1}`;
        this.sendSaveLoadout(name);
        this.loadoutInput = "";
        return;
      }
      if (hit(this.loadoutScrollUpRect, mx, my)) {
        this.loadoutScroll--;
        return;
      }
      if (hit(this.loadoutScrollDownRect, mx, my)) {
        this.loadoutScroll++;
        return;
      }
      for (let i = 0; i < this.loadoutItemRects.length; i++) {
        const rect = this.loadoutItemRects[i];
        if (!rect) continue;
        if (hit(rect.load, mx, my)) {
          this.sendLoadLoadout(i);
          return;
        }
        if (hit(rect.del, mx, my)) {
          this.sendDeleteLoadout(i);
          return;
        }
        // 点击整行区域也可加载
        if (hit(rect.row, mx, my)) {
          this.sendLoadLoadout(i);
          return;
        }
      }
      return;
    }

    // Server selector buttons
    for (const key of ['eu', 'as', 'hk'] as const) {
      const r = this.serverBtnRects[key];
      if (r && hit(r, mx, my)) {
        if (this.serverRegion !== key) {
          this.serverRegion = key;
          localStorage.setItem("petalia.server", key);
          // 切换服务器时重新连接
          this.connect();
        }
        return;
      }
    }

    // Name field (above biome buttons) — use same dimensions as draw code
    const layout = this.menuLayout();
    const isMobileLayout = this.isMobile || this.w < 640;
    const nameFieldW = isMobileLayout ? Math.min(260, this.w * 0.8) : Math.min(300, this.w * 0.4);
    const nameFieldH = isMobileLayout ? 36 : 42;
    const nameFieldX = this.w / 2 - nameFieldW / 2;
    const nameFieldY = isMobileLayout ? (layout.gridY - 48) : (layout.gridY - 70);
    const nameRect = { x: nameFieldX, y: nameFieldY, w: nameFieldW, h: nameFieldH };
    if (hit(nameRect, mx, my)) {
      this.focus = "name";
      if (this.showVirtualKeyboard()) {
        this.vk.active = true;
        this.vk.target = 'playerName';
        this.vk.numMode = false;
      }
    } else {
      this.focus = null;
    }

    // Biome buttons
    const biomeButtons = this.menuBiomeButtons();
    for (const map of MAPS) {
      if (!this.BIOME_COLORS[map.name]) continue; // skip arena map
      const r = biomeButtons[map.id];
      if (r && hit(r, mx, my)) {
        this.selectedMap = map.id;
        // Update target background color for smooth transition
        this.menuTargetBgColor = [...this.BIOME_BG_COLORS[map.name]];
        return;
      }
    }

    // Left sidebar buttons（参考 MainMenu 布局）— each returns so a single
    // tap never triggers two actions.
    if (actions.left_inventory && hit(actions.left_inventory, mx, my)) { this.toggleBag(); return; }
    if (actions.left_craft && hit(actions.left_craft, mx, my)) { this.toggleCraft(); return; }

    // Play button (big button below biome grid)
    const playBtnRect = this.menuPlayButtonRect();
    if (playBtnRect && hit(playBtnRect, mx, my)) this.startGame();
  }

  private menuPlayButtonRect(): Rect | null {
    const layout = this.menuLayout();
    const isMobileLayout = this.isMobile || this.w < 640;
    const cols = layout.COLS;
    const totalRows = Math.ceil(MAPS.length / cols);
    const playBtnY = layout.gridY + totalRows * (layout.BIOME_H + layout.BIOME_GAP) + (isMobileLayout ? 12 : 30);
    const playBtnW = isMobileLayout ? Math.min(260, this.w * 0.8) : 180;
    const playBtnH = isMobileLayout ? 48 : 52;
    return { x: this.w / 2 - playBtnW / 2, y: playBtnY, w: playBtnW, h: playBtnH };
  }

  private startGame() {
    this.pendingScene = () => {
      this.scene = "game";
      this.alive = true;
      // Settings is menu-only. Force it shut on entry, otherwise its own
      // canvas listeners would keep swallowing clicks and wheel events over
      // an invisible panel for the whole match.
      this.settings.close();
      this.mobGallery.close();
      this.shopSystem.close();
      this.challenges.panelOpen = false;
      this.loadoutPanelOpen = false;
      this.arenaPanel.close();
      this.arenaPanel.state = 'closed';
      this.updateMobileLayout();
      // 进入游戏场景：执行天赋的延迟等级同步（load 时若在菜单则挂起）。
      this.talent.onGameStart();
      this.connect();
    };
  }

  private gotoMenu() {
    this.currentRunDrops = [];
    this.persist();
    this.pendingScene = () => {
      this.scene = "menu";
      this.net?.close();
      this.net = null;
      this.connected = false;
      this.afkPending = false;
      this.afkKicked = false;
      this.afkAnim = 0;
      this.afkSecondsLeft = 0;
      this.afkSmoothSeconds = 0;
      this.bagOpen = false;
      this.craftOpen = false;
      this.craftSearchActive = false;
      this.craftBiomeOpen = false;
      this.shopSystem.close();
      this.challenges.panelOpen = false;
      this.loadoutPanelOpen = false;
      this.arenaPanel.close();
      this.arenaPanel.state = 'closed';
      this.updateMobileLayout();
      // 回到主页面后重新建立服务器连接(主页面同样进行 AFK 检测,
      // 以菜单模式 JOIN,不进入世界模拟)。
      this.connect();
    };
  }

  // ------------------------------------------------------------ game input
  private gameClick(mx: number, my: number, shiftKey = false) {
    // The AFK prompt is modal: while it is up, the only click that does
    // anything is the one on the button itself. Clicking elsewhere must not
    // dismiss it, otherwise a cat on the keyboard would pass the check.
    if (this.afkPending) {
      if (hit(this.afkButtonRect(), mx, my)) this.sendAfkAck();
      return;
    }
    // 天赋面板：打开时面板内点击由面板处理，面板外点击关闭（与主菜单一致）。
    if (this.talent.isOpen) {
      if (this.talent.handleClick([mx, my])) return;
      this.talent.close();
      return;
    }
    // Arena 面板：面板打开时截获点击
    if (this.arenaPanel.panelOpen && this.arenaPanel.handleClick(mx, my)) {
      return;
    }
    // After an AFK kick the only thing left to do is go back to the menu.
    if (this.afkKicked) {
      const bw = 200;
      if (hit({ x: this.w / 2 - bw / 2, y: this.h / 2 + 30, w: bw, h: 52 }, mx, my)) this.gotoMenu();
      return;
    }
    if (!this.alive) {
      // Use pre-computed rects from renderDeath (center buttons)
      if (hit(this.deathCenterRespawnRect, mx, my)) {
        const w = new Writer(2);
        w.u8(C2S.RESPAWN);
        this.net?.send(w.bytes());
        this.alive = true;
        // Clear run drops for the next run
        this.currentRunDrops = [];
        return;
      }
      if (hit(this.deathCenterMenuRect, mx, my)) {
        this.gotoMenu();
        return;
      }
      // Start touch scroll if pressing inside content area
      if (hit(this.deathContentRect, mx, my)) {
        this.deathTouchScrolling = true;
        this.deathTouchStartY = my;
        this.deathTouchStartOffset = this.deathScrollOffset;
        return;
      }
      return;
    }

    // 面板打开时严格拦截，不穿透到游戏世界
    if (this.accountSystem.panelOpen) {
      this.accountSystem.handleClick(mx, my);
      return;
    }
    if (this.settings.panelOpen) {
      this.settings.handleClick(mx, my);
      return;
    }
    // Achievement panel: modal while open — clicks inside are swallowed,
    // clicks outside close it.
    if (this.achievements.panelOpen) {
      if (this.achievements.beginTouch(mx, my)) return;
      if (this.achievements.handleClick(mx, my)) return;
      this.achievements.panelOpen = false;
      return;
    }
    if (this.bagAnim > 0.4) {
      if (this.handleBagClick(mx, my)) return;
      // 拖快捷栏卡片到背包时保持背包打开:命中快捷栏卡片直接开始拖拽,
      // 松手落在背包区域会自动合并/存入(见 dropDrag),而不是关闭背包。
      const idx = this.cellIndexAtPoint(mx, my);
      if (idx >= 0 && !isBagCell(idx)) {
        const cell = this.cellAt(idx);
        if (cell) {
          this.drag = { from: idx, cell };
          this.dragX = mx;
          this.dragY = my;
          return;
        }
      }
      this.bagOpen = false;
      return;
    }
    if (this.craftAnim > 0.4) {
      if (this.handleCraftClick(mx, my, shiftKey)) return;
      this.craftOpen = false;
      return;
    }

    // Loadout 按钮
    if (hit(this.loadoutBtnRect, mx, my)) {
      this.loadoutPanelOpen = !this.loadoutPanelOpen;
      return;
    }

    // Loadout 面板（模态）
    if (this.loadoutPanelOpen) {
      if (hit(this.loadoutCloseRect, mx, my)) {
        this.loadoutPanelOpen = false;
        return;
      }
      if (hit(this.loadoutSaveBtnRect, mx, my)) {
        const name = this.loadoutInput.trim() || `Loadout ${this.loadouts.length + 1}`;
        this.sendSaveLoadout(name);
        this.loadoutInput = "";
        return;
      }
      if (hit(this.loadoutScrollUpRect, mx, my)) {
        this.loadoutScroll--;
        return;
      }
      if (hit(this.loadoutScrollDownRect, mx, my)) {
        this.loadoutScroll++;
        return;
      }
      for (let i = 0; i < this.loadoutItemRects.length; i++) {
        const rect = this.loadoutItemRects[i];
        if (!rect) continue;
        if (hit(rect.load, mx, my)) {
          this.sendLoadLoadout(i);
          return;
        }
        if (hit(rect.del, mx, my)) {
          this.sendDeleteLoadout(i);
          return;
        }
        // 点击整行区域也可加载
        if (hit(rect.row, mx, my)) {
          this.sendLoadLoadout(i);
          return;
        }
      }
      return; // 面板内点击其他区域不穿透
    }

    for (const b of this.hudButtons()) {
      if (!hit(b.rect, mx, my)) continue;
      if (b.id === "bag") this.toggleBag();
      if (b.id === "craft") this.toggleCraft();
      if (b.id === "menu") this.gotoMenu();
      return;
    }


    // Mobile: clicking the chatbox triggers the keyboard
    if (this.showVirtualKeyboard()) {
      const chatLift = this.isMobile || this.w < 640 ? 76 : 50;
      const chatScreenHeight = this.h - this.hotbarHeight() + chatLift;
      if (this.chat.handleClick(mx, my, chatScreenHeight)) {
        this.vk.active = true;
        this.vk.target = 'chat';
        this.vk.numMode = false;
        return;
      }
    }

    if (this.craftAnim > 0.4 && this.handleCraftClick(mx, my, shiftKey)) return;

    if (this.bagAnim > 0.4 && this.handleBagClick(mx, my)) return;

    // Both hotbar rows and the bag start a drag the same way.
    const idx = this.cellIndexAtPoint(mx, my);
    if (idx >= 0) {
      const cell = this.cellAt(idx);
      if (cell) {
        // Bag cells are stacks. A drag from the inventory always represents
        // exactly one physical item, never the whole item-type stack.
        this.drag = { from: idx, cell: isBagCell(idx) ? { ...cell, count: 1 } : cell };
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
  private handleCraftClick(mx: number, my: number, shiftKey = false): boolean {
    const layout = this.craftLayout();
    const p = layout.panel;
    if (!hit(p, mx, my)) return false;

    if (hit(layout.closeRect, mx, my)) {
      this.craftOpen = false;
      return true;
    }

    // The result card stays on screen until the player clicks it (anywhere
    // in the panel) to acknowledge it and move on.
    if (this.craftPhase === "showing") {
      this.craftPhase = "none";
      this.craftPending = null;
      this.craftResultPulse = 0;
      this.craftShowTimer = 0;
      return true;
    }

    // Keep the five submitted cards fixed in place until their animation resolves.
    // This also prevents a double click from starting a second craft.
    if (this.craftPhase !== "none") return true;

    for (const { mode, rect } of this.craftModeRects()) {
      if (!hit(rect, mx, my)) continue;
      if (this.craftMode !== mode) {
        this.craftMode = mode;
        this.craftSel = null;
        this.craftSlotCounts = [0, 0, 0, 0, 0];
        this.craftMsg = "";
        this.craftScrollY = 0;
        this.clampCraftScroll();
      }
      return true;
    }

    if (hit(layout.barRect, mx, my)) {
      this.craftSearchActive = true;
      this.craftBiomeOpen = false;
      if (this.showVirtualKeyboard()) {
        this.vk.active = true;
        this.vk.target = 'craftSearch';
        this.vk.numMode = false;
      }
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

    // click a card in the browser grid to load it into the craft slots (drag still works too).
    // Shift+click instantly loads every owned card, distributed across the slots.
    const entry = this.craftGridEntryAtPoint(mx, my);
    if (entry) {
      this.selectCraftCell(entry.cell, shiftKey);
      return true;
    }

    // Clicking a big slot clears just that slot's cards back to the bag.
    if (this.craftMode === "normal") {
      const padRects = this.craftPadRects();
      for (let i = 0; i < padRects.length; i++) {
        if (hit(padRects[i], mx, my) && this.craftSel && this.craftSlotCounts[i] > 0) {
          this.craftSlotCounts[i] = 0;
          if (this.craftTotalLoaded() === 0) this.craftSel = null;
          this.craftMsg = "";
          return true;
        }
      }
    } else if (hit(this.craftSingleSlotRect(), mx, my) && this.craftSel) {
      this.craftSel = null;
      return true;
    }

    if (hit(layout.actionRect, mx, my)) {
      this.submitCraft();
      return true;
    }
    // Start touch scrolling on empty area (mobile)
    this.craftTouchScrolling = true;
    this.craftTouchStartY = my;
    this.craftTouchStartOffset = this.craftScrollY;
    return true;
  }

  /** Puts a bag cell into the craft slots, with a little pop of feedback.
   *  In normal (pentagon) mode, a plain click loads 5 cards distributed
   *  evenly across the 5 slots (1 each). Clicking the same card again
   *  adds 5 more cards on top (stacking). Shift+click instead distributes
   *  every owned card of this type evenly across the 5 slots in one go
   *  (see autoFillCraftSlots).
   */
  private selectCraftCell(cell: Cell, shiftKey = false) {
    if (this.craftPhase !== "none") return;


    if (this.craftMode === "normal") {
      if (shiftKey) {
        this.autoFillCraftSlots(cell.item, cell.rarity);
        return;
      }
      const avail = this.countOf(cell.item, cell.rarity);
      if (avail <= 0) {
        this.craftMsg = "No cards of this type.";
        this.craftMsgLife = 1.4;
        return;
      }

      // Same card already selected → stack more cards on top
      if (this.craftSel && this.craftSel.item === cell.item && this.craftSel.rarity === cell.rarity) {
        const alreadyLoaded = this.craftTotalLoaded();
        const remaining = avail - alreadyLoaded;
        if (remaining <= 0) {
          this.craftMsg = "No more cards of this type.";
          this.craftMsgLife = 1.4;
          return;
        }
        const toAdd = Math.min(5, remaining);
        for (let i = 0; i < toAdd; i++) {
          this.craftSlotCounts[i % CRAFT_CARD_COUNT]++;
        }
        const newTotal = alreadyLoaded + toAdd;
        this.craftMsg = `Loaded ${newTotal} cards.`;
        if (this.craftMsg) this.craftMsgLife = 1.8;
      } else {
        // First time loading this card type
        this.craftSel = { item: cell.item, rarity: cell.rarity };
        this.craftSlotCounts = this.craftDistributeEvenly(Math.min(CRAFT_CARD_COUNT, avail));
        this.craftMsg = avail > CRAFT_CARD_COUNT
          ? `Loaded ${CRAFT_CARD_COUNT} cards — click again to add more.`
          : avail < CRAFT_CARD_COUNT
            ? `Loaded ${avail} cards.`
            : "";
        if (this.craftMsg) this.craftMsgLife = 1.8;
      }
    } else {
      this.craftSel = { item: cell.item, rarity: cell.rarity };
      this.craftMsg = "";
    }

    this.craftGlow = 1;
    this.craftStartFill();
  }

  /** Shift+click convenience: distributes every owned card of this type
   *  evenly across the 5 pentagon slots in one action (e.g. 12 cards ->
   *  [3, 3, 2, 2, 2]) instead of the plain-click 5-card load.
   */
  private autoFillCraftSlots(item: number, rarity: number) {
    const avail = this.countOf(item, rarity);
    if (avail <= 0) {
      this.craftMsg = "No cards of this type.";
      this.craftMsgLife = 1.4;
      return;
    }
    this.craftSel = { item, rarity };
    this.craftSlotCounts = this.craftDistributeEvenly(avail);
    this.craftMsg = `Loaded ${avail} cards.`;
    this.craftMsgLife = 1.8;
    this.craftGlow = 1;
    this.craftStartFill();
  }

  /** Fires the current mode's request if the selection satisfies its requirements. */
  private submitCraft() {
    if (this.craftPhase !== "none") return;
    if (!this.net || !this.connected) {
      this.craftMsg = "Press PLAY to enter the world before crafting.";
      this.craftMsgLife = 2.2;
      this.craftShake = 0.35;
      return;
    }
    const sel = this.craftSel;
    if (!sel) {
      this.craftMsg = "Pick a card first.";
      this.craftMsgLife = 2;
      this.craftShake = 0.35;
      return;
    }
    const avail = this.countOf(sel.item, sel.rarity);

    if (this.craftMode === "normal") {
      const loaded = this.craftTotalLoaded();
      if (loaded < CRAFT_CARD_COUNT || sel.rarity >= MAX_CRAFT_RARITY) {
        this.craftMsg = loaded < CRAFT_CARD_COUNT ? `Fill all ${CRAFT_CARD_COUNT} slots first.` : "Already at max craftable rarity.";
        this.craftMsgLife = 2;
        this.craftShake = 0.35;
        return;
      }
      const w = new Writer(6);
      // Send the total card count — the server calculates attempts from it.
      w.u8(C2S.CRAFT).u8(sel.item).u8(sel.rarity).u16(loaded);
      this.craftLogPetals += loaded;
      this.craftLogAttempts += 1;
      this.craftStartRotation();
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
      this.craftLogPetals += required;
      this.craftLogAttempts += 1;
      this.craftStartRotation();
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
    this.craftLogPetals += 1;
    this.craftLogAttempts += 1;
    this.craftStartRotation();
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
      if (this.showVirtualKeyboard()) {
        this.vk.active = true;
        this.vk.target = 'bagSearch';
        this.vk.numMode = false;
      }
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
    // Click on a bag item card → start a drag immediately. Previously this
    // method returned true for every click inside the panel, which prevented
    // drag-from-bag from ever working on both desktop and mobile.
    const bagSlotIdx = this.bagSlotAtPoint(mx, my);
    if (bagSlotIdx >= 0) {
      const bagCell = this.cellAt(bagSlotIdx);
      if (bagCell) {
        this.drag = { from: bagSlotIdx, cell: { ...bagCell, count: 1 } };
        this.dragX = mx;
        this.dragY = my;
        return true;
      }
    }
    // Start touch scrolling on empty area (mobile)
    this.bagTouchScrolling = true;
    this.bagTouchStartY = my;
    this.bagTouchStartOffset = this.bagScrollY;
    // Consumed: click on bag panel background — don't fall through to game world.
    return true;
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

  /** Sum of cards currently loaded across the 5 pentagon slots (normal mode). */
  private craftTotalLoaded(): number {
    return this.craftSlotCounts.reduce((a, b) => a + b, 0);
  }

  /** Splits `total` cards evenly across the 5 pentagon slots (remainder
   *  going to the earliest slots first), mirroring an even-distribution
   *  fill: e.g. 12 cards -> [3, 3, 2, 2, 2].
   */
  private craftDistributeEvenly(total: number): number[] {
    const n = CRAFT_CARD_COUNT;
    const base = Math.floor(total / n);
    const remainder = total % n;
    return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
  }

  private dropDrag(mx: number, my: number) {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    if (this.craftAnim > 0.4 && hit(this.craftPanelRect(), mx, my)) {
      this.selectCraftCell(drag.cell);
      return;
    }
    // 松手落在背包面板区域内 → 与背包中相同卡片自动合并(x1→x2)或存入
    // 空格,而不是替换另一张卡片。背包保持打开(见 gameClick)。
    const inBagRegion = this.bagAnim > 0.4 && hit(this.bagPanelRect(), mx, my);
    if (inBagRegion) {
      if (this.scene === "game") this.depositDragToBag(drag, mx, my);
      else this.depositDragToBagLocal(drag, mx, my);
      return;
    }
    const target = this.cellIndexAtPoint(mx, my);
    if (target < 0 || target === drag.from) return;
    if (this.scene !== "game") {
      // 主菜单:本地格子操作(不发送 SWAP,避免与服务端副本不同步;
      // 改动在进入游戏时随 JOIN 整体同步到服务器)。
      this.applyLocalCellDrop(drag, target);
      return;
    }
    // Cell indices now span two hotbar rows plus an unlimited bag, so they no
    // longer fit in a byte — send both endpoints as u16.
    const w = new Writer(8);
    w.u8(C2S.SWAP).u16(drag.from).u16(target);
    this.net?.send(w.bytes());

    // The server transfers one item when the source is a bag cell. Do not do
    // a full-stack optimistic swap here: wait for its inventory snapshot so
    // the stack count and an equipped replacement cannot briefly desync.
    if (isBagCell(drag.from)) {
      // 从背包拖到快捷栏:成功后隐藏背包。
      if (isHotbarCell(target)) this.bagOpen = false;
      return;
    }

    // Hotbar-to-hotbar (either row) and hotbar-to-bag stay a normal card swap,
    // mirrored locally so the drag feels instant.
    const a = this.cellAt(drag.from);
    const b = this.cellAt(target);
    this.setCellLocal(drag.from, b);
    this.setCellLocal(target, a);
  }

  /**
   * 把拖拽中的卡片存入背包:与背包中相同卡片自动合并(x1→x2),否则放入
   * 第一个空格(绝不替换其它卡片)。快捷栏来源整格存入;背包来源保持原有
   * 的逐格移动/合并行为。仅游戏场景调用(服务端同步)。
   */
  private depositDragToBag(drag: { from: number; cell: Cell }, mx: number, my: number) {
    if (isBagCell(drag.from)) {
      // 背包内部整理:松手落在另一个背包格 → 交给服务器合并/移动
      // (moveOneFromBag:相同卡片合并、空格置入、其它情况原样保留)。
      const target = this.cellIndexAtPoint(mx, my);
      if (target < 0 || target === drag.from || !isBagCell(target)) return;
      const w = new Writer(8);
      w.u8(C2S.SWAP).u16(drag.from).u16(target);
      this.net?.send(w.bytes());
      return;
    }
    // 快捷栏 → 背包:先找相同卡片合并,再找空格存入。
    let target = -1;
    for (let i = 0; i < this.bag.length; i++) {
      const c = this.bag[i];
      if (c && c.item === drag.cell.item && c.rarity === drag.cell.rarity) {
        target = bagCellIndex(i);
        break;
      }
    }
    if (target < 0) {
      for (let i = 0; i < this.bag.length; i++) {
        if (!this.bag[i]) {
          target = bagCellIndex(i);
          break;
        }
      }
    }
    if (target < 0 && this.bag.length < BAG_MAX) {
      target = bagCellIndex(this.bag.length);
      this.bag.push(null);
    }
    if (target < 0) return; // 背包已满,卡片留在原地
    const w = new Writer(8);
    w.u8(C2S.SWAP).u16(drag.from).u16(target);
    this.net?.send(w.bytes());
    // 本地镜像,保持拖拽手感(与服务端 swapCells 行为一致:相同卡片合并、
    // 空格直接置入,快捷栏格清空)。
    const a = this.cellAt(drag.from);
    if (a) {
      const bt = this.cellAt(target);
      if (bt) bt.count += a.count;
      else this.setCellLocal(target, a);
      this.setCellLocal(drag.from, null);
    }
  }

  /**
   * 主菜单的本地背包存入(不发送 SWAP):与背包中相同卡片自动合并(x1→x2),
   * 否则存入第一个空格;快捷栏来源整格存入,背包来源保持逐格移动/合并。
   * 改动只作用于本地存档,进入游戏时随 JOIN 整体同步到服务器。
   */
  private depositDragToBagLocal(drag: { from: number; cell: Cell }, mx: number, my: number) {
    if (isBagCell(drag.from)) {
      // 背包内部整理:合并到相同卡片、空格置入,目标格是不同卡片则保留原位
      // (与服务器 moveOneFromBag 一致)。
      const target = this.cellIndexAtPoint(mx, my);
      if (target < 0 || target === drag.from || !isBagCell(target)) return;
      const a = this.cellAt(drag.from);
      if (!a) return;
      const bt = this.cellAt(target);
      if (bt) {
        if (bt.item === a.item && bt.rarity === a.rarity) bt.count += a.count;
        else return;
      } else {
        this.setCellLocal(target, a);
      }
      this.setCellLocal(drag.from, null);
      this.saveNow();
      return;
    }
    // 快捷栏 → 背包:先找相同卡片合并,再找空格存入。
    let target = -1;
    for (let i = 0; i < this.bag.length; i++) {
      const c = this.bag[i];
      if (c && c.item === drag.cell.item && c.rarity === drag.cell.rarity) {
        target = bagCellIndex(i);
        break;
      }
    }
    if (target < 0) {
      for (let i = 0; i < this.bag.length; i++) {
        if (!this.bag[i]) {
          target = bagCellIndex(i);
          break;
        }
      }
    }
    if (target < 0 && this.bag.length < BAG_MAX) {
      target = bagCellIndex(this.bag.length);
      this.bag.push(null);
    }
    if (target < 0) return; // 背包已满,卡片留在原位
    const a = this.cellAt(drag.from);
    if (!a) return;
    const bt = this.cellAt(target);
    if (bt) bt.count += a.count;
    else this.setCellLocal(target, a);
    this.setCellLocal(drag.from, null);
    this.saveNow();
  }

  /**
   * 主菜单的本地格子操作(不发送 SWAP):快捷栏↔快捷栏纯交换(快捷栏永不
   * 叠加),背包→快捷栏替换(被替换的旧卡放回背包,源格减一)。改动只作用于
   * 本地存档,进入游戏时随 JOIN 整体同步到服务器。
   */
  private applyLocalCellDrop(drag: { from: number; cell: Cell }, target: number) {
    if (isBagCell(drag.from)) {
      // 背包 → 快捷栏:目标格放一张该卡,旧卡(若有)放回背包,源格数量减一。
      const src = this.cellAt(drag.from);
      if (!src || src.count <= 0) return;
      const cur = this.cellAt(target);
      if (cur && !this.addToBagLocal(cur)) return; // 背包满,替换失败保留原位
      this.setCellLocal(target, { item: src.item, rarity: src.rarity, count: 1 });
      src.count -= 1;
      if (src.count <= 0) this.setCellLocal(drag.from, null);
      this.saveNow();
      return;
    }
    // 快捷栏 ↔ 快捷栏:纯交换(不管是否相同稀有度/种类都不叠加)。
    const a = this.cellAt(drag.from);
    const b = this.cellAt(target);
    this.setCellLocal(drag.from, b);
    this.setCellLocal(target, a);
    this.saveNow();
  }

  /** 把一张卡放回背包(合并进相同堆叠或存入空格);背包满放不下时返回 false。
   *  先校验容量再写入,保证失败时不做任何部分写入。 */
  private addToBagLocal(cell: Cell): boolean {
    let left = cell.count;
    // 预校验:可合并空间 + 空格容量 + 可扩容容量,不足则整体失败。
    let room = 0;
    let emptySlots = 0;
    for (const c of this.bag) {
      if (!c) emptySlots++;
      else if (c.item === cell.item && c.rarity === cell.rarity) room += Math.max(0, 999 - c.count);
    }
    room += emptySlots * 999;
    room += (BAG_MAX - this.bag.length) * 999;
    if (left > room) return false;
    // 合并进相同堆叠
    for (const c of this.bag) {
      if (left <= 0) break;
      if (c && c.item === cell.item && c.rarity === cell.rarity && c.count < 999) {
        const put = Math.min(999 - c.count, left);
        c.count += put;
        left -= put;
      }
    }
    // 存入空格 / 扩容(预校验已保证容量足够,此处的守卫仅作防御)
    while (left > 0) {
      let idx = this.bag.indexOf(null);
      if (idx < 0) {
        if (this.bag.length >= BAG_MAX) return false;
        idx = this.bag.length;
        this.bag.push(null);
      }
      const put = Math.min(999, left);
      this.bag[idx] = { item: cell.item, rarity: cell.rarity, count: put };
      left -= put;
    }
    return true;
  }

  private setCellLocal(index: number, cell: Cell | null) {
    if (isMainCell(index)) this.slots[index] = cell;
    else if (index < HOTBAR_CELLS) this.secondary[index - SLOT_COUNT] = cell;
    else this.bag[index - HOTBAR_CELLS] = cell;
  }

  // --------------------------------------------------------------- render
  private render(dt: number) {
    const ctx = this.ctx;
    ctx.save();
    if (this.scene === "menu") this.renderMenu(dt);
    else this.renderGame(dt);
    ctx.restore();

    // Virtual keyboard (mobile) — drawn on top of everything
    this.vk.draw(ctx, this.w, this.h);

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

    // Debug overlay always renders last (over menu/game/loading fade) and in
    // both scenes, so toggling it never depends on being in a match.
    if (this.settings.showDebugInfo) this.renderDebugOverlay(ctx);
  }

  /**
   * Bottom-right debug panel: ping, throughput, live object count, FPS and
   * the collision-check count the server performed on its last tick. Purely
   * a diagnostic HUD — toggled from Settings → Debug Info.
   */
  private renderDebugOverlay(ctx: CanvasRenderingContext2D) {
    // Compressed: 2 short lines, smaller font, tight padding, so the panel
    // takes up a fraction of the original screen space and never covers
    // the chat box or hotbar in the bottom-right corner.
    const fps = this.debugFps >= 1 ? Math.round(this.debugFps).toString() : "--";
    const ping = this.connected ? (this.debugPingMs > 0 ? `${this.debugPingMs}ms` : "...") : "--";
    const inKB = formatDebugBytes(this.debugThroughputInWindow);
    const outKB = formatDebugBytes(this.debugThroughputOutWindow);
    const objs = this.connected ? this.debugEntityCount : this.ents.size;
    const players = this.connected ? this.debugPlayerCount : "--";
    const checks = this.connected ? this.debugCollisionChecks : "--";
    // Player move speed in px/s, rounded to int for readability. Falls back
    // to a local computation when we don't have a server reading (e.g.
    // older server build, or pre-connection).
    const speed = this.debugPlayerSpeed > 0
      ? `${Math.round(this.debugPlayerSpeed)}px/s`
      : `${Math.round(this.computeLocalPlayerSpeed())}px/s`;
    const line1 = `${fps}fps ${ping} ↓${inKB}/s ↑${outKB}/s`;
    const line2 = `obj:${objs} player:${players} collision:${checks} speed:${speed}`;
    const fontSize = 10;
    const lineH = 12;
    const padX = 6;
    const padY = 4;
    ctx.save();
    ctx.font = `900 ${fontSize}px "Trebuchet MS", "Segoe UI", sans-serif`;
    const w = Math.ceil(Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width)) + padX * 2;
    const h = lineH * 2 + padY * 2 - 2;
    const x = this.w - w - 8;
    const y = this.h - h - 8;
    panel(ctx, { x, y, w, h }, "rgba(10,16,22,0.78)");
    text(ctx, line1, x + padX, y + padY + lineH / 2, fontSize, "rgba(255,255,255,0.92)", "left");
    text(ctx, line2, x + padX, y + padY + lineH + lineH / 2 + 1, fontSize, "rgba(255,255,255,0.78)", "left");
    ctx.restore();
  }
  private renderMenu(dt: number) {
    const ctx = this.ctx;
    const t = this.time;
    const W = this.w;
    const H = this.h;

    // Initialize petals if empty
    if (this.menuPetals.length === 0) this.initMenuPetals();

    // Update background color transition
    this.updateMenuBgColor(dt);

    // Update floating petals
    this.updateMenuPetals(dt);

    // ─── Background ───
    const bg = this.menuBgColor;
    const r = Math.round(bg[0]), g = Math.round(bg[1]), b = Math.round(bg[2]);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, W, H);

    // Grid background
    this.drawMenuGrid(ctx, r, g, b);

    // Floating petals
    for (const petal of this.menuPetals) {
      this.drawMenuPetal(ctx, petal);
    }

    // ─── Helpers ───
    const adj = (rgb: number[], f: number) => rgb.map(c => Math.max(0, Math.min(255, Math.floor(c * f))));

    const drawBtn = (rect: { x: number; y: number; w: number; h: number }, baseColor: number[], whiteStroke = false) => {
      const { x, y, w, h } = rect;

      roundRect(ctx, x, y, w, h, 8);
      ctx.fillStyle = `rgb(${baseColor[0]},${baseColor[1]},${baseColor[2]})`;
      ctx.fill();

      ctx.save();
      roundRect(ctx, x, y, w, h, 8);
      ctx.clip();
      ctx.fillStyle = `rgb(${adj(baseColor, 0.78)[0]},${adj(baseColor, 0.78)[1]},${adj(baseColor, 0.78)[2]})`;
      ctx.fillRect(x, y, w, h / 2);
      ctx.restore();

      if (whiteStroke) {
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.lineWidth = 3;
        roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 10);
        ctx.stroke();
      }

      ctx.strokeStyle = `rgb(${adj(baseColor, 0.48)[0]},${adj(baseColor, 0.48)[1]},${adj(baseColor, 0.48)[2]})`;
      ctx.lineWidth = 3;
      roundRect(ctx, x, y, w, h, 8);
      ctx.stroke();
    };

    const drawBtnLabel = (rect: { x: number; y: number; w: number; h: number }, txt: string, fontSize: number) => {
      const { x, y, w, h } = rect;
      ctx.font = `bold ${fontSize}px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeText(txt, x + w / 2, y + h / 2);
      ctx.fillStyle = 'white';
      ctx.fillText(txt, x + w / 2, y + h / 2);
    };

    // ─── Title ───
    const isMobileLayout = this.isMobile || W < 640;
    const titleSize = isMobileLayout ? Math.max(26, Math.min(44, W * 0.12)) : Math.max(28, Math.min(60, W * 0.07));
    const bob = Math.sin(t * 1.6) * 6;
    const titleY = isMobileLayout ? Math.max(35, this.h * 0.08) : Math.max(60, this.h * 0.12);

    ctx.font = `bold ${titleSize}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 8;
    ctx.strokeText('Molorr.io', W / 2, titleY + bob * 0.4);
    ctx.fillStyle = '#fff';
    ctx.fillText('Molorr.io', W / 2, titleY + bob * 0.4);

    // ─── Server Selector [EU] [AS] ───
    const btnW = isMobileLayout ? 44 : 54;
    const btnH = isMobileLayout ? 26 : 30;
    const btnGap = isMobileLayout ? 10 : 12;
    const btnY = titleY + bob * 0.4 + (isMobileLayout ? 8 : 12);
    const totalBtnW = btnW * 2 + btnGap;
    const btnStartX = W / 2 - totalBtnW / 2;
    this.serverBtnRects = {};
    for (const key of ['eu', 'as'] as const) {
      const idx = key === 'eu' ? 0 : 1;
      const bx = btnStartX + idx * (btnW + btnGap);
      const by = btnY;
      this.serverBtnRects[key] = { x: bx, y: by, w: btnW, h: btnH };
      const isActive = this.serverRegion === key;
      const isHovered = hit(this.serverBtnRects[key], this.mx, this.my);
      roundRect(ctx, bx, by, btnW, btnH, 6);
      ctx.fillStyle = isActive
        ? (isHovered ? '#4a7fb5' : '#3a6fa5')
        : (isHovered ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.35)');
      ctx.fill();
      ctx.lineWidth = isActive ? 2 : 1;
      ctx.strokeStyle = isActive ? '#7abfff' : 'rgba(255,255,255,0.25)';
      ctx.stroke();
      ctx.font = `bold ${isMobileLayout ? 12 : 14}px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isActive ? '#fff' : 'rgba(255,255,255,0.6)';
      ctx.fillText(key.toUpperCase(), bx + btnW / 2, by + btnH / 2);
    }

    // ─── Name Field (above biome buttons) ───
    const layout = this.menuLayout();
    const nameFieldW = isMobileLayout ? Math.min(260, W * 0.8) : Math.min(300, W * 0.4);
    const nameFieldH = isMobileLayout ? 36 : 42;
    const nameFieldX = W / 2 - nameFieldW / 2;
    const nameFieldY = isMobileLayout ? (layout.gridY - 48) : (layout.gridY - 70);

    // Draw name field
    roundRect(ctx, nameFieldX, nameFieldY, nameFieldW, nameFieldH, 8);
    ctx.fillStyle = this.focus === 'name' ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.35)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = this.focus === 'name' ? '#ffe763' : 'rgba(255,255,255,0.3)';
    ctx.stroke();

    const caret = this.focus === 'name' && Math.floor(t * 2) % 2 === 0 ? '|' : '';
    const nameText = this.playerName || 'Flower name';
    const nameColor = this.playerName ? '#ffffff' : 'rgba(255,255,255,0.45)';
    ctx.font = `${isMobileLayout ? 16 : 18}px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeText(nameText + caret, nameFieldX + 14, nameFieldY + nameFieldH / 2);
    ctx.fillStyle = nameColor;
    ctx.fillText(nameText + caret, nameFieldX + 14, nameFieldY + nameFieldH / 2);

    // ─── Biome Buttons (3-column grid) ───
    const biomeButtons = this.menuBiomeButtons();

    // Update hover state
    this.menuHoveredButton = null;
    for (const map of MAPS) {
      if (!this.BIOME_COLORS[map.name]) continue; // skip arena map
      const rect = biomeButtons[map.id];
      if (rect && hit(rect, this.mx, this.my)) {
        this.menuHoveredButton = `biome_${map.id}`;
      }
    }

    for (const map of MAPS) {
      if (!this.BIOME_COLORS[map.name]) continue; // skip arena map
      const rect = biomeButtons[map.id];
      if (!rect) continue;

      const isHovered = this.menuHoveredButton === `biome_${map.id}`;
      const isSelected = this.selectedMap === map.id;
      const baseColor = isHovered ? this.BIOME_HOVER_COLORS[map.name] : this.BIOME_COLORS[map.name];

      drawBtn(rect, baseColor, isSelected);
      drawBtnLabel(rect, map.name, isMobileLayout ? 13 : 16);
    }

    // ─── Play Button (below biome grid) ───
    const playBtnRect = this.menuPlayButtonRect();
    if (playBtnRect) {
      const isPlayHovered = hit(playBtnRect, this.mx, this.my);
      const playColor: [number, number, number] = isPlayHovered ? [50, 190, 80] : [63, 174, 96];
      drawBtn(playBtnRect, playColor);

      ctx.font = `bold ${isMobileLayout ? 20 : 26}px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeText('PLAY', playBtnRect.x + playBtnRect.w / 2, playBtnRect.y + playBtnRect.h / 2);
      ctx.fillStyle = 'white';
      ctx.fillText('PLAY', playBtnRect.x + playBtnRect.w / 2, playBtnRect.y + playBtnRect.h / 2);
    }

    // ─── Top Bar Buttons（参考 MainMenu 配色与布局）───
    const actions = this.menuActionRects();
    const TOP_BTN_COLORS: Record<string, [number, number, number]> = {
      top_account:       [52, 152, 219],
      top_shop:          [46, 204, 113],
      top_hunting_quest: [46, 204, 113],
      top_talent:        [142, 68, 173],
      top_mob_gallery:   [155, 89, 182],
      top_achievement:   [230, 126, 34],
      top_arena:         [231, 76, 60],
      top_settings:      [51, 51, 85],
      top_changelog:     [21, 142, 24],
    };
    const TOP_BTN_HOVER_COLORS: Record<string, [number, number, number]> = {
      top_account:       [41, 128, 185],
      top_shop:          [39, 174, 96],
      top_hunting_quest: [39, 174, 96],
      top_talent:        [155, 89, 182],
      top_mob_gallery:   [142, 68, 173],
      top_achievement:   [211, 84, 0],
      top_arena:         [192, 57, 43],
      top_settings:      [85, 85, 119],
      top_changelog:     [28, 180, 32],
    };
    for (const key of Object.keys(TOP_BTN_COLORS)) {
      const rect = actions[key];
      if (!rect) continue;
      const isHov = hit(rect, this.mx, this.my);
      const color = isHov ? TOP_BTN_HOVER_COLORS[key] : TOP_BTN_COLORS[key];
      drawBtn(rect, color);
      // 顶部栏：圆角正方形 + 居中图标（MainMenu._drawTopBtnIcon）
      this._drawTopBtnIcon(ctx, key.replace('top_', ''), rect);
    }

    // ─── Left Sidebar Buttons（参考 MainMenu 配色与图标）───
    const leftBtnColors: Record<string, [number, number, number]> = {
      left_inventory:  [52, 152, 219],
      left_craft:      [155, 89, 182],
    };
    const leftBtnHoverColors: Record<string, [number, number, number]> = {
      left_inventory:  [41, 128, 185],
      left_craft:      [142, 68, 173],
    };

    for (const key of ['left_inventory', 'left_craft']) {
      const rect = actions[key];
      if (!rect) continue;
      const isHov = hit(rect, this.mx, this.my);
      const color = isHov ? leftBtnHoverColors[key] : leftBtnColors[key];
      drawBtn(rect, color);
      // 侧栏：宽按钮，图标居左 + 快捷键标签靠右（MainMenu._drawLeftBtnIcon）
      this._drawLeftBtnIcon(ctx, key.replace('left_', ''), rect);
    }

    // ─── Version text ───
    ctx.font = `${isMobileLayout ? 11 : 14}px ${FONT_FAMILY}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 3;
    ctx.strokeText('v0.4.3', W - 10, isMobileLayout ? H - 8 : H - 10);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('v0.4.3', W - 10, isMobileLayout ? H - 8 : H - 10);
    const pwB = Math.min(180, W - 24);
    this.extraBonusButton = [W - pwB - 12, 64, pwB, 165];
    this.hoveredButton = null;
    if (this.hitArr(this._bonusClaimRect, this.mx, this.my)) this.hoveredButton = 'bonus_claim';
    else if (this.hitArr(this._bonusExtraRect, this.mx, this.my)) this.hoveredButton = 'bonus_extra';
    this._drawBonusPanel(ctx, isMobileLayout ? 12 : 12);
    this.settings.draw(ctx, W / 2, H / 2);

    // Craft / Inventory panels can be opened right from the main menu, reusing
    // the same in-game panel drawers.
    this.renderBag();
    this.renderCraft();
    if (this.drag) {
  const size = 60;
  // 摆动动画：使用正弦波产生左右摆动
  const swingAmount = 10; // 摆动幅度（像素）
  const swingSpeed = 6; // 摆动速度
  const swing = Math.sin(this.time * swingSpeed) * swingAmount;

  // 添加轻微的旋转摆动
  const rotationAmount = 0.09; // 弧度
  const rotSwing = Math.sin(this.time * swingSpeed) * rotationAmount;

  ctx.save();
  ctx.translate(this.dragX, this.dragY);
  ctx.rotate(rotSwing);
  ctx.translate(-this.dragX, -this.dragY);

  drawCard(ctx, {
    x: this.dragX - size / 2 + swing,
    y: this.dragY - size / 2,
    w: size,
    h: size
  }, this.drag.cell, {
    hovered: true,
    scale: 1.1,
  });

  ctx.restore();
}
    // 商店面板(绘制在最上层)。
    this.shopSystem.setMouse(this.mx, this.my);
    this.shopSystem.draw(ctx, W, H);
    // Bonus 面板（常驻主菜单，无按钮；参考 MainMenu._drawBonusPanel）。
    // 桌面/手机版都在右上角（顶部栏已移到左上角，右上角空闲）。
    // 面板区域点击不穿透（见 menuClick）。
    this.quickSlot.draw(ctx);


    // Mobile: suggest fullscreen + show current control scheme
    if (this.isMobile && !this.phoneTipIgnored) {
      const isFs = typeof document !== "undefined" && !!document.fullscreenElement;
      const topY = 8;
      const tipW = Math.min(360, W * 0.92);
      const tipH = isFs ? 58 : 126;
      const tipX = W / 2 - tipW / 2;
      ctx.save();
      roundRect(ctx, tipX, topY, tipW, tipH, 10);
      ctx.fillStyle = isFs ? "rgba(0,0,0,0.48)" : "rgba(28,36,46,0.92)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.stroke();
      if (!isFs) {
        text(ctx, "Phone tip: Enter fullscreen for best experience", tipX + tipW / 2, topY + 16, 12, "#ffe763");
        text(ctx, "Landscape + fullscreen", tipX + tipW / 2, topY + 32, 10, "rgba(255,255,255,0.7)");
        const btnW = 180, btnH = 32;
        const btnX = tipX + tipW / 2 - btnW / 2;
        const btnY = topY + 46;
        const fullBtnRect: Rect = { x: btnX, y: btnY, w: btnW, h: btnH };
        const ignoreW = tipW - 24, ignoreH = 30;
        const ignoreX = tipX + 12;
        const ignoreY = btnY + btnH + 10;
        const ignoreBtnRect: Rect = { x: ignoreX, y: ignoreY, w: ignoreW, h: ignoreH };
        this.mobileFullscreenBtn = fullBtnRect;
        this.mobileTipIgnoreBtn = ignoreBtnRect;
        button(ctx, fullBtnRect, "FULLSCREEN", "#3fae60", hit(fullBtnRect, this.mx, this.my), 13);
        button(ctx, ignoreBtnRect, "IGNORE — DON'T SHOW AGAIN", "#4a5563", hit(ignoreBtnRect, this.mx, this.my), 11);
      } else {
        text(ctx, "Mobile: joystick to move | SPACE=Spread SHIFT=Defend", tipX + tipW / 2, topY + 18, 11, "#c9ffd6");
        text(ctx, "Buttons on right also work", tipX + tipW / 2, topY + 36, 10, "rgba(255,255,255,0.65)");
        this.mobileFullscreenBtn = null;
        this.mobileTipIgnoreBtn = null;
      }
      ctx.restore();
    } else {
      this.mobileFullscreenBtn = null;
      this.mobileTipIgnoreBtn = null;
    }

    // Draw last: these floating panels intentionally overlay every main-menu
    // control while open.
    // MobGallery 在独立文件(无源码),用外层变换实现划入动画:淡入 + 从底部滑入。
    if (this.mobGallery.visible) {
      const mgT = ease.outCubic(this.mobGalleryAnim);
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.mobGalleryAnim * 1.6);
      ctx.translate(0, (1 - mgT) * (H + 20));
      this.mobGallery.draw(ctx, this.time, W, H);
      ctx.restore();
    }
    this.changelog.draw(ctx, W, H);
    // Account panel overlays everything when open.
    this.accountSystem.draw(ctx);
    // Achievement panel (主菜单奖杯图标入口,与游戏内共用)
    this.achievements.drawPanel(ctx);
    // Challenge panel (主菜单 Hunting Quest 图标入口)
    this.challenges.drawPanel(ctx);
    // 天赋面板（最上层，主菜单 Talent 图标入口）。
    this.talent.draw(ctx);

    // Loadout 按钮与面板（主菜单也支持）
    this.drawLoadoutButton();
    if (this.loadoutPanelOpen) {
      this.drawLoadoutPanel();
    }

    // Arena 面板（主菜单 Arena 图标入口）
    this.arenaPanel.setBag(this.bag);
    this.arenaPanel.draw(ctx);

    // ─── "Coming soon" toast（未实现按钮的点击反馈）───
    if (this.menuToast && this.time < this.menuToast.until) {
      ctx.save();
      const alphaT = Math.min(1, (this.menuToast.until - this.time) * 2.5);
      ctx.globalAlpha = alphaT;
      const tw = Math.min(300, W - 40);
      const th = 44;
      const tx = W / 2 - tw / 2;
      const ty = H - 150;
      roundRect(ctx, tx, ty, tw, th, 10);
      ctx.fillStyle = 'rgba(20,24,34,0.92)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,231,99,0.6)';
      ctx.stroke();
      text(ctx, this.menuToast.text, W / 2, ty + th / 2, 15, '#ffe763');
      ctx.restore();
    } else if (this.menuToast) {
      this.menuToast = null;
    }

    // 主页面同样显示 AFK 检测提示(连接已建立时由服务端触发)。
    // 模态覆盖层画在一切面板之上。
    if (this.afkAnim > 0.01) this.renderAfkCheck();
    if (this.afkKicked) this.renderAfkKicked();
  }

  /**
   * Bonus 面板（参考 MainMenu._drawBonusPanel）：绘制在右上角
   * this.extraBonusButton 矩形内。适配本游戏的 BonusSystem API。
   */
  private _drawBonusPanel(ctx: CanvasRenderingContext2D, fontSize: number) {
    const [px, py, pw, ph] = this.extraBonusButton;
    const bonusSys = this.bonus;
    if (!bonusSys) return;

    // ===== 检测手机版 =====
    const isMobile = this.isMobile || this.w < 640;
    const scale = isMobile ? 0.7 : 1; // 手机版缩小到 70%

    // 如果是手机版，调整面板位置和大小
    let drawPx = px, drawPy = py, drawPw = pw, drawPh = ph;
    if (isMobile) {
        // 面板居中，缩小尺寸
        const centerX = px + pw / 2;
        const centerY = py + ph / 10;
        drawPw = pw * scale;
        drawPh = ph * scale;
        drawPx = centerX - drawPw / 2;
        drawPy = centerY - drawPh / 2;
    }

    const streakDays = bonusSys.streakDays || 0;
    const canClaim = bonusSys.canClaim();
    const isActive = bonusSys.isActive;
    const currentMult = bonusSys.isActive ? bonusSys.currentMultiplier : 1;
    const nextMult = bonusSys.nextBonusMultiplier;

    let remainingTime = "00:00";
    if (bonusSys.isActive) {
        const remaining = Math.max(0, bonusSys.remainingSeconds || 0);
        const minutes = Math.floor(remaining / 60);
        const seconds = Math.floor(remaining % 60);
        remainingTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    const panelColor = [220, 170, 40];
    const adj = (rgb: number[], f: number) => rgb.map(c => Math.max(0, Math.min(255, Math.floor(c * f))));

    // 手机版字体缩小
    const fs = isMobile ? fontSize * 0.7 : fontSize;
    const titleFs = isMobile ? fs + 1 : fs + 2;
    const multFs = isMobile ? fs + 3 : fs + 6;
    const btnFs = isMobile ? fs - 3 : fs - 2;
    const statusFs = isMobile ? fs - 5 : fs - 4;

    ctx.fillStyle = `rgb(${adj(panelColor, 1.1).join(',')})`;
    ctx.beginPath();
    ctx.roundRect(drawPx, drawPy, drawPw, drawPh, 14 * (isMobile ? 0.7 : 1));
    ctx.fill();

    ctx.fillStyle = `rgb(${adj(panelColor, 0.78).join(',')})`;
    ctx.beginPath();
    ctx.roundRect(drawPx, drawPy, drawPw, drawPh / 2, 14 * (isMobile ? 0.7 : 1));
    ctx.fill();

    ctx.strokeStyle = `rgb(${adj(panelColor, 0.55).join(',')})`;
    ctx.lineWidth = isMobile ? 2 : 4;
    ctx.beginPath();
    ctx.roundRect(drawPx, drawPy, drawPw, drawPh, 14 * (isMobile ? 0.7 : 1));
    ctx.stroke();

    // 标题
    const titleY = drawPy + (isMobile ? 12 : 18);
    this.drawStrokedText(ctx, `Daily Streak #${streakDays}`, drawPx + drawPw / 2, titleY, titleFs, 'center', 'white');

    // 星星和倍数(金铜色五角星图标 + 倍数文本)
    const starY = drawPy + (isMobile ? 32 : 48);
    drawStarIcon(ctx, drawPx + drawPw / 2 - (isMobile ? 16 : 22), starY, isMobile ? 10 : 14);
    this.drawStrokedText(ctx, `${nextMult}x`, drawPx + drawPw / 2 + (isMobile ? 12 : 18), starY, multFs, 'center', 'white');

    // 按钮尺寸
    const btnW = drawPw - (isMobile ? 12 : 20);
    const btnH = Math.max(isMobile ? 18 : 24, drawPh * (isMobile ? 0.15 : 0.18));
    const btn1X = drawPx + (isMobile ? 6 : 10);
    const btn1Y = drawPy + (isMobile ? 46 : 70);

    this._bonusClaimRect = [btn1X, btn1Y, btnW, btnH];
    const claimHover = this.hoveredButton === 'bonus_claim';
    let claimColor = canClaim ? (claimHover ? [255, 235, 100] : [255, 215, 0]) : (claimHover ? [180, 180, 180] : [140, 140, 140]);

    // Claim 按钮
    ctx.fillStyle = `rgb(${claimColor.join(',')})`;
    ctx.beginPath();
    ctx.roundRect(btn1X, btn1Y, btnW, btnH, isMobile ? 5 : 8);
    ctx.fill();
    ctx.fillStyle = `rgb(${adj(claimColor, 0.85).join(',')})`;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(btn1X, btn1Y, btnW, btnH, isMobile ? 5 : 8);
    ctx.clip();
    ctx.fillRect(btn1X, btn1Y, btnW, btnH / 2);
    ctx.restore();
    ctx.strokeStyle = `rgb(${adj(claimColor, 0.65).join(',')})`;
    ctx.lineWidth = isMobile ? 2 : 3;
    ctx.beginPath();
    ctx.roundRect(btn1X, btn1Y, btnW, btnH, isMobile ? 5 : 8);
    ctx.stroke();

    const claimLabel = isMobile ? 'Claim' : 'Claim Rewards';
    this.drawStrokedText(ctx, claimLabel, btn1X + btnW / 2, btn1Y + btnH / 2, btnFs, 'center', '#ffffff');

    // Extra Bonus 按钮
    const btn2X = drawPx + (isMobile ? 6 : 10);
    const btn2Y = btn1Y + btnH + (isMobile ? 4 : 8);
    this._bonusExtraRect = [btn2X, btn2Y, btnW, btnH];

    const extraActive = (this.extraBonusActive && Date.now() < this.extraBonusExpireTime) ||
                        this.extraBonusPermanent || this.rubyMembershipActive;
    const extraHover = this.hoveredButton === 'bonus_extra';
    let extraColor: number[], extraText: string;
    if (extraActive) {
        extraColor = extraHover ? [80, 180, 80] : [60, 160, 60];
        extraText = isMobile ? `Extra (${remainingTime})` : `Extra Bonus (${remainingTime})`;
    } else {
        extraColor = extraHover ? [150, 150, 150] : [120, 120, 120];
        extraText = isMobile ? 'Extra (inactive)' : 'Extra Bonus (inactive)';
    }

    ctx.fillStyle = `rgb(${extraColor.join(',')})`;
    ctx.beginPath();
    ctx.roundRect(btn2X, btn2Y, btnW, btnH, isMobile ? 5 : 8);
    ctx.fill();
    ctx.fillStyle = `rgb(${adj(extraColor, 0.75).join(',')})`;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(btn2X, btn2Y, btnW, btnH, isMobile ? 5 : 8);
    ctx.clip();
    ctx.fillRect(btn2X, btn2Y, btnW, btnH / 2);
    ctx.restore();
    ctx.strokeStyle = `rgb(${adj(extraColor, 0.55).join(',')})`;
    ctx.lineWidth = isMobile ? 2 : 3;
    ctx.beginPath();
    ctx.roundRect(btn2X, btn2Y, btnW, btnH, isMobile ? 5 : 8);
    ctx.stroke();
    this.drawStrokedText(ctx, extraText, btn2X + btnW / 2, btn2Y + btnH / 2, btnFs, 'center', 'white');

    // 底部状态文字
    if (isActive) {
        const statusY = drawPy + drawPh - (isMobile ? 6 : 8);
        const statusText = isMobile ? `${currentMult}x ${remainingTime}` : `Active: ${currentMult}x  ·  ${remainingTime}`;
        this.drawStrokedText(ctx, statusText, drawPx + drawPw / 2, statusY, statusFs, 'center', 'rgba(255,255,255,0.8)');
    }
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

    // Ensure biome is up to date. Walls are drawn from the authoritative
    // rectangle list (`this.walls`) instead of the old raster cache so the
    // visuals always match collision exactly and never get stuck with an
    // empty/stale WALL_DATA entry while joining a biome.
    const mapName = map.name || "Garden";
    if (this.currentBiome !== mapName) {
      this.currentBiome = mapName;
    }

    const zoom = Math.min(1.15, Math.max(0.72, Math.min(this.w / 1280, this.h / 800) * 1.05));
    // Antennae petals zoom the camera out (smaller zoom = see more world).
    // The bonus is subtracted from zoom, clamped to a minimum of 0.35.
    const antBonus = antennaeViewBonus(this.slots);
    this.viewZoom = Math.max(0.35, zoom - antBonus);

    const isArena = this.arenaPanel.state === 'in-game';

    if (isArena) {
      // Arena 模式：独立地图，不叠加在普通地图上
      this.renderArenaBattlefield(ctx);
    } else {
      // 正常模式：渲染地图地面和墙壁
      const groundColor = BIOME_BACKGROUNDS[this.currentBiome]?.ground_color || [30, 174, 99];
      if (this.currentBiome === "Ocean" || this.currentBiome === "Desert") {
        this.drawWavesDirect(ctx, { x: this.camX, y: this.camY }, groundColor);
      } else {
        this.drawBackgroundPattern(ctx, { x: this.camX, y: this.camY }, groundColor);
      }
      if (this.settings.cacheCanvas) {
        this.drawWallsCached(ctx, { x: this.camX, y: this.camY });
      }
    }

    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(this.viewZoom, this.viewZoom);
    ctx.translate(-this.camX, -this.camY);

    if (isArena) {
      // Arena 世界中渲染网格、墙和边界
      this.renderArenaWorld(ctx);
    } else {
      const viewW = this.w / this.viewZoom;
      const viewH = this.h / this.viewZoom;

      // out-of-bounds shading
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      const ob = 4000;
      ctx.fillRect(this.camX - viewW, -ob, viewW * 2, ob);
      ctx.fillRect(this.camX - viewW, this.worldH, viewW * 2, ob);
      ctx.fillRect(-ob, this.camY - viewH, ob, viewH * 2);
      ctx.fillRect(this.worldW, this.camY - viewH, ob, viewH * 2);

      // walls（缓存开启时由 drawWallsCached blit 墙壁缓存，避免重复绘制）
      if (!this.settings.cacheCanvas) this.drawWallsFromData(ctx, { x: this.camX, y: this.camY });
    }

    // entities
    const list = [...this.ents.values()].sort((a, b) => a.kind - b.kind || a.y - b.y);
    for (const e of list) {
      if (e.kind === ENT.DROP) this.drawDrop(e);
    }
    for (const e of list) {
      if (e.kind === ENT.PETAL) this.drawPetalEnt(e);
      else if (e.kind === ENT.MOB) this.drawMobEnt(e);
      else if (e.kind === ENT.PLAYER) this.drawPlayerEnt(e);
      else if (e.kind === ENT.PROJECTILE) this.drawProjectileEnt(e);
    }

    // Draw the burst produced when a Rose reaches the flower.
    // The moving Rose is the normal ENT.PETAL drawn above.
    // Draw Rose particles
    for (const rp of this.roseParticles) {
      ctx.save();
      ctx.globalAlpha = rp.life / rp.maxLife;
      ctx.fillStyle = rp.color;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // floaters live in world space
    for (const f of this.floaters) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
      text(ctx, f.msg, f.x, f.y, 16, f.color);
      ctx.restore();
    }
    ctx.restore(); // 恢复世界变换

    // 恢复 arena 圆形裁剪
    if (isArena) ctx.restore();

    if (!isArena && this.mapFlash > 0) {
      ctx.save();
      ctx.globalAlpha = this.mapFlash * 0.8;
      ctx.fillStyle = map.accent;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();
      text(ctx, map.name, this.w / 2, this.h / 2 - 120, 44 + (1 - this.mapFlash) * 6, "#ffffff");
    }

    this.renderHud();
        // Chat system overlay (bottom-left, above hotbar)
    this.chat.width = Math.min(400, this.w * 0.35);
    // 手机版：再往上抬一点（在快捷栏上面一点点）
    const chatLift = this.isMobile || this.w < 640 ? 76 : 50;
    this.chat.draw(this.ctx, this.h - this.hotbarHeight() + chatLift);
    this.renderBag();
    this.renderCraft();

    // 天赋面板（游戏内由主菜单 Talent 入口打开后显示在最上层）。
    this.talent.draw(this.ctx);

    // Arena 面板（游戏内也可显示）
    this.arenaPanel.setBag(this.bag);
    this.arenaPanel.draw(ctx);

if (this.drag) {
  const size = 60;
  // 摆动动画：使用正弦波产生左右摆动
  const swingAmount = 10; // 摆动幅度（像素）
  const swingSpeed = 6; // 摆动速度
  const swing = Math.sin(this.time * swingSpeed) * swingAmount;

  // 添加轻微的旋转摆动
  const rotationAmount = 0.09; // 弧度
  const rotSwing = Math.sin(this.time * swingSpeed) * rotationAmount;

  ctx.save();
  ctx.translate(this.dragX, this.dragY);
  ctx.rotate(rotSwing);
  ctx.translate(-this.dragX, -this.dragY);

  drawCard(ctx, {
    x: this.dragX - size / 2 + swing,
    y: this.dragY - size / 2,
    w: size,
    h: size
  }, this.drag.cell, {
    hovered: true,
    scale: 1.1,
  });

  ctx.restore();
}
    if (!this.alive) this.renderDeath();
    // Achievement unlock popup (bottom-right) + panel (centered, on top of HUD)
    this.achievements.drawPopup(ctx);
    this.achievements.drawPanel(ctx);
    // The AFK prompt sits above the death screen: answering it matters even
    // while dead, since an idle corpse still holds a server slot.
    if (this.afkAnim > 0.01) this.renderAfkCheck();
    if (this.afkKicked) this.renderAfkKicked();
    else if (!this.connected) {
      panel(ctx, { x: this.w / 2 - 120, y: 16, w: 240, h: 40 });
      text(ctx, "connecting to server...", this.w / 2, 36, 16, "#ffe763");
    } else if (this.stallNoticeAnim > 0.01) {
      // Still connected, but snapshots stopped arriving. The world above is
      // the last known scene, held until the stream recovers.
      ctx.save();
      ctx.globalAlpha = this.stallNoticeAnim;
      panel(ctx, { x: this.w / 2 - 130, y: 16, w: 260, h: 40 });
      const dots = ".".repeat(1 + (Math.floor(this.time * 2) % 3));
      text(ctx, `waiting for server${dots}`, this.w / 2, 36, 16, "#ffb066");
      ctx.restore();
    }
    // Account panel overlays the game scene too, so the player can access
    // it without returning to the main menu.
    this.accountSystem.draw(ctx);

    // Loadout 按钮与面板
    this.drawLoadoutButton();
    if (this.loadoutPanelOpen) {
      this.drawLoadoutPanel();
    }
  }

  private renderArenaBattlefield(ctx: CanvasRenderingContext2D) {
    // 屏幕空间：深色背景 + 圆形裁剪
    const cx = this.w / 2;
    const cy = this.h / 2;
    const radius = Math.min(this.w, this.h) / 2;

    // 先填充整个画布为深色，覆盖任何普通地图残留
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, this.w, this.h);

    // 圆形裁剪 - 整个 arena 内容都在这个圆内
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    // 深色背景（仅在圆内可见）
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, this.w, this.h);

    // 注意：不 restore 裁剪，保持裁剪作用到后续的 world 渲染
    // 在 renderGame 中，entities 和 arenaWorld 都在这个裁剪内渲染
    // 裁剪由 renderGame 末尾的 restore 恢复
  }

  private renderArenaWorld(ctx: CanvasRenderingContext2D) {
    const R = 4000; // 球形战场半径
    const arenaCenterX = 4000; // 战场中心世界坐标
    const arenaCenterY = 4000;

    // 网格地板 - 同心圆（世界坐标）
    for (let r = 200; r <= R; r += 200) {
      ctx.strokeStyle = r % 800 === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(arenaCenterX, arenaCenterY, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 极轴线（世界坐标）
    for (let a = 0; a < 360; a += 30) {
      const rad = a * Math.PI / 180;
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.moveTo(arenaCenterX, arenaCenterY);
      ctx.lineTo(arenaCenterX + Math.cos(rad) * R, arenaCenterY + Math.sin(rad) * R);
      ctx.stroke();
    }

    // 边界圆环（世界坐标）
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(arenaCenterX, arenaCenterY, R, 0, Math.PI * 2);
    ctx.stroke();

    // 随机墙（世界坐标）
    if (this.arenaWalls) {
      ctx.fillStyle = '#2c3e50';
      ctx.strokeStyle = '#444';
      ctx.lineWidth = 1;
      for (const wall of this.arenaWalls) {
        ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
        ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
      }
    }
  }


  // ================================================================
  // Loadout UI
  // ================================================================

  private drawLoadoutButton() {
    const ctx = this.ctx;
    const barWidth = SLOT_COUNT * 52;
    const startX = (this.w - barWidth) / 2;
    const x = startX + barWidth + 120;
    const y = this.h - this.hotbarHeight() + 4;
    const size = this.LOADOUT_BTN_SIZE;

    // 先记录按钮矩形（供悬停判定与点击命中使用）
    this.loadoutBtnRect = { x, y, w: size, h: size };

    // ── 按钮底：参考 drawLoadout 的样式（悬停高亮 + 上半部加深 + 描边）──
    const adjust = (rgb: number[], f: number) =>
      rgb.map(c => Math.max(0, Math.min(255, Math.floor(c * f))));
    const baseColor = hit(this.loadoutBtnRect, this.mx, this.my)
      ? this.LOADOUT_BUTTON_HOVER_COLOR
      : this.LOADOUT_BUTTON_COLOR;
    const darkColor  = `rgb(${adjust(baseColor, 0.85).join(',')})`;
    const lightColor = `rgb(${baseColor.join(',')})`;
    const strokeColor = `rgb(${adjust(baseColor, 0.5).join(',')})`;

    ctx.beginPath();
    roundRect(ctx, x, y, size, size, 10);
    ctx.fillStyle = lightColor;
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, x, y, size, size, 10);
    ctx.clip();
    ctx.fillStyle = darkColor;
    ctx.fillRect(x, y, size, size / 2);
    ctx.restore();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    // ── 图标：长方形 + 3 个圆（枪形 loadout 图标）──
    const cx = x + size / 2;
    const cy = y + size / 2;
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1.5;

    // 1) 长方形：枪身
    ctx.beginPath();
    roundRect(ctx, cx - 9, cy - 1, 20, 6, 2);
    ctx.fill();
    ctx.stroke();

    // 2) 圆 1：顶部弹仓
    ctx.beginPath();
    ctx.arc(cx - 4, cy - 6, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 3) 圆 2：前端枪口
    ctx.beginPath();
    ctx.arc(cx + 13, cy + 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 4) 圆 3：下方握把
    ctx.beginPath();
    ctx.arc(cx - 7, cy + 10, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  private drawLoadoutPanel() {
    const ctx = this.ctx;
    // 面板尺寸（小屏自动收窄，避免溢出）
    const w = Math.min(this.LOADOUT_PANEL_W, this.w - 24);
    const h = Math.min(this.LOADOUT_PANEL_H, this.h - 48);
    const x = Math.max(12, (this.w - w) / 2);
    const y = Math.max(24, (this.h - h) / 2);

    // 1. 半透明背景蒙版
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, this.w, this.h);

    // 2. 面板主体（参考 drawLoadout：深色底 + 投影 + 紫色描边）
    ctx.save();
    ctx.shadowBlur = 30;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.fillStyle = 'rgba(12, 12, 25, 0.98)';
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, 15);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(155, 89, 182, 0.7)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 3. 标题（Loadouts Gallery）
    ctx.font = `${w < 380 ? 16 : 20}px ${FONT_FAMILY}`;
    ctx.fillStyle = 'white';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Loadouts Gallery', x + 25, y + 32);

    // 4. 右上角关闭按钮
    const closeX = x + w - 18;
    const closeY = y + 18;
    ctx.fillStyle = 'rgba(231, 76, 60, 0.9)';
    ctx.beginPath();
    ctx.arc(closeX, closeY, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = `14px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', closeX, closeY + 1);
    this.loadoutCloseRect = { x: closeX - 12, y: closeY - 12, w: 24, h: 24 };

    // 5. 保存按钮（Save Current，悬停高亮，参考 drawLoadout 的 _saveBtnRect 样式）
    const saveX = x + w - 150;
    const saveY = y + 16;
    const saveW = 100;
    const saveH = 32;
    const isSaveHover = hit({ x: saveX, y: saveY, w: saveW, h: saveH }, this.mx, this.my);
    const sCol = isSaveHover ? [142, 68, 173] : [100, 60, 150];
    ctx.fillStyle = `rgb(${sCol.join(',')})`;
    ctx.beginPath();
    roundRect(ctx, saveX, saveY, saveW, saveH, 8);
    ctx.fill();
    ctx.strokeStyle = `rgb(${sCol.map(c => Math.max(0, Math.min(255, Math.floor(c * 0.6)))).join(',')})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `13px ${FONT_FAMILY}`;
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Save Current', saveX + saveW / 2, saveY + saveH / 2);
    this.loadoutSaveBtnRect = { x: saveX, y: saveY, w: saveW, h: saveH };

    // 6. 保存命名输入框
    this.drawLoadoutInput(x + 20, y + 56, w - 40, "Enter Name...", this.loadoutInput);

    // 7. 分割线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 15, y + 92);
    ctx.lineTo(x + w - 15, y + 92);
    ctx.stroke();

    // 8. 已保存 Loadout 列表（大卡片 + 操作按钮 + 滚动）
    const listTop = y + 105;
    const maxVisible = 5;
    const spacing = 14;
    const total = this.loadouts.length;
    const itemH = Math.max(72, Math.floor((h - (listTop - y) - 40 - (maxVisible - 1) * spacing) / maxVisible));

    this.loadoutItemRects = [];
    this.loadoutScrollUpRect = { x: 0, y: 0, w: 0, h: 0 };
    this.loadoutScrollDownRect = { x: 0, y: 0, w: 0, h: 0 };

    if (total === 0) {
      ctx.font = `18px ${FONT_FAMILY}`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No Loadouts Saved', x + w / 2, y + h / 2);
      return;
    }

    this.loadoutScroll = Math.max(0, Math.min(this.loadoutScroll, total - maxVisible));
    const startIdx = this.loadoutScroll;
    const withScroll = total > maxVisible;
    const iw = w - 40 - (withScroll ? 30 : 0);
    const cardSize = Math.max(32, Math.floor(iw * 0.1));
    const cardGap = 5;

    for (let vi = 0; vi < maxVisible && startIdx + vi < total; vi++) {
      const realIdx = startIdx + vi;
      const lo = this.loadouts[realIdx];
      const iy = listTop + vi * (itemH + spacing);
      const ix = x + 20;

      // 记录整行可点击区域
      const rowRect: Rect = { x: ix, y: iy, w: iw, h: itemH };

      // 卡片背景（当前激活的 loadout 高亮，悬停时也高亮）
      const rowHovered = hit(rowRect, this.mx, this.my);
      ctx.fillStyle = lo.active ? 'rgba(155, 89, 182, 0.35)' : (rowHovered ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.05)');
      ctx.beginPath();
      roundRect(ctx, ix, iy, iw, itemH, 12);
      ctx.fill();
      if (lo.active) {
        ctx.strokeStyle = 'rgba(155, 89, 182, 0.9)';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (rowHovered) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // 名称
      ctx.font = `17px ${FONT_FAMILY}`;
      ctx.fillStyle = 'white';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`${realIdx + 1}. ${lo.name || "Unnamed Loadout"}`, ix + 15, iy + 12);

      // 物品卡片（用 drawCard 替代之前的 drawItemIcon）
      const cardY = iy + itemH - cardSize - 8;
      const maxCards = Math.min(8, lo.slots.length);
      const totalCardsW = maxCards * (cardSize + cardGap) - cardGap;
      const cardStartX = ix + 15;
      // 如果卡片总宽度超出可用区域，缩小卡片尺寸
      let finalCardSize = cardSize;
      let finalCardGap = cardGap;
      if (cardStartX + totalCardsW > ix + iw - 140) {
        const available = (ix + iw - 140) - cardStartX;
        finalCardSize = Math.max(22, Math.floor((available - (maxCards - 1) * 3) / maxCards));
        finalCardGap = 3;
      }
      for (let si = 0; si < maxCards; si++) {
        const cell = lo.slots[si];
        const cx2 = cardStartX + si * (finalCardSize + finalCardGap);
        if (cell) {
          drawCard(ctx, { x: cx2, y: cardY, w: finalCardSize, h: finalCardSize }, { item: cell.item, rarity: cell.rarity, count: cell.count }, { hovered: false, dim: 1 });
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
          ctx.beginPath();
          roundRect(ctx, cx2, cardY, finalCardSize, finalCardSize, 4);
          ctx.fill();
        }
      }

      // 操作按钮（Load / Delete；Update 协议未提供，故不绘制）——置于右上角，
      // 迷你图标整行排在按钮下方，避免两者重叠。
      const btnW = 55, btnH = 24, gap = 10;
      const by = iy + 8;
      const loadBx = ix + iw - 2 * (btnW + gap) - 15;
      const delBx = ix + iw - (btnW + gap) - 15;
      this.loadoutItemRects[realIdx] = {
        y: iy,
        row: rowRect,
        load: { x: loadBx, y: by, w: btnW, h: btnH },
        del: { x: delBx, y: by, w: btnW, h: btnH },
      };
      const drawP = (bx2: number, label: string, color: string) => {
        const isH = hit({ x: bx2, y: by, w: btnW, h: btnH }, this.mx, this.my);
        ctx.fillStyle = isH ? color : `${color}aa`;
        ctx.beginPath();
        roundRect(ctx, bx2, by, btnW, btnH, 6);
        ctx.fill();
        ctx.font = `11px ${FONT_FAMILY}`;
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, bx2 + btnW / 2, by + btnH / 2);
      };
      drawP(loadBx, 'Load', '#27ae60');
      drawP(delBx, 'Delete', '#e74c3c');
    }

    // 9. 滚动箭头（多于 5 个时显示）
    if (withScroll) {
      const upX = x + w - 30;
      const upY = listTop;
      const downY = y + h - 40;
      this.loadoutScrollUpRect = { x: upX, y: upY, w: 25, h: 25 };
      this.loadoutScrollDownRect = { x: upX, y: downY, w: 25, h: 25 };
      ctx.fillStyle = 'rgba(155, 89, 182, 0.6)';
      ctx.beginPath(); roundRect(ctx, upX, upY, 25, 25, 5); ctx.fill();
      ctx.beginPath(); roundRect(ctx, upX, downY, 25, 25, 5); ctx.fill();
      ctx.font = `14px ${FONT_FAMILY}`;
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('▲', upX + 12.5, upY + 13);
      ctx.fillText('▼', upX + 12.5, downY + 13);
    }
  }

  private drawLoadoutInput(x: number, y: number, w: number, placeholder: string, val: string) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.strokeStyle = 'rgba(155, 89, 182, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    roundRect(ctx, x, y, w, 30, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = val ? 'white' : 'rgba(255, 255, 255, 0.35)';
    ctx.font = `14px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(val || placeholder, x + 10, y + 15);

    this.loadoutInputRect = { x, y, w, h: 30 };
  }

  /** 将 loadouts 保存到 localStorage */
  private saveLoadoutsLocal() {
    try {
      localStorage.setItem(LOADOUT_SAVE_KEY, JSON.stringify(this.loadouts));
      if (CloudStorage.isReady) {
        CloudStorage.instance.set(LOADOUT_SAVE_KEY, this.loadouts);
      }
    } catch {
      /* ignore */
    }
  }

  /** 从 localStorage 加载 loadouts */
  private loadLoadoutsLocal() {
    try {
      const raw = localStorage.getItem(LOADOUT_SAVE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          this.loadouts = data;
        }
      }
    } catch {
      /* ignore */
    }
  }

  private drawButton(x: number, y: number, w: number, h: number, text: string, color: string) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'white';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2);
  }

  private wallExteriorPath(visibleWalls: Wall[], blockers: Wall[]): Path2D {
    const path = new Path2D();
    const EPS = 0.0001;

    const subtractInterval = (
      intervals: [number, number][],
      cutA: number,
      cutB: number,
    ): [number, number][] => {
      const a = Math.min(cutA, cutB);
      const b = Math.max(cutA, cutB);
      if (b <= a + EPS) return intervals;
      const out: [number, number][] = [];
      for (const [start, end] of intervals) {
        if (b <= start + EPS || a >= end - EPS) {
          out.push([start, end]);
          continue;
        }
        if (a > start + EPS) out.push([start, Math.min(a, end)]);
        if (b < end - EPS) out.push([Math.max(b, start), end]);
      }
      return out;
    };

    const addVertical = (x: number, intervals: [number, number][]) => {
      for (const [y1, y2] of intervals) {
        if (y2 <= y1 + EPS) continue;
        path.moveTo(x, y1);
        path.lineTo(x, y2);
      }
    };
    const addHorizontal = (y: number, intervals: [number, number][]) => {
      for (const [x1, x2] of intervals) {
        if (x2 <= x1 + EPS) continue;
        path.moveTo(x1, y);
        path.lineTo(x2, y);
      }
    };

    for (const w of visibleWalls) {
      const left = w.x;
      const right = w.x + w.w;
      const top = w.y;
      const bottom = w.y + w.h;

      let leftIntervals: [number, number][] = [[top, bottom]];
      let rightIntervals: [number, number][] = [[top, bottom]];
      let topIntervals: [number, number][] = [[left, right]];
      let bottomIntervals: [number, number][] = [[left, right]];

      for (const o of blockers) {
        if (o === w || o.w <= 0 || o.h <= 0) continue;
        const oLeft = o.x;
        const oRight = o.x + o.w;
        const oTop = o.y;
        const oBottom = o.y + o.h;

        // If another wall touches or overlaps the outside of this side, that
        // shared span is inside the wall union and must not receive a border.
        if (oLeft < left - EPS && oRight >= left - EPS) {
          leftIntervals = subtractInterval(leftIntervals, oTop, oBottom);
        }
        if (oLeft <= right + EPS && oRight > right + EPS) {
          rightIntervals = subtractInterval(rightIntervals, oTop, oBottom);
        }
        if (oTop < top - EPS && oBottom >= top - EPS) {
          topIntervals = subtractInterval(topIntervals, oLeft, oRight);
        }
        if (oTop <= bottom + EPS && oBottom > bottom + EPS) {
          bottomIntervals = subtractInterval(bottomIntervals, oLeft, oRight);
        }
      }

      addHorizontal(top, topIntervals);
      addVertical(right, rightIntervals);
      addHorizontal(bottom, bottomIntervals);
      addVertical(left, leftIntervals);
    }

    return path;
  }
    private buildWallPolygons(): { x: number; y: number }[][] {
    const map = MAPS[this.mapId] ?? MAPS[0];
    const size = 256;
    const cellW = map.width / size;
    const cellH = map.height / size;


    // 1. 栅格化
    const grid = new Uint8Array(size * size);
    for (const w of this.walls) {
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

    // 2. 提取轮廓边缘
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

    // 3. 简化多边形 (去除直线上的冗余点)
    const simplified = rawLoops.map(loop => {
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
    });

    // 4. 添加噪声 (确定性噪声)
    // 使用简单的哈希函数代替随机数，保证墙壁形状固定
    const noise = (x: number, y: number) => {
      let h = x * 374761393 + y * 668265263;
      h = (h ^ (h >> 13)) * 1274126177;
      h = h ^ (h >> 16);
      return (h & 0x7fffffff) / 0x7fffffff;
    };

    const PTS_PER_CELL = 1;  // 原值是 7。改为 0.5 意味着“每2个单位才产生一个点”。
                                // 8000 的长度将只生成 4000 个点（原来是 56000+ 个），压力骤减。

    const BIG_AMP = 0.4;       // 保持或稍微增大。点变少了，每个点的波动要稍微明显一点才看得出效果。
    const FINE_AMP = 0.2;      // 保持或稍微增大。同上，细节波动要明显一点。

    const BIG_FREQ = 0.08;     // 降低频率。原来的 0.1 在长距离上会产生很多波动，降低它可以减少计算次数。
    const FINE_FREQ = 1.8;

    return simplified.map((loop) => {
      const pts: { x: number; y: number }[] = [];
      const n = loop.length;

      // 从 n-1 遍历到 0 (倒序)
      for (let i = n - 1; i >= 0; i--) {
        const p1 = loop[i];
        const p2 = loop[(i - 1 + n) % n]; // 配合倒序，取前一个点

        const horizontal = p1.y === p2.y;
        const len = horizontal ? Math.abs(p2.x - p1.x) : Math.abs(p2.y - p1.y);
        const steps = Math.max(1, Math.round(len * PTS_PER_CELL));

        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          const wx = p1.x + (p2.x - p1.x) * t;
          const wy = p1.y + (p2.y - p1.y) * t;

          let j = 0;
          if (s !== 0) {
            // 使用坐标作为噪声参数，而不是随机数
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

      return pts;
    });
  }
drawWallsFromData(ctx: CanvasRenderingContext2D, c: { x: number; y: number }) {
    if (!this.walls.length) return;
    if (this.settings.lowQualityWall) {
        this.drawWallsLegacy(ctx, c);
        return;
    }
    const cx = Math.round(c.x * 100) / 100;
    const cy = Math.round(c.y * 100) / 100;
    const viewScale = Math.round((this.viewZoom || 1) * 100) / 100;
    const vw = Math.round((this.w / viewScale) * 100) / 100;
    const vh = Math.round((this.h / viewScale) * 100) / 100;
    const left = Math.round((cx - vw / 2) * 100) / 100;
    const right = Math.round((cx + vw / 2) * 100) / 100;
    const top = Math.round((cy - vh / 2) * 100) / 100;
    const bottom = Math.round((cy + vh / 2) * 100) / 100;
    const pad = Math.round((2000 / viewScale) * 100) / 100;


    // 获取多边形
    const cacheKey = `${this.mapId}_${this.walls.length}`;
    let polygons = this.wallPolygonsCache?.get(cacheKey);
    if (!polygons) {
      polygons = this.buildWallPolygons();
      if (!this.wallPolygonsCache) this.wallPolygonsCache = new Map();
      this.wallPolygonsCache.set(cacheKey, polygons);
    }

    // 视野裁剪（边界框检查）
    const visiblePolygons = polygons.filter(poly => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const pt of poly) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
      return minX <= right && maxX >= left &&
             minY <= bottom && maxY >= top;
    });

    if (!visiblePolygons.length) {
      return;
    }

    // 纹理缓存
    const biomeKey = this.currentBiome;
    if (!this.wallPatternCache) this.wallPatternCache = new Map();
    let cachedPattern = this.wallPatternCache.get(biomeKey) ?? null;

    if (!cachedPattern) {
      const s = 512, cv = document.createElement('canvas');
      cv.width = cv.height = s;
      const g = cv.getContext('2d');
      if (g) {
        const b = BIOME_BACKGROUNDS[this.currentBiome]?.wall_color || [80, 80, 80];
        g.fillStyle = `rgb(${b[0]},${b[1]},${b[2]})`;
        g.fillRect(0, 0, s, s);
        g.fillStyle = `rgba(${Math.max(0, b[0] - 25)}, ${Math.max(0, b[1] - 25)}, ${Math.max(0, b[2] - 25)}, .5)`;
        for (let i = 0; i < 17; i++) {
          const r = 5 + Math.random() * 10;
          const x = Math.random() * s;
          const y = Math.random() * s;
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
      }
      cachedPattern = ctx.createPattern(cv, 'repeat');
      if (cachedPattern) this.wallPatternCache.set(biomeKey, cachedPattern);
    }
    if (cachedPattern) this.wallPattern = cachedPattern;
    this._wallPatternBiome = this.currentBiome;

    const bgConfig = BIOME_BACKGROUNDS[this.currentBiome];
    const wallColor = bgConfig?.wall_color || [80, 80, 80];
    const darkColor = `rgb(${Math.max(0, wallColor[0] - 50)}, ${Math.max(0, wallColor[1] - 50)}, ${Math.max(0, wallColor[2] - 50)})`;
    const groundColor = bgConfig?.ground_color || [80, 80, 80];
    const lightColor = `rgba(${Math.max(0, groundColor[0] - 30)}, ${Math.max(0, groundColor[1] - 30)}, ${Math.max(0, groundColor[2] - 30)}, 0.4)`;
    const outlineScale = 1 / viewScale;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // 1. 浅色粗描边
    ctx.strokeStyle = lightColor;
    ctx.lineWidth = 36 / outlineScale;
    ctx.beginPath();
    for (const poly of visiblePolygons) {
      if (poly.length < 3) continue;
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
    }
    ctx.stroke();

    // 2. 填充纹理（裁剪到视野）
    ctx.save();
    ctx.beginPath();
    ctx.rect(left - pad, top - pad, (right - left) + pad * 2, (bottom - top) + pad * 2);
    ctx.clip();

    ctx.fillStyle = this.wallPattern ?? `rgb(${wallColor[0]},${wallColor[1]},${wallColor[2]})`;
    ctx.beginPath();
    for (const poly of visiblePolygons) {
      if (poly.length < 3) continue;
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();

    // 3. 深色细描边
    ctx.strokeStyle = darkColor;
    ctx.lineWidth = 12 / outlineScale;
    ctx.beginPath();
    for (const poly of visiblePolygons) {
      if (poly.length < 3) continue;
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
    }
    ctx.stroke();

    // 4. 再次填充（修正内边框）
    ctx.save();
    ctx.beginPath();
    ctx.rect(left - pad, top - pad, (right - left) + pad * 2, (bottom - top) + pad * 2);
    ctx.clip();

    ctx.fillStyle = this.wallPattern ?? `rgb(${wallColor[0]},${wallColor[1]},${wallColor[2]})`;
    ctx.beginPath();
    for (const poly of visiblePolygons) {
      if (poly.length < 3) continue;
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();

    ctx.restore();
}
  private drawWallsLegacy(ctx: CanvasRenderingContext2D, c: { x: number; y: number }) {
    if (!this.walls.length) return;

    // Draw directly from the authoritative wall rectangles received from the
    // sim. The previous renderer converted walls to a 64px raster first; that
    // rounded every rectangle outward and could also cache an empty grid before
    // the server's wall list arrived (Garden then had collision but no visible
    // walls). Direct rectangles keep the drawn footprint identical to collision
    // for every biome.
    const cx = c.x;
    const cy = c.y;
    const viewScale = this.viewZoom || 1;
    const vw = this.w / viewScale;
    const vh = this.h / viewScale;
    const left = cx - vw / 2;
    const right = cx + vw / 2;
    const top = cy - vh / 2;
    const bottom = cy + vh / 2;
    const pad = 80 / viewScale;

    const visibleWalls = this.walls.filter((w) =>
      w.x + w.w >= left - pad && w.x <= right + pad &&
      w.y + w.h >= top - pad && w.y <= bottom + pad,
    );
    if (!visibleWalls.length) return;

    if (!this.wallPattern || this._wallPatternBiome !== this.currentBiome) {
      const s = 512, cv = document.createElement('canvas');
      cv.width = cv.height = s;
      const g = cv.getContext('2d');
      if (g) {
        const b = BIOME_BACKGROUNDS[this.currentBiome]?.wall_color || [80, 80, 80];
        g.fillStyle = `rgb(${b[0]},${b[1]},${b[2]})`;
        g.fillRect(0, 0, s, s);
        g.fillStyle = `rgba(${Math.max(0, b[0] - 25)}, ${Math.max(0, b[1] - 25)}, ${Math.max(0, b[2] - 25)}, .5)`;
        for (let i = 0; i < 17; i++) {
          const r = 5 + Math.random() * 10;
          const x = Math.random() * s;
          const y = Math.random() * s;
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
      }
      this.wallPattern = ctx.createPattern(cv, 'repeat');
      this._wallPatternBiome = this.currentBiome;
    }

    const path = new Path2D();
    for (const w of visibleWalls) path.rect(w.x, w.y, w.w, w.h);
    const exteriorPath = this.wallExteriorPath(visibleWalls, this.walls);

    const bgConfig = BIOME_BACKGROUNDS[this.currentBiome];
    const wallColor = bgConfig?.wall_color || [80, 80, 80];
    const darkColor = `rgb(${Math.max(0, wallColor[0] - 50)}, ${Math.max(0, wallColor[1] - 50)}, ${Math.max(0, wallColor[2] - 50)})`;
    const groundColor = bgConfig?.ground_color || [80, 80, 80];
    const lightColor = `rgba(${Math.max(0, groundColor[0] - 30)}, ${Math.max(0, groundColor[1] - 30)}, ${Math.max(0, groundColor[2] - 30)}, 0.4)`;
    const outlineScale = 1 / viewScale;

    ctx.save();
    ctx.lineJoin = 'round';
    // Exterior sides are stroked as individual path segments after internal
    // shared spans have been removed. Butt caps prevent rounded caps from
    // showing at places where two neighbouring wall rectangles meet.
    ctx.lineCap = 'butt';

    // Clip all decoration to the wall path. This prevents the art from
    // extending past the collision rectangles, which made Desert/Ocean walls
    // appear larger than the actual blocked area.
    ctx.clip(path);
    ctx.fillStyle = this.wallPattern || `rgb(${wallColor[0]},${wallColor[1]},${wallColor[2]})`;
    ctx.fill(path);

    if (!this.settings.lowQualityWall) {
      ctx.strokeStyle = lightColor;
      ctx.lineWidth = 28 * outlineScale;
      ctx.stroke(exteriorPath);
    }

    ctx.strokeStyle = darkColor;
    ctx.lineWidth = (this.settings.lowQualityWall ? 4 : 10) * outlineScale;
    ctx.stroke(exteriorPath);

    ctx.restore();
  }


  /**
   * 墙壁缓存：cache canvas 只缓存墙壁（不缓存地面）。
   * 相机跨瓦片 / 缩放 / 换图 / 墙壁数量变化时重建；重建前先 clearRect
   * 清理上一帧，避免残留旧墙壁像素。地面每帧直接绘制，墙壁每帧 blit
   * 一张 drawImage。
   */
  private drawWallsCached(
    context: CanvasRenderingContext2D,
    cameraOffset: { x: number; y: number },
  ) {
    const w = this.w, h = this.h, zoom = this.viewZoom || 1;
    // Cache tile = a chunk in world space. We rebuild the bitmap when the
    // camera crosses a tile boundary so the cached content stays accurate
    // even though it is only re-rasterised occasionally.
    const tile = 256;
    const tileX = Math.floor(cameraOffset.x / tile);
    const tileY = Math.floor(cameraOffset.y / tile);
    const key = `${this.mapId}|${this.currentBiome}|${zoom.toFixed(3)}|${tileX}|${tileY}|${this.walls.length}`;
    if (
      !this._groundWallCache ||
      this._groundWallCache.width !== w ||
      this._groundWallCache.height !== h ||
      this._groundWallCacheKey !== key ||
      this._groundWallCacheBiome !== this.currentBiome ||
      this._groundWallCacheMap !== this.mapId
    ) {
      if (!this._groundWallCache || this._groundWallCache.width !== w || this._groundWallCache.height !== h) {
        this._groundWallCache = document.createElement("canvas");
        this._groundWallCache.width = w;
        this._groundWallCache.height = h;
        this._groundWallCtx = this._groundWallCache.getContext("2d");
      }
      const off = this._groundWallCtx;
      if (!off || !this._groundWallCache) return;
      // 清理上一帧（旧墙壁像素），避免残留
      off.setTransform(1, 0, 0, 1, 0, 0);
      off.clearRect(0, 0, w, h);
      off.save();
      off.translate(w / 2, h / 2);
      off.scale(zoom, zoom);
      off.translate(-cameraOffset.x, -cameraOffset.y);
      // 只缓存墙壁：复用实时绘制函数（drawWallsFromData），
      // 保证与关闭缓存时的外观完全一致。世界变换已在上方设置。
      this.drawWallsFromData(off, cameraOffset);
      off.restore();
      this._groundWallCacheKey = key;
      this._groundWallCacheBiome = this.currentBiome;
      this._groundWallCacheMap = this.mapId;
    }
    if (this._groundWallCache) context.drawImage(this._groundWallCache, 0, 0);
  }

  drawWavesDirect(context: CanvasRenderingContext2D, cameraOffset: { x: number; y: number }, groundColor: [number, number, number]) {
    const [r, g, b] = groundColor;

    // 基础颜色
    const baseColor = `rgb(${r}, ${g}, ${b})`;
    const stripeColor = `rgba(${Math.min(255, r + 20)}, ${Math.min(255, g + 35)}, ${Math.min(255, b + 60)}, 0.45)`;
    const darkSpotColor = `rgba(${Math.max(0, r - 35)}, ${Math.max(0, g - 25)}, ${Math.max(0, b - 15)}, 0.35)`;
    const lightBlurColor = `rgba(${Math.min(255, r + 15)}, ${Math.min(255, g + 25)}, ${Math.min(255, b + 45)}, 0.2)`;

    context.save();
    // 1. 底色
    context.restore();
    context.save();
    context.fillStyle = baseColor;
    context.fillRect(0, 0, this.w, this.h);

    context.translate(this.w / 2, this.h / 2);
    context.scale(this.viewZoom || 1, this.viewZoom || 1);
    context.translate(-cameraOffset.x, -cameraOffset.y);

    // 2. 绘制带独立波动的斜条纹
    const stripeWidth = 150;
    const spacing = 300;
    const tilt = 0.75;
    const freq = 0.006;
    const amp = 30;

    context.lineCap = 'round';
    context.strokeStyle = stripeColor;
    context.lineWidth = stripeWidth;

    for (let baseY = -this.worldH; baseY < this.worldH * 2; baseY += spacing) {
        context.beginPath();

        const phase = (baseY * 0.123);

        for (let wx = 0; wx <= this.worldW; wx += 30) {
            const wave = Math.sin(wx * freq + phase) * amp;
            const wy = baseY + (wx * tilt) + wave;

            if (wx === 0) context.moveTo(wx, wy);
            else context.lineTo(wx, wy);
        }
        context.stroke();
    }

    // 3. 背景大色块
    const bigSpotCount = 60;
    for (let i = 0; i < bigSpotCount; i++) {
        const bx = (i * 3571) % this.worldW;
        const by = (i * 2467) % this.worldH;

        if (bx > cameraOffset.x - 200 && bx < cameraOffset.x + this.w / (this.viewZoom || 1) + 200 &&
            by > cameraOffset.y - 200 && by < cameraOffset.y + this.h / (this.viewZoom || 1) + 200) {

            const size = 50 + (i % 4) * 15;
            context.beginPath();
            context.arc(bx, by, size, 0, Math.PI * 2);
            context.fillStyle = lightBlurColor;
            context.fill();
        }
    }

    // 4. 深色细碎斑点
    const smallSpotCount = 180;
    for (let i = 0; i < smallSpotCount; i++) {
        const sx = (i * 1234) % this.worldW;
        const sy = (i * 5678) % this.worldH;

        if (sx > cameraOffset.x - 50 && sx < cameraOffset.x + this.w / (this.viewZoom || 1) + 50 &&
            sy > cameraOffset.y - 50 && sy < cameraOffset.y + this.h / (this.viewZoom || 1) + 50) {

            const radius = 2 + (i % 3);
            context.beginPath();
            context.arc(sx, sy, radius, 0, Math.PI * 2);
            context.fillStyle = darkSpotColor;
            context.fill();
        }
    }

    context.restore();
  }

  drawBackgroundPattern(context: CanvasRenderingContext2D, cameraOffset: { x: number; y: number }, groundColor: [number, number, number]) {
    const scale = this.viewZoom || 1;
    const pattern = this.getOrCreatePattern(groundColor, scale);
    const [r, g, b] = groundColor;

    // 1. Opaque base pass in screen space. This is what actually clears the
    // previous frame — without it the translucent pattern just accumulates on
    // top of the last frame and everything smears together.
    context.save();
    context.fillStyle = `rgb(${r}, ${g}, ${b})`;
    context.fillRect(0, 0, this.w, this.h);
    context.restore();

    if (!pattern) return;

    // 2. Decorative pattern pass in world space so it scrolls with the camera.
    // The visible world rect is the screen rect divided by the zoom, centered
    // on the camera; a small margin hides seams at fractional offsets.
    const margin = 4;
    const fillW = this.w / scale + margin * 2;
    const fillH = this.h / scale + margin * 2;
    const fillX = cameraOffset.x - fillW / 2;
    const fillY = cameraOffset.y - fillH / 2;

    context.save();
    context.translate(this.w / 2, this.h / 2);
    context.scale(scale, scale);
    context.translate(-cameraOffset.x, -cameraOffset.y);
    context.fillStyle = pattern;
    context.fillRect(fillX, fillY, fillW, fillH);
    context.restore();
  }

  getOrCreatePattern(groundColor: [number, number, number], scale: number) {
    const key = `${this.currentBiome}_fixed`;

    if (!this._patternCache) this._patternCache = {};
    if (this._patternCache[key]) return this._patternCache[key];

    console.log(`🔄 生成固定图案: ${key}`);
    const pattern = this.createTilePattern(groundColor, 1.0);  // 始终用 1.0 创建
    if (pattern) {
      this._patternCache[key] = pattern;
    }

    return pattern;
  }

  createWavePattern(groundColor: [number, number, number], scale: number, tileSize: number): CanvasPattern | null {
    const canvas = document.createElement("canvas");
    canvas.width = tileSize;
    canvas.height = tileSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = `rgb(${groundColor[0]}, ${groundColor[1]}, ${groundColor[2]})`;
    ctx.fillRect(0, 0, tileSize, tileSize);
    return ctx.createPattern(canvas, "repeat");
  }

  createTilePattern(groundColor: [number, number, number], scale: number) {
    const currentScale = scale || this.viewZoom || 1;
    const TILE_SIZE = 800 * Math.max(0.5, currentScale);

    const canvas = document.createElement("canvas");
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const r = groundColor[0];
    const g = groundColor[1];
    const b = groundColor[2];
    const type = this.currentBiome;

    if (type === "Ocean" || type === "Desert") {
        return this.createWavePattern(groundColor, currentScale, TILE_SIZE);
    }

    // Opaque ground base inside the tile itself, so filling with this pattern
    // always covers whatever was drawn last frame instead of blending with it.
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

    const getShapeRadius = (size: number, shapeType: string) => {
        switch (shapeType) {
            case "Plain":
            case "Random":
            case "Jungle":
                return Math.max(size * 0.8, size * 0.6);
            case "Bio":
            case "Sewer":
                return size;
            default:
                return size * 0.5;
        }
    };

    const drawShape = (ctx: CanvasRenderingContext2D, size: number, shapeType: string) => {
        switch (shapeType) {
            case "Plain":
            case "Random":
            case "Jungle":
                ctx.beginPath();
                ctx.ellipse(0, 0, size * 0.8, size * 0.6, 0, 0, Math.PI * 2);
                ctx.fill();
                break;
            case "Bio":
            case "Sewer":
                ctx.beginPath();
                ctx.moveTo(-size, 0);
                ctx.bezierCurveTo(
                    -size * 0.8, -size * 1.5,
                    size * 0.8, size * 1.5,
                    size, 0
                );
                ctx.lineWidth = size * 0.4;
                ctx.strokeStyle = ctx.fillStyle;
                ctx.stroke();
                break;
            default:
                ctx.beginPath();
                ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
                ctx.fill();
        }
    };

    const dark = `rgb(${r*0.85}, ${g*0.85}, ${b*0.85})`;
    const light = `rgb(${r*1.1}, ${g*1.1}, ${b*1.1})`;

    const GRID_SIZE = TILE_SIZE / 6;
    const ROW_SPACING = GRID_SIZE;
    const COL_SPACING = GRID_SIZE;
    const DIAGONAL_OFFSET = COL_SPACING / 2;

    const rows = Math.ceil(TILE_SIZE / ROW_SPACING) + 1;
    const cols = Math.ceil(TILE_SIZE / COL_SPACING) + 1;

    let drawnCount = 0;
    const MAX_DRAW = 50;

    for (let row = 0; row < rows && drawnCount < MAX_DRAW; row++) {
        for (let col = 0; col < cols && drawnCount < MAX_DRAW; col++) {
            const offsetX = (row % 2 === 0) ? 0 : DIAGONAL_OFFSET;

            let x = col * COL_SPACING + offsetX;
            let y = row * ROW_SPACING;

            const jitter = GRID_SIZE * 0.25;
            x += (Math.random() - 0.5) * jitter;
            y += (Math.random() - 0.5) * jitter;

            const size = (25 + Math.random() * 12) * currentScale;
            const radius = getShapeRadius(size, type);
            const margin = radius + 5;

            if (x < margin || x > TILE_SIZE - margin ||
                y < margin || y > TILE_SIZE - margin) {
                continue;
            }

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate((Math.random() - 0.5) * Math.PI * 0.3);
            ctx.globalAlpha = 0.2 + Math.random() * 0.25;
            ctx.fillStyle = Math.random() > 0.5 ? dark : light;

            drawShape(ctx, size, type);

            ctx.restore();
            drawnCount++;
        }
    }

    if (drawnCount < 100) {
        const extra = Math.min(5, 25 - drawnCount);
        for (let i = 0; i < extra; i++) {
            let placed = false;
            for (let attempt = 0; attempt < 20 && !placed; attempt++) {
                const x = Math.random() * TILE_SIZE;
                const y = Math.random() * TILE_SIZE;
                const radius = 8 * currentScale;
                const margin = radius + 3;

                if (x > margin && x < TILE_SIZE - margin &&
                    y > margin && y < TILE_SIZE - margin) {

                    ctx.save();
                    ctx.translate(x, y);
                    ctx.globalAlpha = 0.15;
                    ctx.fillStyle = Math.random() > 0.5 ? dark : light;
                    ctx.beginPath();
                    ctx.arc(0, 0, radius, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                    placed = true;
                }
            }
        }
    }

    return ctx.createPattern(canvas, "repeat");
  }

  private drawDrop(e: Ent) {
    // Drops use the exact same renderer as inventory, crafting, and the main
    // quick-slot row: square rarity background, centered item icon, item name,
    // and stack badge. Only the gentle world-space bob is unique to loot.
    const bob = Math.sin(this.time * 4 + e.id) * 3;
    const size = 46;
    const stack = Math.max(1, Math.round(e.hp * 255));

    // 只有"确定被玩家吸"（服务器标记 suction，即掉落物落入磁铁吸取范围、
    // 正在被快速吸向玩家）的掉落物才会缩小淡出；玩家靠近但未被吸取时
    // 保持原大小、完全不透明。
    let scale = 1;
    let alpha = 1;
    if (e.suction) {
      const me = this.ents.get(this.selfId);
      if (me) {
        const dx = me.x - e.x;
        const dy = me.y - e.y;
        const d = Math.hypot(dx, dy);
        const SUCK_START = 220; // world px — start shrinking at this distance
        const SUCK_END = 24;    // world px — fully gone once this close
        if (d < SUCK_START) {
          const t = Math.max(0, Math.min(1, (d - SUCK_END) / (SUCK_START - SUCK_END)));
          scale = 0.2 + t * 0.8;   // 0.2x near the player → 1.0x at SUCK_START
          alpha = 0.25 + t * 0.75;
        }
      }
    }

    const finalSize = size * scale;
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    drawCard(
      this.ctx,
      { x: e.x - finalSize / 2, y: e.y - finalSize / 2 + bob * scale, w: finalSize, h: finalSize },
      { item: e.type, rarity: e.team, count: stack },
      { dim: 0.94 },
    );
    this.ctx.restore();
  }

private drawProjectileEnt(e: Ent) {
  const ctx = this.ctx;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.angle + Math.PI);
  // 判断来源类型
  const isFromItem = e.type === 52;
  const isFromEnemy = e.type === 16 || e.type === 5;

  // 大小：物品固定，生物随稀有度缩放
  const scale = isFromItem ? 0.4 : (0.3 + (e.rarity || 0) * 0.15);

  // ---- 绘制 Missile 形状 ----
  ctx.beginPath();
  ctx.moveTo(-50 * scale, 0);
  ctx.lineTo(10 * scale, -20 * scale);
  ctx.lineTo(10 * scale, 20 * scale);
  ctx.closePath();

  const color = '#3a3a3a';

  ctx.fillStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 15 * scale;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}
  private drawPetalEnt(e: Ent) {
    const ctx = this.ctx;
    // Petal snapshots pack the cell rarity into the team byte (see sendState),
    // so orbiting petals must pass it through. Without it every petal rendered
    // at rarity 0 and rarity-scaled artwork (Stinger's extra triangles, Light's
    // extra blobs) never appeared in the world, only on the card.
    drawItemIcon(ctx, e.type, e.x, e.y, e.radius, this.time * 3 + e.id, e.team);
  }

  /**
   * Build client-side segment colliders for a Leech entity from its position
   * history. The server maintains the authoritative segment positions, but
   * we don't sync them over the wire — instead the client reconstructs the
   * trail from the entity's interpolated world position each frame.
   */
  private updateLeechSegments(e: Ent) {
    const segRadius = e.radius * 0.55;
    const segCount = 6;
    const spacing = segRadius * 1.1;

    // Record current position into history
    if (!e.positionHistory) e.positionHistory = [];
    e.positionHistory.unshift({ x: e.x, y: e.y });
    const maxHistory = 120;
    if (e.positionHistory.length > maxHistory) e.positionHistory.length = maxHistory;

    // Build segments by sampling the trail at fixed distances
    const segments: { physicsBody: { position: { x: number; y: number }; radius: number } }[] = [];
    segments.push({
      physicsBody: { position: { x: e.x, y: e.y }, radius: segRadius },
    });
    let lastX = e.x, lastY = e.y;
    let needed = spacing;
    for (let i = 1; i < segCount; i++) {
      let placed = false;
      for (let j = 0; j < e.positionHistory.length; j++) {
        const p = e.positionHistory[j];
        const d = Math.hypot(p.x - lastX, p.y - lastY);
        if (d >= needed) {
          const t = needed / d;
          const sx = lastX + (p.x - lastX) * t;
          const sy = lastY + (p.y - lastY) * t;
          segments.push({
            physicsBody: { position: { x: sx, y: sy }, radius: segRadius },
          });
          lastX = sx; lastY = sy;
          needed = spacing;
          placed = true;
          break;
        } else {
          needed -= d;
          lastX = p.x; lastY = p.y;
        }
      }
      if (!placed) {
        segments.push({
          physicsBody: { position: { x: lastX, y: lastY }, radius: segRadius },
        });
      }
    }
    e.segmentColliders = segments;
  }

  private drawMobEnt(e: Ent) {
    const ctx = this.ctx;
    const def = MOBS[e.type];
    if (!def) return;
    const isFriendly = e.team !== TEAM.HOSTILE;
    drawMob(ctx, e.type, e.x, e.y, e.radius, e.angle, this.time, isFriendly, e.rarity, this.level);
    if (e.hurt > 0) {
      ctx.save();
      ctx.globalAlpha = e.hurt * 3;
      ctx.fillStyle = "rgba(255,120,120,0.7)";
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Fixed-size name/health-bar/rarity tag: sizes stay constant on screen
    // regardless of the world camera zoom.
    drawMobHealthLabel(ctx, e.x, e.y, e.radius, this.viewZoom, {
      name: def.name,
      hpPct: e.hp,
      displayHpPct: e.displayHp ?? e.hp,
      rarity: e.rarity,
      friendly: isFriendly,
    });
  }

  private drawPlayerEnt(e: Ent) {
    const ctx = this.ctx;
    const isSelf = e.team === TEAM.SELF;
    let spreadMode = false;
    let contractMode = false;
    let mousePos: { x: number; y: number } | undefined = undefined;

    if (isSelf) {
      const uiBusy = this.drag !== null;
      const isSpaceDown = this.keys.has("Space") || this.mobileSpreadActive;
      const isShiftDown = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || this.keys.has("Shift") || this.mobileContractActive;
      // New mapping: Space = spread, Shift = contract (plus mouse for usability)
      spreadMode = (this.mouseDown && !uiBusy) || isSpaceDown;
      contractMode = this.rightDown || isShiftDown;
      // Use this.viewZoom (which includes the Antennae bonus) so the mouse
      // position maps correctly to world space at the zoomed-out view.
      const worldMouseX = (this.mx - this.w / 2) / this.viewZoom + this.camX;
      const worldMouseY = (this.my - this.h / 2) / this.viewZoom + this.camY;
      mousePos = { x: worldMouseX, y: worldMouseY };
    } else {
      spreadMode = (e.type & 1) !== 0;
      contractMode = (e.type & 2) !== 0;
      mousePos = {
        x: e.x + Math.cos(e.angle) * 100,
        y: e.y + Math.sin(e.angle) * 100,
      };
    }

    e.spreadMode = spreadMode;
    e.contractMode = contractMode;
    e.mousePosition = mousePos;
    e.health = isSelf ? this.hp : e.hp * 100;
    e.maxHealth = isSelf ? this.maxHp : 100;

    drawDefaultSkin(ctx, e.x, e.y, e.radius, e);
    // Draw Antennae and Third Eye on the player body (not rotating with the
    // flower). These are passive body accessories drawn after the skin.
    if (isSelf) {
      // Find the best (highest-rarity) Antennae and Third Eye in the hotbar.
      let bestAnt = -1, bestEye = -1;
      for (let i = 0; i < this.slots.length; i++) {
        const cell = this.slots[i];
        if (!cell) continue;
        if (cell.item === ANTENNAE_ITEM && cell.rarity > bestAnt) bestAnt = cell.rarity;
        if (cell.item === THIRD_EYE_ITEM && cell.rarity > bestEye) bestEye = cell.rarity;
      }
      if (bestAnt >= 0) drawPlayerAntennae(ctx, e.x, e.y, e.radius, bestAnt, this.time);
      if (bestEye >= 0) drawPlayerThirdEye(ctx, e.x, e.y, e.radius, bestEye, this.time);
    }
    text(ctx, e.name || "flower", e.x, e.y - e.radius - 16, 14, "#ffffff");
    healthBar(ctx, e.x - 32, e.y + e.radius + 8, 64, 9, e.hp);
  }

  private renderHud() {
    const ctx = this.ctx;
    const shortMobile = this.isMobile && this.w > this.h && this.h <= 600;
    // HUD scale: shrink the entire top-left player panel (avatar, HP, XP)
    // on mobile or narrow viewports so it doesn't dominate the screen.
    // Desktop keeps the original size; phones with h<=600 get a tighter
    // ~0.55x scale that still leaves every label readable.
    let hudScale = 1;
    if (this.isMobile || this.w < 640) {
      if (this.h <= 600 && this.w > this.h) hudScale = 0.55;
      else hudScale = 0.75;
    }
    const _s = (v: number) => v * hudScale;
    // 左上角玩家信息面板（参照目标 UI 排版）
    const avatarSize = 60;
    const VAvatarSize = _s(60);
const avatarX = _s(20);
const avatarY = _s(20);


// 头像 - 绘制玩家花朵
const avatarCX = avatarX + VAvatarSize / 2;
const avatarCY = avatarY + VAvatarSize;
const me = this.ents.get(this.selfId);
if (me) {
    ctx.save();
    // 计算当前玩家的 spread/contract 状态（复用 drawPlayerEnt 的逻辑）
    const uiBusy = this.drag !== null;
    const isSpaceDown = this.keys.has("Space") || this.mobileSpreadActive;
    const isShiftDown = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || this.keys.has("Shift") || this.mobileContractActive;
    const spreadMode = (this.mouseDown && !uiBusy) || isSpaceDown;
    const contractMode = this.rightDown || isShiftDown;
    const worldMouseX = (this.mx - this.w / 2) / this.viewZoom + this.camX;
    const worldMouseY = (this.my - this.h / 2) / this.viewZoom + this.camY;

    // 创建临时 ent 用于绘制
    const tempEnt: Ent = {
        ...me,
        x: avatarCX,
        y: avatarCY,
        radius: _s(avatarSize / 2 - 4),
        spreadMode,
        contractMode,
        mousePosition: { x: worldMouseX, y: worldMouseY },
        health: this.hp,
        maxHealth: this.maxHp,
    };

    drawDefaultSkin(ctx, avatarCX, avatarCY, _s(avatarSize / 2 - 4), tempEnt);

    // 绘制触角和第三只眼（复用 drawPlayerEnt 中的逻辑）
    let bestAnt = -1, bestEye = -1;
    for (let i = 0; i < this.slots.length; i++) {
        const cell = this.slots[i];
        if (!cell) continue;
        if (cell.item === ANTENNAE_ITEM && cell.rarity > bestAnt) bestAnt = cell.rarity;
        if (cell.item === THIRD_EYE_ITEM && cell.rarity > bestEye) bestEye = cell.rarity;
    }
    if (bestAnt >= 0) drawPlayerAntennae(ctx, avatarCX, avatarCY, _s(avatarSize / 2 - 5), bestAnt, this.time);
    if (bestEye >= 0) drawPlayerThirdEye(ctx, avatarCX, avatarCY, _s(avatarSize / 2 - 5), bestEye, this.time);

    ctx.restore();
} else {

    ctx.save();
    ctx.fillStyle = "#2a2a2a";
    ctx.beginPath();
    ctx.arc(avatarCX, avatarCY, avatarSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#4CAF50";
    ctx.lineWidth = _s(3);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${_s(24)}px ${FONT_FAMILY || "Arial"}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const initial = this.playerName ? this.playerName.charAt(0).toUpperCase() : "P";
    ctx.fillText(initial, avatarCX, avatarCY);
    ctx.restore();
}
    ctx.lineWidth = _s(1.4);
    // 用户名
    ctx.fillStyle = "#4CAF50";
    ctx.font = `bold ${_s(22)}px ${FONT_FAMILY || "Arial"}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
        ctx.strokeText(`@${this.playerName}`, avatarX + avatarSize + _s(14), avatarY + _s(30));
    ctx.fillText(`@${this.playerName}`, avatarX + avatarSize + _s(14), avatarY + _s(30));


    // 血条背景
    const barX = avatarX + avatarSize + _s(15);
    const barY = avatarY + _s(40);
    const barW = _s(250);
    const barH = _s(26);
    roundRect(ctx, barX, barY, barW, barH, _s(20));
    ctx.fillStyle = "#333333";
    ctx.fill();

    // 血条
    const hpPct = Math.max(0, Math.min(1, this.hp / Math.max(1, this.maxHp)));
    const hpBarW = _s(240) * hpPct;
    if (hpBarW > 0) {
      roundRect(ctx, barX + _s(5), barY + _s(3), hpBarW, _s(20), _s(16));
      ctx.fillStyle = "#8BC34A";
      ctx.fill();
    }

    // 护盾条（叠加在血条内部）
    if (this.shield > 0) {
      const shieldPct = Math.min(1, this.shield / Math.max(1, this.maxHp));
      const shieldW = _s(230) * shieldPct;
      if (shieldW > 0) {
        roundRect(ctx, barX + _s(6), barY + _s(5), shieldW, _s(16), _s(16));
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fill();
      }
    }

    // 血条文字
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${_s(15)}px ${FONT_FAMILY || "Arial"}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeText(`${Math.max(0, Math.round(this.hp))} / ${this.maxHp}`, barX + barW / 2, barY + barH / 2);
    ctx.fillText(`${Math.max(0, Math.round(this.hp))} / ${this.maxHp}`, barX + barW / 2, barY + barH / 2);

    // 等级背景
    const lvlX = barX;
    const lvlY = barY + barH + _s(8);
    const lvlW = _s(150);
    const lvlH = _s(20);
    roundRect(ctx, lvlX, lvlY, lvlW, lvlH, _s(20));

    ctx.fillStyle = "#333333";
    ctx.fill();

    // 等级进度
    const need = xpForLevel(this.level + 1);
    const prev = xpForLevel(this.level);
    const xpPct = Math.max(0, Math.min(1, (this.xp - prev) / Math.max(1, need - prev)));
    const xpW = _s(130) * xpPct;
    if (xpW > 0) {
      roundRect(ctx, lvlX + _s(3), lvlY + _s(2), xpW, _s(16), _s(16));
      ctx.fillStyle = "#FFC107";
      ctx.fill();
    }

    // 等级文字
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `bold ${_s(14)}px ${FONT_FAMILY || "Arial"}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.strokeText(`Level ${this.level}`, lvlX + _s(20), lvlY + lvlH / 2);
    ctx.fillText(`Level ${this.level}`, lvlX + _s(20), lvlY + lvlH / 2);
    ctx.fillStyle = "#aaaaaa";


    // ---- 队友信息（小队成员，最多4人） ----
    const squadMates = Array.from(this.ents.values()).filter(
      e => e.kind === ENT.PLAYER && e.team === TEAM.FRIENDLY && e.id !== this.selfId && e.squadLevel !== undefined
    ).slice(0, 4);

    if (squadMates.length > 0) {
      const squadScale = hudScale * 0.8;
      const _sq = (v: number) => v * squadScale;
      const squadAvatarSize = 40;
      const squadBarW = _sq(160);
      const squadBarH = _sq(14);
      const gapY = _sq(10);

      let squadY = lvlY + lvlH + _sq(14);

      for (const mate of squadMates) {
        const sAvatarX = _sq(40);
        const sAvatarY = squadY;
        const sAvatarCX = sAvatarX + _sq(squadAvatarSize) / 2;
        const sAvatarCY = sAvatarY + _sq(squadAvatarSize) / 2;

        // 队友头像（花朵）
        ctx.save();
        const mateEnt: Ent = {
          ...mate,
          x: sAvatarCX,
          y: sAvatarCY,
          radius: _sq(squadAvatarSize / 2 + 2),
          spreadMode: false,
          contractMode: false,
        };
        drawDefaultSkin(ctx, sAvatarCX, sAvatarCY, _sq(squadAvatarSize / 2 - 2), mateEnt);
        ctx.restore();

        // 队友名字
        ctx.fillStyle = "#4CAF50";
        ctx.font = `bold ${_sq(14)}px ${FONT_FAMILY || "Arial"}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.strokeText(mate.name || "?", sAvatarX + _sq(squadAvatarSize) + _sq(8), sAvatarY + _sq(18));
        ctx.fillText(mate.name || "?", sAvatarX + _sq(squadAvatarSize) + _sq(8), sAvatarY + _sq(18));

        // 队友等级和稀有度（在名字下方）
        const mateLevel = mate.squadLevel ?? 0;
        const mateRarity = mate.squadRarity ?? 0;
        const rarityInfo = RARITIES[mateRarity];
        ctx.font = `bold ${_sq(11)}px ${FONT_FAMILY || "Arial"}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const lvlY2 = sAvatarY + _sq(22);
        ctx.fillStyle = "#ffffff";
        ctx.strokeText(`Level ${mateLevel}`, sAvatarX + _sq(squadAvatarSize) + _sq(8), lvlY2);
        ctx.fillText(`Level ${mateLevel}`, sAvatarX + _sq(squadAvatarSize) + _sq(8), lvlY2);
        if (rarityInfo) {
          const rarityX = sAvatarX + _sq(squadAvatarSize) + _sq(8) + ctx.measureText(`Level ${mateLevel}  `).width;
          ctx.fillStyle = rarityInfo.color;
          ctx.strokeText(rarityInfo.name, rarityX, lvlY2);
          ctx.fillText(rarityInfo.name, rarityX, lvlY2);
        }

        // 队友血条背景
        const sBarX = sAvatarX + _sq(squadAvatarSize) + _sq(8);
        const sBarY = sAvatarY + _sq(34);
        roundRect(ctx, sBarX, sBarY, squadBarW, squadBarH, _sq(7));
        ctx.fillStyle = "#333333";
        ctx.fill();

        // 队友血条前景
        const mateHpPct = Math.max(0, Math.min(1, mate.hp));
        const mateHpW = (squadBarW - _sq(4)) * mateHpPct;
        if (mateHpW > 0) {
          roundRect(ctx, sBarX + _sq(2), sBarY + _sq(2), mateHpW, squadBarH - _sq(4), _sq(5));
          ctx.fillStyle = "#8BC34A";
          ctx.fill();
        }

        // 血条百分比文字
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${_sq(10)}px ${FONT_FAMILY || "Arial"}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeText(`${Math.round(mateHpPct * 100)}%`, sBarX + squadBarW / 2, sBarY + squadBarH / 2);
        ctx.fillText(`${Math.round(mateHpPct * 100)}%`, sBarX + squadBarW / 2, sBarY + squadBarH / 2);

        squadY += _sq(squadAvatarSize) + _sq(16) + gapY;
      }
    }
    // ---- 最近的 Ultra+ 生物血条（屏幕顶部中央） ----
    if (this.nearestUltraPlus) {
      const target = this.nearestUltraPlus;
      const rarityInfo = RARITIES[target.rarity];
      const targetName = MOBS[target.type]?.name ?? "Unknown";
      const barCenterX = this.w / 2;
      const barY = 30;
      const barW = Math.min(340, Math.max(220, this.w * 0.38));
      const barH = 28;
      const barX = barCenterX - barW / 2;
      const rarityColor = rarityInfo?.color ?? "#ff4444";

      ctx.save();
      // 名字（稀有度色 + 黑描边）
      ctx.font = `bold 18px ${FONT_FAMILY || "Arial"}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 4;
      ctx.lineJoin = "round";
      ctx.strokeText(`${rarityInfo?.name ?? ""} ${targetName}`, barCenterX, barY - 5);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(`${rarityInfo?.name ?? ""} ${targetName}`, barCenterX, barY - 5);

      // 血条背景（深灰圆角）
      roundRect(ctx, barX, barY, barW, barH, 14);
      ctx.fillStyle = "#333333";
      ctx.fill();
      ctx.strokeStyle = "#333333";
      ctx.lineWidth = 2;
      ctx.stroke();

      // 血条前景（稀有度颜色，基于 displayHp 平滑过渡）
      const pct = Math.max(0, Math.min(1, target.displayHp ?? target.hp));
      const fillW = Math.max(0, (barW - 4) * pct);
      if (fillW > 0) {
        roundRect(ctx, barX + 2, barY + 2, fillW, barH - 4, 12);
        ctx.fillStyle ="#66cc00";
        ctx.fill();
      }

      // 血条文字（百分比，白色居中）
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold 14px ${FONT_FAMILY || "Arial"}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const hpText = `${Math.round(pct * 100)}%`;
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeText(hpText, barCenterX, barY + barH / 2);
      ctx.fillText(hpText, barCenterX, barY + barH / 2);
      ctx.restore();
    }

    // buttons
    for (const b of this.hudButtons()) button(ctx, b.rect, b.label, b.color, hit(b.rect, this.mx, this.my), shortMobile ? 13 : 16);

    // minimap
    const mm = shortMobile ? 82 : 132;
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
      if (e.kind === ENT.MOB) continue;
      else if (e.kind === ENT.PLAYER) ctx.fillStyle = e.team === TEAM.SELF ? "#ffe763" : "#9ad4ff";
      else continue;
      const size = e.team === TEAM.SELF ? 4 : 3;
      ctx.fillRect(e.x * sx - size / 2, e.y * sy - size / 2, size, size);
    }
    ctx.restore();
    text(ctx, MAPS[this.mapId]?.name ?? "", mx + mm / 2, my + mm - 10, 12, "rgba(255,255,255,0.85)");

    // kill feed (hidden on short phones where it would cover action buttons)
    if (!shortMobile) this.killFeed.forEach((k, i) => {
      ctx.save();
      ctx.globalAlpha = Math.min(1, k.life);
      text(ctx, k.msg, this.w - 16, my + mm + 24 + i * 20, 14, "#d9ffd9", "right");
      ctx.restore();
    });

    // Dual-row quick-slot bar (main + secondary rows)
    this.quickSlot.draw(ctx);

    // Mobile controls: joystick + Spread (Space) / Contract (Shift) buttons
    if (this.isMobile && this.mobileControlsVisible && this.bagAnim < 0.2 && this.craftAnim < 0.2 && !this.vk.active) {
      // Joystick base
      const joy = this.mobileJoystick;
      ctx.save();
      ctx.globalAlpha = 0.38;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.arc(joy.centerX, joy.centerY, joy.radius + 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = joy.active ? 0.55 : 0.32;
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(joy.centerX, joy.centerY, joy.radius, 0, Math.PI * 2);
      ctx.stroke();
      // Joystick knob
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = joy.active ? "#ffe763" : "rgba(255,255,255,0.65)";
      ctx.beginPath();
      ctx.arc(joy.currX, joy.currY, Math.max(18, joy.radius * 0.38), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Spread / Contract buttons (Space / Shift) — circular
      const drawMobileAction = (rect: Rect | null, label: string, active: boolean, sub: string) => {
        if (!rect) return;
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const r = Math.min(rect.w, rect.h) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = active ? (label === "SPREAD" ? "#3fae60" : "#c9762b") : "rgba(18,24,32,0.72)";
        ctx.fill();
        ctx.lineWidth = active ? 3 : 2;
        ctx.strokeStyle = active ? "#ffffff" : "rgba(255,255,255,0.25)";
        ctx.stroke();
        text(ctx, label, cx, cy - 6, Math.max(11, r * 0.28), "#ffffff");
        text(ctx, sub, cx, cy + 12, Math.max(9, r * 0.2), active ? "#ffffff" : "rgba(255,255,255,0.6)");
        ctx.restore();
      };
      drawMobileAction(this.mobileSpreadRect, "SPREAD", this.mobileSpreadActive, "[SPACE]");
      drawMobileAction(this.mobileContractRect, "DEFEND", this.mobileContractActive, "[SHIFT]");
    }

    // Mobile hint: show controls help if mobile
    if (this.isMobile && !shortMobile && this.scene === "game" && this.w > 0) {
      const hintY = 90;
      ctx.save();
      ctx.globalAlpha = 0.85;
      text(ctx, "Move: joystick  |  SPACE: Spread  SHIFT: Defend", this.w / 2, hintY, 11, "rgba(255,255,255,0.75)");
      ctx.restore();
    }
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
    // 5px rounded corners per design request.
    roundRect(ctx, p.x, p.y, p.w, p.h, 5);
    ctx.fillStyle = "#5aa0db";
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#3f7dc2";
    ctx.stroke();

    text(ctx, "Inventory", p.x + p.w / 2, p.y + 24 * layout.scale, 20 * layout.scale, "#ffffff");

    // close button
    button(ctx, layout.closeRect, "x", "#e53232", hit(layout.closeRect, this.mx, this.my), 15 * layout.scale);

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
      drawCard(ctx, r, entry.cell, { hovered, dim: this.drag?.from === bagCellIndex(entry.slot) ? 0.35 : 1 });
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
    const sc = layout.scale;
    const panelH = layout.statsH;
    const panelY = p.y + p.h - panelH - 4 * sc;
    const panelX = p.x + layout.pad;
    const panelW = p.w - layout.pad * 2;

    ctx.save();
    // 5px rounded corners per design request.
    roundRect(ctx, panelX, panelY, panelW, panelH, 5);
    ctx.fillStyle = "#3f7dc2";
    ctx.fill();

    const stats = this.bagRarityStats();
    const total = stats.reduce((sum, st) => sum + st.count, 0);
    text(ctx, `Summary: ${this.formatBagNumber(total)}`, panelX + 12 * sc, panelY + 16 * sc, 12 * sc, "#ffffff", "left");

    const visible = stats.filter((st) => st.count > 0).reverse();
    if (visible.length === 0) {
      text(ctx, "Empty", panelX + panelW / 2, panelY + panelH / 2 + 8 * sc, 13 * sc, "rgba(255,255,255,0.8)");
      ctx.restore();
      return;
    }

    const cols = 3;
    const colWidth = (panelW - 16 * sc) / cols;
    const rowHeight = 18 * sc;
    const startX = panelX + 10 * sc;
    const startY = panelY + 40 * sc;
    const fontSize = 10 * sc;
    visible.forEach((st, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * colWidth;
      const y = startY + row * rowHeight;
      const maxName = 10;
      const label = st.name.length > maxName ? st.name.slice(0, 4) + ".." : st.name;
      text(ctx, label, x, y, fontSize, "#ffffff", "left");
      ctx.font = `${fontSize}px sans-serif`;
      const tw = ctx.measureText(label).width;
      text(ctx, this.formatBagNumber(st.count), x + tw + 4 * sc, y, fontSize, st.color, "left");
    });
    ctx.restore();
  }

  private formatBagNumber(num: number): string {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
    if (num >= 1000) return (num / 1000).toFixed(2) + "K";
    return num.toString();
  }

  private tooltip(cell: Cell, x: number, y: number) {
    // Pipe the latest server-authoritative talent bonuses into the tooltip
    // so reload time + petal damage reflect the active talent tree. Falls
    // back to undefined (treated as no-modifier) before the first
    // S2C.TALENT_BONUSES arrives, which keeps the panel looking right from
    // t=0.
    TooltipSystem.drawItemTooltip(this.ctx, cell, x, y, this.w, this.h, this.talentBonuses);
  }

  /**
   * Wide CraftAnimation-style panel with compact mode selectors, a pentagon
   * input area, a side action button, result effects, and a rarity matrix.
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

    const panelColor = this.craftMode === "normal" ? "#CDA46E" : this.craftMode === "oracle" ? "#4A6FA5" : "#4A8C5E";
    const panelBorder = this.craftMode === "normal" ? "#A8865A" : this.craftMode === "oracle" ? "#1E3C78" : "#1E6432";
    roundRect(ctx, p.x, p.y, p.w, p.h, 12);
    ctx.fillStyle = panelColor;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = panelBorder;
    ctx.stroke();

    text(ctx, this.craftMode === "normal" ? "Craft" : this.craftMode === "oracle" ? "Oracle" : "Trade", p.x + p.w * 0.38, p.y + 24 * layout.scale, 22 * layout.scale, "#ffffff");
    button(ctx, layout.closeRect, "x", "#e53232", hit(layout.closeRect, this.mx, this.my), 14 * layout.scale);

    // Action button centered beside the pentagon.
    const btn = layout.actionRect;
    const label = this.craftActionLabel();
    button(ctx, btn, label.text, accent, hit(btn, this.mx, this.my), 15 * layout.scale, label.enabled);
    // small cooldown hint next to button if Oracle/Trade
    if (this.craftMode !== "normal") {
      const cd = this.craftCooldownLeft(this.craftMode as "oracle" | "trade");
      if (cd > 0) {
        text(ctx, this.formatCooldown(cd), btn.x + btn.w / 2, btn.y + btn.h + 12 * layout.scale, 11 * layout.scale, "#ffd54a");
      }
    }

    // Compact Cr / Or / Tr selectors in the top-right row.
    for (const { mode, rect, label: lab, color } of this.craftModeRects()) {
      const active = this.craftMode === mode;
      button(ctx, rect, lab, active ? color : "#3f7dc2", hit(rect, this.mx, this.my), 12 * layout.scale);
    }

    // Biome and search filters directly above the matrix.
    dropdownField(ctx, layout.dropRect, this.craftBiome, this.craftBiomeOpen);
    searchField(ctx, layout.barRect, this.craftSearchText, this.craftSearchActive, "Search cards...");

    // Craft log (top-left compact)
    this.drawCraftLogPanel(ctx, layout);

    // Five big slots + particles behind
    this.drawCraftParticles(ctx);

    if (this.craftMode === "normal") this.renderCraftSlots(ctx, layout);
    else this.renderCraftSingle(ctx, layout, this.craftMode);

    // Result card overlay - always on top of slots when showing
    if (this.craftPhase === "showing" && this.craftPending) {
      this.renderResultCard(ctx, layout);
    }

    // Inventory browser grid BELOW craft area, SMALLER, never covers craft slots
    const hovered = this.renderCraftGrid(ctx, layout);

    // Transient message centered above grid (not over button anymore)
    if (this.craftMsgLife > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.craftMsgLife);
      const bad = /fail|cooldown|need|cannot|refused|nothing|first|max/i.test(this.craftMsg);
      text(ctx, this.craftMsg, p.x + p.w * 0.38, layout.infoY + 14 * layout.scale, 12 * layout.scale, bad ? "#ffbcbc" : "#c9ffd6");
      ctx.restore();
    }

    // success burst over center
    if (this.craftBurstT > 0) {
      const focus = this.craftMode === "normal" ? layout.bigSlots[2] : layout.singleSlot;
      craftBurst(ctx, focus.x + focus.w / 2, focus.y + focus.h / 2, this.craftBurstT, this.craftBurstColor);
    }

    // Tooltip for inventory
    if (hovered) this.tooltip(hovered.cell, this.mx + 14, this.my - 10);
    if (this.craftBiomeOpen) dropdownList(ctx, layout.dropRect, BIOME_LIST, this.craftBiome, this.mx, this.my);

    ctx.restore();
  }

  /** Compact craft log panel at top-left (mirrors StarCraftUI.drawCraftLog) */
  private drawCraftLogPanel(ctx: CanvasRenderingContext2D, layout: ReturnType<GameClient["craftLayout"]>) {
    const r = layout.logRect;
    const sc = layout.scale;
    ctx.save();
    roundRect(ctx, r.x, r.y, r.w, r.h, 6 * sc);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.stroke();
    text(ctx, "Craft Log", r.x + 8 * sc, r.y + 12 * sc, 11 * sc, "#ffffff", "left");
    const logs = [
      { t: `Used: ${this.craftLogPetals}`, c: "#00E5FF" },
      { t: `Crafted: ${this.craftLogCrafted}`, c: "#FF5555" },
      { t: `Burned: ${this.craftLogBurned}`, c: "#FFBB33" },
      { t: `Attempts: ${this.craftLogAttempts}`, c: "#FFD966" },
      { t: `${this.craftLogLast.slice(0, 18)}`, c: "#7db3ff" },
    ];
    logs.forEach((log, i) => {
      text(ctx, log.t, r.x + 8 * sc, r.y + 26 * sc + i * 12 * sc, 10 * sc, log.c, "left");
    });
    ctx.restore();
  }

  /** Dedicated Result Card rendering — larger, pulsing, with rarity glow (new) */
  private renderResultCard(ctx: CanvasRenderingContext2D, layout: ReturnType<GameClient["craftLayout"]>) {
    if (!this.craftPending) return;
    const rr = layout.resultRect;
    const rarity = this.craftPending.rarity;
    const color = this.rarityRgb(rarity);

    // Bounded scale: a quick overshoot "pop" as the card appears, settling
    // into a small idle bob — it never keeps growing the longer it's shown.
    const popDuration = 0.4;
    let pulse: number;
    if (this.craftShowTimer < popDuration) {
      const t = Math.max(0, this.craftShowTimer) / popDuration;
      const s = 1.70158;
      const tm1 = t - 1;
      pulse = 1 + (s + 1) * tm1 * tm1 * tm1 + s * tm1 * tm1; // easeOutBack, overshoots then settles at 1
    } else {
      pulse = 1 + Math.sin(this.time * 3) * 0.025;
    }

    ctx.save();
    // glow behind
    ctx.globalAlpha = 0.35 + Math.sin(this.time * 5) * 0.15;
    roundRect(ctx, rr.x - 6, rr.y - 6, rr.w + 12, rr.h + 12, 12);
    ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
    ctx.fill();
    ctx.globalAlpha = 1;

    // card background with corner radius 8 (matches CraftAnimation)
    ctx.translate(rr.x + rr.w / 2, rr.y + rr.h / 2);
    ctx.scale(pulse, pulse);
    ctx.translate(-rr.w / 2, -rr.h / 2);

    // Keep the result itself identical to every other item card; the glow is
    // presentation only and does not introduce a second card skin.
    drawCard(ctx, { x: 0, y: 0, w: rr.w, h: rr.h }, this.craftPending, {
      hovered: true,
    });
    ctx.restore();

    // RESULT label above card
    text(ctx, "RESULT", layout.cx, rr.y - 14, 13, RARITIES[rarity]?.color ?? "#ffe763");
    const belowY = rr.y + rr.h + (this.craftPending.count > 1 ? 14 : 6);
    if (this.craftPending.count > 1) {
      text(ctx, `x${this.craftPending.count}`, layout.cx, belowY, 13, "#ffffff");
    }
    // Reminder that this card must be clicked (anywhere in the panel) to continue.
    const hintPulse = 0.55 + Math.sin(this.time * 4) * 0.25;
    ctx.save();
    ctx.globalAlpha = hintPulse;
    text(ctx, "Click to continue", layout.cx, belowY + (this.craftPending.count > 1 ? 16 : 14), 10, "rgba(255,255,255,0.85)");
    ctx.restore();
  }

  /** Draws the item-row/rarity-column crafting matrix. */
  private renderCraftGrid(
    ctx: CanvasRenderingContext2D,
    layout: ReturnType<GameClient["craftLayout"]>,
  ): { slot: number; cell: Cell } | null {
    const p = layout.panel;
    const rows = this.craftMatrixRows();

    ctx.save();
    roundRect(ctx, layout.gridStartX - 4, layout.gridTop - 4, layout.totalGridWidth + 8, layout.gridH + 8, 8);
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(layout.gridStartX - 4, layout.gridTop, layout.totalGridWidth + 8, layout.gridH);
    ctx.clip();

    const startRow = Math.floor(this.craftScrollY / layout.itemHeight);
    const yOffset = -(this.craftScrollY % layout.itemHeight);
    const visibleRows = rows.slice(startRow, startRow + layout.maxVisibleRows + 2);
    let hoveredEntry: { slot: number; cell: Cell } | null = null;
    const sel = this.craftSel;

    // Every item/rarity coordinate gets a background, even when no card exists.
    for (let ri = 0; ri < layout.maxVisibleRows + 1; ri++) {
      const ry = layout.gridTop + ri * layout.itemHeight + yOffset;
      if (ry + layout.slotSize < layout.gridTop || ry > layout.gridTop + layout.gridH) continue;
      for (let ci = 0; ci < layout.cols; ci++) {
        const rx = layout.gridStartX + ci * (layout.slotSize + layout.gap);
        roundRect(ctx, rx, ry, layout.slotSize, layout.slotSize, 6);
        ctx.fillStyle = "rgba(0,0,0,0.14)";
        ctx.fill();
      }
    }

    visibleRows.forEach((item, ri) => {
      const ry = layout.gridTop + ri * layout.itemHeight + yOffset;
      if (ry + layout.slotSize < layout.gridTop || ry > layout.gridTop + layout.gridH) return;
      for (let col = 0; col < layout.cols; col++) {
        const cell = this.craftMatrixCell(item, col);
        if (!cell) continue;
        const r: Rect = {
          x: layout.gridStartX + col * (layout.slotSize + layout.gap),
          y: ry,
          w: layout.slotSize,
          h: layout.slotSize,
        };
        const isHovered = hit(r, this.mx, this.my) && !this.drag;
        if (isHovered) hoveredEntry = { slot: -1, cell };
        const picked = !!sel && sel.item === cell.item && sel.rarity === cell.rarity;
        const scale = isHovered ? 1.08 : picked ? 1.04 : 1;
        drawCard(ctx, r, cell, { hovered: isHovered || picked, scale, dim: picked ? 1 : 0.92 });
        if (picked) {
          ctx.save();
          ctx.globalAlpha = 0.65 + Math.sin(this.time * 6) * 0.25;
          roundRect(ctx, r.x - 1, r.y - 1, r.w + 2, r.h + 2, 7);
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#ffe763";
          ctx.stroke();
          ctx.restore();
        }
      }
    });

    ctx.restore();

    // Color-coded rarity headings make each matrix column easy to scan.
    for (let col = 0; col < layout.cols; col++) {
      const x = layout.gridStartX + col * (layout.slotSize + layout.gap) + layout.slotSize / 2;
      const rarityName = RARITIES[col]?.name ?? "";
      text(ctx, rarityName, x, layout.gridTop - 10 * layout.scale, 9 * layout.scale, RARITIES[col]?.color ?? "rgba(255,255,255,0.6)");
    }

    if (rows.length === 0) {
      text(
        ctx,
        this.craftSearchText || this.craftBiome !== "All" ? "No cards match filter" : "Bag empty",
        p.x + p.w / 2,
        layout.gridTop + layout.gridH / 2,
        12 * layout.scale,
        "rgba(255,255,255,0.70)",
      );
    }

    if (rows.length > layout.maxVisibleRows) {
      scrollbar(ctx, layout.scrollTrack, this.craftScrollThumbRect(layout), this.craftDraggingThumb);
    }

    return hoveredEntry;
  }

  /** Craft mode: 5 big slots in pentagon — with fill animation from CraftAnimation */
  private renderCraftSlots(ctx: CanvasRenderingContext2D, layout: ReturnType<GameClient["craftLayout"]>) {
    const p = layout.panel;
    const sel = this.craftSel;
    const avail = sel ? this.countOf(sel.item, sel.rarity) : 0;
    const submitting = this.craftPhase === "rotating" || this.craftPhase === "waiting";
    const spin = this.craftSpin > 0 ? ease.inOutCubic(1 - this.craftSpin / 0.8) * Math.PI * 2 : 0;

    text(ctx, "Click: load 5 cards · Shift+click: load all (unlimited)", p.x + p.w * 0.38, layout.craftBottom - 18 * layout.scale, 9 * layout.scale, "rgba(255,255,255,0.55)");

    // Draw animated slots (pentagon with rotation/contraction)
    layout.bigSlots.forEach((baseRect, i) => {
      const [ox, oy] = this.craftLocalPos(i);
      const progress = this.craftPhase === "rotating" ? Math.min(1, this.craftRotTime / this.craftRotDuration) : 0;
      const [px, py] = this.craftPhase === "rotating" ? this.craftContractedPos(progress, ox, oy) : [ox, oy];
      const rad = (Math.PI / 180) * this.craftAngle;
      const cx = layout.cx + px * Math.cos(rad) - py * Math.sin(rad);
      const cy = layout.cy + px * Math.sin(rad) + py * Math.cos(rad);
      const r: Rect = { x: cx - baseRect.w / 2, y: cy - baseRect.h / 2, w: baseRect.w, h: baseRect.h };

      // Once submitted, keep all five input cards visible even after the
      // authoritative inventory update removes them from the bag. Otherwise
      // a slot is filled only once the player has clicked a card into it.
      const slotCount = this.craftSlotCounts[i] ?? 0;
      const filled = !!sel && (submitting || slotCount > 0) && this.craftPhase !== "showing";
      // Slot background always drawn (CraftAnimation drawSlots behavior)
      ctx.save();
      roundRect(ctx, r.x, r.y, r.w, r.h, 8);
      ctx.fillStyle = "#A8865A";
      ctx.fill();
      ctx.restore();

      if (!filled || !sel) return;

      ctx.save();
      if (this.craftSpin > 0) {
        ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
        ctx.rotate(spin + i * 0.25);
        ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
      }
      const bob = Math.sin(this.time * 3 + i * 0.7) * 1.2;
      // Fill animation (growing card) only for newly filled slots
      if (this.craftFillActive) {
        const fill = this.craftFillTransform();
        ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
        ctx.rotate(fill.angle);
        ctx.scale(fill.scale, fill.scale);
        ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
      }
      drawCard(ctx, { ...r, y: r.y + bob }, { item: sel.item, rarity: sel.rarity, count: Math.max(1, slotCount) }, {
        scale: this.craftSpin > 0 ? 1.06 : 1,
      });
      ctx.restore();
    });

    // Info lines below pentagon, above grid — not overlapping
    const y = layout.infoY;
    const sc = layout.scale;
    if (!sel) {
      text(ctx, "Pick a card from inventory below", layout.cx, y - 45 * sc, 12 * sc, "rgba(255,255,255,0.75)");
      return;
    }
    const def = ITEMS[sel.item];
    const chance = craftChanceFor(sel.rarity);
    text(ctx, `${RARITIES[sel.rarity].name} ${def.name}`, layout.cx, y, 14 * sc, RARITIES[sel.rarity].color);
    const loaded = this.craftTotalLoaded();
    const ready = loaded > 0;
    const status = submitting
      ? `Using ${loaded} cards...`
      : loaded > 0
        ? `Loaded ${loaded} · Ready`
        : `Loaded 0`;
    text(
      ctx,
      status,
      layout.cx,
      y + 16 * sc,
      11 * sc,
      submitting || ready ? "#c9ffd6" : "#ffbcbc",
    );
    if (sel.rarity < MAX_CRAFT_RARITY && chance !== undefined) {
      const next = sel.rarity + 1;
      text(ctx, `→ ${RARITIES[next].name} ${(chance * 100).toFixed(1)}%`, layout.cx, y + 28 * sc, 11 * sc, RARITIES[next].color);
    } else {
      text(ctx, "Max rarity", layout.cx, y + 28 * sc, 11 * sc, "rgba(255,255,255,0.65)");
    }
  }

  /** Oracle / Trade modes: single centered slot */
  private renderCraftSingle(
    ctx: CanvasRenderingContext2D,
    layout: ReturnType<GameClient["craftLayout"]>,
    mode: "oracle" | "trade",
  ) {
    const p = layout.panel;
    const sc = layout.scale;
    const isOracle = mode === "oracle";
    const sel = this.craftSel;
    const avail = sel ? this.countOf(sel.item, sel.rarity) : 0;
    const r = layout.singleSlot;

    text(
      ctx,
      isOracle ? "Upgrade 1 rarity — guaranteed" : "Exchange for Coins",
      layout.cx,
      r.y - 18 * sc,
      11 * sc,
      "rgba(255,255,255,0.85)",
    );

    // background
    ctx.save();
    roundRect(ctx, r.x, r.y, r.w, r.h, 8 * sc);
    ctx.fillStyle = isOracle ? "#1E3C78" : "#1E6432";
    ctx.fill();
    ctx.restore();

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
      if (this.craftFillActive) {
        const fill = this.craftFillTransform();
        ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
        ctx.rotate(fill.angle);
        ctx.scale(fill.scale, fill.scale);
        ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
      }
      drawCard(ctx, r, { item: sel.item, rarity: sel.rarity, count: avail });
      ctx.restore();
    } else {
      text(ctx, "+", r.x + r.w / 2, r.y + r.h / 2, 22 * sc, "rgba(255,255,255,0.35)");
    }

    const y = layout.infoY;
    if (sel) {
      const def = ITEMS[sel.item];
      text(ctx, `${RARITIES[sel.rarity].name} ${def.name}`, layout.cx, y, 13 * sc, RARITIES[sel.rarity].color);
      if (isOracle) {
        const required = oracleRequiredCount(sel.rarity);
        if (required === undefined) {
          text(ctx, "Cannot Oracle this rarity", layout.cx, y + 16 * sc, 11 * sc, "#ffbcbc");
        } else {
          text(ctx, `Need ${required} — have ${avail}`, layout.cx, y + 16 * sc, 11 * sc, avail >= required ? "#c9ffd6" : "#ffbcbc");
          const target = sel.rarity + ORACLE_SKIP;
          if (target < RARITIES.length) {
            text(ctx, `→ ${RARITIES[target].name}`, layout.cx, y + 28 * sc, 11 * sc, RARITIES[target].color);
          }
        }
      } else {
        text(ctx, `${avail} → ${avail} Coin${avail === 1 ? "" : "s"}`, layout.cx, y + 16 * sc, 11 * sc, "#ffd54a");
      }
    } else {
      text(ctx, "Pick a card below", layout.cx, y + 10 * sc, 11 * sc, "rgba(255,255,255,0.7)");
    }

    const cooldownMs = this.craftCooldownLeft(mode);
    const ready = cooldownMs <= 0;
    text(
      ctx,
      `${isOracle ? "Oracle" : "Trade"}: ${ready ? "Ready" : this.formatCooldown(cooldownMs)}`,
      layout.cx,
      y + 42 * sc,
      10 * sc,
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
      const enabled = !!sel
        && this.craftTotalLoaded() > 0
        && sel.rarity < MAX_CRAFT_RARITY
        && this.craftPhase === "none";
      return { text: "CRAFT", enabled };
    }
    if (this.craftMode === "oracle") {
      const required = sel ? oracleRequiredCount(sel.rarity) : undefined;
      const enabled = !!sel && required !== undefined && avail >= required && this.craftCooldownLeft("oracle") <= 0;
      return { text: "ORACLE", enabled };
    }
    return { text: "TRADE", enabled: !!sel && avail >= 1 && this.craftCooldownLeft("trade") <= 0 };
  }

  /**
   * Modal [AFK CHECK] prompt drawn dead-centre. It dims the world, states why
   * it appeared, and counts down to the disconnect. Clicking the button is the
   * only way to dismiss it (see gameClick/onPointerDown).
   */
  private renderAfkCheck() {
    const ctx = this.ctx;
    const t = ease.outCubic(this.afkAnim);
    const secs = Math.max(0, Math.ceil(this.afkSmoothSeconds));
    // Urgency ramps up as the countdown drains: red text and a faster pulse.
    const urgent = secs <= 10;
    const pulse = 1 + Math.sin(this.time * (urgent ? 9 : 4.5)) * 0.035 * t;

    ctx.save();
    ctx.globalAlpha = t;
    ctx.fillStyle = "rgba(8,10,14,0.72)";
    ctx.fillRect(0, 0, this.w, this.h);

    const cx = this.w / 2;
    const cy = this.h / 2;
    const panelW = Math.min(this.isMobile ? 320 : 460, this.w - 32);
    const panelH = this.isMobile ? 220 : 250;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pulse, pulse);
    ctx.translate(-cx, -cy);

    panel(ctx, { x: cx - panelW / 2, y: cy - panelH / 2 - 26, w: panelW, h: panelH }, "rgba(24,30,40,0.96)");
    text(ctx, "ARE YOU STILL THERE?", cx, cy - panelH / 2 + 12, this.isMobile ? 24 : 27, "#ffe763");
    text(
      ctx,
      "No activity detected for a while.",
      cx,
      cy - panelH / 2 + 48,
      15,
      "#c9d6e4",
    );
    text(
      ctx,
      "Click the button to stay in the game.",
      cx,
      cy - panelH / 2 + 70,
      15,
      "#c9d6e4",
    );

    // Countdown ring + seconds, sitting just above the button.
    const ringY = cy - 18;
    const ringR = 26;
    const frac = Math.max(0, Math.min(1, this.afkSmoothSeconds / AFK_CHECK_SECONDS));
    ctx.save();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.arc(cx, ringY, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = urgent ? "#ff6f6f" : "#3fae60";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, ringY, ringR, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    text(ctx, `${secs}`, cx, ringY, 24, urgent ? "#ff8080" : "#ffffff");

    const r = this.afkButtonRect();
    button(
      ctx,
      r,
      "AFK CHECK",
      urgent ? "#c9452b" : "#3fae60",
      hit(r, this.mx, this.my),
      this.isMobile ? 22 : 24,
    );
    text(
      ctx,
      "You will be disconnected when the timer runs out.",
      cx,
      r.y + r.h + 24,
      13,
      "#98a7b8",
    );
    ctx.restore();
    ctx.restore();
  }

  /** Shown after the server dropped us for failing the AFK check. */
  private renderAfkKicked() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "rgba(8,10,14,0.8)";
    ctx.fillRect(0, 0, this.w, this.h);
    text(ctx, "Disconnected — AFK", this.w / 2, this.h / 2 - 60, 38, "#ffb066");
    text(
      ctx,
      "You did not respond to the AFK check.",
      this.w / 2,
      this.h / 2 - 16,
      17,
      "#ffffff",
    );
    const bw = 200;
    const r = { x: this.w / 2 - bw / 2, y: this.h / 2 + 30, w: bw, h: 52 };
    button(ctx, r, this.scene === "menu" ? "Reconnect" : "Main menu", "#41505f", hit(r, this.mx, this.my), 20);
    ctx.restore();
  }

  private renderDeath() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "rgba(8,10,14,0.66)";
    ctx.fillRect(0, 0, this.w, this.h);
    text(ctx, "You were shredded!", this.w / 2, this.h / 2 - 70, 42, "#ff8080");
    text(ctx, "click Respawn to continue", this.w / 2, this.h / 2 - 20, 17, "#ffffff");
    const bw = 180;
    const cx = this.w / 2;
    this.deathCenterRespawnRect = { x: cx - bw - 10, y: this.h / 2 + 40, w: bw, h: 52 };
    this.deathCenterMenuRect = { x: cx + 10, y: this.h / 2 + 40, w: bw, h: 52 };
    button(ctx, this.deathCenterRespawnRect, "Respawn", "#3fae60", hit(this.deathCenterRespawnRect, this.mx, this.my), 20);
    button(ctx, this.deathCenterMenuRect, "Main menu", "#41505f", hit(this.deathCenterMenuRect, this.mx, this.my), 20);
    this.drawDeathDropPanel(ctx);
    ctx.restore();
  }

  private drawDeathDropPanel(ctx: CanvasRenderingContext2D) {
    const W = this.w;
    const H = this.h;
    const isMobile = this.isMobile || W < 640;
    const margin = isMobile ? 8 : 16;
    const panelW = Math.min(isMobile ? 280 : 380, W - margin * 2);
    const panelH = Math.min(isMobile ? 340 : 460, H - margin * 2);
    // Top-right corner
    const px = W - panelW - margin;
    const py = margin;
    this.deathPanelRect = { x: px, y: py, w: panelW, h: panelH };

    // Background
    ctx.fillStyle = "rgba(10, 10, 18, 0.96)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(px, py, panelW, panelH, 10);
    else ctx.rect(px, py, panelW, panelH);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 60, 60, 0.5)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(px, py, panelW, panelH, 10);
    else ctx.rect(px, py, panelW, panelH);
    ctx.stroke();

    // Content area (scrollable) — fills the entire panel
    const pad = isMobile ? 10 : 14;
    const contentTop = py + pad;
    const contentH = panelH - pad * 2;
    const contentW = panelW - pad * 2;
    this.deathContentRect = { x: px + pad, y: contentTop, w: contentW, h: contentH };

    // Build cells from currentRunDrops — MERGE same item+rarity
    const drops = this.currentRunDrops || [];
    const merged = new Map<string, { item: number; rarity: number; count: number }>();
    for (const drop of drops) {
      const itemId = ITEMS.findIndex((d) => d && d.name === drop.type);
      const rarityIdx = RARITIES.findIndex((r) => r && r.name === drop.rarity);
      if (itemId >= 0 && rarityIdx >= 0) {
        const def = ITEMS[itemId];
        const rar = RARITIES[rarityIdx];
        // Guard: drawCard/ui.ts shade() requires valid color strings
        if (!def || !rar) continue;
        if (typeof rar.color !== "string") continue;
        const key = `${itemId}_${rarityIdx}`;
        const existing = merged.get(key);
        if (existing) {
          existing.count += drop.count || 1;
        } else {
          merged.set(key, { item: itemId, rarity: rarityIdx, count: drop.count || 1 });
        }
      }
    }

    // 转为数组并按稀有度排序 (b.rarity - a.rarity 表示降序，最稀有的在最前面)
    // 如果你的稀有度定义是索引越小越稀有，请改成 a.rarity - b.rarity
    const cells = Array.from(merged.values()).sort((a, b) => {
      if (a.rarity !== b.rarity) {
        return b.rarity - a.rarity;
      }
      // 相同稀有度下，按物品ID排序，保持同种物品在一起
      return a.item - b.item;
    });

    const cols = Math.max(5, Math.floor(contentW / (isMobile ? 48 : 62)));
    const gap = 6;
    const slotSize = Math.floor((contentW - gap * (cols - 1)) / cols);
    const rowH = slotSize + gap + (isMobile ? 10 : 12);
    const totalRows = Math.ceil(cells.length / cols);
    const totalContentH = totalRows * rowH;
    this.deathMaxScroll = Math.max(0, totalContentH - contentH);
    this.deathScrollOffset = Math.max(0, Math.min(this.deathMaxScroll, this.deathScrollOffset));

    // Draw cards (clipped)
    ctx.save();
    ctx.beginPath();
    ctx.rect(px + pad, contentTop, contentW, contentH);
    ctx.clip();

    const startRow = Math.floor(this.deathScrollOffset / rowH);
    const startIdx = startRow * cols;

    for (let i = startIdx; i < cells.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = px + pad + col * (slotSize + gap);
      const cy = contentTop + row * rowH - this.deathScrollOffset;

      if (cy + rowH < contentTop || cy > contentTop + contentH) continue;

      const cell = cells[i];
      drawCard(ctx, { x: cx, y: cy, w: slotSize, h: slotSize }, cell, { hovered: false });

      // Rarity label below card
      const rar = RARITIES[cell.rarity];
      if (rar) {
        ctx.save();
        ctx.font = `900 ${isMobile ? 8 : 9}px ${FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 3;
        ctx.strokeText(rar.name, cx + slotSize / 2, cy + slotSize + 2);
        ctx.fillStyle = rar.color;
        ctx.fillText(rar.name, cx + slotSize / 2, cy + slotSize + 2);
        ctx.restore();
      }
    }

    ctx.restore();

    // Scrollbar
    if (this.deathMaxScroll > 0) {
      const barX = px + panelW - 12;
      const barY = contentTop;
      const barH = contentH;
      const thumbH = Math.max(16, barH * (contentH / totalContentH));
      const thumbY = barY + (this.deathScrollOffset / this.deathMaxScroll) * (barH - thumbH);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(barX, barY, 5, barH, 2);
      else ctx.rect(barX, barY, 5, barH);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(barX, thumbY, 5, thumbH, 2);
      else ctx.rect(barX, thumbY, 5, thumbH);
      ctx.fill();
    }
  }
}
