/**
 * CLIENT MAIN FILE
 * ----------------
 * Everything the player sees is painted with canvas2d (no DOM/CSS UI):
 * main menu, account panel, world, HUD, inventory bag, crafting panel,
 * drag & drop of item cards, panel/scene animations.
 */
import {
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
  MOBS,
  ORACLE_SKIP,
  RARITIES,
  SECONDARY_SLOT_COUNT,
  SLOT_COUNT,
  Wall,
  bagCellIndex,
  isBagCell,
  isMainCell,
  craftChanceFor,
  getSummonCount,
  mapRarityToSummonRarity,
  oracleRequiredCount,
  xpForLevel,
} from "../shared/defs";
import { C2S, ENT, EVT, Reader, S2C, SWAP_ROW_ALL, TEAM, Writer } from "../shared/protocol";
import type { Cell } from "../shared/sim";
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
  name: string;
  seen: number;
  hurt: number;
  spawn: number;
  spreadMode?: boolean;
  contractMode?: boolean;
  mousePosition?: { x: number; y: number };
  health?: number;
  maxHealth?: number;
  spreadAnim?: number;
  contractAnim?: number;
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
    maxMagicAnts: number = 20;
    maxParticles: number = 200;
    performanceMode: string = "auto";
    photoHardware: boolean = false;
    collisionUpdateSkip: number = 0;
    lowQualityWall: boolean = false;

    // UI状态
    panelOpen: boolean = false;
    panelRect: [number, number, number, number] | null = null;
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
            return {
                x: (clientX - rect.left) * (currentCanvas.width / rect.width),
                y: (clientY - rect.top) * (currentCanvas.height / rect.height)
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

                const rect = canvas.getBoundingClientRect();
                const deltaY = e.touches[0].clientY - touchStartY;
                const scaleY = canvas.height / rect.height;

                this.scrollOffset = Math.max(0, Math.min(
                    this.maxScrollOffset,
                    touchStartOffset - deltaY * scaleY
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
                showMovementHelper: this.showMovementHelper
            }));
        } catch(e) {}
        this._forceRedraw();
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

        const panelW = 320;
        const viewW = x * 2;
        const viewH = y * 2;
        const panelX = Math.min(118, Math.max(12, viewW - panelW - 12));
        const panelY = 16;
        const panelH = Math.max(300, Math.min(480, viewH - panelY - 16));
        this.panelRect = [panelX, panelY, panelW, panelH];

        const totalContentHeight = 880;
        const contentY = panelY + 70;
        const contentH = panelH - 90;
        this.maxScrollOffset = Math.max(0, totalContentHeight - contentH);

        ctx.save();
        ctx.lineJoin = "round";

        // 背景
        ctx.fillStyle = 'rgba(180, 180, 180, 0.95)';
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(panelX, panelY, panelW, panelH, 15);
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
                       'showMovementHelper','lowQualityWall'];
        const labels = ['Show Hitbox', 'Show Rarity', 'Show Damage', 'Show Particles',
                        'Health Bar', 'Enemy Panel', 'Show FPS', 'Show Projectile Hitbox',
                        'Show Advanced DPS', 'Potato Hardware', 'Movement Helper','Low Quality Wall'];

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

        const aboutText = "Hi there! Welcome to Flwrr.pro, a game inspired by zorr.pro, which is developed since November 2025. Welcome to give advise by multi-player mode or just tell me directly.";

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

        // 关闭按钮
        const closeX = panelX + panelW - 35, closeY = panelY + 10, closeSize = 25;
        ctx.fillStyle = '#e74c3c';
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(closeX, closeY, closeSize, closeSize, 6);
        } else {
            ctx.rect(closeX, closeY, closeSize, closeSize);
        }
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.stroke();
        drawStrokeText('×', closeX + 12, closeY + 13, 18);

        ctx.restore();
    }

    handleClick(x: number, y: number) {
        if (!this.panelOpen || !this.panelRect) return false;

        const [px, py, pw, ph] = this.panelRect;

        // 1. 关闭按钮
        const closeX = px + pw - 35, closeY = py + 10, closeSize = 25;
        if (x >= closeX && x <= closeX + closeSize && y >= closeY && y <= closeY + closeSize) {
            this.panelOpen = false;
            this._forceRedraw();
            return true;
        }

        // 2. 滚动条拖拽开始 — test the thumb before the track because
        // the thumb sits inside the track rectangle.
        if (this._scrollThumbRect) {
            const [tx, ty, tw, th] = this._scrollThumbRect;
            if (x >= tx && x <= tx + tw && y >= ty && y <= ty + th) {
                this.isDraggingScroll = true;
                this.dragStartY = y;
                this.dragStartOffset = this.scrollOffset;
                return true;
            }
        }

        // 3. 滚动条点击
        if (this._scrollBarRect) {
            const [sx, sy, sw, sh] = this._scrollBarRect;
            if (x >= sx && x <= sx + sw && y >= sy && y <= sy + sh) {
                const relativeY = y - sy;
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
                       'showMovementHelper','lowQualityWall'];

        for (let i = 0; i < items.length; i++) {
            const itemY = checkYStart + i * itemH - this.scrollOffset;
            const checkX = px + 25;
            const checkSize = 20;

            const hitX = checkX - 8;
            const hitY = itemY - 10;
            const hitW = checkSize + 16;
            const hitH = itemH + 8;

            const isHit = x >= hitX && x <= hitX + hitW && y >= hitY && y <= hitY + hitH;

            if (isHit) {
                this.toggle(items[i]);
                this._forceRedraw();
                return true;
            }
        }

        // 5. 减号按钮
        if (this._minusRect) {
            const [rx, ry, rw, rh] = this._minusRect;
            if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) {
                this.setMaxMagicAnts(this.maxMagicAnts - 5);
                return true;
            }
        }

        // 6. 加号按钮
        if (this._plusRect) {
            const [rx, ry, rw, rh] = this._plusRect;
            if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) {
                this.setMaxMagicAnts(this.maxMagicAnts + 5);
                return true;
            }
        }

        // 7. Magic Ants 滑块
        if (this._sliderRect) {
            const [rx, ry, rw, rh] = this._sliderRect;
            if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) {
                const percent = (x - rx) / rw;
                this.setMaxMagicAnts(Math.floor(1 + percent * 99));
                return true;
            }
        }

        // 8. Particles 滑块
        if (this._particleSliderRect) {
            const [rx, ry, rw, rh] = this._particleSliderRect;
            if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) {
                const percent = (x - rx) / rw;
                this.setMaxParticles(Math.floor(50 + percent * 450));
                return true;
            }
        }

        return false;
    }

    handleMouseMove(x: number, y: number) {
        if (!this.panelOpen) return;
        if (this.isDraggingScroll && this._scrollThumbRect && this._scrollBarRect) {
            const th = this._scrollThumbRect[3];
            const scrollBarH = this._scrollBarRect[3];
            const dy = y - this.dragStartY;

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
  width = 380;
  height = 65;

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

  draw(ctx: CanvasRenderingContext2D, screenHeight: number) {
    if (!this.visible) return;
    if (!this.messages) this.messages = [];
    const now = Date.now();
    this.messages = this.messages.filter(msg => now - msg.timestamp < 30000);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = Math.min(2, (window.devicePixelRatio || 1));
    ctx.scale(dpr, dpr);
    const panelX = 15;
    const panelY = screenHeight - this.height - 2;
    const padding = 12;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, this.width, this.height, 10);
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
      const y = panelY - 10 - i * lineHeight;
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
    const inputY = panelY + this.height - 28;
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
  private bonus = new BonusSystem();
  private bonusOpen = false;
  private chat = new ChatSystem();
  private squadCode = "";

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

  // player state
  private hp = 100;
  private maxHp = 100;
  private xp = 0;
  private level = 1;
  private alive = true;
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
  private mobileSpreadRect: Rect | null = null;
  private mobileContractRect: Rect | null = null;
  private mobileJoystickRect: Rect | null = null;
  private mobileFullscreenBtn: Rect | null = null;
  private mobileControlsVisible = false;
  private lastTouchTime = 0;

  // Dual-row quick-slot bar (main + secondary)
  quickSlot!: QuickSlot;

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
    this.loadLocal();
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
      reloadProgress: (slot) => this.slotReload[slot] ?? 1,
      slotHp: (slot) => this.slotHp[slot] ?? 1,
      draggingFrom: () => this.drag?.from ?? -1,
      requestSwapSlot: (slot) => this.sendSwapRow(slot),
      requestSwapAll: () => this.sendSwapRow(SWAP_ROW_ALL),
      drawTooltip: (cell, x, y) => this.tooltip(cell, x, y),
    };
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


  private detectMobile(): boolean {
    if (typeof window === "undefined") return false;
    return (
      window.innerWidth <= 900 ||
      /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      "ontouchstart" in window
    );
  }

  private updateMobileLayout() {
    this.isMobile = this.detectMobile();
    if (!this.isMobile) {
      this.mobileControlsVisible = false;
      return;
    }
    // Show mobile controls only in game scene for better UX
    this.mobileControlsVisible = this.scene === "game";
    const hotbarH = this.hotbarHeight();
    // Joystick bottom-left
    const joyRadius = Math.min(62, Math.max(48, this.w * 0.13));
    const joyCenterX = 90;
    const joyCenterY = this.h - hotbarH - joyRadius - 18;
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
    const btnSize = Math.min(70, Math.max(54, this.w * 0.15));
    const gap = 12;
    const rightX = this.w - btnSize - 18;
    const baseY = this.h - hotbarH - btnSize * 2 - gap - 22;
    this.mobileSpreadRect = { x: rightX, y: baseY, w: btnSize, h: btnSize };
    this.mobileContractRect = { x: rightX, y: baseY + btnSize + gap, w: btnSize, h: btnSize };
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
      if (nm) this.playerName = nm;
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
        this.chat.addMessage("Welcome! Press [Enter] to chat. Commands: /claim, /create_public_squad, /create_private_squad, /join_squad <CODE>, /leave_squad, /find_public_squad", "System", true);
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
          // Mob radii use u16: the Eternal 10× size tier can exceed the
          // previous 255px byte limit. Other entity kinds remain compact u8.
          const radius = kind === ENT.MOB ? r.u16() : r.u8();
          const hp = r.u8() / 255;
          let name = "";
          if (kind === ENT.PLAYER) name = r.str();
          const rarity = kind === ENT.MOB ? r.u8() : 0;
          let e = this.ents.get(id);
          if (!e) {
            e = {
              id, kind, type: etype, team, x, y, tx: x, ty: y, angle,
              radius, hp, displayHp: hp, rarity, name, seen: this.time, hurt: 0, spawn: 0,
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
          if (name) e.name = name;
          e.seen = this.time;
          if (e.spawn < 1) e.spawn = Math.min(1, e.spawn + 0.12);
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
      case S2C.CHAT: {
        const text = r.str();
        const sender = r.str();
        const isSystem = r.u8() === 1;
        const isCraftReport = r.u8() === 1;
        const isSelf = sender === this.playerName;
        this.chat.addMessage(text, sender, isSystem, isCraftReport, isSelf);
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
        this.craftMsg = value > 1 ? `Crafted ${value}x ${RARITIES[rarity].name} ${ITEMS[item].name}!` : `Crafted ${RARITIES[rarity].name} ${ITEMS[item].name}!`;
        this.craftLogCrafted += value;
        this.craftLogLast = this.craftMsg;
        this.craftResolve({ item, rarity, count: value });
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

    for (const e of this.ents.values()) {
      const k = Math.min(1, dt * 16);
      e.x += (e.tx - e.x) * k;
      e.y += (e.ty - e.y) * k;
      e.hurt = Math.max(0, e.hurt - dt);
      // Lagging health buffer: eases toward the real health so damage shows
      // as a brief red trail draining off the bar instead of an instant cut.
      if (e.displayHp === undefined) e.displayHp = e.hp;
      e.displayHp += (e.hp - e.displayHp) * Math.min(1, dt * 6);
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
    const uiBusy = this.drag !== null || this.bagAnim > 0.4 || this.craftAnim > 0.4 || this.chat.inputActive;

    if (this.isMobile && this.mobileJoystick.active) {
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
    } else {
      // Mouse movement is measured from the camera/screen centre (where the
      // player is rendered). The server remains authoritative for acceleration,
      // wall collision, and map bounds; this is only the desired direction.
      // Close to the player, reduce the input so it eases to a stop instead of
      // continuously overshooting the cursor.
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
    // Mobile: almost full width for easier touch
    const isMobileLayout = this.isMobile || this.w < 640;
    const w = isMobileLayout ? Math.min(440, this.w * 0.96) : Math.min(400, this.w * 0.92);
    const hotbarH = this.hotbarHeight();
    const maxH = this.h - hotbarH - (isMobileLayout ? 40 : 130);
    const h = Math.min(isMobileLayout ? this.h * 0.86 : 560, Math.max(320, maxH));
    const hidden = this.h + 20;
    const shown = this.h - hotbarH - h - (isMobileLayout ? 10 : 26);
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
    return bagCellIndex(entry.slot);
  }

  private craftPanelRect(): Rect {
    // WIDER panel as requested — 760px ideal, responsive down to 92% of screen
    // On mobile, use almost full width and slide from bottom instead of side for better touch
    const isMobileLayout = this.isMobile || this.w < 640;
    const idealW = isMobileLayout ? this.w * 0.96 : 780;
    const w = Math.min(idealW, Math.floor(this.w * (isMobileLayout ? 0.96 : 0.92)));
    const hotbarH = this.hotbarHeight();
    const maxH = this.h - hotbarH - (isMobileLayout ? 12 : 40);
    const h = Math.min(isMobileLayout ? this.h * 0.88 : 620, Math.max(560, maxH, this.h - 40));
    const t = ease.outCubic(this.craftAnim);
    if (isMobileLayout) {
      const hidden = this.h + 20;
      const shown = this.h - hotbarH - h - 10;
      return { x: (this.w - w) / 2, y: hidden + (shown - hidden) * t, w, h };
    }
    const hidden = this.w + 20;
    const shown = this.w - w - 16;
    return { x: hidden + (shown - hidden) * t, y: Math.max(12, this.h - hotbarH - h - 18), w, h };
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
    const pad = 14;
    const headerH = 42;
    const tabsH = 32;
    const barH = 26;

    // Craft log and compact mode selectors share the top row.
    const logRect: Rect = { x: p.x + pad, y: p.y + 10, w: 150, h: 82 };
    const tabsY = p.y + 10;

    // CraftAnimation geometry: radius 80 and slot size 70.
    const bigSize = 70;
    const radius = 80;
    const cx = p.x + p.w * 0.38;
    const cy = p.y + 148;

    const bigSlots: Rect[] = [];
    for (let i = 0; i < CRAFT_CARD_COUNT; i++) {
      const ang = (Math.PI / 180) * (-90 + i * (360 / CRAFT_CARD_COUNT));
      const ox = Math.cos(ang) * radius;
      const oy = Math.sin(ang) * radius;
      bigSlots.push({ x: cx + ox - bigSize / 2, y: cy + oy - bigSize / 2, w: bigSize, h: bigSize });
    }
    const singleSlot: Rect = { x: cx - bigSize / 2, y: cy - bigSize / 2, w: bigSize, h: bigSize };

    const resultSize = 88;
    const resultRect: Rect = { x: cx - resultSize / 2, y: cy - resultSize / 2, w: resultSize, h: resultSize };

    // Pin the action to the right edge, centered beside the pentagon.
    const actionW = 110;
    const actionH = 36;
    const actionRect: Rect = { x: p.x + p.w - 124, y: cy - actionH / 2, w: actionW, h: actionH };
    const closeRect: Rect = { x: p.x + p.w - 34, y: p.y + 10, w: 24, h: 24 };

    const craftBottom = cy + radius + bigSize / 2 + 24;

    // Filters are directly above the prompt and matrix: biome first, search second.
    const barGap = 8;
    const dropW = 110;
    const barW = Math.min(210, p.w * 0.34);
    const dropX = p.x + pad;
    const barY = craftBottom + 4;
    const barX = dropX + dropW + barGap;
    const infoY = barY + barH + 10;
    const gridTop = infoY + 38;
    const gridBottom = p.y + p.h - 10;

    // Matrix columns map directly to rarity indexes; rows map to item types.
    const slotSizeSmall = 40;
    const gapSmall = 6;
    const itemHeightSmall = slotSizeSmall + gapSmall;
    const cols = RARITIES.length;
    const totalGridWidth = cols * (slotSizeSmall + gapSmall) - gapSmall;
    const gridStartX = p.x + p.w / 2 - totalGridWidth / 2;
    const gridH = Math.max(itemHeightSmall, gridBottom - gridTop);
    const maxVisibleRows = Math.max(1, Math.floor(gridH / itemHeightSmall));
    const scrollTrack: Rect = { x: gridStartX + totalGridWidth + 10, y: gridTop, w: 6, h: gridH };

    return {
      panel: p,
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
      if (this.craftMode !== "trade" && def.kind === "trinket") continue;
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
  private hudButtonRowY(row: 0 | 1): number {
    const isMobileLayout = this.isMobile || this.w < 640;
    const mobileOffset = isMobileLayout ? 130 : 0; // lift above joystick
    const bottom = this.h - this.hotbarHeight() - 34 - mobileOffset;
    return bottom - (1 - row) * 46 - 38;
  }

  private hudButtons(): { id: string; rect: Rect; label: string; color: string }[] {
    const isMobileLayout = this.isMobile || this.w < 640;
    const bw = isMobileLayout ? Math.min(100, this.w * 0.22) : Math.min(120, this.w / 8);
    const bh = isMobileLayout ? 44 : 38;
    const invLabel = isMobileLayout ? "Bag" : "Inventory";
    return [
      { id: "bag", rect: { x: 16, y: this.hudButtonRowY(0), w: bw, h: bh }, label: invLabel, color: "#3d8bd6" },
      { id: "craft", rect: { x: 16, y: this.hudButtonRowY(1), w: bw, h: bh }, label: "Craft", color: "#c9762b" },
      // Settings is a main-menu-only panel: it is deliberately absent from the
      // in-game HUD (neither the button nor the panel is drawn while playing).
      { id: "menu", rect: { x: this.w - (isMobileLayout ? 88 : 108), y: this.hudButtonRowY(1), w: isMobileLayout ? 72 : 92, h: bh }, label: "Menu", color: "#8a4d4d" },
    ];
  }

  private mapButtons(): { id: number; rect: Rect }[] {
    const isMobileLayout = this.isMobile || this.w < 640;
    const bw = isMobileLayout ? 78 : 92;
    const bh = isMobileLayout ? 36 : 38;
    // On mobile, show map buttons centered at top or just above hotbar but shifted right to avoid joystick overlap
    const x = isMobileLayout ? this.w * 0.32 : this.w - (bw + 8) * MAPS.length - 8;
    const baseY = this.hudButtonRowY(0);
    // If mobile, put map buttons slightly lower than inventory to avoid overlap?
    return MAPS.map((m, idx) => ({ id: m.id, rect: { x: x + idx * (bw + 8), y: baseY, w: bw, h: bh } }));
  }

  // ---------------------------------------------------------------- events
  private onContext = (e: Event) => e.preventDefault();

  private onKeyDown = (e: KeyboardEvent) => {
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
    // Mobile joystick handling: if active, clamp current point to radius
    if (this.isMobile && this.mobileJoystick.active) {
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
    }
    if (this.bagDraggingThumb) this.dragBagThumb(p.y);
    if (this.craftDraggingThumb) this.dragCraftThumb(p.y);
    if (this.settings.panelOpen) this.settings.handleMouseMove(p.x, p.y);
    this.quickSlot.handleMouseMove(p.x, p.y);
  };

  private onPointerDown = (e: PointerEvent) => {
    const p = this.pointerPos(e);
    this.mx = p.x;
    this.my = p.y;
    // Mobile controls: spread (Space) / contract (Shift) / joystick
    if (this.isMobile) {
      if (this.scene === "menu" && this.mobileFullscreenBtn && hit(this.mobileFullscreenBtn, p.x, p.y)) {
        this.tryEnterFullscreen();
        return;
      }
      if (this.scene === "game") {
        if (this.mobileSpreadRect && hit(this.mobileSpreadRect, p.x, p.y)) {
          this.mobileSpreadActive = true;
          this.lastTouchTime = performance.now();
          try { (e.target as Element)?.setPointerCapture?.(e.pointerId); } catch {}
          return;
        }
        if (this.mobileContractRect && hit(this.mobileContractRect, p.x, p.y)) {
          this.mobileContractActive = true;
          this.lastTouchTime = performance.now();
          try { (e.target as Element)?.setPointerCapture?.(e.pointerId); } catch {}
          return;
        }
        if (this.mobileJoystickRect && hit(this.mobileJoystickRect, p.x, p.y)) {
          this.mobileJoystick.active = true;
          this.mobileJoystick.pointerId = e.pointerId;
          this.mobileJoystick.currX = p.x;
          this.mobileJoystick.currY = p.y;
          this.lastTouchTime = performance.now();
          try { (e.target as Element)?.setPointerCapture?.(e.pointerId); } catch {}
          return;
        }
        // Allow starting joystick from any left-bottom touch as fallback
        if (p.x < this.w * 0.45 && p.y > this.h * 0.35) {
          this.mobileJoystick.active = true;
          this.mobileJoystick.pointerId = e.pointerId;
          this.mobileJoystick.centerX = p.x;
          this.mobileJoystick.centerY = p.y;
          this.mobileJoystick.currX = p.x;
          this.mobileJoystick.currY = p.y;
          this.lastTouchTime = performance.now();
          try { (e.target as Element)?.setPointerCapture?.(e.pointerId); } catch {}
          return;
        }
      }
    }
    if (e.button === 2) {
      this.rightDown = true;
      return;
    }
    this.mouseDown = true;
    if (this.scene === "menu") this.menuClick(p.x, p.y);
    else this.gameClick(p.x, p.y, e.shiftKey);
  };

  private onPointerUp = (e: PointerEvent) => {
    // Release mobile touch buttons
    if (this.isMobile) {
      this.mobileSpreadActive = false;
      this.mobileContractActive = false;
      if (this.mobileJoystick.active && (this.mobileJoystick.pointerId === null || this.mobileJoystick.pointerId === e.pointerId)) {
        this.mobileJoystick.active = false;
        this.mobileJoystick.currX = this.mobileJoystick.centerX;
        this.mobileJoystick.currY = this.mobileJoystick.centerY;
        this.mobileJoystick.pointerId = null;
      }
    }
    if (e.button === 2) {
      this.rightDown = false;
      return;
    }
    this.mouseDown = false;
    this.bagDraggingThumb = false;
    this.craftDraggingThumb = false;
    if (this.settings.panelOpen) this.settings.handleMouseUp();
    if (this.drag) this.dropDrag(this.mx, this.my);
  };

  private onWheel = (e: WheelEvent) => {
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
  
  private menuLayout() {
    // Mobile responsive: single column on phone, 3 columns on desktop
    const isMobileLayout = this.isMobile || this.w < 640;
    const COLS = isMobileLayout ? 1 : 3;
    const BIOME_W = isMobileLayout ? Math.min(280, this.w * 0.82) : 180;
    const BIOME_H = isMobileLayout ? 52 : 45;
    const BIOME_GAP = isMobileLayout ? 12 : 15;
    const gridYOffset = isMobileLayout ? 40 : 80;

    const gridW = COLS * BIOME_W + (COLS - 1) * BIOME_GAP;
    const gridX = this.w / 2 - gridW / 2;
    const gridY = this.h / 2 - gridYOffset;

    return { gridX, gridY, gridW, BIOME_W, BIOME_H, BIOME_GAP };
  }

  /** Rects for biome buttons in grid layout */
  private menuBiomeButtons() {
    const layout = this.menuLayout();
    const buttons: Record<number, { x: number; y: number; w: number; h: number }> = {};
    
    const COLS = 3;
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

  /** Rects for the main-menu actions (top bar and left sidebar) - responsive for phone */
  private menuActionRects() {
    const W = this.w;
    const H = this.h;
    const buttons: Record<string, { x: number; y: number; w: number; h: number }> = {};
    const isMobileLayout = this.isMobile || W < 640;

    if (isMobileLayout) {
      // Phone: bottom horizontal bar with 4 buttons
      const BTN_W = Math.min(78, (W - 40) / 4);
      const BTN_H = 42;
      const GAP = 8;
      const totalW = BTN_W * 4 + GAP * 3;
      const startX = (W - totalW) / 2;
      const y = H - BTN_H - 58; // above instructions
      buttons['left_inventory'] = { x: startX, y, w: BTN_W, h: BTN_H };
      buttons['left_craft'] = { x: startX + BTN_W + GAP, y, w: BTN_W, h: BTN_H };
      buttons['left_bonus'] = { x: startX + (BTN_W + GAP) * 2, y, w: BTN_W, h: BTN_H };
      buttons['left_settings'] = { x: startX + (BTN_W + GAP) * 3, y, w: BTN_W, h: BTN_H };
    } else {
      // Desktop: left sidebar
      const LEFT_X = 14;
      const LEFT_W = 90;
      const LEFT_H = 45;
      const LEFT_GAP = 10;
      const leftMidY = H / 2 - (LEFT_H * 4 + LEFT_GAP * 3) / 2;
      buttons['left_inventory'] = { x: LEFT_X, y: leftMidY, w: LEFT_W, h: LEFT_H };
      buttons['left_craft'] = { x: LEFT_X, y: leftMidY + LEFT_H + LEFT_GAP, w: LEFT_W, h: LEFT_H };
      buttons['left_bonus'] = { x: LEFT_X, y: leftMidY + (LEFT_H + LEFT_GAP) * 2, w: LEFT_W, h: LEFT_H };
      buttons['left_settings'] = { x: LEFT_X, y: leftMidY + (LEFT_H + LEFT_GAP) * 3, w: LEFT_W, h: LEFT_H };
    }

    return buttons;
  }

  private menuClick(mx: number, my: number) {
    if (this.settings.panelOpen) {
      if (this.settings.handleClick(mx, my)) return;
    }
    if (this.bonusOpen) {
      const modal = this.bonusModalRect();
      const claim = { x: modal.x + 28, y: modal.y + modal.h - 66, w: modal.w - 56, h: 40 };
      if (hit(claim, mx, my) && this.bonus.claim()) this.sendBonusStatus();
      else if (!hit(modal, mx, my)) this.bonusOpen = false;
      return;
    }
    // Craft / Inventory panels can be opened right from the main menu — give
    // them first crack at the click (same as in-game) so their own chrome
    // (close button, search, scrollbar, drag targets) works here too.
    if (this.craftAnim > 0.4 && this.handleCraftClick(mx, my)) return;
    if (this.bagAnim > 0.4 && this.handleBagClick(mx, my)) return;

    // Name field (above biome buttons)
    const layout = this.menuLayout();
    const nameFieldW = Math.min(300, this.w * 0.4);
    const nameFieldH = 42;
    const nameFieldX = this.w / 2 - nameFieldW / 2;
    const nameFieldY = layout.gridY - 70;
    const nameRect = { x: nameFieldX, y: nameFieldY, w: nameFieldW, h: nameFieldH };
    this.focus = hit(nameRect, mx, my) ? "name" : null;

    // Biome buttons
    const biomeButtons = this.menuBiomeButtons();
    for (const map of MAPS) {
      const r = biomeButtons[map.id];
      if (r && hit(r, mx, my)) {
        this.selectedMap = map.id;
        // Update target background color for smooth transition
        this.menuTargetBgColor = [...this.BIOME_BG_COLORS[map.name]];
        return;
      }
    }

    // Action buttons (top bar and left sidebar)
    const actions = this.menuActionRects();
    
    // Left sidebar buttons (same functions)
    if (actions.left_inventory && hit(actions.left_inventory, mx, my)) this.toggleBag();
    if (actions.left_craft && hit(actions.left_craft, mx, my)) this.toggleCraft();
    if (actions.left_bonus && hit(actions.left_bonus, mx, my)) this.bonusOpen = true;
    if (actions.left_settings && hit(actions.left_settings, mx, my)) this.settings.togglePanel();
    
    // Play button (big button below biome grid)
    const playBtnRect = this.menuPlayButtonRect();
    if (playBtnRect && hit(playBtnRect, mx, my)) this.startGame();
  }
  
  private menuPlayButtonRect(): Rect | null {
    const layout = this.menuLayout();
    const isMobileLayout = this.isMobile || this.w < 640;
    const cols = isMobileLayout ? 1 : 3;
    const totalRows = Math.ceil(MAPS.length / cols);
    const playBtnY = layout.gridY + totalRows * (layout.BIOME_H + layout.BIOME_GAP) + 30;
    const playBtnW = isMobileLayout ? Math.min(300, this.w * 0.86) : 180;
    const playBtnH = isMobileLayout ? 60 : 52;
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
      this.updateMobileLayout();
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
      this.updateMobileLayout();
    };
  }

  // ------------------------------------------------------------ game input
  private gameClick(mx: number, my: number, shiftKey = false) {
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

    if (hit(layout.actionRect, mx, my)) this.submitCraft();
    return true;
  }

  /** Puts a bag cell into the craft slots, with a little pop of feedback.
   *  In normal (pentagon) mode, a plain click loads 5 cards distributed
   *  evenly across the 5 slots (1 each). Shift+click instead distributes
   *  every owned card of this type evenly across the 5 slots in one go
   *  (see autoFillCraftSlots).
   */
  private selectCraftCell(cell: Cell, shiftKey = false) {
    if (this.craftPhase !== "none") return;
    if (this.craftMode !== "trade" && ITEMS[cell.item]?.kind === "trinket") {
      this.craftMsg = "Coins can only be traded.";
      this.craftMsgLife = 2;
      return;
    }

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
      this.craftSel = { item: cell.item, rarity: cell.rarity };
      this.craftSlotCounts = this.craftDistributeEvenly(Math.min(CRAFT_CARD_COUNT, avail));
      this.craftMsg = avail > CRAFT_CARD_COUNT
        ? `Loaded ${avail} cards — use shift+click to load all.`
        : avail < CRAFT_CARD_COUNT
          ? `Loaded ${avail} cards.`
          : "";
      if (this.craftMsg) this.craftMsgLife = 1.8;
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
      if (loaded < 1 || sel.rarity >= MAX_CRAFT_RARITY) {
        this.craftMsg = loaded < 1 ? "Load cards first." : "Already at max craftable rarity.";
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
    const target = this.cellIndexAtPoint(mx, my);
    if (target < 0 || target === drag.from) return;
    // Cell indices now span two hotbar rows plus an unlimited bag, so they no
    // longer fit in a byte — send both endpoints as u16.
    const w = new Writer(8);
    w.u8(C2S.SWAP).u16(drag.from).u16(target);
    this.net?.send(w.bytes());

    // The server transfers one item when the source is a bag cell. Do not do
    // a full-stack optimistic swap here: wait for its inventory snapshot so
    // the stack count and an equipped replacement cannot briefly desync.
    if (isBagCell(drag.from)) return;

    // Hotbar-to-hotbar (either row) and hotbar-to-bag stay a normal card swap,
    // mirrored locally so the drag feels instant.
    const a = this.cellAt(drag.from);
    const b = this.cellAt(target);
    this.setCellLocal(drag.from, b);
    this.setCellLocal(target, a);
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
    const titleSize = Math.max(28, Math.min(60, W * 0.07));
    const bob = Math.sin(t * 1.6) * 6;
    const titleY = Math.max(60, this.h * 0.12);
    
    ctx.font = `bold ${titleSize}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 8;
    ctx.strokeText('PETALIA.IO', W / 2, titleY + bob * 0.4);
    ctx.fillStyle = '#ffe763';
    ctx.fillText('PETALIA.IO', W / 2, titleY + bob * 0.4);
    
    // ─── Name Field (above biome buttons) ───
    const layout = this.menuLayout();
    const nameFieldW = Math.min(300, W * 0.4);
    const nameFieldH = 42;
    const nameFieldX = W / 2 - nameFieldW / 2;
    const nameFieldY = layout.gridY - 70;
    
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
    ctx.font = `18px ${FONT_FAMILY}`;
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
      const rect = biomeButtons[map.id];
      if (rect && hit(rect, this.mx, this.my)) {
        this.menuHoveredButton = `biome_${map.id}`;
      }
    }
    
    for (const map of MAPS) {
      const rect = biomeButtons[map.id];
      if (!rect) continue;
      
      const isHovered = this.menuHoveredButton === `biome_${map.id}`;
      const isSelected = this.selectedMap === map.id;
      const baseColor = isHovered ? this.BIOME_HOVER_COLORS[map.name] : this.BIOME_COLORS[map.name];
      
      drawBtn(rect, baseColor, isSelected);
      drawBtnLabel(rect, map.name, 16);
    }
    
    // ─── Play Button (below biome grid) ───
    const playBtnRect = this.menuPlayButtonRect();
    if (playBtnRect) {
      const isPlayHovered = hit(playBtnRect, this.mx, this.my);
      const playColor: [number, number, number] = isPlayHovered ? [50, 190, 80] : [63, 174, 96];
      drawBtn(playBtnRect, playColor);
      
      ctx.font = `bold 26px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeText('PLAY', playBtnRect.x + playBtnRect.w / 2, playBtnRect.y + playBtnRect.h / 2);
      ctx.fillStyle = 'white';
      ctx.fillText('PLAY', playBtnRect.x + playBtnRect.w / 2, playBtnRect.y + playBtnRect.h / 2);
    }
    
    // ─── Left Sidebar Buttons ───
    const actions = this.menuActionRects();
    const leftBtnColors: Record<string, [number, number, number]> = {
      left_inventory: [52, 152, 219],
      left_craft: [155, 89, 182],
      left_bonus: [217, 154, 38],
      left_settings: [127, 140, 141],
    };
    const leftBtnHoverColors: Record<string, [number, number, number]> = {
      left_inventory: [41, 128, 185],
      left_craft: [142, 68, 173],
      left_bonus: [195, 130, 30],
      left_settings: [100, 110, 110],
    };
    
    for (const key of ['left_inventory', 'left_craft', 'left_bonus', 'left_settings']) {
      const rect = actions[key];
      if (!rect) continue;
      const isHov = hit(rect, this.mx, this.my);
      const color = isHov ? leftBtnHoverColors[key] : leftBtnColors[key];
      drawBtn(rect, color);
      
      ctx.font = `bold 11px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      const labels: Record<string, string> = { 
        left_inventory: '[I]nventory', 
        left_craft: '[C]raft', 
        left_bonus: 'Bonus',
        left_settings: 'Settings'
      };
      ctx.strokeText(labels[key] || '', rect.x + rect.w / 2, rect.y + rect.h / 2);
      ctx.fillStyle = 'white';
      ctx.fillText(labels[key] || '', rect.x + rect.w / 2, rect.y + rect.h / 2);
    }
    
    // ─── Version text ───
    ctx.font = `14px ${FONT_FAMILY}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 3;
    ctx.strokeText('v0.4.3', W - 10, H - 10);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('v0.4.3', W - 10, H - 10);
    
    // ─── Instructions ───
    ctx.textAlign = 'center';
    ctx.font = `14px ${FONT_FAMILY}`;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    const instrText = 'Select a biome and press PLAY to enter the world';
    ctx.strokeText(instrText, W / 2, H - 30);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(instrText, W / 2, H - 30);
    
    // ─── Auth status ───
    ctx.font = `13px ${FONT_FAMILY}`;
    ctx.strokeText(this.authStatus, W / 2, H - 50);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(this.authStatus, W / 2, H - 50);

    // Craft / Inventory panels can be opened right from the main menu, reusing
    // the same in-game panel drawers.
    this.renderBag();
    this.renderCraft();
    if (this.bonusOpen) this.renderBonusModal();
    this.settings.draw(ctx, W / 2, H / 2);
    if (this.drag) {
      const size = 60;
      drawCard(ctx, { x: this.dragX - size / 2, y: this.dragY - size / 2, w: size, h: size }, this.drag.cell, {
        hovered: true,
        scale: 1.1,
      });
    }

    // Mobile: suggest fullscreen + show current control scheme
    if (this.isMobile) {
      const isFs = typeof document !== "undefined" && !!document.fullscreenElement;
      const topY = 8;
      const tipW = Math.min(360, W * 0.92);
      const tipH = isFs ? 58 : 84;
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
        const btnRect: Rect = { x: btnX, y: btnY, w: btnW, h: btnH };
        this.mobileFullscreenBtn = btnRect;
        button(ctx, btnRect, "FULLSCREEN", "#3fae60", hit(btnRect, this.mx, this.my), 13);
      } else {
        text(ctx, "Mobile: joystick to move | SPACE=Spread SHIFT=Defend", tipX + tipW / 2, topY + 18, 11, "#c9ffd6");
        text(ctx, "Buttons on right also work", tipX + tipW / 2, topY + 36, 10, "rgba(255,255,255,0.65)");
        this.mobileFullscreenBtn = null;
      }
      ctx.restore();
    }
  }

  private bonusModalRect(): Rect {
    return { x: this.w / 2 - 175, y: this.h / 2 - 145, w: 350, h: 290 };
  }

  private renderBonusModal() {
    const ctx = this.ctx;
    const r = this.bonusModalRect();
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, this.w, this.h);
    panel(ctx, r);
    text(ctx, "DAILY LOOT BONUS", r.x + r.w / 2, r.y + 38, 24, "#ffe763");
    text(ctx, `Streak: ${this.bonus.streakDays} day${this.bonus.streakDays === 1 ? "" : "s"}`, r.x + r.w / 2, r.y + 76, 17, "#ffffff");
    if (this.bonus.isActive) {
      text(ctx, `ACTIVE  ×${this.bonus.currentMultiplier}`, r.x + r.w / 2, r.y + 120, 28, "#73e58b");
      text(ctx, `${this.bonus.remainingTimeText} remaining`, r.x + r.w / 2, r.y + 150, 17, "rgba(255,255,255,0.82)");
      text(ctx, "Extra card copies apply to every mob drop.", r.x + r.w / 2, r.y + 184, 14, "rgba(255,255,255,0.72)");
    } else {
      text(ctx, `Today's reward: ×${this.bonus.nextBonusMultiplier} drops for 1 hour`, r.x + r.w / 2, r.y + 124, 17, "#ffffff");
      text(ctx, "Claim once each day to build your streak.", r.x + r.w / 2, r.y + 157, 14, "rgba(255,255,255,0.72)");
    }
    const claim = { x: r.x + 28, y: r.y + r.h - 66, w: r.w - 56, h: 40 };
    button(ctx, claim, this.bonus.isActive ? "BONUS ACTIVE" : this.bonus.canClaim() ? "CLAIM BONUS" : "COME BACK TOMORROW", this.bonus.isActive ? "#477c56" : "#d99a26", hit(claim, this.mx, this.my), 17);
    ctx.restore();
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
    this.viewZoom = zoom;

    // Draw background
    const groundColor = BIOME_BACKGROUNDS[this.currentBiome]?.ground_color || [30, 174, 99];
    if (this.currentBiome === "Ocean" || this.currentBiome === "Desert") {
      this.drawWavesDirect(ctx, { x: this.camX, y: this.camY }, groundColor);
    } else {
      this.drawBackgroundPattern(ctx, { x: this.camX, y: this.camY }, groundColor);
    }

    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-this.camX, -this.camY);

    const viewW = this.w / zoom;
    const viewH = this.h / zoom;

    // out-of-bounds shading
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    const ob = 4000;
    ctx.fillRect(this.camX - viewW, -ob, viewW * 2, ob);
    ctx.fillRect(this.camX - viewW, this.worldH, viewW * 2, ob);
    ctx.fillRect(-ob, this.camY - viewH, ob, viewH * 2);
    ctx.fillRect(this.worldW, this.camY - viewH, ob, viewH * 2);

    // walls
    this.drawWallsFromData(ctx, { x: this.camX, y: this.camY });

    // entities
    const list = [...this.ents.values()].sort((a, b) => a.kind - b.kind || a.y - b.y);
    for (const e of list) {
      if (e.kind === ENT.DROP) this.drawDrop(e);
    }
    for (const e of list) {
      if (e.kind === ENT.PETAL) this.drawPetalEnt(e);
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
    // Chat system overlay (bottom-left, above hotbar)
    this.chat.width = Math.min(400, this.w * 0.35);
    this.chat.draw(this.ctx, this.h - this.hotbarHeight() + 50);
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

  buildWallEdgeCache() {    
    const d = (window as any).WALL_DATA?.[this.currentBiome];    
    if (!d) return;    
    
    const size = Math.sqrt(d.length) | 0;    
    const cellW = this.worldW / size;    
    const cellH = this.worldH / size;    
    
    const W = (x: number, y: number) =>    
        x >= 0 && y >= 0 && x < size && y < size &&    
        d[y * size + x] === '1';    
    
    // =========================    
    // 1. 栅格 → 有向边    
    // =========================    
    const edgeMap = new Map<number, { x: number; y: number }>();    
    const keyOf = (x: number, y: number) => x * (size + 1) + y;    
    
    for (let y = 0; y < size; y++) {    
        for (let x = 0; x < size; x++) {    
            if (!W(x, y)) continue;    
            if (!W(x, y - 1)) edgeMap.set(keyOf(x, y), { x: x + 1, y: y });    
            if (!W(x + 1, y)) edgeMap.set(keyOf(x + 1, y), { x: x + 1, y: y + 1 });    
            if (!W(x, y + 1)) edgeMap.set(keyOf(x + 1, y + 1), { x: x, y: y + 1 });    
            if (!W(x - 1, y)) edgeMap.set(keyOf(x, y + 1), { x: x, y: y });    
        }    
    }    
    
    // =========================    
    // 2. 串成闭合多边形    
    // =========================    
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
    
    // =========================    
    // 3. 简化    
    // =========================    
    const simplify = (loop: { x: number; y: number }[]) => {    
        const n = loop.length;    
        const out: { x: number; y: number }[] = [];    
        for (let i = 0; i < n; i++) {    
            const p0 = loop[(i - 1 + n) % n];    
            const p1 = loop[i];    
            const p2 = loop[(i + 1) % n];    
            const collinear = (p1.x - p0.x) * (p2.y - p1.y) === (p1.y - p0.y) * (p2.x - p1.x);    
            if (!collinear) out.push(p1);    
        }    
        return out.length >= 3 ? out : loop;    
    };    
    const simplified = rawLoops.map(simplify);    
    
    // =========================    
    // 4. 噪声（幅度调小，更平滑）    
    // =========================    
    const noise = (x: number, y: number, seed: number) => {    
        let h = seed * 374761393 + x * 668265263 + y * 1274126177;    
        h = (h ^ (h >> 13)) * 1274126177;    
        h = h ^ (h >> 16);    
        return (h & 0x7fffffff) / 0x7fffffff;    
    };    
    const PTS_PER_CELL = 3;    
    const BIG_AMP = 0.1;    
    const FINE_AMP = 0.04;    
    const BIG_FREQ = 0.2;    
    const FINE_FREQ = 2.9;    
    
    this.wallNoisyLoops = simplified.map((loop, loopIdx) => {    
        const pts: { x: number; y: number }[] = [];    
        const n = loop.length;    
        const seed = loopIdx * 0.7 + 1;    
    
        for (let i = 0; i < n; i++) {    
            const p1 = loop[i];    
            const p2 = loop[(i + 1) % n];    
            const horizontal = p1.y === p2.y;    
            const len = horizontal ? Math.abs(p2.x - p1.x) : Math.abs(p2.y - p1.y);    
            const steps = Math.max(1, Math.round(len * PTS_PER_CELL));    
    
            for (let s2 = 0; s2 < steps; s2++) {    
                const t = s2 / steps;    
                const wx = p1.x + (p2.x - p1.x) * t;    
                const wy = p1.y + (p2.y - p1.y) * t;    
    
                let j = 0;    
                if (s2 !== 0) {    
                    const big = (noise(wx * BIG_FREQ, wy * BIG_FREQ, seed + 11) - 0.5) * 2 * BIG_AMP;    
                    const fine = (noise(wx * FINE_FREQ, wy * FINE_FREQ, seed + 53) - 0.5) * 2 * FINE_AMP;    
                    j = big + fine;    
                }    
    
                pts.push({    
                    x: (wx + (horizontal ? 0 : j)) * cellW,    
                    y: (wy + (horizontal ? j : 0)) * cellH    
                });    
            }    
        }    
        return pts;    
    });    
    
    this.wallMaxJitterPx = (BIG_AMP + FINE_AMP) * Math.min(cellW, cellH);    
    this._wallEdgeBiome = this.currentBiome;    
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

  drawWallsFromData(ctx: CanvasRenderingContext2D, c: { x: number; y: number }) {
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

  _drawWallsLegacy(ctx: CanvasRenderingContext2D, cameraOffset: { x: number; y: number }, wallData: string) {    
    const size = Math.sqrt(wallData.length) | 0;    
    const cellW = this.worldW / size;    
    const cellH = this.worldH / size;    
    
    const cx = cameraOffset.x;    
    const cy = cameraOffset.y;    
    
    const viewScale = this.viewZoom || 1;    
    const vw = this.w / viewScale;    
    const vh = this.h / viewScale;    
    
    const left = cx - vw / 2;    
    const right = cx + vw / 2;    
    const top = cy - vh / 2;    
    const bottom = cy + vh / 2;    
    
    const BUFFER_BLOCKS = 12;    
    const pad = cellW * BUFFER_BLOCKS * viewScale;    
    
    const bgConfig = BIOME_BACKGROUNDS[this.currentBiome];    
    const wallColor = bgConfig?.wall_color || [80, 80, 80];    
    
    // 初始化 Pattern    
    if (!this._wallPatternLegacy || this._wallPatternLegacyBiome !== this.currentBiome) {    
        const s = 512, cv = document.createElement('canvas');    
        cv.width = cv.height = s;    
        const g = cv.getContext('2d');    
        if (g) {
          g.fillStyle = `rgb(${wallColor[0]},${wallColor[1]},${wallColor[2]})`;    
          g.fillRect(0, 0, s, s);    
    
          g.fillStyle = `rgba(${Math.max(0, wallColor[0] - 25)}, ${Math.max(0, wallColor[1] - 25)}, ${Math.max(0, wallColor[2] - 25)}, .5)`;    
          for (let i = 0; i < 17; i++) {    
              const r = 5 + Math.random() * 10;    
              const x = Math.random() * s;    
              const y = Math.random() * s;    
              g.beginPath();    
              g.arc(x, y, r, 0, Math.PI * 2);    
              g.fill();    
          }    
        }
    
        this._wallPatternLegacy = ctx.createPattern(cv, 'repeat');    
        this._wallPatternLegacyBiome = this.currentBiome;    
    }    
    
    // 计算颜色（匹配高质量模式）    
    const darkColor = `rgb(${Math.max(0, wallColor[0] - 50)}, ${Math.max(0, wallColor[1] - 50)}, ${Math.max(0, wallColor[2] - 50)})`;    
    const groundColor = bgConfig?.ground_color || [80, 80, 80];    
    const lightColor = `rgba(${Math.min(255, groundColor[0] - 30)}, ${Math.min(255, groundColor[1] - 30)}, ${Math.min(255, groundColor[2] - 30)}, 0.4)`;    
    
    // renderGame already applied the camera transform, so cells are drawn at
    // raw world coordinates (no second -camera offset) and the pattern stays
    // aligned without a counter-translation.
    ctx.save();    
    ctx.lineJoin = 'round';    
    ctx.lineCap = 'round';    
    
    // Border widths are authored in screen pixels but stroked in world space.
    const outlineScale = 1 / viewScale;    
    
    const startX = Math.max(0, Math.floor((left - pad) / cellW));    
    const endX = Math.min(size, Math.ceil((right + pad) / cellW));    
    const startY = Math.max(0, Math.floor((top - pad) / cellH));    
    const endY = Math.min(size, Math.ceil((bottom + pad) / cellH));    
    
    // ==========================================    
    // 步骤 1：第一圈粗边 —— 浅色外部框 (36px)    
    // ==========================================    
    ctx.strokeStyle = lightColor;    
    ctx.lineWidth = 36 * outlineScale;    
    for (let y = startY; y < endY; y++) {    
        for (let x = startX; x < endX; x++) {    
            if (wallData[y * size + x] === '1') {    
                const px = x * cellW;    
                const py = y * cellH;    
                ctx.strokeRect(px, py, cellW, cellH);    
            }    
        }    
    }    
    
    // ==========================================    
    // 步骤 2：第一遍填充 —— 盖掉向内侵入的浅色边    
    // ==========================================    
    if (this._wallPatternLegacy) {
      ctx.fillStyle = this._wallPatternLegacy;    
    }
    for (let y = startY; y < endY; y++) {    
        for (let x = startX; x < endX; x++) {    
            if (wallData[y * size + x] === '1') {    
                const px = x * cellW;    
                const py = y * cellH;    
                ctx.fillRect(px - 0.5, py - 0.5, cellW + 1, cellH + 1);    
            }    
        }    
    }    
    
    // ==========================================    
    // 步骤 3：第二圈粗边 —— 深色内部框 (12px)    
    // ==========================================    
    ctx.strokeStyle = darkColor;    
    ctx.lineWidth = 12 * outlineScale;    
    for (let y = startY; y < endY; y++) {    
        for (let x = startX; x < endX; x++) {    
            if (wallData[y * size + x] === '1') {    
                const px = x * cellW;    
                const py = y * cellH;    
                ctx.strokeRect(px, py, cellW, cellH);    
            }    
        }    
    }    
    
    // ==========================================    
    // 步骤 4：最终填充 —— 盖掉向内侵入的深色边，留下纯正图案    
    // ==========================================    
    for (let y = startY; y < endY; y++) {    
        for (let x = startX; x < endX; x++) {    
            if (wallData[y * size + x] === '1') {    
                const px = x * cellW;    
                const py = y * cellH;    
                ctx.fillRect(px - 0.5, py - 0.5, cellW + 1, cellH + 1);    
            }    
        }    
    }    
    
    ctx.restore();    
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
    drawCard(
      this.ctx,
      { x: e.x - size / 2, y: e.y - size / 2 + bob, w: size, h: size },
      { item: e.type, rarity: e.team, count: stack },
      { dim: 0.94 },
    );
  }

  private drawPetalEnt(e: Ent) {
    const ctx = this.ctx;
    // Petal snapshots pack the cell rarity into the team byte (see sendState),
    // so orbiting petals must pass it through. Without it every petal rendered
    // at rarity 0 and rarity-scaled artwork (Stinger's extra triangles, Light's
    // extra blobs) never appeared in the world, only on the card.
    drawItemIcon(ctx, e.type, e.x, e.y, e.radius, this.time * 3 + e.id, e.team);
  }

  private drawMobEnt(e: Ent) {
    const ctx = this.ctx;
    const def = MOBS[e.type];
    if (!def) return;
    drawMob(ctx, e.type, e.x, e.y, e.radius, e.angle, this.time, e.team !== TEAM.HOSTILE, e.rarity, this.level);
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
      friendly: e.team !== TEAM.HOSTILE,
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
      const zoom = Math.min(1.15, Math.max(0.72, Math.min(this.w / 1280, this.h / 800) * 1.05));
      const worldMouseX = (this.mx - this.w / 2) / zoom + this.camX;
      const worldMouseY = (this.my - this.h / 2) / zoom + this.camY;
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

    // health — sits just above the dual-row hotbar
    const hpW = Math.min(300, this.w * 0.28);
    const hpY = this.h - this.hotbarHeight() - 26;
    healthBar(ctx, this.w / 2 - hpW / 2, hpY, hpW, 18, this.hp / Math.max(1, this.maxHp), "#57e36a");
    text(ctx, `${Math.max(0, Math.round(this.hp))} / ${this.maxHp}`, this.w / 2, hpY + 9, 12, "#ffffff");

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

    // Dual-row quick-slot bar (main + secondary rows)
    this.quickSlot.draw(ctx);

    // Mobile controls: joystick + Spread (Space) / Contract (Shift) buttons
    if (this.isMobile && this.mobileControlsVisible) {
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

      // Spread / Contract buttons (Space / Shift)
      const drawMobileAction = (rect: Rect | null, label: string, active: boolean, sub: string) => {
        if (!rect) return;
        ctx.save();
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 14);
        ctx.fillStyle = active ? (label === "SPREAD" ? "#3fae60" : "#c9762b") : "rgba(18,24,32,0.72)";
        ctx.fill();
        ctx.lineWidth = active ? 3 : 2;
        ctx.strokeStyle = active ? "#ffffff" : "rgba(255,255,255,0.25)";
        ctx.stroke();
        text(ctx, label, rect.x + rect.w / 2, rect.y + rect.h / 2 - 6, Math.max(11, rect.w * 0.18), "#ffffff");
        text(ctx, sub, rect.x + rect.w / 2, rect.y + rect.h / 2 + 12, Math.max(9, rect.w * 0.12), active ? "#ffffff" : "rgba(255,255,255,0.6)");
        ctx.restore();
      };
      drawMobileAction(this.mobileSpreadRect, "SPREAD", this.mobileSpreadActive, "[SPACE]");
      drawMobileAction(this.mobileContractRect, "DEFEND", this.mobileContractActive, "[SHIFT]");
    }

    // Mobile hint: show controls help if mobile
    if (this.isMobile && this.scene === "game" && this.w > 0) {
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
    const mult = RARITIES[cell.rarity].mult;

    // Stat lines are collected first so the panel can size itself to fit.
    const lines: { label: string; color: string }[] = [];
    if (def.kind === "petal") {
      lines.push({ label: `Damage ${(def.damage * mult).toFixed(0)}`, color: "#ffffff" });
      lines.push({ label: `Health ${(def.health * mult).toFixed(0)}`, color: "#ffffff" });
      if (def.heal) lines.push({ label: `Heal ${(def.heal * mult).toFixed(1)}/s`, color: "#8fffa8" });
      if (def.speed) lines.push({ label: `Speed +${def.speed}%`, color: "#8fd8ff" });
      lines.push({ label: `Reload ${def.reload.toFixed(1)}s`, color: "#ffd54a" });
    } else if (def.kind === "summon") {
      const count = getSummonCount(def.id);
      const petRarity = def.noDowngrade ? cell.rarity : mapRarityToSummonRarity(cell.rarity);
      const petName = MOBS[def.petMob ?? 0].name;
      lines.push({
        label: `Summons ${count > 1 ? `${count}x ` : ""}${RARITIES[petRarity].name} ${petName}`,
        color: "#8fffa8",
      });
      lines.push({ label: `Health ${(def.health * mult).toFixed(0)}`, color: "#ffffff" });
      lines.push({ label: `Reload ${def.reload.toFixed(1)}s per summon`, color: "#ffd54a" });
    } else {
      lines.push({ label: "Trade fodder — no combat use", color: "#ffd54a" });
    }

    const w = 216;
    const lineH = 18;
    const h = 52 + lines.length * lineH + 26;
    const px = Math.min(x, this.w - w - 8);
    const py = Math.max(8, Math.min(y - h, this.h - h - 8));
    panel(ctx, { x: px, y: py, w, h }, "rgba(12,18,26,0.95)");
    text(ctx, def.name, px + 12, py + 20, 17, RARITIES[cell.rarity].color, "left");
    text(ctx, RARITIES[cell.rarity].name, px + 12, py + 40, 13, RARITIES[cell.rarity].color, "left");
    lines.forEach((l, i) => text(ctx, l.label, px + 12, py + 62 + i * lineH, 13, l.color, "left"));
    text(ctx, def.desc, px + 12, py + h - 10, 12, "rgba(255,255,255,0.7)", "left");
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

    text(ctx, this.craftMode === "normal" ? "Craft" : this.craftMode === "oracle" ? "Oracle" : "Trade", p.x + p.w * 0.38, p.y + 24, 22, "#ffffff");
    button(ctx, layout.closeRect, "x", "#e53232", hit(layout.closeRect, this.mx, this.my), 14);

    // Action button centered beside the pentagon.
    const btn = layout.actionRect;
    const label = this.craftActionLabel();
    button(ctx, btn, label.text, accent, hit(btn, this.mx, this.my), 15, label.enabled);
    // small cooldown hint next to button if Oracle/Trade
    if (this.craftMode !== "normal") {
      const cd = this.craftCooldownLeft(this.craftMode as "oracle" | "trade");
      if (cd > 0) {
        text(ctx, this.formatCooldown(cd), btn.x + btn.w / 2, btn.y + btn.h + 12, 11, "#ffd54a");
      }
    }

    // Compact Cr / Or / Tr selectors in the top-right row.
    for (const { mode, rect, label: lab, color } of this.craftModeRects()) {
      const active = this.craftMode === mode;
      button(ctx, rect, lab, active ? color : "#3f7dc2", hit(rect, this.mx, this.my), 12);
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
      text(ctx, this.craftMsg, p.x + p.w * 0.38, layout.infoY + 14, 12, bad ? "#ffbcbc" : "#c9ffd6");
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
    ctx.save();
    roundRect(ctx, r.x, r.y, r.w, r.h, 6);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.stroke();
    text(ctx, "Craft Log", r.x + 8, r.y + 12, 11, "#ffffff", "left");
    const logs = [
      { t: `Used: ${this.craftLogPetals}`, c: "#00E5FF" },
      { t: `Crafted: ${this.craftLogCrafted}`, c: "#FF5555" },
      { t: `Burned: ${this.craftLogBurned}`, c: "#FFBB33" },
      { t: `Attempts: ${this.craftLogAttempts}`, c: "#FFD966" },
      { t: `${this.craftLogLast.slice(0, 18)}`, c: "#7db3ff" },
    ];
    logs.forEach((log, i) => {
      text(ctx, log.t, r.x + 8, r.y + 26 + i * 12, 10, log.c, "left");
    });
    ctx.restore();
  }

  /** Dedicated Result Card rendering — larger, pulsing, with rarity glow (new) */
  private renderResultCard(ctx: CanvasRenderingContext2D, layout: ReturnType<GameClient["craftLayout"]>) {
    if (!this.craftPending) return;
    const rr = (layout as any).resultRect as Rect;
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
      text(ctx, RARITIES[col]?.name ?? "", x, layout.gridTop - 10, 9, RARITIES[col]?.color ?? "rgba(255,255,255,0.6)");
    }

    if (rows.length === 0) {
      text(
        ctx,
        this.craftSearchText || this.craftBiome !== "All" ? "No cards match filter" : "Bag empty",
        p.x + p.w / 2,
        layout.gridTop + layout.gridH / 2,
        12,
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

    text(ctx, "Combine cards to upgrade rarity", p.x + p.w * 0.38, (layout as any).craftBottom - 46, 11, "rgba(255,255,255,0.85)");
    text(ctx, "Click: load 5 cards · Shift+click: load all (unlimited)", p.x + p.w * 0.38, (layout as any).craftBottom - 34, 9, "rgba(255,255,255,0.55)");

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

      if (!filled) return;

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
      drawCard(ctx, { ...r, y: r.y + bob }, { item: sel!.item, rarity: sel!.rarity, count: Math.max(1, slotCount) }, {
        scale: this.craftSpin > 0 ? 1.06 : 1,
      });
      ctx.restore();
    });

    // Info lines below pentagon, above grid — not overlapping
    const y = layout.infoY;
    if (!sel) {
      text(ctx, "Pick a card from inventory below", layout.cx, y + 10, 12, "rgba(255,255,255,0.75)");
      return;
    }
    const def = ITEMS[sel.item];
    const chance = craftChanceFor(sel.rarity);
    text(ctx, `${RARITIES[sel.rarity].name} ${def.name}`, layout.cx, y, 14, RARITIES[sel.rarity].color);
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
      y + 16,
      11,
      submitting || ready ? "#c9ffd6" : "#ffbcbc",
    );
    if (sel.rarity < MAX_CRAFT_RARITY && chance !== undefined) {
      const next = sel.rarity + 1;
      text(ctx, `→ ${RARITIES[next].name} ${(chance * 100).toFixed(1)}%`, layout.cx, y + 28, 11, RARITIES[next].color);
    } else {
      text(ctx, "Max rarity", layout.cx, y + 28, 11, "rgba(255,255,255,0.65)");
    }
  }

  /** Oracle / Trade modes: single centered slot */
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
      isOracle ? "Upgrade 1 rarity — guaranteed" : "Exchange for Coins",
      layout.cx,
      r.y - 18,
      11,
      "rgba(255,255,255,0.85)",
    );

    // background
    ctx.save();
    roundRect(ctx, r.x, r.y, r.w, r.h, 8);
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
      text(ctx, "+", r.x + r.w / 2, r.y + r.h / 2, 22, "rgba(255,255,255,0.35)");
    }

    const y = layout.infoY;
    if (sel) {
      const def = ITEMS[sel.item];
      text(ctx, `${RARITIES[sel.rarity].name} ${def.name}`, layout.cx, y, 13, RARITIES[sel.rarity].color);
      if (isOracle) {
        const required = oracleRequiredCount(sel.rarity);
        if (required === undefined) {
          text(ctx, "Cannot Oracle this rarity", layout.cx, y + 16, 11, "#ffbcbc");
        } else {
          text(ctx, `Need ${required} — have ${avail}`, layout.cx, y + 16, 11, avail >= required ? "#c9ffd6" : "#ffbcbc");
          const target = sel.rarity + ORACLE_SKIP;
          if (target < RARITIES.length) {
            text(ctx, `→ ${RARITIES[target].name}`, layout.cx, y + 28, 11, RARITIES[target].color);
          }
        }
      } else {
        text(ctx, `${avail} → ${avail} Coin${avail === 1 ? "" : "s"}`, layout.cx, y + 16, 11, "#ffd54a");
      }
    } else {
      text(ctx, "Pick a card below", layout.cx, y + 10, 11, "rgba(255,255,255,0.7)");
    }

    const cooldownMs = this.craftCooldownLeft(mode);
    const ready = cooldownMs <= 0;
    text(
      ctx,
      `${isOracle ? "Oracle" : "Trade"}: ${ready ? "Ready" : this.formatCooldown(cooldownMs)}`,
      layout.cx,
      y + 42,
      10,
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

  private renderDeath() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "rgba(8,10,14,0.66)";
    ctx.fillRect(0, 0, this.w, this.h);
    text(ctx, "You were shredded!", this.w / 2, this.h / 2 - 70, 42, "#ff8080");
    text(ctx, `Level ${this.level} · ${this.xp} XP · you keep 100% on respawn`, this.w / 2, this.h / 2 - 20, 17, "#ffffff");
    const bw = 180;
    const cx = this.w / 2;
    const r1 = { x: cx - bw - 10, y: this.h / 2 + 40, w: bw, h: 52 };
    const r2 = { x: cx + 10, y: this.h / 2 + 40, w: bw, h: 52 };
    button(ctx, r1, "Respawn", "#3fae60", hit(r1, this.mx, this.my), 20);
    button(ctx, r2, "Main menu", "#41505f", hit(r2, this.mx, this.my), 20);
    ctx.restore();
  }
}
