// Pure canvas2d drawing kit: every widget in this game is painted here.
import { ITEMS, MAPS, MOBS, RARITIES, getSummonCount } from "../shared/defs";
import type { Cell } from "../shared/sim";

// ============================================
// Main-menu backdrop
// ============================================

/** The biomes the main menu can show. The hidden Arena map has no menu palette. */
export type Biome = "Garden" | "Desert" | "Ocean";

const MENU_BIOMES: Biome[] = ["Garden", "Desert", "Ocean"];

/** Narrows an arbitrary map name to a `Biome`, or `null` for the Arena map. */
export function asBiome(name: string): Biome | null {
  return (MENU_BIOMES as string[]).includes(name) ? (name as Biome) : null;
}

/**
 * Ground colour per biome, read straight from the map defs (`MapDef.bg`) so the
 * menu backdrop and the in-world ground can never drift apart.
 */
export const BIOME_GROUND: Record<Biome, string> = (() => {
  const out = {} as Record<Biome, string>;
  for (const m of MAPS) {
    const b = asBiome(m.name);
    if (b) out[b] = m.bg;
  }
  return out;
})();

/** The slate-900 both the menu gradient and the panels fade into. */
export const MENU_SLATE_900 = "#0f172a";

/** Gradient stop factors: top = 65% of the ground colour, mid = 40% at 55% height. */
const MENU_TOP_FACTOR = 0.65;
const MENU_MID_FACTOR = 0.4;

/** Parses `#rgb` / `#rrggbb` into an rgb triple. */
export function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  const full = c.length === 3 ? c.split("").map((s) => s + s).join("") : c;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Multiplies each rgb channel by `f` (0..1). */
function scaleRgb(rgb: [number, number, number], f: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(rgb[0])}, ${c(rgb[1])}, ${c(rgb[2])})`;
}

/** The ground colour of `biome` as an rgb triple, ready for the menu animation. */
export function biomeGroundRgb(biome: Biome): [number, number, number] {
  return hexToRgb(BIOME_GROUND[biome]);
}

/**
 * The gradient's mid tone (ground x 40%). Grid lines and floating petals are
 * tinted from this so they stay legible against both ends of the backdrop.
 */
export function menuMidTone(ground: [number, number, number]): [number, number, number] {
  return [
    Math.round(ground[0] * MENU_MID_FACTOR),
    Math.round(ground[1] * MENU_MID_FACTOR),
    Math.round(ground[2] * MENU_MID_FACTOR),
  ];
}

/**
 * Main-menu backdrop: a vertical gradient derived from the SELECTED biome's
 * ground palette (top = 65% of the ground colour, mid = 40%, bottom fades to
 * the shared slate-900), so the menu reads as "the map you picked".
 *
 * This game paints everything with canvas2d and has no DOM/CSS, so the gradient
 * is returned as a `CanvasGradient` for `ctx.fillStyle` rather than as a CSS
 * `linear-gradient(...)` string. `ground` is an rgb triple rather than a biome
 * name so the caller can pass the *animated* colour while the menu cross-fades
 * between biomes; use `biomeGroundRgb(biome)` for the static colour.
 */
export function menuBackground(
  ctx: CanvasRenderingContext2D,
  height: number,
  ground: [number, number, number],
): CanvasGradient {
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, scaleRgb(ground, MENU_TOP_FACTOR));
  g.addColorStop(0.55, scaleRgb(ground, MENU_MID_FACTOR));
  g.addColorStop(1, MENU_SLATE_900);
  return g;
}

// ============================================
// 根据稀有度获取花瓣数量
// ============================================

/**
 * 根据稀有度获取 Light 花瓣数量
 * rarity: 0=Common, 1=Unusual, 2=Rare, 3=Epic, 4=Legendary, 5=Mythic, 6=Ultra, 7=Super, 8=Omega/Eternal
 */
export function getLightPetalCount(rarity: number): number {
  if (rarity <= 3) return 3;      // Common-Epic: 3
  if (rarity === 4) return 4;     // Legendary: 4
  if (rarity === 5) return 5;     // Mythic: 5
  if (rarity === 6) return 6;     // Ultra: 6
  if (rarity === 7) return 6;     // Super: 6
  if (rarity >= 8) return 8;      // Omega-Eternal: 8
  return 3;
}

/**
 * 根据稀有度获取 Stinger 三角形数量
 */
export function getStingerPetalCount(rarity: number): number {
  if (rarity <= 3) return 1;      // Common-Epic: 1
  if (rarity === 4) return 3;     // Legendary: 3
  if (rarity === 5) return 4;     // Mythic: 4
  if (rarity === 6) return 5;     // Ultra: 5
  if (rarity === 7) return 6;     // Super: 6
  if (rarity >= 8) return 7;      // Omega-Eternal: 7
  return 1;
}

/**
 * 获取物品的固定花瓣数量（覆盖稀有度规则）
 * 返回 -1 表示使用稀有度规则
 */
export function getFixedPetalCount(itemId: number): number {
  // Basic (id: 0) - 永远 1 个
  if (itemId === 31) return 1;
  // Pearl (id: 6) - 永远 1 个
  if (itemId === 6) return 1;
  // Bubble (id: 5) - 永远 1 个
  if (itemId === 5) return 1;
  // Sand (id: 4) - 永远 4 个
  if (itemId === 4) return 4;
  // 其他物品使用稀有度规则
  return -1;
}

// ============================================
// 基础绘图工具
// ============================================

/** Shared UI font stack (kept as a constant so every label/health-bar/tag matches). */
export const FONT_FAMILY = '"Trebuchet MS", "Segoe UI", sans-serif';

/**
 * Optional accelerated icon renderer (the sprite-sheet atlas in spriteSheet.ts).
 *
 * spriteSheet.ts has to import `drawItemIcon` from here to BAKE the atlas, so
 * ui.ts must not import it back — that would be a cycle. Instead the sprite
 * sheet registers itself through this hook at startup, and every icon call site
 * in this file goes through `iconRenderer()`, which falls back to the vector
 * renderer whenever the atlas is unavailable.
 */
type IconRenderer = (
  ctx: CanvasRenderingContext2D,
  itemId: number,
  x: number,
  y: number,
  size: number,
  spin: number,
  rarity: number,
  compact: boolean,
) => void;

let acceleratedIcon: IconRenderer | null = null;

/** Registers the sprite-sheet renderer. Called once by spriteSheet.ts. */
export function setIconRenderer(fn: IconRenderer | null) {
  acceleratedIcon = fn;
}

/**
 * Draws an item icon through the sprite atlas when one is registered, else via
 * the vector renderer. Prefer this over `drawItemIcon` at UI call sites.
 */
export function icon(
  ctx: CanvasRenderingContext2D,
  itemId: number,
  x: number,
  y: number,
  size: number,
  spin = 0,
  rarity = 0,
  compact = false,
) {
  if (acceleratedIcon) acceleratedIcon(ctx, itemId, x, y, size, spin, rarity, compact);
  else drawItemIcon(ctx, itemId, x, y, size, spin, rarity, compact);
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function text(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  size: number,
  color = "#ffffff",
  align: CanvasTextAlign = "center",
  stroke = true,
) {
  ctx.save();
  ctx.font = `900 ${size}px "Trebuchet MS", "Segoe UI", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  if (stroke) {
    ctx.lineWidth = Math.max(2, size * 0.22);
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineJoin = "round";
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
  ctx.restore();
}

export function measure(ctx: CanvasRenderingContext2D, str: string, size: number) {
  ctx.save();
  ctx.font = `900 ${size}px "Trebuchet MS", "Segoe UI", sans-serif`;
  const w = ctx.measureText(str).width;
  ctx.restore();
  return w;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function hit(r: Rect, mx: number, my: number) {
  return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
}

export function shade(hex: string, amount: number) {
  const c = hex.replace("#", "");
  const n = parseInt(c.length === 3 ? c.split("").map((s) => s + s).join("") : c, 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r + amount)));
  g = Math.max(0, Math.min(255, Math.round(g + amount)));
  b = Math.max(0, Math.min(255, Math.round(b + amount)));
  return `rgb(${r},${g},${b})`;
}

export function button(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  label: string,
  color: string,
  hovered: boolean,
  fontSize = 22,
  enabled = true,
) {
  const base = enabled ? (hovered ? shade(color, 24) : color) : "#7a7a7a";
  ctx.save();
  ctx.globalAlpha = enabled ? 1 : 0.7;
  roundRect(ctx, r.x, r.y + 5, r.w, r.h, 9);
  ctx.fillStyle = shade(base, -50);
  ctx.fill();
  roundRect(ctx, r.x, r.y + (hovered && enabled ? 2 : 0), r.w, r.h, 9);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.28)";
  ctx.stroke();
  text(ctx, label, r.x + r.w / 2, r.y + r.h / 2 + (hovered && enabled ? 2 : 0), fontSize, "#ffffff");
  ctx.restore();
}

export function panel(ctx: CanvasRenderingContext2D, r: Rect, fill = "rgba(28,36,46,0.92)") {
  ctx.save();
  roundRect(ctx, r.x, r.y, r.w, r.h, 14);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.stroke();
  ctx.restore();
}

// ============================================
// UI 组件
// ============================================

/**
 * Flat white input box used by every searchable panel (inventory + crafting).
 * Draws the placeholder, the typed text and a blinking caret while focused.
 */
export function searchField(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  value: string,
  active: boolean,
  placeholder = "Search...",
) {
  ctx.save();
  ctx.fillStyle = active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.65)";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(r.x, r.y, r.w, r.h);

  const showPlaceholder = value === "" && !active;
  ctx.font = `${Math.round(r.h * 0.46)}px "Trebuchet MS", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = showPlaceholder ? "#444444" : "#000000";
  ctx.fillText(showPlaceholder ? placeholder : value, r.x + 10, r.y + r.h / 2);

  if (active && Math.floor(Date.now() / 530) % 2 === 0) {
    const tw = ctx.measureText(value).width;
    ctx.fillStyle = "#000000";
    ctx.fillRect(r.x + 10 + tw + 1, r.y + 6, 2, r.h - 12);
  }
  ctx.restore();
}

/** Closed state of the biome picker that sits next to a search field. */
export function dropdownField(ctx: CanvasRenderingContext2D, r: Rect, label: string, open: boolean) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.font = `${Math.round(r.h * 0.42)}px "Trebuchet MS", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = "#444444";
  ctx.fillText(label.length > 10 ? label.slice(0, 9) + "…" : label, r.x + 10, r.y + r.h / 2);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(0,0,0,0.8)";
  ctx.fillText(open ? "▲" : "▼", r.x + r.w - 10, r.y + r.h / 2);
  ctx.restore();
}

/** Open option list of a dropdown. `optionRect` must match the click hit-test in game.ts. */
export function dropdownList(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  options: string[],
  selected: string,
  mx: number,
  my: number,
) {
  const optH = r.h + 2;
  const listY = r.y + r.h + 4;
  const listH = optH * options.length + 6;
  ctx.save();
  ctx.fillStyle = "rgba(16,22,30,0.94)";
  ctx.fillRect(r.x, listY, r.w, listH);
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x, listY, r.w, listH);
  ctx.restore();

  options.forEach((option, i) => {
    const rect: Rect = { x: r.x + 3, y: listY + 3 + i * optH, w: r.w - 6, h: optH - 2 };
    const hovered = hit(rect, mx, my);
    const isSelected = option === selected;
    ctx.save();
    if (isSelected || hovered) {
      ctx.fillStyle = isSelected ? "rgba(85,170,255,0.25)" : "rgba(255,255,255,0.06)";
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    ctx.font = `${Math.round(optH * 0.44)}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = isSelected ? "#55aaff" : "rgba(255,255,255,0.85)";
    ctx.fillText(option, rect.x + 10, rect.y + rect.h / 2);
    ctx.restore();
  });
}

/** Vertical scrollbar shared by the inventory grid and the crafting grid. */
export function scrollbar(ctx: CanvasRenderingContext2D, track: Rect, thumb: Rect, dragging: boolean) {
  roundRect(ctx, track.x, track.y, track.w, track.h, 3);
  ctx.fillStyle = "rgba(20,30,45,0.25)";
  ctx.fill();
  roundRect(ctx, thumb.x, thumb.y, thumb.w, thumb.h, 3);
  ctx.fillStyle = dragging ? "rgba(20,30,45,0.85)" : "rgba(20,30,45,0.6)";
  ctx.fill();
}

/** Big empty crafting pad: dashed socket with a soft glow when it is filled/ready. */
export function craftPad(ctx: CanvasRenderingContext2D, r: Rect, glow: number, pulse: number) {
  ctx.save();
  roundRect(ctx, r.x, r.y, r.w, r.h, 10);
  ctx.fillStyle = "rgba(18,40,64,0.35)";
  ctx.fill();
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = `rgba(255,255,255,${0.22 + glow * 0.5})`;
  ctx.stroke();
  ctx.setLineDash([]);
  if (glow > 0.01) {
    ctx.globalAlpha = glow * (0.35 + Math.sin(pulse * 4) * 0.15);
    roundRect(ctx, r.x - 3, r.y - 3, r.w + 6, r.h + 6, 12);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffe763";
    ctx.stroke();
  }
  ctx.restore();
}

// ============================================
// 核心绘制函数 - drawItemIcon (支持稀有度)
// ============================================

/** Draw antennae icon — a pair of curved feelers with tip dots. */
export function drawAntennaeIcon(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, animTimer: number) {
  const s = radius / 50;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const drawAntenna = (isLeft: boolean) => {
    const side = isLeft ? -1 : 1;
    ctx.save();
    ctx.translate(14 * side, 20);
    ctx.rotate((Math.PI / 6) * side);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-8, -30, 0, -70);
    ctx.quadraticCurveTo(8, -30, 0, 0);
    ctx.fillStyle = '#333333';
    ctx.fill();
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Tip dot
    ctx.beginPath();
    ctx.arc(0, -70, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#555555';
    ctx.fill();
    ctx.restore();
  };
  drawAntenna(true);
  drawAntenna(false);
  ctx.restore();
}

/** Draw the artwork of an item (petal or summon). */
export function drawItemIcon(
  ctx: CanvasRenderingContext2D,
  itemId: number,
  x: number,
  y: number,
  size: number,
  spin = 0,
  rarity: number = 0,
  compact = false,
) {
  const def = ITEMS[itemId];
  if (!def) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  ctx.scale(0.8, 0.8);

  // Normalize each item's artwork so every icon occupies roughly the same
  // visual area and is centered on the cell. `k` scales the shape, while
  // (ox, oy) (in units of `size`) re-centers shapes whose geometry is offset.
  const ICON_NORM: Record<number, { k: number; ox: number; oy: number }> = {
    31: { k: 0.66, ox: 0, oy: 0.5 },
    7: { k: 1.25, ox: 0.375, oy: 0 },    // Wing: enlarge + shift right (it sat too far left)
    9: { k: 1.25, ox: 0.15, oy: 0.28 },  // Stick: enlarge + re-center
    21: { k: 2.55, ox: 0, oy: 0 },
  };
  const norm = ICON_NORM[def.id];
  if (norm) {
    ctx.scale(norm.k, norm.k);
    ctx.translate(norm.ox * size, norm.oy * size);
  }

  ctx.lineWidth = Math.max(1.5, size * 0.16);
  ctx.strokeStyle = def.outline;
  ctx.fillStyle = def.color;
  switch (def.id) {

    case 1: { // Leaf
      ctx.beginPath();
      ctx.moveTo(0, size);
      ctx.quadraticCurveTo(-size, 0, 0, -size);
      ctx.quadraticCurveTo(size, 0, 0, size);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = size * 0.15;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, size * 0.7);
      ctx.quadraticCurveTo(size * 0.2, size * 0.4, 0, -size * 0.7);
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, size);
      ctx.lineTo(0, size * 1.3);
      ctx.stroke();
      break;
    }
    case 2: { // Stinger
      const count = getStingerPetalCount(rarity);
      const s = compact ? 0.65 : 1.0;
      if (count === 1) {
        // A lone stinger triangle should sit in the middle of the icon
        // (pointing up), not off to the side facing the center.
        const R = size * 1.15 * s;
        ctx.beginPath();
        ctx.moveTo(0, -R);
        ctx.lineTo(-R * 0.866, R * 0.5);
        ctx.lineTo(R * 0.866, R * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        for (let i = 0; i < count; i++) {
          ctx.save();
          ctx.rotate((i * 2 * Math.PI / count) - Math.PI / 2);
          ctx.beginPath();
          ctx.moveTo(0, size * 0.4 * s);
          ctx.lineTo(-size * 0.5 * s, size * 1.4 * s);
          ctx.lineTo(size * 0.5 * s, size * 1.4 * s);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
      break;
    }
    case 3: { // Rock
      ctx.beginPath();
      for(let i=0;i<5;i++){
        const a = (i * 2 * Math.PI / 5) - Math.PI / 2;
        const r = size * 0.9;
        const px = r * Math.cos(a);
        const py = r * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 4: { // Sand
      const drawHex = (hx: number, hy: number, hr: number, rot: boolean) => {
        ctx.save();
        ctx.translate(hx, hy);
        if (rot) ctx.rotate(Math.PI / 6);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            let a = i * Math.PI / 3;
            let px = hr * Math.cos(a);
            let py = hr * Math.sin(a);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      };
      drawHex(-size * 0.75, 0, size * 0.5, false);
      drawHex(size * 0.75, 0, size * 0.5, false);
      drawHex(0, -size * 0.75, size * 0.5, true);
      drawHex(0, size * 0.75, size * 0.5, true);
      break;
    }
case 5: { // Bubble — 透明泡泡
  const radius = size * 0.9;
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = Math.max(2, size * 0.2);
  ctx.stroke();
  // 高光
  ctx.beginPath();
  ctx.arc(-radius * 0.3, -radius * 0.3, radius * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fill();
  ctx.restore();
  break;
}

    case 11: { // Clover — three overlapping two-tone leaves around a dark hub
      // Authored with leaf ellipses 40x60 at r=65 plus a r=28 hub. The measured
      // ink box is 203x223 centered on (22.5, -0.5), so scale by its half-height
      // and shift by that offset to sit dead center in the cell.
      const k = (size * 1.1) / 100;
      ctx.save();
      ctx.scale(k, k);
      ctx.translate(-10, 0.5);
      const leaf = (a: number) => {
        ctx.save();
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(0, -65, 45, 65, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#2d6833";
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, -65, 20, 40, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#4e9a52";
        ctx.fill();
        ctx.restore();
      };
      const b = -Math.PI / 6;
      leaf(b);
      leaf(b + (Math.PI * 2) / 3);
      leaf(b + (Math.PI * 4) / 3);
      ctx.beginPath();
      ctx.arc(0, 0, 28, 0, Math.PI * 2);
      ctx.fillStyle = "#2d6833";
      ctx.fill();
      ctx.restore();
      break;
    }
case 13: { // Corn — a fat kernel-yellow crescent with a thick olive rim
  // 使用你提供的 Corn 绘制代码
  const k = (size * 2) / 100;
  ctx.save();
  ctx.scale(k, k);
  ctx.translate(-150, -150);
  ctx.beginPath();
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#a2901c';
  ctx.fillStyle = '#eade45';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.moveTo(100, 130);
  ctx.quadraticCurveTo(150, 70, 200, 130);
  ctx.quadraticCurveTo(200, 150, 180, 200);
  ctx.quadraticCurveTo(150, 160, 120, 200);
  ctx.quadraticCurveTo(100, 150, 100, 130);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  break;
}
case 16: { // Heavy — 黑色圆盘带灰色瞳孔
  const k = size / 55;
  ctx.save();
  ctx.scale(k, k);
  ctx.translate(-100, -90);
  // 背景擦除（使用画布背景色，这里假设是透明或深色，用 clearRect 或 fillRect 配合背景色）
  // 由于 drawItemIcon 中已经有画布背景，我们直接绘制
  ctx.beginPath();
  ctx.arc(100, 90, 55, 0, Math.PI * 2);
  ctx.fillStyle = '#2d2d2d';
  ctx.fill();
  ctx.strokeStyle = '#131313';
  ctx.lineWidth = 10;
  ctx.stroke();
  // 瞳孔
  ctx.beginPath();
  ctx.arc(80, 75, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#555555';
  ctx.fill();
  ctx.restore();
  break;
}
case 17: { // Moon — 灰色星球带陨石坑
  const radius = size*1.2;
  const cx = 0, cy = 0;
  const r = radius;
  const baseR = r * 0.85;

  ctx.save();

  // 1. 粗的深色外圈
  ctx.beginPath();
  ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(4, r * 0.12);
  ctx.strokeStyle = '#4d4d4d';
  ctx.stroke();

  // 2. 内部灰色填充
  ctx.beginPath();
  ctx.arc(cx, cy, baseR - baseR * 0.06, 0, Math.PI * 2);
  ctx.fillStyle = '#888888';
  ctx.fill();

  // 3. 陨石坑
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, baseR - baseR * 0.06, 0, Math.PI * 2);
  ctx.clip();

  const craterScale = r / 170;
  const craters = [
    {x: -30 * craterScale, y: -100 * craterScale, r: 55 * craterScale},
    {x: 60 * craterScale, y: -85 * craterScale, r: 48 * craterScale},
    {x: 60 * craterScale, y: 0 * craterScale, r: 35 * craterScale},
    {x: -110 * craterScale, y: 60 * craterScale, r: 45 * craterScale},
    {x: -50 * craterScale, y: 40 * craterScale, r: 25 * craterScale},
    {x: 100 * craterScale, y: 80 * craterScale, r: 30 * craterScale},
  ];

  for (const crater of craters) {
    ctx.beginPath();
    ctx.arc(cx + crater.x, cy + crater.y, crater.r, 0, Math.PI * 2);
    ctx.fillStyle = '#9d9d9d';
    ctx.fill();

  }

  ctx.restore();
  ctx.restore();
  break;
}
    case 18: { // Pollen — always exactly three yellow balls
      const r = size * 0.5;
      const d = r * 1.05;
      // A triangle of 3 circles sits d/4 above the origin; nudge it back down.
      for (let i = 0; i < 3; i++) {
        const a = (i * 2 * Math.PI) / 3 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * d, Math.sin(a) * d + d / 4, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 22: { // Salt — an irregular white crystal (7 jittered radii)
      const k = (size * 1.15) / 49;
      ctx.save();
      ctx.scale(k, k);
      ctx.beginPath();
      const radii = [38, 42, 39, 44, 38, 43, 36];
      for (let i = 0; i < 7; i++) {
        const a = (i * 2 * Math.PI) / 7 - Math.PI / 2;
        ctx[i === 0 ? "moveTo" : "lineTo"](radii[i] * Math.cos(a), radii[i] * Math.sin(a));
      }
      ctx.closePath();
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "#c4c4c4";
      ctx.lineWidth = 10;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 25: { // Lightning — a slightly more compact 10-point cyan star
      // Keep the sharp silhouette, but reduce its footprint by 10% so it
      // reads closer in size to the surrounding petal icons.
      const k = (size * 1.08) / 60;
      ctx.save();
      ctx.scale(k, k);
      const spikes = 10;
      const outer = 55;
      const inner = 30;
      let rot = (Math.PI / 2) * 3;
      const step = Math.PI / spikes;
      ctx.beginPath();
      ctx.moveTo(0, -outer);
      for (let i = 0; i < spikes; i++) {
        ctx.lineTo(Math.cos(rot) * outer, Math.sin(rot) * outer);
        rot += step;
        ctx.lineTo(Math.cos(rot) * inner, Math.sin(rot) * inner);
        rot += step;
      }
      ctx.closePath();
      ctx.fillStyle = "#53E5E8";
      ctx.fill();
      ctx.strokeStyle = "#4ADEDE";
      ctx.lineWidth = 8;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();
      break;
    }
case 28: {
  const r = size*0.4;
  const cx = 0, cy = 0;
  const spreadRadius = size * 0.8;

  ctx.save();

  // 使用 spin 作为动画时间，让圆点缓慢聚拢/散开
  const animTime = spin * 0.5; // 用 spin 驱动动画
  const phase = Math.sin(animTime) * 0.5 + 0.5; // 0-1 之间振荡

  // 聚拢程度：0.3（散开）到 1.0（聚拢）
  const gather = 0.3 + phase * 0.7;
  const currentSpread = spreadRadius * (1 - gather * 0.6);

  // 5个圆点的角度偏移
  const angles = [0, 1.296, 2.513, 3.77, 5.027];

  const dotPositions = angles.map((a, i) => {
    const angleOffset = spin * 0.3 + i * 1.256;
    const dist = currentSpread * (0.3 + Math.sin(angleOffset + i) * 0.3 + 0.4);
    return {
      x: Math.cos(angleOffset) * dist,
      y: Math.sin(angleOffset) * dist,
    };
  });

  // 绘制灰色连线
  ctx.beginPath();

  // 绘制5个白色圆点
  for (const pos of dotPositions) {
    ctx.beginPath();
    ctx.arc(cx + pos.x, cy + pos.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,200,200,0.2)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  ctx.restore();
  break;
}
    case 31: { // light
      const count = getLightPetalCount(rarity);
      for(let i=0;i<count;i++){
        const a = (i * 2 * Math.PI / count) - Math.PI / 2;
        const px = size * 1.0 * Math.cos(a);
        const py = -size * 0.5 + size * 1.0 * Math.sin(a);
        ctx.beginPath();
        ctx.arc(px, py, size * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = size*0.25;
        ctx.stroke();
      }
      break;
    }
    case 36: { // Iris — a single, notably small purple ball
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.52, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(2, size * 0.2);
      ctx.stroke();
      break;
    }

    case 19: { // Honey — a flat-topped hexagon (honeycomb cell)
      const radius = size;
      const sides = 6;
      ctx.beginPath();
      for (let i = 0; i < sides; i++) {
        const a = (i * 2 * Math.PI) / sides - Math.PI / 2;
        const px = radius * Math.cos(a);
        const py = radius * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = "#FFD700";
      ctx.fill();
      ctx.strokeStyle = "#B9A000";
      ctx.lineWidth = Math.max(2, size * 0.2);
      ctx.lineJoin = "round";
      ctx.stroke();
      break;
    }
    case 21: { // Starfish — a rounded coral triangle with three pale dots
      const cT = (
        p1: { x: number; y: number },
        p2: { x: number; y: number },
        p3: { x: number; y: number },
        r: number,
      ) => {
        ctx.beginPath();
        ctx.moveTo((p3.x + p1.x) / 2, (p3.y + p1.y) / 2);
        ctx.arcTo(p1.x, p1.y, p2.x, p2.y, r);
        ctx.arcTo(p2.x, p2.y, p3.x, p3.y, r);
        ctx.arcTo(p3.x, p3.y, p1.x, p1.y, r);
        ctx.closePath();
      };
      const k = size / 55;
      ctx.save();
      ctx.scale(k, k);
      // Cancels the shape's centroid drift after rotation so the triangle
      // stays centered in the icon cell instead of sliding toward a corner.
      ctx.translate(1, 8.3);
      ctx.rotate((-28 * Math.PI) / 180);
      const pts = [
        { x: 0, y: -70 },
        { x: 15, y: 21 },
        { x: -15, y: 21 },
      ];
      cT(pts[0], pts[1], pts[2], 7);
      ctx.fillStyle = "#be615d";
      ctx.fill();
      ctx.strokeStyle = "#a6514e";
      ctx.lineWidth = 4;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.fillStyle = "#cf8982";
      [
        { y: 10, r: 5.5 },
        { y: -4, r: 4 },
        { y: -16, r: 2.5 },
      ].forEach((c) => {
        ctx.beginPath();
        ctx.arc(0, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
      break;
    }
    case 38: { // Shell — a fan-shaped seashell icon
      // Enlarged ~25% (was size / 55) so the shell reads as big as round
      // petals like Pearl instead of sitting noticeably small.
      const k = size / 44;
      ctx.save();
      ctx.scale(k, k);
      ctx.translate(0, 12);
      const orig2 = { x: 0, y: 20 };
      const R2 = 48;
      const fanAngles2 = [-44, -22, 0, 22, 44];
      const rays2 = fanAngles2.map(d => {
        const a = (d - 90) * Math.PI / 180;
        return { x: orig2.x + Math.cos(a) * R2, y: orig2.y + Math.sin(a) * R2 };
      });
      ctx.beginPath();
      ctx.moveTo(rays2[0].x, rays2[0].y);
      for (let i = 0; i < 4; i++) {
        const a = rays2[i], b = rays2[i + 1];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const dx = mx - orig2.x, dy = my - orig2.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        ctx.quadraticCurveTo(orig2.x + dx / len * (len + 12), orig2.y + dy / len * (len + 12), b.x, b.y);
      }
      ctx.bezierCurveTo(rays2[4].x - 2, rays2[4].y + 5, orig2.x + 10, orig2.y + 5, orig2.x, orig2.y);
      ctx.bezierCurveTo(orig2.x - 8, orig2.y + 4, rays2[0].x + 2, rays2[0].y + 4, rays2[0].x, rays2[0].y);
      ctx.closePath();
      ctx.fillStyle = "#f2d96e";
      ctx.fill();
      ctx.strokeStyle = "#c8a030";
      ctx.lineWidth = 5;
      ctx.stroke();
      // stripes
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = "#c8a030";
      ctx.lineWidth = 2;
      [-22.5, -7.5, 7.5, 22.5].forEach(d => {
        const a = (d - 90) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(orig2.x + Math.cos(a) * R2 * 0.2, orig2.y + Math.sin(a) * R2 * 0.2);
        ctx.lineTo(orig2.x + Math.cos(a) * R2 * 0.8, orig2.y + Math.sin(a) * R2 * 0.8);
        ctx.stroke();
      });
      ctx.restore();
      ctx.restore();
      break;
    }
    case 41: { // Cactus — a scalloped flower-like pad (outer tips + concave waists)
      // Ported from a fixed-pixel reference (outerRadius 52 / innerRadius 40 /
      // 8 points on a 100x80 canvas) but scaled by `size` so it matches every
      // icon context (hotbar, bag, card, drag) like the rest of drawItemIcon.
      const outerRadius = size;
      const innerRadius = size * (40 / 52);
      const points = 8;
      const angleStep = (Math.PI * 2) / points;
      ctx.beginPath();
      const startX = outerRadius * Math.cos(-Math.PI / 2);
      const startY = outerRadius * Math.sin(-Math.PI / 2);
      ctx.moveTo(startX, startY);
      for (let i = 0; i < points; i++) {
        const nextOuterAngle = (i + 1) * angleStep - Math.PI / 2;
        const innerAngle = i * angleStep + angleStep / 2 - Math.PI / 2;
        const cpX = innerRadius * Math.cos(innerAngle);
        const cpY = innerRadius * Math.sin(innerAngle);
        const nextX = outerRadius * Math.cos(nextOuterAngle);
        const nextY = outerRadius * Math.sin(nextOuterAngle);
        ctx.quadraticCurveTo(cpX, cpY, nextX, nextY);
      }
      ctx.closePath();
      ctx.fillStyle = "#5CAE53";
      ctx.strokeStyle = "#2D6B33";
      ctx.lineWidth = Math.max(4, size * 0.3);
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.fill();
      break;
    }
    case 39: { // Magnet — a two-tone horseshoe magnet (red pole / blue pole)

      const cx = 150;
      const cy = 115;
      const radius = 45;
      const legLength = 10;
      // Thicker bars (was 32) per request — the horseshoe reads chunkier
      // while the pole gap stays clearly open.
      const thickness = 50;

      ctx.save();
      ctx.scale(size / 60, size / 60);
      ctx.translate(-cx, -120);

      ctx.lineWidth = thickness;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // ── Left half: arc quarter + leg, all red ──
      ctx.strokeStyle = "#9c3838";
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx - radius, cy + radius + legLength);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, -Math.PI / 2, Math.PI, true);
      ctx.stroke();

      // ── Right half: arc quarter + leg, all blue ──
      ctx.strokeStyle = "#3d3f99";
      ctx.beginPath();
      ctx.moveTo(cx + radius, cy);
      ctx.lineTo(cx + radius, cy + radius + legLength);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, -Math.PI / 2, true);
      ctx.stroke();

      ctx.restore();
      break;
    }
    case 32: { // Glass — a jagged, translucent crystal shard
      const jitterA = [0.05, -0.08, 0.04, -0.06, 0.07, -0.03];
      const jitterR = [1.0, 0.82, 1.05, 0.88, 1.0, 0.86];
      const sides = jitterA.length;
      const R = size * 0.95;
      ctx.beginPath();
      for (let i = 0; i < sides; i++) {
        const a = (i * 2 * Math.PI) / sides + jitterA[i];
        const r = R * jitterR[i];
        const px = r * Math.cos(a);
        const py = r * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(235,235,235,0.6)";
      ctx.fill();
      ctx.lineWidth = Math.max(2, size * 0.18);
      ctx.strokeStyle = "rgba(225,225,225,0.9)";
      ctx.lineJoin = "round";
      ctx.stroke();
      break;
    }
    case 33: { // Bone — a rounded dog-bone silhouette
      const drawBonePath = (c: CanvasRenderingContext2D) => {
        const r = 15, s = 13, l = 40, w = 2, d = 8;
        c.beginPath();
        c.arc(s, -l, r, -Math.PI * 0.7, Math.PI * 0.2);
        c.quadraticCurveTo(w, 0, s + r * Math.cos(Math.PI * 0.2), l - r * Math.sin(Math.PI * 0.2));
        c.arc(s, l, r, -Math.PI * 0.2, Math.PI * 0.7);
        c.quadraticCurveTo(0, l - d, -s + r * Math.cos(Math.PI * 0.3), l + r * Math.sin(Math.PI * 0.3));
        c.arc(-s, l, r, Math.PI * 0.3, Math.PI * 1.2);
        c.quadraticCurveTo(-w, 0, -s - r * Math.cos(Math.PI * 0.2), -l + r * Math.sin(Math.PI * 0.2));
        c.arc(-s, -l, r, Math.PI * 0.8, Math.PI * 1.7);
        c.quadraticCurveTo(0, -l + d, s + r * Math.cos(-Math.PI * 0.7), -l + r * Math.sin(-Math.PI * 0.7));
        c.closePath();
      };
      const k = size / 55;
      ctx.save();
      ctx.scale(k, k);
      ctx.rotate((45 * Math.PI) / 180);
      ctx.fillStyle = "#eef5f8";
      drawBonePath(ctx);
      ctx.fill();
      ctx.strokeStyle = "#c6d5dd";
      ctx.lineWidth = 8;
      ctx.lineJoin = ctx.lineCap = "round";
      drawBonePath(ctx);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 27: { // Claw — curved brown claw
      // 50% larger than the previous oversized icon so the Claw reads clearly
      // on small drop/inventory cards and in the world.
      const k = (size / 80) * 1.5;
      ctx.save();
      ctx.scale(k, k);
      // Center the supplied 66..168 × 30..110 authored path on the icon.
      ctx.translate(-117, -70);
      ctx.fillStyle = "#4a322d";
      ctx.beginPath();
      ctx.moveTo(68, 70);
      ctx.quadraticCurveTo(115, 30, 168, 98);
      ctx.quadraticCurveTo(125, 72, 148, 110);
      ctx.quadraticCurveTo(105, 82, 66, 85);
      ctx.quadraticCurveTo(80, 78, 68, 70);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 10;
      ctx.strokeStyle = "#3C261E";
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 35: { // Pincer — curved claw drawn from an authored quadratic path
      // The authored path spans x 38..82 and y 40.5..85 (44 x 44.5 units)
      // centred on (60, 62.76). Scale it to ~1.9x `size` so it matches the
      // visual weight of the other petal icons, then re-centre on the origin.
      const k = (size / 44) * 1.9;
      ctx.save();
      ctx.scale(k, k);
      ctx.translate(-60, -62.76);
      ctx.fillStyle = "#454545";
      ctx.beginPath();

      // 使用二次贝塞尔曲线绘制弯曲爪子
      ctx.moveTo(38, 50);
      ctx.quadraticCurveTo(60, 50, 82, 85);
      ctx.quadraticCurveTo(80, 20, 38, 50);

      ctx.fill();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 7: { // Wing
      ctx.beginPath();
      ctx.moveTo(-size * 0.75, -size * 1.0);
      ctx.quadraticCurveTo(-size * 0.25, 0, -size * 0.75, size * 1.0);
      ctx.quadraticCurveTo(size * 0.75, 0, -size * 0.75, -size * 1.0);
      ctx.closePath();
      ctx.fill();
      ctx.lineJoin = 'round';
      ctx.stroke();
      break;
    }
    case 9: { // Stick
      ctx.save();
      ctx.translate(0, -size * 0.25);
      ctx.rotate(-Math.PI / 12);
      ctx.lineJoin = 'round';
      const drawSticks = () => {
          const sr = (x: number, y: number, w: number, h: number) => {
              const sc = size / 75;
              ctx.roundRect(x * sc, y * sc, w * sc, h * sc, 10 * sc);
          };
          ctx.save(); sr(-14, -5, 16, 80); ctx.restore();
          ctx.save(); ctx.rotate(Math.PI / 6); sr(-15, -70, 16, 70); ctx.restore();
          ctx.save(); ctx.rotate(-Math.PI / 5); sr(-15, -55, 16, 55); ctx.restore();
      };
      ctx.beginPath();
      drawSticks();
      ctx.fillStyle = def.outline;
      ctx.strokeStyle = def.outline;
      ctx.lineWidth = size * 0.3;
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      drawSticks();
      ctx.fillStyle = def.color;
      ctx.strokeStyle = def.color;
      ctx.lineWidth = size * 0.05;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 43: { // Antennae — curved insect feelers
      drawAntennaeIcon(ctx, 0, 0, size, spin);
      break;
    }
    case 44: { // Soil — a rugged clump outline
      const k44 = size / 70;
      ctx.save();
      ctx.scale(k44, k44);
      ctx.translate(-100, -77.5);
      ctx.beginPath();
      ctx.moveTo(75, 30);
      ctx.lineTo(125, 30);
      ctx.lineTo(145, 42);
      ctx.lineTo(155, 70);
      ctx.lineTo(155, 90);
      ctx.lineTo(140, 115);
      ctx.lineTo(110, 125);
      ctx.lineTo(90, 125);
      ctx.lineTo(60, 115);
      ctx.lineTo(45, 90);
      ctx.lineTo(45, 70);
      ctx.lineTo(55, 42);
      ctx.closePath();
      ctx.fillStyle = '#6a4824';
      ctx.fill();
      ctx.lineWidth = 15;
      ctx.strokeStyle = '#3f2a12';
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 45: { // Fang — a curved tooth (teardrop)
      const k = size / 55;
      ctx.save();
      ctx.translate(0, size * 0.15);
      ctx.scale(k, k);
      ctx.beginPath();
      ctx.moveTo(0, -52);
      ctx.quadraticCurveTo(40, 0, 0, 55);
      ctx.quadraticCurveTo(-40, 0, 0, -52);
      ctx.closePath();
      ctx.fillStyle = def.color;
      ctx.fill();
      ctx.lineWidth = 40 * k;
      ctx.strokeStyle = def.outline;
      ctx.stroke();
      ctx.restore();
      break;
    }
case 46: { // Orange — three oranges with leaves
  // spin 是旋转角度，世界绘制时 spin 会随时间变化（有数值），卡片绘制时 spin = 0
  const isWorld = Math.abs(spin) > 0.01;

  const R2 = isWorld ? 8 : 13;
  const spacing = isWorld ? size * 0.35 : size * 0.5;

  const drawOrangeWithLeaf = (ox2: number, oy2: number, rotation: number) => {
    ctx.save();
    ctx.translate(ox2, oy2);
    ctx.rotate(rotation);
    ctx.beginPath();
    ctx.arc(0, 0, R2, 0, Math.PI * 2);
    ctx.fillStyle = def.color;
    ctx.fill();
    ctx.lineWidth = Math.max(3, R2 * 0.25);
    ctx.strokeStyle = def.outline;
    ctx.stroke();

    // ===== 叶子也随 R2 缩放 =====
    const leafScale = R2 / 14;  // 基准 R2=14 时叶子正常
    const leafX = -3 * leafScale;
    const leafY = -R2 + 7 * leafScale;

    ctx.beginPath();
    ctx.moveTo(leafX, leafY);
    ctx.quadraticCurveTo(leafX + 12 * leafScale, leafY - 12 * leafScale, leafX + 18 * leafScale, leafY - 3 * leafScale);
    ctx.quadraticCurveTo(leafX + 10 * leafScale, leafY + 6 * leafScale, leafX, leafY);
    ctx.closePath();
    ctx.fillStyle = '#4b8b33';
    ctx.fill();
    ctx.lineWidth = 3 * leafScale;
    ctx.strokeStyle = '#2c6214';
    ctx.stroke();
    ctx.restore();
  };

  ctx.save();
  ctx.translate(-spacing, spacing);
  drawOrangeWithLeaf(0, 0, -2.09);
  ctx.restore();
  ctx.save();
  ctx.translate(spacing, spacing);
  drawOrangeWithLeaf(0, 0, 2.09);
  ctx.restore();
  ctx.save();
  ctx.translate(0, -spacing);
  drawOrangeWithLeaf(0, 0, 0);
  ctx.restore();
  break;
}
    case 48: {
     drawThirdEyeIcon(ctx, 0, 0, size * 0.65, spin);

      break;
    }
    case 50: {
        const FSize = size/2
          ctx.beginPath();
          ctx.arc(0, 0, FSize, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
      break;
    }
    case 52: {

  const scale = size/40

  // ---- 绘制 Missile 形状 ----
  ctx.beginPath();
  ctx.moveTo(-40 * scale, 0);
  ctx.lineTo(30 * scale, -20 * scale);
  ctx.lineTo(30 * scale, 20 * scale);
  ctx.closePath();

  const color = '#3a3a3a';

  ctx.fillStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 15 * scale;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fill();

      break;
    }
    case 53: { // Yggdrasil — leaf of the world tree (user-supplied artwork)
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(0, size);
      ctx.quadraticCurveTo(-size, 0, 0, -size);
      ctx.quadraticCurveTo(size * 1.3, 0, 0, size);
      ctx.closePath();
      ctx.fillStyle = '#735800';
      ctx.fill();
      ctx.lineWidth = size * 0.15;
      ctx.strokeStyle = '#5A4500';
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, size * 0.7);
      ctx.quadraticCurveTo(size * 0.2, size * 0.1, 0, -size * 0.7);
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#5A4500';
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, size);
      ctx.lineTo(-size / 40, size * 1.3);
      ctx.lineWidth = size * 0.18;
      ctx.stroke();
      break;
    }
    default: {
      switch (def.shape) {
        case "circle": {
          ctx.beginPath();
          ctx.arc(0, 0, size, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth =  size * 0.25;
          ctx.stroke();
          break;
        }
        case "square": {
          roundRect(ctx, -size, -size, size * 2, size * 2, size * 0.3);
          ctx.fill();
          ctx.stroke();
          break;
        }
        case "triangle": {
          // Plain upward equilateral triangle, used by triangle-shaped items
          // that have no bespoke artwork of their own (e.g. Pincer).
          const R = size * 1.15;
          ctx.beginPath();
          ctx.moveTo(0, -R);
          ctx.lineTo(-R * 0.866, R * 0.5);
          ctx.lineTo(R * 0.866, R * 0.5);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          break;
        }
        case "egg": {
          const count = getSummonCount(def.id);
          const isCircleEgg = (def.id === 12 || def.id === 14|| def.id === 51);

          if (isCircleEgg) {
            // Draw circle arrangement
            const overlapPercent = 0.15 + 0.05 * count;
            const shapeRadius = size * 0.75; // Eggs 15% smaller (was 0.935) — rounded to 2 s.f.
            const effectiveDiameter = shapeRadius * 2 * (1 - overlapPercent);
            let centerDistance = 0;
            if (count === 1) {
              centerDistance = 0;
            } else if (count === 2) {
              centerDistance = effectiveDiameter / 2;
            } else {
              const angleStep = (Math.PI * 2) / count;
              centerDistance = effectiveDiameter / (2 * Math.sin(angleStep / 2));
            }

            const angleStep = (Math.PI * 2) / count;
            for (let i = 0; i < count; i++) {
              const angle = i * angleStep;
              const ex = centerDistance * Math.cos(angle);
              const ey = centerDistance * Math.sin(angle);

              ctx.beginPath();
              ctx.arc(ex, ey, shapeRadius, 0, Math.PI * 2);
              ctx.fill();
              ctx.lineWidth =  shapeRadius * 0.35;
              ctx.stroke();
            }
          } else {
            // Draw narrow ellipse arrangement
            const overlapPercent = 0.15;
            const shapeRadius = size * 1.05; // Ellipse eggs 15% smaller (was 1.224) — rounded to 2 s.f.
            const rx = shapeRadius * 0.6; // 较短的半径
            const ry = shapeRadius;       // 较长的半径
            const angleStep = (Math.PI * 2) / count;
            const effectiveDiameter = (rx * 2) * (1 - overlapPercent);
            let centerDistance = 0;
            if (count === 1) {
              centerDistance = 0;
            } else if (count === 2) {
              centerDistance = effectiveDiameter / 2;
            } else {
              centerDistance = effectiveDiameter / (2 * Math.sin(angleStep / 2));
            }

            for (let i = 0; i < count; i++) {
              const angle = i * angleStep;
              const ex = centerDistance * Math.cos(angle);
              const ey = centerDistance * Math.sin(angle);

              ctx.beginPath();
              ctx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
              ctx.fill();
              ctx.lineWidth =  shapeRadius * 0.23;
              ctx.stroke();
            }
          }
          break;
        }
        case "nest_egg": {
          // Nest eggs draw ONE larger egg instead of a cluster of small ones.
          const baseR = size * 1.2;
          const rx = baseR * 0.7;
          const ry = baseR;
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
          ctx.fillStyle = def.color;
          ctx.fill();
          ctx.lineWidth = Math.max(2, baseR * 0.2);
          ctx.strokeStyle = def.outline;
          ctx.stroke();
          ctx.restore();
          break;
        }
        case "star": {
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
            const rr = i % 2 === 0 ? size * 1.25 : size * 0.55;
            ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          break;
        }
        default: {
          ctx.beginPath();
          ctx.arc(0, 0, size, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;
        }
      }
      break;
    }
  }
  ctx.restore();
}

// ============================================
// 卡片绘制
// ============================================
// src/game/client/ui.ts - 修改 drawCard 函数

/** Inventory / hotbar card - flat square card: light inner fill + dark border (matches reference Card.draw). */
export function drawCard(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  cell: Cell | null,
  opts: {
    hovered?: boolean;
    empty?: string;
    scale?: number;
    showName?: boolean;
    dim?: number;
    /** 0..1 reload progress. 1 = fully reloaded/ready; below 1 draws a sweep overlay. */
    reload?: number;
    /** 0..1 remaining health. Below 1 draws a damage overlay on top of the card. */
    hp?: number;
  } = {},
) {
  const scale = opts.scale ?? 1;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const size = Math.min(r.w, r.h);

  ctx.save();
  ctx.globalAlpha = opts.dim ?? 1;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);

  if (!cell) {
    // Empty slot - flat square, same style as filled cards.
    ctx.fillStyle = opts.hovered ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.28)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    if (opts.empty) text(ctx, opts.empty, cx, cy, 12, "rgba(255,255,255,0.5)");
    ctx.restore();
    return;
  }

  const rarity = RARITIES[Math.min(cell.rarity, RARITIES.length - 1)];
  const def = ITEMS[cell.item];

  // Inner fill - light rarity color (RARITY_COLORS).
  ctx.fillStyle = rarity.color;
  ctx.fillRect(r.x, r.y, r.w, r.h);

  // Border - dark rarity color (BORDER_COLORS).
  ctx.strokeStyle = rarity.border;
  ctx.lineWidth = 4;
  ctx.strokeRect(r.x, r.y, r.w, r.h);

  // Hover highlight.
  if (opts.hovered) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
  }

  // Item icon - centered in the upper area, leaving room for the name band.
  const showName = opts.showName !== false && !!def;
  const iconSize = size * 0.28;
  const iconCy = cy - (showName ? r.h * 0.07 : 0);
  // Cards are the hottest icon call site (a full bag redraws dozens per frame),
  // so they go through the sprite atlas.
  icon(ctx, cell.item, cx, iconCy, iconSize, 0, cell.rarity, cell.item === 2);

  // Item name (bottom band) with the reference word-wrap logic.
  if (showName && def) {
    ctx.save();

    const itemName = def.name;
    const maxWidth = r.w * 0.95;
    const maxHeight = r.h * 0.22;

    let lines: string[] = [];
    const maxCharsPerLine = 10;

    if (itemName.length > maxCharsPerLine) {
      const spaceIndex = itemName.indexOf(' ');
      if (spaceIndex !== -1 && spaceIndex <= maxCharsPerLine && spaceIndex < itemName.length - 1) {
        lines = [itemName.substring(0, spaceIndex), itemName.substring(spaceIndex + 1)];
      } else {
        const mid = Math.ceil(itemName.length / 2);
        let splitPoint = mid;
        for (let i = mid; i < itemName.length; i++) {
          if (itemName[i] === ' ') { splitPoint = i; break; }
        }
        if (splitPoint === mid) {
          for (let i = mid - 1; i > 0; i--) {
            if (itemName[i] === ' ') { splitPoint = i; break; }
          }
        }
        if (splitPoint === mid) splitPoint = Math.floor(itemName.length / 2);
        lines = [itemName.substring(0, splitPoint), itemName.substring(splitPoint + 1)];
      }
    } else {
      lines = [itemName];
    }

    let fontSize = lines.length > 1 ? Math.floor(maxHeight * 0.6) : Math.floor(maxHeight * 0.9);
    ctx.font = `900 ${fontSize}px "Trebuchet MS", "Segoe UI", sans-serif`;
    let longestLineWidth = Math.max(...lines.map(line => ctx.measureText(line).width));

    while (longestLineWidth > maxWidth && fontSize > 7) {
      fontSize--;
      ctx.font = `900 ${fontSize}px "Trebuchet MS", "Segoe UI", sans-serif`;
      longestLineWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const textX = cx;
    const spacing = fontSize * 0.85;

    lines.forEach((line, index) => {
      let textY: number;
      if (lines.length === 1) {
        textY = r.y + r.h - (maxHeight / 2) - 2;
      } else {
        const baseY = r.y + r.h - (maxHeight / 2) - 4;
        textY = (index === 0) ? baseY - (spacing / 2) : baseY + (spacing / 2);
      }
      ctx.strokeStyle = "black";
      ctx.lineWidth = fontSize > 12 ? 3 : 2;
      ctx.lineJoin = "round";
      ctx.strokeText(line, textX, textY);
      ctx.fillStyle = "white";
      ctx.fillText(line, textX, textY);
    });

    ctx.restore();
  }

  // Count badge (top-right, rotated) - matches reference.
  if (cell.count > 1) {
    ctx.save();

    const countStr = "x" + (cell.count >= 1000000 ? (cell.count / 1000000).toFixed(1) + 'M' :
                            cell.count >= 1000 ? (cell.count / 1000).toFixed(1) + 'K' :
                            cell.count);

    const fontSize = Math.max(7, Math.round(18 * size / 70));
    ctx.font = `900 ${fontSize}px "Trebuchet MS", "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.translate(r.x + r.w - 10, r.y + 5);
    ctx.rotate(0.3);
    ctx.strokeStyle = "black";
    ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.24));
    ctx.lineJoin = "round";
    ctx.strokeText(countStr, 0, 0);
    ctx.fillStyle = "white";
    ctx.fillText(countStr, 0, 0);

    ctx.restore();
  }


  const reload = opts.reload ?? 1;
  if (reload < 1) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    const sweep = Math.PI * 2 * (1 - Math.max(0, reload));
    const radius = Math.hypot(r.w, r.h);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + sweep);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Damage overlay (for quickslot active petals)
  const hp = opts.hp ?? 1;
  if (hp < 1) {
    const damageRatio = 1 - Math.max(0, Math.min(1, hp));
    if (damageRatio > 0) {
      drawDamageOverlay(ctx, r.x, r.y, r.w, damageRatio);
    }
  }

  ctx.restore();
}
// ============================================
// 怪物绘制
// ============================================

export function drawBee(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  animationTimer: number,
  angleToPlayer: number,
  level = 1,
  viewScale = 1.0,
  enemyObj: { isFriendly?: boolean } | null = null,
) {
  const scaledSize = size;
  if (scaledSize <= 0) return;
  const isFriendly = enemyObj?.isFriendly;
  const totalScale = size / 100;
  const bodyColor = isFriendly ? [255, 235, 120] : [255, 231, 99];
  const darkBodyColor = isFriendly ? [230, 200, 80] : [211, 189, 7];

  const colorToCss = (c: readonly number[] | string) => {
    if (typeof c === "string") return c;
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };

  context.save();
  context.translate(x, y);
  context.rotate(angleToPlayer);

  const bw = scaledSize, bh = scaledSize * 0.70;
  const bx = -bw / 2;
  const lineWidth = Math.max(2, 7 * totalScale);
  const cx = 0, cy = 0;
  const a = bw / 2, b = bh / 2;
  const swing = Math.sin(animationTimer * 5) * 0.52;
  context.rotate(swing);

  // --- 1. 绘制尾针 (放在最底层，稍微往右移一点点防止断层) ---
  const sl = 20 * totalScale, sw2 = 14 * totalScale;
  context.fillStyle = "#000";
  context.beginPath();
  context.moveTo(bx + 2, cy - sw2); // +2 像素确保没入身体内部
  context.lineTo(bx + 2, cy + sw2);
  context.lineTo(bx - sl, cy);
  context.closePath();
  context.strokeStyle = "#000";
  context.lineJoin ='round';
  context.stroke();
  context.fill();

  // --- 2. 绘制身体基础填充 ---
  context.fillStyle = colorToCss(bodyColor);
  context.beginPath();
  context.ellipse(cx, cy, a, b, 0, 0, Math.PI * 2);
  context.fill();

  // --- 3. 绘制条纹 (使用 clip 裁剪，确保线条绝不超出身体且无缝) ---
  context.save();
  context.beginPath();
  context.ellipse(cx, cy, a, b, 0, 0, Math.PI * 2);
  context.clip(); // 建立裁剪区域
  context.fillStyle = "#333333";
  const stripeW = Math.max(2, b * 0.4);
  [0.65, 0, -0.65].forEach((off) => {
    const sx2 = cx + a * off; // 直接画一个足够大的矩形，反正会被 clip 裁掉超出的部分
    context.fillRect(sx2 - stripeW / 2, cy - b, stripeW * 1.2, b * 2);
  });
  context.restore();

  // --- 4. 绘制身体描边 (放在填充和条纹之后，压住边缘缝隙) ---
  context.strokeStyle = colorToCss(darkBodyColor);
  context.lineWidth = lineWidth;
  context.beginPath();
  context.ellipse(cx, cy, a, b, 0, 0, Math.PI * 2);
  context.stroke();

  // --- 5. 绘制触角 (保持在描边之上) ---
  const antennaLen = bw * 0.4;
  const antennaBase = Math.max(3, 4 * totalScale);
  const antennaTip = Math.max(4, 7 * totalScale);

  const drawAntenna = (side: number, xOffsetMult: number, yOffset: number) => {
    const sx = bx + bw * xOffsetMult;
    const sy = cy + yOffset * totalScale;
    const ctrlX = sx + antennaLen * 0.3;
    const ctrlY = sy + side * antennaLen * -0.1;
    const ex = sx + antennaLen * 0.8;
    const ey = sy + side * antennaLen;

    context.beginPath();
    context.moveTo(sx, sy);
    context.quadraticCurveTo(ctrlX, ctrlY, ex, ey);
    context.strokeStyle = "#333333";
    context.lineWidth = antennaBase;
    context.lineCap = "round";
    context.stroke();

    context.beginPath();
    context.arc(ex, ey, antennaTip, 0, Math.PI * 2);
    context.fillStyle = "#333333";
    context.fill();
  };

  drawAntenna(-0.5, 0.95, -5);
  drawAntenna(0.5, 0.95, 5);

  context.restore();
}

/** Mobs are drawn procedurally, no images. */
export function drawMob(
  ctx: CanvasRenderingContext2D,
  type: number,
  x: number,
  y: number,
  radius: number,
  angle: number,
  t: number,
  friendly: boolean,
  rarity = 0,
  level = 0,
  id = 0,
) {
  const def = MOBS[type];
  if (!def || radius <= 0) return;
 const game = (window as any).gameInstance;
  const isPotato = game?.settings?.photoHardware === true;

  if (isPotato) {
    // Potato模式：只绘制灰色圆
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = friendly ? 'rgba(100, 180, 100, 0.7)' : 'rgba(51, 51, 51, 0.7)';
    ctx.fill();
    if (friendly) {
      ctx.strokeStyle = 'rgba(100, 180, 100, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  const css = (rgb: readonly number[] | string) => {
    if (typeof rgb === "string") return rgb;
    if (rgb.length >= 4) return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${rgb[3]})`;
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  };
  const drawCircle = (cx: number, cy: number, r: number, fill: readonly number[], stroke?: readonly number[]) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = css(fill);
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = css(stroke);
      ctx.lineWidth = Math.max(1, r * 0.16);
      ctx.stroke();
    }
  };

  /**
   * Draw a matched pair of bent feelers splayed around `angleToPlayer`.
   *
   * Each antenna is a quadratic curve: the base points ±30° off the facing
   * direction, the control point is swung a further `bendFactor` radians
   * outward at half length, and both the control point and the tip are pulled
   * sideways by `endGap` so the two feelers hook away from each other. The ant
   * renderer draws in a space already rotated to its target, so it passes
   * angleToPlayer = 0 and the antennae turn with the body.
   */
  const drawAntAntenna = (
    headX: number,
    headY: number,
    angleToPlayer: number,
    scale = 1.0,
    animationTimer = 0,
    antennaColor: readonly number[] | string = [50, 50, 50],
    antennaLen = 18,
    antennaWidth = 2.5,
    antennaWaveAmp = 0.2,
    antennaWaveFreq = 10,
    bendFactor = 0.9,
    startOffset = 0,
    endGap = -4,
  ) => {
    const len = antennaLen * scale;
    const width = Math.max(1, antennaWidth * scale * 2);
    const startOffsetScaled = startOffset * scale;
    const endGapScaled = endGap * scale;
    const waveAngle = Math.sin(animationTimer * antennaWaveFreq) * (antennaWaveAmp * 0.3);

    ctx.save();
    ctx.strokeStyle = css(antennaColor);
    ctx.lineWidth = width;
    ctx.lineCap = "round";

    const getPerpOffset = (angle: number, gap: number) => ({
      x: -Math.sin(angle) * gap,
      y: Math.cos(angle) * gap,
    });

    // 左触角
    const leftBaseAngle = angleToPlayer - Math.PI / 6 + waveAngle;
    const leftStartX = headX + Math.cos(leftBaseAngle) * startOffsetScaled;
    const leftStartY = headY + Math.sin(leftBaseAngle) * startOffsetScaled;
    const leftEndBaseX = headX + Math.cos(leftBaseAngle) * len;
    const leftEndBaseY = headY + Math.sin(leftBaseAngle) * len;
    const leftShrink = -Math.min(endGapScaled, len * 0.3);
    const leftPerp = getPerpOffset(leftBaseAngle, leftShrink);
    const leftEndX = leftEndBaseX + leftPerp.x;
    const leftEndY = leftEndBaseY + leftPerp.y;
    const leftMidAngle = leftBaseAngle - bendFactor;
    const leftMidDist = len * 0.5;
    const leftMidShrink = -Math.min(endGapScaled * 0.5, len * 0.15);
    const leftMidPerp = getPerpOffset(leftMidAngle, leftMidShrink);
    const leftMidX = headX + Math.cos(leftMidAngle) * leftMidDist + leftMidPerp.x;
    const leftMidY = headY + Math.sin(leftMidAngle) * leftMidDist + leftMidPerp.y;

    ctx.beginPath();
    ctx.moveTo(leftStartX, leftStartY);
    ctx.quadraticCurveTo(leftMidX, leftMidY, leftEndX, leftEndY);
    ctx.stroke();

    // 右触角
    const rightBaseAngle = angleToPlayer + Math.PI / 6 - waveAngle;
    const rightStartX = headX + Math.cos(rightBaseAngle) * startOffsetScaled;
    const rightStartY = headY + Math.sin(rightBaseAngle) * startOffsetScaled;
    const rightEndBaseX = headX + Math.cos(rightBaseAngle) * len;
    const rightEndBaseY = headY + Math.sin(rightBaseAngle) * len;
    const rightShrink = Math.min(endGapScaled, len * 0.3);
    const rightPerp = getPerpOffset(rightBaseAngle, rightShrink);
    const rightEndX = rightEndBaseX + rightPerp.x;
    const rightEndY = rightEndBaseY + rightPerp.y;
    const rightMidAngle = rightBaseAngle + bendFactor;
    const rightMidDist = len * 0.5;
    const rightMidShrink = Math.min(endGapScaled * 0.5, len * 0.15);
    const rightMidPerp = getPerpOffset(rightMidAngle, rightMidShrink);
    const rightMidX = headX + Math.cos(rightMidAngle) * rightMidDist + rightMidPerp.x;
    const rightMidY = headY + Math.sin(rightMidAngle) * rightMidDist + rightMidPerp.y;

    ctx.beginPath();
    ctx.moveTo(rightStartX, rightStartY);
    ctx.quadraticCurveTo(rightMidX, rightMidY, rightEndX, rightEndY);
    ctx.stroke();
    ctx.restore();
  };

  const drawJellyfish = () => {
    const scaledSize = radius * 2.0;
    const BODY = friendly ? "rgba(255,215,0,0.8)" : "rgba(200,215,235,0.8)";
    const STROKE = friendly ? "rgba(255,235,120,0.85)" : "rgba(240,240,240,0.9)";
    const TENT = friendly ? "rgba(200,160,0,0.9)" : "rgba(220,230,245,0.85)";
    const scale = scaledSize / 180;
    const R = 86 * scale;
    ctx.save();
    ctx.translate(x, y + Math.sin(t * 1.5) * 5);
    ctx.rotate(angle + Math.PI);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = TENT;
    ctx.lineWidth = 8 * scale;
    for (let i = 0; i < 10; i++) {
      const baseAngle = (i / 10) * Math.PI * 2;
      const wave = Math.sin(t * 2 + i * 0.8) * 12 * scale;
      const bx = Math.cos(baseAngle) * R;
      const by = Math.sin(baseAngle) * R;const ex = Math.cos(baseAngle) * (R + 55 * scale) + Math.sin(baseAngle) * wave;
      const ey = Math.sin(baseAngle) * (R + 55 * scale) - Math.cos(baseAngle) * wave;
      const cpx = Math.cos(baseAngle) * (R + 28 * scale) + Math.sin(baseAngle) * wave * 0.5;
      const cpy = Math.sin(baseAngle) * (R + 28 * scale) - Math.cos(baseAngle) * wave * 0.5;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(cpx, cpy, ex, ey);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = BODY;
    ctx.fill();
    ctx.strokeStyle = STROKE;
    ctx.lineWidth = 6 * scale;
    ctx.stroke();
    const pr = 13 * scale;
    const pd = 20 * scale;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const cx2 = Math.cos(a) * pd;
      const cy2 = Math.sin(a) * pd;
      const gapCenter = a + Math.PI;
      const gap = Math.PI * 0.18;
      ctx.beginPath();
      ctx.arc(cx2, cy2, pr, gapCenter + gap, gapCenter - gap, false);
      ctx.stroke();
    }
    ctx.restore();
  };

  const drawHornet = () => {
    const scale = (radius * 2) / 120;
    const colors = friendly
      ? { body: "#ffe667", stroke: "#d1bb54", dark: "#333333", stingerColor: "#333333" }
      : { body: "#ffd363", stroke: "#d3ad46", dark: "#333333", stingerColor: "#333333" };
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const bodyW = 50 * scale;
    const bodyH = 70 * scale;
    const strokeWidth = 12 * scale;
    ctx.beginPath();
    ctx.moveTo(-20 * scale, 50 * scale);
    ctx.lineTo(0, 120 * scale);
    ctx.lineTo(20 * scale, 50 * scale);
    ctx.closePath();
    ctx.fillStyle = colors.stingerColor;
    ctx.strokeStyle = colors.stingerColor;
    ctx.lineWidth = strokeWidth;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, bodyW, bodyH, 0, 0, Math.PI * 2);
    ctx.fillStyle = colors.body;
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, bodyW, bodyH, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = colors.dark;
    const stripeWidth = 26 * scale;
    ctx.fillRect(-bodyW * 1.5, -45 * scale, bodyW * 3, stripeWidth);
    ctx.fillRect(-bodyW * 1.5, 5 * scale, bodyW * 3, stripeWidth);
    ctx.fillRect(-bodyW * 1.5, 55 * scale, bodyW * 3, stripeWidth);
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(0, 0, bodyW, bodyH, 0, 0, Math.PI * 2);
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
    const drawAntenna = (isLeft: boolean) => {
      ctx.save();
      const side = isLeft ? -1 : 1;
      ctx.translate(14 * scale * side, -62 * scale);
      ctx.rotate((Math.PI / 6) * side);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-8 * scale, -30 * scale, 0, -70 * scale);
      ctx.quadraticCurveTo(8 * scale, -30 * scale, 0, 0);
      ctx.fillStyle = colors.dark;
      ctx.fill();
      ctx.strokeStyle = colors.dark;
      ctx.lineWidth = 5 * scale;
      ctx.stroke();
      ctx.restore();
    };
    drawAntenna(true);
    drawAntenna(false);
    ctx.restore();
  };

  const drawBeetle = () => {
    const vf = (radius * 2) / 75;
    const BORDER = friendly ? [180, 130, 10] : [72, 38, 115];
    const BODY = friendly ? [210, 165, 35] : [108, 62, 162];
    const SPOT = friendly ? [140, 100, 10] : [62, 28, 100];
    const SEAM = SPOT;
    const BLACK = [20, 15, 25];
    const hw = 27 * vf;
    const hh = 40 * vf;
    const topY = -hh;
    const bodyPath = (w: number, h: number) => {
      ctx.beginPath();
      const wideW = w * 1.2;
      ctx.moveTo(0, -h);
      ctx.bezierCurveTo(wideW, -h, wideW, -h * 0.2, wideW, 0);
      ctx.bezierCurveTo(wideW, h * 0.2, wideW, h, 0, h);
      ctx.bezierCurveTo(-wideW, h, -wideW, h * 0.2, -wideW, 0);
      ctx.bezierCurveTo(-wideW, -h * 0.2, -wideW, -h, 0, -h);
      ctx.closePath();
    };
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const drawMandible = (side: number) => {
      const mandibleHeight = hh * 1.5;
      const p0x = side * 12 * vf;
      const p0y = topY + 30 * vf;
      const p1x = side * 15 * vf;
      const p1y = -mandibleHeight * 0.55;
      const p2x = side * -2 * vf;
      const p2y = -mandibleHeight;
      const cpX = side * 6 * vf;
      const cpY = -mandibleHeight * 0.7;
      const swing = Math.sin(t * 8) * 0.1 * side;
      ctx.save();
      ctx.translate(p0x, p0y);
      ctx.rotate(swing);
      ctx.fillStyle = css(BLACK);
      ctx.strokeStyle = css(BLACK);
      ctx.lineWidth = 2.5 * vf;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(p1x, p1y);
      ctx.lineTo(p2x, p2y);
      ctx.quadraticCurveTo(cpX, cpY, 0, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };
    drawMandible(-1);
    drawMandible(1);
    ctx.fillStyle = css(BORDER);
    bodyPath(hw, hh);
    ctx.fill();
    ctx.fillStyle = css(BODY);
    bodyPath(hw - 4 * vf, hh - 4 * vf);
    ctx.fill();
    ctx.strokeStyle = css(SEAM);
    ctx.lineWidth = 5 * vf;
    ctx.beginPath();
    ctx.moveTo(0, -hh + 10 * vf);
    ctx.quadraticCurveTo(4 * vf, 0, 0, hh - 10 * vf);
    ctx.stroke();
    ctx.fillStyle = css(SPOT);
    for (const [sx, sy, sr] of [[-11, -20, 5], [11, -20, 5], [-12, 0, 5], [12, 0, 5], [-11, 20, 5], [11, 20, 5]] as const) {
      ctx.beginPath();
      ctx.arc(sx * vf, sy * vf, sr * vf, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };
const drawCrab = () => {
    const bodyColor = friendly ? [255, 215, 0] : [230, 120, 80];
    const bodyStrokeColor = friendly ? [200, 160, 0] : [180, 80, 50];
    const limbColor = friendly ? [180, 140, 0] : [40, 40, 40];
    const legWidthMult = 0.65;
    const clawSizeMult = 0.4;
    const scale = (radius * 3) / 90;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);

    const anim = t * 3;

    const drawLeg = (baseX: number, baseY: number, dirX: number, dirY: number, phase: number) => {
        const swing = Math.sin(anim * 2.6 + phase) * 0.25;

        const cosThigh = Math.cos(swing);
        const sinThigh = Math.sin(swing);
        const lenThigh = 1.2;

        const kneeX = baseX + (dirX * cosThigh - dirY * sinThigh) * lenThigh;
        const kneeY = baseY + (dirX * sinThigh + dirY * cosThigh) * lenThigh;

        ctx.beginPath();
        ctx.moveTo(baseX * scale, baseY * scale);
        ctx.lineTo(kneeX * scale, kneeY * scale);
        ctx.strokeStyle = css(limbColor);
        ctx.lineWidth = 6 * scale * legWidthMult;
        ctx.lineCap = "round";
        ctx.stroke();

        const kneeBend = Math.abs(Math.sin(anim * 2.6 + phase)) * 0.05;
        const legAngle = swing + (kneeBend * dirX);

        const cosCalf = Math.cos(legAngle);
        const sinCalf = Math.sin(legAngle);
        const lenCalf = 1;

        const footX = kneeX + (dirX * cosCalf - dirY * sinCalf) * lenCalf;
        const footY = kneeY + (dirX * sinCalf + dirY * cosCalf) * lenCalf;

        ctx.beginPath();
        ctx.moveTo(kneeX * scale, kneeY * scale);
        ctx.lineTo(footX * scale, footY * scale);
        ctx.lineWidth = 6 * scale * legWidthMult;
        ctx.stroke();
    };

    [-1, 4, 8, 14].forEach((ly, i) => {
        const len = [7, 6, 6, 5][i];
        drawLeg(22, ly, len, (i - 1.5) * 3, i * 0.7);
        drawLeg(-22, ly, -len, (i - 1.5) * 3, i * 0.7);
    });

    const drawClaw = (ox: number, oy: number, flip: number, clawAngle: number) => {
        ctx.save();
        ctx.translate(ox * scale, oy * scale);
        ctx.scale(flip, 1);
        ctx.rotate(clawAngle);
        const s = scale * clawSizeMult;
        const offsetX = -32 * s;
        const offsetY = -50 * s;
        ctx.fillStyle = "#2a2a2a";
        ctx.strokeStyle = "#222222";
        ctx.lineWidth = 8 * s;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(offsetX, offsetY);
        ctx.quadraticCurveTo(8 * s + offsetX, 25 * s + offsetY, 18 * s + offsetX, offsetY);
        ctx.quadraticCurveTo(15 * s + offsetX, 22 * s + offsetY, 0, 0);
        ctx.quadraticCurveTo(-18 * s + offsetX, 35 * s + offsetY, offsetX, offsetY);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    };

    const visualScale = Math.pow(scale, 0.01);
    const clawAngle = Math.sin(anim * 2.5) * 0.2;
    drawClaw(-visualScale * 25, -10, 1, clawAngle);
    drawClaw(visualScale * 25, -10, -1, clawAngle);

    const wFront = 160 * scale / 3;
    const wBack = 132 * scale / 3;
    const H = 95 * scale / 3;
    const r = 30 * scale / 3;
    const arc = 24 * scale / 3;
    const xFL = -wFront / 2, xFR = wFront / 2, xBL = -wBack / 2, xBR = wBack / 2;
    const yF = -H / 2, yB = H / 2;
ctx.lineJoin = 'round';
ctx.lineCap = 'round';
    ctx.fillStyle = css(bodyColor);
    ctx.strokeStyle = css(bodyStrokeColor);
    ctx.lineWidth = 8 * scale / 2;
    ctx.beginPath();
    ctx.moveTo(xBL, yB - r);
    ctx.arcTo(xBL, yB, xBL + r, yB, r);
    ctx.lineTo(xBR - r, yB);
    ctx.arcTo(xBR, yB, xBR, yB - r, r);
    ctx.lineTo(xFR, yF + r);
    ctx.arcTo(xFR, yF, xFR - r, yF, r);
    ctx.quadraticCurveTo(0, yF - arc, xFL + r, yF);
    ctx.arcTo(xFL, yF, xFL, yF + r, r);
    ctx.lineTo(xBL, yB - r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 8 * scale / 2;
    [[-15, -20, -11, 8, -13, 22], [15, -20, 11, 8, 13, 22]].forEach(([ax, ay, bx, by, ex, ey]) => {
        const s = scale / 3;
        ctx.beginPath();
        ctx.moveTo(ax * s, ay * s);
        ctx.bezierCurveTo(bx * s, (by / 2) * s, bx * s, by * s, ex * s, ey * s);
        ctx.stroke();
    });

    ctx.restore();
};
  const drawWorkerAnt = () => {
    const scaledSize = radius * 2;
    const bodyColor = friendly ? [200, 160, 0] : [60, 60, 60];
    const innerBodyColor = friendly ? [255, 215, 0] : [90, 90, 90];
    const antennaColor = [51, 51, 51];
    const headRadius = scaledSize / 2.2;
    const bodyRadius = headRadius * 0.8;
    const headX = headRadius * 0.3;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const antennaScale = headRadius / 12;
    drawAntAntenna(
      headX, 0, 0, antennaScale, t,
      antennaColor, 15, 2, 0.2, 10, 0.9,
      headRadius * 0.9 / antennaScale, -4,
    );
    drawCircle(-bodyRadius * 0.8, 0, bodyRadius, bodyColor);
    drawCircle(-bodyRadius * 0.8, 0, bodyRadius * 0.7, innerBodyColor);
    drawCircle(headX, 0, headRadius, bodyColor);
    drawCircle(headX, 0, headRadius * 0.7, innerBodyColor);
    ctx.restore();
  };
const drawSoldierAnt = () => {
  const scaledSize = radius * 2;
  const bodyColor = friendly ? [200, 160, 0] : [60, 60, 60];
  const innerBodyColor = friendly ? [255, 215, 0] : [90, 90, 90];
  const antennaColor = [51, 51, 51];

  // --- 翅膀颜色配置 ---
  const wingBaseColor = friendly ? [255, 215, 0] : [200, 200, 255];
  const wingAlpha = 0.5;

  const headRadius = scaledSize / 2.2;
  const bodyRadius = headRadius * 0.8;
  const headX = headRadius * 0.3;
  const bodyX = -bodyRadius * 0.8;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // --- 1. 绘制身体 ---
  drawCircle(bodyX, 0, bodyRadius, bodyColor);
  drawCircle(bodyX, 0, bodyRadius * 0.7, innerBodyColor);

  // --- 2. 绘制翅膀 ---
  const wingAngle = Math.sin(t * 8) * (10 * Math.PI / 180);

  ctx.save();
  ctx.fillStyle = `rgba(${wingBaseColor[0]}, ${wingBaseColor[1]}, ${wingBaseColor[2]}, ${wingAlpha})`;
  ctx.globalAlpha = 0.8;

  // 翅膀长度（长轴半径）
  const wingLength = scaledSize * 0.4;
  // 翅膀根部Y偏移
  const wingRootYOffset = -bodyRadius * 0.5;

  // === 左翅膀 ===
  ctx.save();
  // 1. 移动到根部（旋转中心）
  ctx.translate(bodyX*0.8, wingRootYOffset);
  // 2. 旋转
  ctx.rotate(wingAngle);

  ctx.beginPath();
  ctx.ellipse(
    wingLength*0.2,
    0,
    wingLength,         // x半径 (长轴)
    bodyRadius * 0.4,   // y半径 (短轴)
    0, 0, Math.PI * 2
  );
  ctx.fill();
  ctx.restore();

  // === 右翅膀 ===
  ctx.save();
  // 1. 移动到根部 (右侧)
  ctx.translate(bodyX*0.8, -wingRootYOffset);
  // 2. 旋转
  ctx.rotate(-wingAngle);

  ctx.beginPath();
  // 同样的逻辑，旋转中心位于翅膀根部端点
  ctx.ellipse(
    wingLength*0.2,
    0,
    wingLength,
    bodyRadius * 0.4,
    0, 0, Math.PI * 2
  );
  ctx.fill();
  ctx.restore();

  ctx.restore();

  // --- 3. 绘制触角 ---
  const antennaScale = headRadius / 12;
  drawAntAntenna(
    headX, 0, 0, antennaScale, t,
    antennaColor, 15, 2, 0.2, 10, 0.9,
    headRadius * 0.9 / antennaScale, -4,
  );

  // --- 4. 绘制头部 ---
  drawCircle(headX, 0, headRadius, bodyColor);
  drawCircle(headX, 0, headRadius * 0.7, innerBodyColor);

  ctx.restore();
};
  const drawLadybug = (shellColor?: string, outlineColor?: string) => {
    // The supplied reference draws a red crescent ladybug: a black underbody
    // topped by a 283° red shell whose notch is cut back through the centre,
    // then clipped black spots. It is adapted to this game's local space so it
    // scales with `radius`, preserves the friendly/gold palette, and uses a
    // stable per-mob seed instead of Math.random() so the spots do not flicker
    // while the mob is moving every frame. The Shiny Ladybug reuses the same
    // artwork with a yellow shell (#ffff00 / #CCcc00) passed in.
    const R = radius;
    const BLACK = "#000000";
    const OUTLINE = outlineColor ?? (friendly ? "#B8860B" : "#AF0000");
    const SHELL = shellColor ?? (friendly ? "#DAA520" : "#DA3232");

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);

    // 起始角度与终止角度（跨度 11/7 π，即约 283°）。
    // The notch (the exposed black head) spans the remaining 3/7 π; centre it
    // on local "up" (-π/2) so that after the `angle + π/2` rotation the face
    // points exactly along the mob's facing direction instead of drifting off
    // to one side.
    const notchSpan = 2 * Math.PI - (11 / 7) * Math.PI; // 3/7 π
    const startAngle = -Math.PI / 2 + notchSpan / 2;    // -2/7 π
    const endAngle = startAngle + (11 / 7) * Math.PI;

    // 计算两个端点的绝对坐标
    const startX = R * Math.cos(startAngle);
    const startY = R * Math.sin(startAngle);
    const endX = R * Math.cos(endAngle);
    const endY = R * Math.sin(endAngle);

    // Black underbody outline.
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = BLACK;
    ctx.fill();

    // Red crescent shell, with the notch cut from the arc back through the centre.
    ctx.beginPath();
    ctx.arc(0, 0, R, startAngle, endAngle);
    ctx.quadraticCurveTo(0, 0, startX, startY);
    ctx.closePath();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = Math.max(1, R * (50 / 120));
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.fillStyle = SHELL;
    ctx.fill();
    ctx.clip();

    // 5–8 random-looking but stable black spots, clipped to the shell.
    let seed = (id >>> 0) || 1;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const spotCount = 5 + Math.floor(random() * 4);
    ctx.fillStyle = BLACK;
    for (let i = 0; i < spotCount; i++) {
      const r = random() * R;
      const spotAngle = random() * Math.PI * 2;
      const spotX = r * Math.cos(spotAngle);
      const spotY = r * Math.sin(spotAngle);
      const spotRadius = (10 + random() * 25) * (R / 120);
      ctx.beginPath();
      ctx.arc(spotX, spotY, spotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore(); // 恢复之前的状态，解除裁剪
  };

  const drawScorpion = () => {
    const scale = (radius * 2) / 120;
    const bodyColor = friendly ? "#FFD700" : "#b59646";
    const darkColor = friendly ? "#B8860B" : "#8d7435";
    const legColor = friendly ? "#DAA520" : "#5a3e1a";
    const timestamp = t * 1000;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.save();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 10 * scale;
    ctx.lineCap = "round";
    const mouthY = -75 * scale;
    const mouthSwing = Math.sin(timestamp * 0.008) * 0.1;
    for (const side of [-1, 1]) {
      const sx = side * 20 * scale;
      const sy = mouthY + 8 * scale;
      const a = -Math.PI / 2 - side * 0.25 - side * mouthSwing;
      const mouthLen = 28 * scale;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(sx + Math.cos(a + side * 0.4) * mouthLen * 0.5, sy + Math.sin(a + side * 0.4) * mouthLen * 0.5, sx + Math.cos(a) * mouthLen, sy + Math.sin(a) * mouthLen);
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = legColor;
    ctx.lineWidth = 10 * scale;
    ctx.lineCap = "round";
    [-40, -10, 20, 60].forEach((ly, index) => {
      const len = [5, 20, 30, 15][index] * scale;
      const swing = Math.sin(timestamp * 0.010 + index * 1.5) * 5 * scale;
      ctx.beginPath();
      ctx.moveTo(-38 * scale, ly * scale);
      ctx.lineTo(-45 * scale - len, ly * scale - scale + swing);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(40 * scale, ly * scale);
      ctx.lineTo(45 * scale + len, ly * scale - scale + swing);
      ctx.stroke();
    });
    ctx.restore();
    const body = (cy: number, r: number, frontW: number, midW: number, tailW: number, frontY: number, midY: number, tailY: number) => {
      ctx.save();
      ctx.beginPath();
      ctx.lineJoin = "round";
      ctx.moveTo(-frontW + 10 * scale, cy + frontY);
      ctx.arcTo(frontW, cy + frontY, midW, cy + midY, r);
      ctx.arcTo(midW, cy + midY, tailW, cy + tailY, r);
      ctx.arcTo(tailW, cy + tailY, -tailW, cy + tailY, r);
      ctx.arcTo(-tailW, cy + tailY, -midW, cy + midY, r);
      ctx.arcTo(-midW, cy + midY, -frontW, cy + frontY, r);
      ctx.arcTo(-frontW, cy + frontY, frontW, cy + frontY, r);
      ctx.closePath();
      ctx.fillStyle = bodyColor;
      ctx.fill();
      ctx.strokeStyle = darkColor;
      ctx.lineWidth = 10 * scale;
      ctx.stroke();
      ctx.restore();
    };
    body(0, 25 * scale, 20 * scale, 70 * scale, 40 * scale, -80 * scale, 20 * scale, 80 * scale);
    ctx.save();
    ctx.strokeStyle = darkColor;
    ctx.lineWidth = 10 * scale;
    ctx.lineCap = "round";
    [-50, -25, 15, 30].forEach((yy, index) => {
      ctx.beginPath();
      const mid = index === 1 || index === 2;
      ctx.arc(0, yy * scale - 20 * scale, (mid ? 44 : 30) * scale, (mid ? 0.2 : 0.3) * Math.PI, (mid ? 0.8 : 0.7) * Math.PI, false);
      ctx.stroke();
    });
    ctx.restore();
    const smallBodyY = 60 * scale;
    body(smallBodyY, 15 * scale, 10 * scale, 30 * scale, 20 * scale, -30 * scale, 10 * scale, 30 * scale);
    ctx.save();
    const stingerSwing = Math.sin(timestamp * 0.015) * 3 * scale;
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 15 * scale;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(stingerSwing * 0.2, 20 * scale);
    ctx.lineTo(-15 * scale + stingerSwing * 0.5, 35 * scale);
    ctx.lineTo(15 * scale + stingerSwing * 0.5, 35 * scale);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = "#2d2d2d";
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = darkColor;
    ctx.lineWidth = 8 * scale;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, smallBodyY - 12 * scale, 10 * scale, 0.2 * Math.PI, 0.8 * Math.PI, false);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, smallBodyY, 12 * scale, 0.2 * Math.PI, 0.8 * Math.PI, false);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  };
const drawCactus = () => {
    const scaledSize = (radius * 2) / 1.4;
    const cactusColor = friendly ? [255, 215, 0] : [100, 200, 100];
    const outlineColor = friendly ? [200, 160, 0] : [50, 150, 50];

    // 刺的数量随稀有度增加
    const baseSpikes = 8;
    const spikesPerRarity = 2;
    const spikeCount = Math.max(8, baseSpikes + rarity * spikesPerRarity);

    // 星形身体参数（八瓣）
    const outerRadius = scaledSize * 0.6;
    const innerRadius = outerRadius * (40 / 52);
    const points = spikeCount;
    const angleStep = (Math.PI * 2) / points;
    const spikeHeight = scaledSize * 0.1;

    ctx.save();

    // ===== 1. 计算刺的位置（从星形尖端伸出） =====
    const tips: { x: number; y: number; angle: number; tipX: number; tipY: number }[] = [];
    for (let i = 0; i < points; i++) {
        const a = i * angleStep - Math.PI / 2;
        // 星形尖端位置
        const tipX = x + outerRadius * Math.cos(a);
        const tipY = y + outerRadius * Math.sin(a);
        // 刺从尖端伸出
        const spikeTipX = tipX + Math.cos(a) * spikeHeight;
        const spikeTipY = tipY + Math.sin(a) * spikeHeight;
        tips.push({
            x: spikeTipX,
            y: spikeTipY,
            angle: a,
            tipX: tipX,
            tipY: tipY
        });
    }

    // ===== 3. 绘制刺（在身体之上） =====
    for (const pos of tips) {
        ctx.save();
        // 从星形尖端位置开始绘制刺
        ctx.translate(pos.tipX, pos.tipY);
        ctx.rotate(pos.angle);

        // 刺的尺寸
        const spikeLength = spikeHeight * 1.2;
        const spikeWidth = spikeLength * 0.3;

        // 刺的颜色（比身体深一些）
        const spikeColor = friendly ? [180, 140, 20] : [60, 160, 60];

        // 绘制刺（三角形）
        ctx.beginPath();
        ctx.moveTo(0, -spikeWidth);
        ctx.lineTo(spikeLength, 0);
        ctx.lineTo(0, spikeWidth);
        ctx.closePath();

        // 使用刺的颜色而不是黑色
        ctx.fillStyle = `#000000`;
        ctx.fill();

        // 刺的描边（使用轮廓颜色）
        ctx.strokeStyle = `#000000`;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();
    }

    // ===== 2. 绘制星形身体 =====
    ctx.beginPath();
    const startX = x + outerRadius * Math.cos(-Math.PI / 2);
    const startY = y + outerRadius * Math.sin(-Math.PI / 2);
    ctx.moveTo(startX, startY);

    for (let i = 0; i < points; i++) {
        const nextOuterAngle = (i + 1) * angleStep - Math.PI / 2;
        const innerAngle = i * angleStep + angleStep / 2 - Math.PI / 2;

        const cpX = x + innerRadius * Math.cos(innerAngle);
        const cpY = y + innerRadius * Math.sin(innerAngle);
        const nextX = x + outerRadius * Math.cos(nextOuterAngle);
        const nextY = y + outerRadius * Math.sin(nextOuterAngle);

        ctx.quadraticCurveTo(cpX, cpY, nextX, nextY);
    }
    ctx.closePath();

    // 填充星形身体
    ctx.fillStyle = css(cactusColor);
    ctx.fill();
    ctx.strokeStyle = css(outlineColor);
    ctx.lineWidth = Math.max(2, scaledSize * 0.05);
    ctx.lineJoin = "round";
    ctx.stroke();

    ctx.restore();
};
  const drawShell = () => {
    const scaledSize = radius * 2 * 1.3;
    if (scaledSize <= 0) return;
    const isFriendly = friendly;
    const S = isFriendly ? '#fff0a0' : '#f2d96e';
    const STRK = isFriendly ? '#c8a000' : '#c8a030';
    const scale = scaledSize / 80;
    ctx.save();
    ctx.translate(x, y);
    const breathe = 1 + Math.sin(t * 0.05) * 0.05;
    ctx.scale(breathe, breathe);
    ctx.rotate(angle + Math.PI / 2);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const orig = { x: 0, y: 30 * scale };
    const R = 62 * scale;
    const fanAngles = [-44, -22, 0, 22, 44];
    const rays = fanAngles.map(d => {
      const a = (d - 90) * Math.PI / 180;
      return { x: orig.x + Math.cos(a) * R, y: orig.y + Math.sin(a) * R };
    });
    const arcL = { x: orig.x - 20 * scale, y: orig.y + 15 * scale };
    const arcR = { x: orig.x + 20 * scale, y: orig.y + 15 * scale };
    const arcCP = { x: orig.x, y: orig.y + 4 * scale };
    const botCP = { x: orig.x, y: orig.y + 11 * scale };
    const fanPath = () => {
      ctx.beginPath();
      ctx.moveTo(rays[0].x, rays[0].y);
      for (let i = 0; i < 4; i++) {
        const a = rays[i], b = rays[i + 1];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const dx = mx - orig.x, dy = my - orig.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        ctx.quadraticCurveTo(orig.x + dx / len * (len + 16 * scale), orig.y + dy / len * (len + 16 * scale), b.x, b.y);
      }
      ctx.bezierCurveTo(rays[4].x - 2 * scale, rays[4].y + 6 * scale, orig.x + 12 * scale, orig.y + 6 * scale, orig.x, orig.y);
      ctx.bezierCurveTo(orig.x - 10 * scale, orig.y + 5 * scale, rays[0].x + 2 * scale, rays[0].y + 5 * scale, rays[0].x, rays[0].y);
      ctx.closePath();
    };
    const arcAreaPath = () => {
      ctx.beginPath();
      ctx.moveTo(arcL.x, arcL.y);
      ctx.quadraticCurveTo(arcCP.x, arcCP.y, arcR.x, arcR.y);
      ctx.quadraticCurveTo(botCP.x, botCP.y, arcL.x, arcL.y);
      ctx.closePath();
    };
    // Bottom area
    arcAreaPath();
    ctx.fillStyle = STRK;
    ctx.fill();
    // Fan fill
    fanPath();
    ctx.fillStyle = S;
    ctx.fill();
    // Outline
    ctx.beginPath();
    ctx.moveTo(rays[0].x, rays[0].y);
    for (let i = 0; i < 4; i++) {
      const a = rays[i], b = rays[i + 1];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dx = mx - orig.x, dy = my - orig.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      ctx.quadraticCurveTo(orig.x + dx / len * (len + 16 * scale), orig.y + dy / len * (len + 16 * scale), b.x, b.y);
    }
    ctx.bezierCurveTo(rays[4].x - 2 * scale, rays[4].y + 6 * scale, orig.x + 12 * scale, orig.y + 6 * scale, orig.x, orig.y);
    ctx.lineTo(arcR.x, arcR.y);
    ctx.quadraticCurveTo(arcCP.x, arcCP.y, arcL.x, arcL.y);
    ctx.lineTo(orig.x, orig.y);
    ctx.bezierCurveTo(orig.x - 12 * scale, orig.y + 6 * scale, rays[0].x + 2 * scale, rays[0].y + 6 * scale, rays[0].x, rays[0].y);
    ctx.closePath();
    ctx.strokeStyle = STRK;
    ctx.lineWidth = 8 * scale;
    ctx.stroke();
    // Stripes
    ctx.save();
    fanPath();
    ctx.clip();
    ctx.strokeStyle = STRK;
    ctx.lineWidth = 2.5 * scale;
    const stripeAngles = [-22.5, -7.5, 7.5, 22.5];
    for (const d of stripeAngles) {
      const a = (d - 90) * Math.PI / 180;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(orig.x + dx * R * 0.22, orig.y + dy * R * 0.22);
      ctx.lineTo(orig.x + dx * R * 0.82, orig.y + dy * R * 0.82);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  };

  const drawSandstorm = () => {
    const scaledSize = radius * 2 * 1.2;
    if (scaledSize <= 0) return;

    const isFriendly = friendly;
    let outerColor: string, middleColor: string, innerColor: string;
    if (isFriendly) {
      outerColor = '#FFD700';
      middleColor = '#DAA520';
      innerColor = '#B8860B';
    } else {
      outerColor = '#e7dd8d';
      middleColor = '#e1c751';
      innerColor = '#d7ba37';
    }

    const heptagonTemplate: { x: number; y: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i * 2 * Math.PI) / 7;
      heptagonTemplate.push({ x: Math.cos(a), y: Math.sin(a) });
    }

    ctx.save();
    ctx.translate(x, y);

    // --- 1. 外层 7 边形 ---
    ctx.save();
    const outerRotation = (t * 200) * Math.PI / 180;
    ctx.rotate(outerRotation);

    const outerRadius = scaledSize * 0.45;
    ctx.beginPath();
    ctx.moveTo(heptagonTemplate[0].x * outerRadius, heptagonTemplate[0].y * outerRadius);
    for (let i = 1; i < 7; i++) {
      ctx.lineTo(heptagonTemplate[i].x * outerRadius, heptagonTemplate[i].y * outerRadius);
    }
    ctx.closePath();
    ctx.fillStyle = outerColor;
    ctx.fill();
    ctx.restore();

    // --- 2. 中层 7 边形 ---
    ctx.save();
    const midRotation = (t * 240) * Math.PI / 180;
    ctx.rotate(midRotation);

    const midRadius = scaledSize * 0.3;
    ctx.beginPath();
    ctx.moveTo(heptagonTemplate[0].x * midRadius, heptagonTemplate[0].y * midRadius);
    for (let i = 1; i < 7; i++) {
      ctx.lineTo(heptagonTemplate[i].x * midRadius, heptagonTemplate[i].y * midRadius);
    }
    ctx.closePath();
    ctx.fillStyle = middleColor;
    ctx.fill();
    ctx.restore();

    // --- 3. 内层 7 边形 ---
    ctx.save();
    const innerRotation = (t * 270) * Math.PI / 180;
    ctx.rotate(innerRotation);

    const innerRadius = scaledSize * 0.15;
    ctx.beginPath();
    ctx.moveTo(heptagonTemplate[0].x * innerRadius, heptagonTemplate[0].y * innerRadius);
    for (let i = 1; i < 7; i++) {
      ctx.lineTo(heptagonTemplate[i].x * innerRadius, heptagonTemplate[i].y * innerRadius);
    }
    ctx.closePath();
    ctx.fillStyle = innerColor;
    ctx.fill();
    ctx.restore();

    ctx.restore();
  };

  const drawStarfish = () => {
    const baseScale = radius * 3.5;
    const lightColor = friendly ? "rgb(255, 235, 120)" : "rgb(255, 150, 80)";
    const darkColor = friendly ? "rgb(255, 215, 0)" : "rgb(200, 90, 40)";
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * 5.2);
    const outerR = baseScale * 0.5;
    const innerR = baseScale * 0.12;
    const coords: { x: number; y: number; angle: number; isTip: boolean }[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const rr = i % 2 === 0 ? outerR : innerR;
      coords.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, angle: a, isTip: i % 2 === 0 });
    }
    ctx.beginPath();
    ctx.moveTo((coords[0].x + coords[coords.length - 1].x) / 2, (coords[0].y + coords[coords.length - 1].y) / 2);
    for (let i = 0; i < coords.length; i++) {
      const curr = coords[i];
      const next = coords[(i + 1) % coords.length];
      const midX = (curr.x + next.x) / 2;
      const midY = (curr.y + next.y) / 2;
      ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
    }
    ctx.closePath();
    ctx.fillStyle = lightColor;
    ctx.fill();
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.06 * baseScale;
    ctx.strokeStyle = darkColor;
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
    for (let arm = 0; arm < 5; arm++) {
      const a = (arm * 2 * Math.PI) / 5 - Math.PI / 2;
      [{ dMult: 0.06, rMult: 0.035 }, { dMult: 0.15, rMult: 0.028 }, { dMult: 0.23, rMult: 0.022 }, { dMult: 0.31, rMult: 0.016 }].forEach((conf) => {
        ctx.beginPath();
        ctx.arc(Math.cos(a) * baseScale * conf.dMult, Math.sin(a) * baseScale * conf.dMult, baseScale * conf.rMult, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.restore();
  };

  const drawSpider = () => {
    const scaledSize = radius * 2;
    if (scaledSize <= 0) return;
    const WAVE_MULTIPLIERS: Record<string, number> = { 'common': 1.0, 'unusual': 1.1, 'rare': 1.3, 'epic': 1.5, 'legendary': 1.8, 'mythic': 2.2, 'ultra': 2.7, 'super': 4.1, 'omega': 5.3, 'eternal': 5.5 };
    const rarityNames = ['common', 'unusual', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'omega', 'eternal'];
    const rarityName = rarityNames[Math.min(rarity, rarityNames.length - 1)] || 'common';
    const waveMult = WAVE_MULTIPLIERS[rarityName] || 1.0;
    const legColor: [number, number, number] = friendly ? [255, 215, 0] : [50, 48, 50];
    const bodyColor: [number, number, number] = friendly ? [200, 160, 0] : [79, 64, 46];
    const bodyEdgeColor: [number, number, number] = friendly ? [180, 140, 0] : [70, 55, 45];
    const bodyRadius = scaledSize / 2;
    const legLength = bodyRadius * 2.2;
    const baseLegWidth = 3.5;
    const baseBodyStroke = 3.5;
    const legWidth = baseLegWidth * scaledSize / 35;
    const bodyStrokeWidth = baseBodyStroke * scaledSize / 40;
    const waveAmp1 = 7 * waveMult;
    const waveAmp2 = 4 * waveMult;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);

    // Left legs (4)
    for (let i = 0; i < 4; i++) {
      const angleOffset = -1.0 + i * 0.50;
      const baseAngle = Math.PI + angleOffset;
      const startX = Math.cos(baseAngle) * bodyRadius * 0.85;
      const startY = Math.sin(baseAngle) * bodyRadius * 0.85;
      const midAngle = baseAngle + 0.3;
      const midDist = bodyRadius + legLength * 0.3;
      const ctrlX = Math.cos(midAngle) * midDist;
      const ctrlY = Math.sin(midAngle) * midDist;
      const endX = Math.cos(baseAngle) * legLength;
      const endY = Math.sin(baseAngle) * legLength;
      const freq1 = 8 + i * 0.7;
      const freq2 = 12 + i * 1.1;
      const phase1 = i * 1.3;
      const phase2 = i * 0.8 + 2.1;
      const wave1 = Math.sin(t * freq1 + phase1) * waveAmp1;
      const wave2 = Math.sin(t * freq2 + phase2) * waveAmp2;
      const wave = wave1 + wave2;
      const perpX = -Math.sin(baseAngle);
      const perpY = Math.cos(baseAngle);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.quadraticCurveTo(ctrlX + perpX * wave, ctrlY + perpY * wave, endX + perpX * wave * 0.7, endY + perpY * wave * 0.7);
      ctx.strokeStyle = `rgb(${legColor[0]}, ${legColor[1]}, ${legColor[2]})`;
      ctx.lineWidth = legWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    // Right legs (4)
    for (let i = 0; i < 4; i++) {
      const angleOffset = 1.0 - i * 0.50;
      const baseAngle = angleOffset;
      const startX = Math.cos(baseAngle) * bodyRadius * 0.85;
      const startY = Math.sin(baseAngle) * bodyRadius * 0.85;
      const midAngle = baseAngle - 0.3;
      const midDist = bodyRadius + legLength * 0.3;
      const ctrlX = Math.cos(midAngle) * midDist;
      const ctrlY = Math.sin(midAngle) * midDist;
      const endX = Math.cos(baseAngle) * legLength;
      const endY = Math.sin(baseAngle) * legLength;
      const freq1 = 9 + i * 0.9;
      const freq2 = 13 + i * 1.3;
      const phase1 = i * 1.5 + 1.2;
      const phase2 = i * 0.9 + 3.7;
      const wave1 = Math.sin(t * freq1 + phase1) * waveAmp1;
      const wave2 = Math.sin(t * freq2 + phase2) * waveAmp2;
      const wave = wave1 + wave2;
      const perpX = -Math.sin(baseAngle);
      const perpY = Math.cos(baseAngle);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.quadraticCurveTo(ctrlX + perpX * wave, ctrlY + perpY * wave, endX + perpX * wave * 0.7, endY + perpY * wave * 0.7);
      ctx.strokeStyle = `rgb(${legColor[0]}, ${legColor[1]}, ${legColor[2]})`;
      ctx.lineWidth = legWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Body
    ctx.beginPath();
    ctx.arc(0, 0, bodyRadius, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${bodyColor[0]}, ${bodyColor[1]}, ${bodyColor[2]})`;
    ctx.fill();
    ctx.strokeStyle = `rgb(${bodyEdgeColor[0]}, ${bodyEdgeColor[1]}, ${bodyEdgeColor[2]})`;
    ctx.lineWidth = bodyStrokeWidth;
    ctx.stroke();

    ctx.restore();
  };

  const drawRock = () => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = def.color;
    ctx.strokeStyle = def.outline;
    ctx.lineWidth = Math.max(2, radius * 0.14);
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const rr = radius * (0.82 + ((i * 37) % 10) / 40);
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

  // ── Spawner nest drawing helpers ──────────────────────────────────
  const hexPts = (cx: number, cy: number, rad: number) => {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (60 * i - 30) * Math.PI / 180;
      pts.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
    }
    return pts;
  };

  const fillRHex = (
    ctx: CanvasRenderingContext2D,
    pts: { x: number; y: number }[],
    color: string,
    cr: number,
  ) => {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < 6; i++) {
      const cur = pts[i], nxt = pts[(i + 1) % 6];
      const dx = nxt.x - cur.x, dy = nxt.y - cur.y;
      const d = Math.hypot(dx, dy);
      const r = Math.min(cr, d / 2);
      const t1x = cur.x + (dx / d) * r, t1y = cur.y + (dy / d) * r;
      if (i === 0) {
        const last = pts[5];
        const ldx = cur.x - last.x, ldy = cur.y - last.y;
        const ld = Math.hypot(ldx, ldy);
        ctx.lineTo(cur.x - (ldx / ld) * r, cur.y - (ldy / ld) * r);
        ctx.quadraticCurveTo(cur.x, cur.y, t1x, t1y);
      } else {
        const prev = pts[i - 1];
        const pdx = cur.x - prev.x, pdy = cur.y - prev.y;
        const pd = Math.hypot(pdx, pdy);
        ctx.lineTo(cur.x - (pdx / pd) * r, cur.y - (pdy / pd) * r);
        ctx.quadraticCurveTo(cur.x, cur.y, t1x, t1y);
      }
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  };

  const drawHiveBody = () => {
    const s = radius * 2;
    if (s <= 0) return;
    const baseR = s * 0.5, cr = s * 0.05;
    fillRHex(ctx, hexPts(x, y, baseR), '#fdda40', cr);
    fillRHex(ctx, hexPts(x, y, baseR * 0.8), '#fbb257', cr * 0.8);
    fillRHex(ctx, hexPts(x, y, baseR * 0.6), '#fdda40', cr * 0.6);
    fillRHex(ctx, hexPts(x, y, baseR * 0.4), '#fbb257', cr * 0.4);
  };

  const drawAntHole = () => {
    const r = radius;
    if (r <= 0) return;
    for (const { mult, color } of [
      { mult: 1.0, color: '#9E5F00' },
      { mult: 0.75, color: '#774800' },
      { mult: 0.5, color: '#613A00' },
      { mult: 0.25, color: '#432800' },
    ]) {
      ctx.beginPath();
      ctx.arc(x, y, r * mult, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  };

  const drawCrabCaveBody = () => {
    const r = radius;
    if (r <= 0) return;
    for (const { mult, color } of [
      { mult: 1.0, color: [64, 49, 4] },
      { mult: 0.75, color: [82, 57, 7] },
      { mult: 0.5, color: [64, 49, 4] },
      { mult: 0.4, color: [40, 30, 2] },
    ]) {
      ctx.beginPath();
      ctx.arc(x, y, r * mult, 0, Math.PI * 2);
      ctx.fillStyle = Array.isArray(color) ? `rgb(${color[0]},${color[1]},${color[2]})` : color;
      ctx.fill();
    }
  };

  switch (type) {
    case 0: drawLadybug(); break;
    case 1: drawBee(ctx, x, y, radius * 2, t, angle, level, 1.0, { isFriendly: friendly }); break;
    case 2: drawRock(); break;
    case 3: drawSoldierAnt(); break;
    case 4: drawCactus(); break;
    case 5: drawScorpion(); break;
    case 6: drawBeetle(); break;
    case 7: drawJellyfish(); break;
    case 8: drawCrab(); break;
    case 9: drawStarfish(); break;
    // New mob placeholders. The user is still drawing the detailed art, so
    // these reuse existing shapes as a sensible stand-in.
    case 10: drawWorkerAnt(); break; // Worker Ant — same ant shape as Soldier Ant
    case 11: drawSandstorm(); break;    // Sandstorm — procedural heptagons
    case 12: drawShell(); break;        // Shell — fan-shaped seashell
    // Spawner nests (stationary; drawHiveBody/drawAntHole/drawCrabCaveBody ignore angle and time).
    case 13: drawAntHole(); break;
    case 14: drawCrabCaveBody(); break;
    case 15: drawHiveBody(); break;
    case 16: drawHornet(); break;
    case 17: drawSpider(); break;
    // Shiny Ladybug — same crescent-shell artwork as the Ladybug, but with
    // the requested yellow palette (fill #ffff00, stroke #CCcc00).
    case 18: drawLadybug("#ffff00", "#CCcc00"); break;
    default: drawRock(); break;
  }

  // Friendly mobs are already unmistakable from their gold/yellow palette
  // (see the `friendly` colour branches in each drawer above), so no extra
  // ring is drawn around them.
}

// ============================================
// 花朵 / 默认皮肤绘制
// ============================================

export interface PlayerSkinState {
  spreadMode?: boolean;
  contractMode?: boolean;
  mousePosition?: { x: number; y: number };
  health?: number;
  maxHealth?: number;
  hurt?: number;
  spreadAnim?: number;
  contractAnim?: number;
  angle?: number;
  /**
   * Dead body on the ground: drawn petal-less with two 'x' eyes and a bitter
   * (frowning) mouth, waiting for a teammate's Yggdrasil to revive it.
   */
  dead?: boolean;
}
export function drawDefaultSkin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  player: PlayerSkinState = {},
) {
  const WIDTH = ctx.canvas?.width || 800;
  const HEIGHT = ctx.canvas?.height || 600;

  // 1. 身体绘制
  ctx.beginPath();
  ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
  ctx.fillStyle = "#999900";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
  ctx.fillStyle = player.hurt && player.hurt > 0 ? "#ff9d9d" : "#F6E476";
  ctx.fill();

  // 2. 角度计算
  let mouseX = player.mousePosition?.x;
  let mouseY = player.mousePosition?.y;
  if (mouseX === undefined || mouseY === undefined) {
    if (player.angle !== undefined) {
      mouseX = x + Math.cos(player.angle) * 100;
      mouseY = y + Math.sin(player.angle) * 100;
    } else {
      mouseX = WIDTH / 2;
      mouseY = HEIGHT / 2;
    }
  }
  const angleToMouse = Math.atan2(mouseY - y, mouseX - x);

  // 将缩放系数统一为 0.7
  const s = 0.7;

  // 模式平滑过度 (Animation / Smooth change)
  const targetSpread = player.spreadMode ? 1 : 0;
  const targetContract = player.contractMode ? 1 : 0;

  if (player.spreadAnim === undefined) player.spreadAnim = targetSpread;
  else player.spreadAnim += (targetSpread - player.spreadAnim) * 0.2;

  if (player.contractAnim === undefined) player.contractAnim = targetContract;
  else player.contractAnim += (targetContract - player.contractAnim) * 0.2;

  if (Math.abs(targetSpread - player.spreadAnim) < 0.005) player.spreadAnim = targetSpread;
  if (Math.abs(targetContract - player.contractAnim) < 0.005) player.contractAnim = targetContract;

  const wSpread = player.spreadAnim;
  const wContract = player.contractAnim;
  const wNormal = Math.max(0, 1 - wSpread - wContract);

  // 开启相对坐标系，将画布原点临时移到玩家中心 (x, y)
  ctx.save();
  ctx.translate(x, y);

  // --- Relative Size Constants ---
  // Use the 's' scaling factor defined above to maintain consistency
  const eyeX = radius/3.5;           // Horizontal eye offset
  const eyeY = radius/5;           // Vertical eye offset
  const eyeRadiusX = radius/13;   // Eye width radius
  const eyeRadiusY = radius/4;     // Eye height radius
  const pupilRadius = radius/8;  // Pupil radius
  const pupilOffset = radius/10;    // How much the pupil moves towards mouse

  const mouthWidth = radius/5;   // Half-width of mouth
  const mouthY = radius/2.5;         // Base Y position of mouth
  const mouthSmile = radius/8;   // Curve depth for smile
  const mouthFrown = radius/8;   // Curve depth for frown

  // 2. Eyes
  const eyePositions = [
    { x: -eyeX, y: -eyeY },
    { x: eyeX, y: -eyeY },
  ];

  const pOffX = Math.cos(angleToMouse) * pupilOffset;
  const pOffY = Math.sin(angleToMouse) * pupilOffset;

  // Dead body: two 'x' eyes + a bitter (frowning) mouth, no pupils.
  if (player.dead) {
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = Math.max(2, radius / 9);
    ctx.lineCap = "round";
    const xr = radius / 4.5; // half-size of each 'x'
    eyePositions.forEach((eye) => {
      ctx.beginPath();
      ctx.moveTo(eye.x - xr, eye.y - xr);
      ctx.lineTo(eye.x + xr, eye.y + xr);
      ctx.moveTo(eye.x + xr, eye.y - xr);
      ctx.lineTo(eye.x - xr, eye.y + xr);
      ctx.stroke();
    });
    ctx.restore(); // undo translate(x, y)
    // Bitter mouth: an upside-down (frowning) curve.
    ctx.save();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2.5 * s;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x - mouthWidth, y + mouthY);
    ctx.quadraticCurveTo(x, y + mouthY - mouthFrown * 1.4, x + mouthWidth, y + mouthY);
    ctx.stroke();
    ctx.restore();
    return;
  }

  eyePositions.forEach((eye) => {
    ctx.save();

    // 绘制黑色眼眶
    ctx.beginPath();
    ctx.ellipse(eye.x, eye.y, eyeRadiusX, eyeRadiusY, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#000000";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#000";
    ctx.stroke();

    // 设置裁剪区域
    ctx.beginPath();
    ctx.ellipse(eye.x, eye.y, eyeRadiusX, eyeRadiusY, 0, 0, Math.PI * 2);
    ctx.clip();

    // 瞳孔
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(eye.x + pOffX, eye.y + pOffY, pupilRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  });

  ctx.restore(); // Restore to draw mouth in world coordinates (or keep relative if preferred, below uses relative)

  // 3. 嘴巴（平滑地自上而下过渡，不绕圈旋转）
  // Note: Using local coordinates logic relative to (x,y)
  ctx.save();
  ctx.strokeStyle = "#000000";
  // Scale line width slightly with radius for better aesthetics on large/small blobs
  ctx.lineWidth = 2.5 * s;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();

  const cyOffset = mouthSmile * (1 - wSpread) - mouthFrown * wSpread;

  ctx.moveTo(x - mouthWidth, y + mouthY);
  ctx.quadraticCurveTo(x, y + mouthY + cyOffset, x + mouthWidth, y + mouthY);
  ctx.stroke();
  ctx.restore();
}


export function drawFlower(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  self: boolean,
  hurt: number,
) {
  drawDefaultSkin(ctx, x, y, radius, {
    spreadMode: false,
    contractMode: false,
    hurt,
  });
}

// ============================================
// 血条
// ============================================

export function healthBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  pct: number,
  color = "#57e36a",
) {
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fill();
  if (pct > 0) {
    roundRect(ctx, x + 2, y + 2, Math.max(2, (w - 4) * Math.max(0, Math.min(1, pct))), h - 4, (h - 4) / 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

// ============================================
// 花瓣受损遮罩 (petal damage overlay)
// ============================================

/**
 * Draws a "chipped away" damage overlay on top of a petal icon: the more
 * health the petal has lost, the taller the dark cover that creeps up from
 * the bottom of its sprite, with a subtle horizontal hatching so the
 * remaining health reads clearly at a glance.
 *
 * `damageRatio` is 0 (undamaged, no overlay) .. 1 (fully depleted, entirely
 * covered). `x`/`y` are the top-left corner of the square `size`x`size` area
 * the petal icon occupies.
 */
export function drawDamageOverlay(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  damageRatio: number,
) {
  const ratio = Math.max(0, Math.min(1, damageRatio));
  if (ratio <= 0 || size <= 0) return;

  const overlay = document.createElement("canvas");
  overlay.width = size;
  overlay.height = size;
  const overlayCtx = overlay.getContext("2d");
  if (!overlayCtx) return;

  const coverHeight = Math.floor(size * ratio);
  if (coverHeight > 0) {
    overlayCtx.fillStyle = "rgba(100, 100, 100, 0.5)";
    overlayCtx.fillRect(0, size - coverHeight, size, coverHeight);
    for (let i = 0; i < coverHeight; i++) {
      const alpha = 0.6 - (i * 0.4) / coverHeight;
      overlayCtx.strokeStyle = `rgba(0, 0, 0, ${alpha})`;
      overlayCtx.lineWidth = 1;
      overlayCtx.beginPath();
      overlayCtx.moveTo(0, size - i);
      overlayCtx.lineTo(size, size - i);
      overlayCtx.stroke();
    }
  }
  ctx.drawImage(overlay, x, y);
}

// ============================================
// 生物血条 / 稀有度标签 (fixed on-screen size)
// ============================================

export interface MobHealthLabelInfo {
  /** Label shown above the bar (mob/pet display name). */
  name: string;
  /** Current health, 0..1. */
  hpPct: number;
  /** Lagging "buffer" health used for the red damage-taken flash, 0..1. */
  displayHpPct: number;
  /** Index into `RARITIES`. */
  rarity: number;
  /** Friendly (player-owned) mobs use a gold fill instead of green. */
  friendly: boolean;
}

/**
 * Draws a name tag, capsule health bar (background + lagging red "damage
 * taken" buffer + current health fill + percentage readout) and a colored
 * rarity tag above a mob. Everything is sized in constant screen pixels: the
 * caller's world-space camera zoom is undone locally so the bar/text never
 * grow or shrink as the player zooms in or out.
 */
export function drawMobHealthLabel(
  ctx: CanvasRenderingContext2D,
  worldX: number,
  worldY: number,
  radius: number,
  viewScale: number,
  info: MobHealthLabelInfo,
) {
  const game = (window as any).gameInstance;
  const showEnhanced = game?.settings?.showEnhancedHealthBar !== false;
  const showRarity = game?.settings?.showRarity !== false;
  const isPotato = game?.settings?.photoHardware === true;

  const zoom = viewScale > 0 ? viewScale : 1;
  const rarityIndex = Math.max(0, Math.min(RARITIES.length - 1, info.rarity | 0));
  const rarity = RARITIES[rarityIndex];

  // 增强模式：大血条，普通模式：小血条
  const healthHeight = showEnhanced ? 16 : 6;
  const pillRadius = healthHeight / 2;
  const healthWidth = 60 + rarityIndex * 5;

  ctx.save();
  ctx.translate(worldX, worldY);
  ctx.scale(1 / zoom, 1 / zoom);

  const healthX = -healthWidth / 2;
  const healthY = radius * zoom + 10;

  // 名字（Potato模式用小字体）
  const fullName = info.name;
  const nameFontSize = isPotato ? 10 : 13;
  ctx.font = `${nameFontSize}px ${FONT_FAMILY}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  const maxNameWidth = healthWidth;
  if (ctx.measureText(fullName).width > maxNameWidth) {
    const adjustedSize = Math.max(7, nameFontSize * (maxNameWidth / ctx.measureText(fullName).width));
    ctx.font = `${adjustedSize}px ${FONT_FAMILY}`;
  }
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.strokeText(fullName, healthX, healthY - 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(fullName, healthX, healthY - 2);

  // 血条背景
  roundRect(ctx, healthX, healthY, healthWidth, healthHeight, pillRadius);
  ctx.fillStyle = "#000000";
  ctx.fill();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 4;
  ctx.stroke();

  // 血条内容
  ctx.save();
  roundRect(ctx, healthX, healthY, healthWidth, healthHeight, pillRadius);
  ctx.clip();

  const bufferPct = Math.max(0, Math.min(1, info.displayHpPct));
  const actualPct = Math.max(0, Math.min(1, info.hpPct));

  // 缓冲层（受击红色）
  if (bufferPct > 0) {
    ctx.fillStyle = "#ff4444";
    roundRect(ctx, healthX, healthY, healthWidth * bufferPct, healthHeight, pillRadius);
    ctx.fill();
  }
  // 当前血量
  if (actualPct > 0) {
    ctx.fillStyle = info.friendly ? "#FFD700" : "#7cfc00";
    roundRect(ctx, healthX, healthY, healthWidth * actualPct, healthHeight, pillRadius);
    ctx.fill();
  }
  ctx.restore();

  // 百分比文字（仅在增强模式且非Potato时显示）
  if (showEnhanced && !isPotato) {
    const pct = Math.round(actualPct * 100);
    ctx.font = `11px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.strokeText(`${pct}%`, 0, healthY + healthHeight / 2);
    ctx.fillStyle = "white";
    ctx.fillText(`${pct}%`, 0, healthY + healthHeight / 2);
  }

  // 稀有度标签（仅在显示稀有度且非Potato时显示）
  if (showRarity && !isPotato) {
    const rarityY = healthY + healthHeight + 2;
    const baseFontSize = 11;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";
    ctx.font = `${baseFontSize}px ${FONT_FAMILY}`;
    let textWidth = ctx.measureText(rarity.name).width;
    let fontSize = baseFontSize;
    if (textWidth > healthWidth) {
      fontSize = Math.max(8, baseFontSize * (healthWidth / textWidth));
      ctx.font = `${fontSize}px ${FONT_FAMILY}`;
    }
    textWidth = ctx.measureText(rarity.name).width;
    const maxX = healthWidth / 2;
    const minX = -healthWidth / 2;
    const finalX = Math.min(Math.max(0, minX), maxX - textWidth);
    ctx.strokeStyle = rarity.border;
    ctx.lineWidth = 2;
    ctx.strokeText(rarity.name, finalX, rarityY);
    ctx.fillStyle = rarity.color;
    ctx.fillText(rarity.name, finalX, rarityY);
  }

  ctx.restore();
}

// ============================================
// 缓动函数
// ============================================

export const ease = {
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2),
};

// =============================================================================
// Custom item renderers — world-space draw helpers
// =============================================================================

/** Faster: a small glowing white ball (like an iris but white). */
export function drawFaster(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, animTimer: number) {
  const r = radius * 0.7;
  ctx.save();
  ctx.translate(x, y);
  const glow = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.8);
  glow.addColorStop(0, 'rgba(255,255,255,0.6)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#cccccc';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-r * 0.3, -r * 0.3, r * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fill();
  ctx.restore();
}

/** Third Eye icon (for cards/inventory): a single eye with iris. */
export function drawThirdEyeIcon(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, animTimer: number) {
  // 如果 animTimer 传入的是时间戳，这里可以计算角度；如果 animTimer 已经是角度，则直接使用。
  // 这里假设 animTimer 就是你需要的角度值（弧度制）。
  const angle = animTimer;

  ctx.save();

  ctx.beginPath();
  ctx.ellipse(x, y, 3, 9, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#000000";
  ctx.fill();
    ctx.strokeStyle = "#000000";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.clip(); // 核心遮罩：之后绘制的内容只会显示在这个椭圆内部


  ctx.beginPath();
  const pupilX = x + Math.cos(angle) * 1.5;
  const pupilY = y + Math.sin(angle) * 3.0;
  ctx.arc(pupilX-1.5, pupilY, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();

  ctx.restore(); // 释放当前眼睛的遮罩，准备处理下一个
}


// =============================================================================
// Player body accessories — Antennae & Third Eye (drawn on body, not rotating)
// =============================================================================

/**
 * Draws Antennae on the player body. These do NOT rotate with the flower —
 * they stay fixed relative to the world, sticking up from the top of the head.
 */
export function drawPlayerAntennae(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, radius: number,
  rarity: number, time: number,
) {
  const scale = radius / 55;
  const sway = Math.sin(time * 2) * 0.06;
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const drawAntenna = (isLeft: boolean) => {
    const side = isLeft ? -1 : 1;
    ctx.save();
    ctx.translate(14 * scale * side, -62 * scale);
    ctx.rotate((Math.PI / 6) * side + sway * side);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-8 * scale, -30 * scale, 0, -70 * scale);
    ctx.quadraticCurveTo(8 * scale, -30 * scale, 0, 0);
    ctx.fillStyle = '#333333';
    ctx.fill();
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 5 * scale;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  };
  drawAntenna(true);
  drawAntenna(false);
  ctx.restore();
}

export function drawPlayerThirdEye(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, radius: number,
  rarity: number, time: number,
) {
  const eyeR = radius * 0.10;
  const eyeX = x;
  const eyeY = y - radius * 0.70;

  ctx.save();

  ctx.beginPath();
  ctx.ellipse(eyeX, eyeY, eyeR*0.8, eyeR * 2.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#000000";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#333333';
  ctx.stroke();

  ctx.clip();
  const moveX = Math.cos(time * 0.002) * (eyeR * 0.35);
  const moveY = Math.sin(time * 0.002) * (eyeR * 0.8);
  ctx.beginPath();
  ctx.arc(eyeX + moveX, eyeY + moveY, eyeR*1.2, 0, Math.PI * 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();


  ctx.restore();
}
