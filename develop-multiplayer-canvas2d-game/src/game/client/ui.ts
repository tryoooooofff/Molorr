// Pure canvas2d drawing kit: every widget in this game is painted here.
import { ITEMS, MOBS, RARITIES } from "../shared/defs";
import type { Cell } from "../shared/sim";

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
  if (itemId === 0) return 1;      // Basic - 永远 1 个
  if (itemId === 6) return 1;      // Pearl - 永远 1 个
  if (itemId === 5) return 1;      // Bubble - 永远 1 个
  if (itemId === 4) return 4;      // Sand - 永远 4 个
  return -1;
}

// ============================================
// 基础绘图工具
// ============================================

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

export function scrollbar(ctx: CanvasRenderingContext2D, track: Rect, thumb: Rect, dragging: boolean) {
  roundRect(ctx, track.x, track.y, track.w, track.h, 3);
  ctx.fillStyle = "rgba(20,30,45,0.25)";
  ctx.fill();
  roundRect(ctx, thumb.x, thumb.y, thumb.w, thumb.h, 3);
  ctx.fillStyle = dragging ? "rgba(20,30,45,0.85)" : "rgba(20,30,45,0.6)";
  ctx.fill();
}

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

export function craftBurst(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, color: string) {
  if (t <= 0) return;
  const p = 1 - t;
  ctx.save();
  ctx.globalAlpha = t;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4 * t + 1;
  ctx.beginPath();
  ctx.arc(x, y, 20 + ease.outCubic(p) * 90, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + p * 1.2;
    const d = 24 + ease.outCubic(p) * 74;
    ctx.globalAlpha = t * 0.9;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 4 * t + 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ============================================
// 独立的图标绘制函数
// ============================================

/** Basic/Light - 圆形花瓣簇 (根据稀有度变化数量) */
function drawBasicIcon(
  ctx: CanvasRenderingContext2D,
  size: number,
  color: string,
  outline: string,
  rarity: number,
) {
  const count = getLightPetalCount(rarity);
  const cx = 0;
  const cy = 0;
  const orbit = size * 0.5;
  const radius = size * 0.4;

  for (let i = 0; i < count; i++) {
    const a = (i * Math.PI / (count / 2)) - Math.PI / 2;
    const x = cx + orbit * Math.cos(a);
    const y = cy + orbit * Math.sin(a);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = Math.max(2, size * 0.12);
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

/** Leaf - 叶子形状 */
function drawLeafIcon(
  ctx: CanvasRenderingContext2D,
  size: number,
  color: string,
  outline: string,
) {
  const s = size;

  ctx.beginPath();
  ctx.moveTo(0, s * 0.45);
  ctx.quadraticCurveTo(-s * 0.45, 0, 0, -s * 0.45);
  ctx.quadraticCurveTo(s * 0.45, 0, 0, s * 0.45);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(2, size * 0.08);
  ctx.strokeStyle = outline;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, -s * 0.3);
  ctx.quadraticCurveTo(s * 0.1, -s * 0.05, 0, s * 0.2);
  ctx.lineCap = 'round';
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = Math.max(1, size * 0.05);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, s * 0.45);
  ctx.lineTo(0, s * 0.7);
  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(2, size * 0.06);
  ctx.stroke();
}

/** Stinger - 三角形簇 (根据稀有度变化数量) */
function drawStingerIcon(
  ctx: CanvasRenderingContext2D,
  size: number,
  color: string,
  outline: string,
  rarity: number,
) {
  const count = getStingerPetalCount(rarity);
  const cx = 0;
  const cy = 0;

  for (let i = 0; i < count; i++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((i * 2 * Math.PI / count) - Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, size * 0.15);
    ctx.lineTo(-size * 0.25, size * 0.55);
    ctx.lineTo(size * 0.25, size * 0.55);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = Math.max(2, size * 0.08);
    ctx.stroke();
    ctx.restore();
  }
}

/** Rock - 五边形 */
function drawRockIcon(
  ctx: CanvasRenderingContext2D,
  size: number,
  color: string,
  outline: string,
) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i * 2 * Math.PI / 5) - Math.PI / 2;
    const r = size * 0.55;
    if (i === 0) ctx.moveTo(r * Math.cos(a), r * Math.sin(a));
    else ctx.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(2, size * 0.08);
  ctx.stroke();
}

/** Sand - 六边形簇 (固定4个) */
function drawSandIcon(
  ctx: CanvasRenderingContext2D,
  size: number,
  color: string,
  outline: string,
) {
  const cx = 0;
  const cy = 0;
  const r = size * 0.3;
  const offset = size * 0.45;

  drawHexagon(ctx, cx - offset, cy - offset, r, false, color, outline);
  drawHexagon(ctx, cx + offset, cy - offset, r, false, color, outline);
  drawHexagon(ctx, cx - offset, cy + offset, r, true, color, outline);
  drawHexagon(ctx, cx + offset, cy + offset, r, true, color, outline);
}

function drawHexagon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rotated: boolean,
  color: string,
  outline: string,
) {
  ctx.save();
  ctx.translate(x, y);
  if (rotated) ctx.rotate(Math.PI / 6);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    if (i === 0) ctx.moveTo(r * Math.cos(a), r * Math.sin(a));
    else ctx.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(2, r * 0.15);
  ctx.stroke();
  ctx.restore();
}

/** Bubble - 圆形带光泽 (单个) */
function drawBubbleIcon(
  ctx: CanvasRenderingContext2D,
  size: number,
  color: string,
  outline: string,
) {
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(2, size * 0.08);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-size * 0.15, -size * 0.2, size * 0.2, size * 0.12, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fill();
}

/** Pearl - 圆形带光泽和阴影 (单个) */
function drawPearlIcon(
  ctx: CanvasRenderingContext2D,
  size: number,
  color: string,
  outline: string,
) {
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(2, size * 0.08);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-size * 0.12, -size * 0.15, size * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(size * 0.1, size * 0.15, size * 0.15, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.1)";
  ctx.fill();
}

/** Wing - 翅膀形状 */
function drawWingIcon(
  ctx: CanvasRenderingContext2D,
  size: number,
  color: string,
  outline: string,
) {
  const s = size;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.35);
  ctx.quadraticCurveTo(s * 0.3, 0, 0, s * 0.35);
  ctx.quadraticCurveTo(s * 0.55, 0, 0, -s * 0.35);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(2, size * 0.08);
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** Egg - 蛋形 */
function drawEggIcon(
  ctx: CanvasRenderingContext2D,
  size: number,
  color: string,
  outline: string,
) {
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.02, size * 0.35, size * 0.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(2, size * 0.08);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-size * 0.1, -size * 0.15, size * 0.1, size * 0.15, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fill();
}

/** Stick - 树枝形状 */
function drawStickIcon(
  ctx: CanvasRenderingContext2D,
  size: number,
  color: string,
  outline: string,
) {
  const s = size;
  ctx.save();
  ctx.rotate(-Math.PI / 12);
  ctx.lineJoin = 'round';

  const drawBranches = () => {
    roundRect(ctx, -s * 0.12, -s * 0.04, s * 0.14, s * 0.7, s * 0.08);
    ctx.save();
    ctx.rotate(Math.PI / 6);
    roundRect(ctx, -s * 0.13, -s * 0.62, s * 0.14, s * 0.62, s * 0.08);
    ctx.restore();
    ctx.save();
    ctx.rotate(-Math.PI / 5);
    roundRect(ctx, -s * 0.13, -s * 0.48, s * 0.14, s * 0.48, s * 0.08);
    ctx.restore();
  };

  ctx.beginPath();
  drawBranches();
  ctx.fillStyle = outline;
  ctx.strokeStyle = outline;
  ctx.lineWidth = s * 0.12;
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  drawBranches();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.018;
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

/** Star - 星形 */
function drawStarIcon(
  ctx: CanvasRenderingContext2D,
  size: number,
  color: string,
  outline: string,
) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? size * 0.55 : size * 0.28;
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(2, size * 0.08);
  ctx.stroke();
}

// ============================================
// drawItemIcon - 根据 icon 字段调用对应函数
// ============================================

export function drawItemIcon(
  ctx: CanvasRenderingContext2D,
  itemId: number,
  x: number,
  y: number,
  size: number,
  spin = 0,
  rarity: number = 0,
) {
  const def = ITEMS[itemId];
  if (!def) return;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);

  const color = def.color;
  const outline = def.outline;

  switch (def.icon) {
    case "basic":
      drawBasicIcon(ctx, size, color, outline, rarity);
      break;
    case "leaf":
      drawLeafIcon(ctx, size, color, outline);
      break;
    case "stinger":
      drawStingerIcon(ctx, size, color, outline, rarity);
      break;
    case "rock":
      drawRockIcon(ctx, size, color, outline);
      break;
    case "sand":
      drawSandIcon(ctx, size, color, outline);
      break;
    case "bubble":
      drawBubbleIcon(ctx, size, color, outline);
      break;
    case "pearl":
      drawPearlIcon(ctx, size, color, outline);
      break;
    case "wing":
      drawWingIcon(ctx, size, color, outline);
      break;
    case "egg":
      drawEggIcon(ctx, size, color, outline);
      break;
    case "stick":
      drawStickIcon(ctx, size, color, outline);
      break;
    case "star":
      drawStarIcon(ctx, size, color, outline);
      break;
    default:
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = Math.max(2, size * 0.08);
      ctx.stroke();
  }

  ctx.restore();
}

// ============================================
// 卡片绘制
// ============================================

export function drawCard(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  cell: Cell | null,
  opts: { hovered?: boolean; empty?: string; scale?: number; showName?: boolean; dim?: number } = {},
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
    roundRect(ctx, r.x, r.y, r.w, r.h, 8);
    ctx.fillStyle = opts.hovered ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.28)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.stroke();
    if (opts.empty) text(ctx, opts.empty, cx, cy, 12, "rgba(255,255,255,0.5)");
    ctx.restore();
    return;
  }

  const rarity = RARITIES[Math.min(cell.rarity, RARITIES.length - 1)];
  const def = ITEMS[cell.item];

  roundRect(ctx, r.x, r.y, r.w, r.h, 8);
  ctx.fillStyle = rarity.color;
  ctx.fill();

  ctx.lineWidth = Math.max(3, size * 0.06);
  ctx.strokeStyle = shade(rarity.color, -80);
  ctx.stroke();

  if (opts.hovered) {
    ctx.lineWidth = Math.max(2, size * 0.04);
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    roundRect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, 6);
    ctx.stroke();
  }

  const iconSize = Math.min(r.w, r.h) * 0.18;
  drawItemIcon(ctx, cell.item, cx, cy - (opts.showName ? r.h * 0.06 : 0), iconSize, 0, cell.rarity);

  if (opts.showName !== false && def) {
    ctx.save();

    let itemName = def.name;
    const maxWidth = r.w * 0.92;
    const maxHeight = r.h * 0.22;
    const fontSizeBase = Math.min(maxHeight * 0.85, 16);

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
          if (itemName[i] === ' ') {
            splitPoint = i;
            break;
          }
        }
        if (splitPoint === mid) {
          for (let i = mid - 1; i > 0; i--) {
            if (itemName[i] === ' ') {
              splitPoint = i;
              break;
            }
          }
        }
        if (splitPoint === mid) {
          splitPoint = Math.floor(itemName.length / 2);
        }
        lines = [itemName.substring(0, splitPoint), itemName.substring(splitPoint + 1)];
      }
    } else {
      lines = [itemName];
    }

    let fontSize = lines.length > 1 ? Math.floor(maxHeight * 0.55) : Math.floor(maxHeight * 0.8);
    fontSize = Math.min(fontSize, fontSizeBase);

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

      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = Math.max(2, fontSize * 0.18);
      ctx.lineJoin = "round";
      ctx.strokeText(line, textX, textY);

      ctx.fillStyle = "#ffffff";
      ctx.fillText(line, textX, textY);
    });

    ctx.restore();
  }

  if (cell.count > 1) {
    ctx.save();

    let countStr = "x" + (cell.count >= 1000000 ? (cell.count / 1000000).toFixed(1) + 'M' :
                          cell.count >= 1000 ? (cell.count / 1000).toFixed(1) + 'K' :
                          cell.count);

    const fontSize = Math.max(12, Math.floor(18 * size / 70));
    ctx.font = `900 ${fontSize}px "Trebuchet MS", "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const centerX = r.x + r.w - 10;
    const centerY = r.y + 8;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(0.3);

    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = Math.max(3, fontSize * 0.22);
    ctx.lineJoin = "round";
    ctx.strokeText(countStr, 0, 0);

    ctx.fillStyle = "#ffffff";
    ctx.fillText(countStr, 0, 0);

    ctx.restore();
    ctx.restore();
  }

  ctx.restore();
}

// ============================================
// 怪物绘制
// ============================================

export function drawMob(
  ctx: CanvasRenderingContext2D,
  type: number,
  x: number,
  y: number,
  radius: number,
  angle: number,
  t: number,
  friendly: boolean,
) {
  const def = MOBS[type];
  if (!def) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineWidth = Math.max(2, radius * 0.14);
  ctx.strokeStyle = def.outline;
  const wob = Math.sin(t * 6 + x * 0.05) * radius * 0.05;

  const legs = (count: number, len: number) => {
    ctx.save();
    ctx.strokeStyle = "rgba(30,25,20,0.85)";
    ctx.lineWidth = Math.max(1.5, radius * 0.1);
    ctx.lineCap = "round";
    for (let i = 0; i < count; i++) {
      const a = -0.9 + (i / (count - 1)) * 1.8;
      const sw = Math.sin(t * 10 + i) * 0.18;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * radius * 0.5, side * radius * 0.4);
        ctx.lineTo(Math.cos(a + sw) * radius * len, side * radius * (0.4 + len * 0.6));
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  switch (def.shape) {
    case "bug": {
      legs(3, 1.15);
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * 0.92 + wob, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.beginPath();
      ctx.arc(radius * 0.55, 0, radius * 0.42, -Math.PI / 2, Math.PI / 2);
      ctx.fill();
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(-radius * 0.45 + (i % 2) * radius * 0.5, (i < 2 ? -1 : 1) * radius * 0.4, radius * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "wasp": {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      const flap = Math.sin(t * 30) * radius * 0.35;
      ctx.beginPath();
      ctx.ellipse(-radius * 0.1, -radius * 0.9 - flap, radius * 0.55, radius * 0.3, -0.4, 0, Math.PI * 2);
      ctx.ellipse(-radius * 0.1, radius * 0.9 + flap, radius * 0.55, radius * 0.3, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#1c1c1c";
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.ellipse(i * radius * 0.42, 0, radius * 0.14, radius * 0.78, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(-radius, -radius * 0.28);
      ctx.lineTo(-radius * 1.6, 0);
      ctx.lineTo(-radius, radius * 0.28);
      ctx.fill();
      break;
    }
    case "ant": {
      legs(3, 1.1);
      ctx.fillStyle = def.color;
      for (const [ox, rr] of [[-radius * 0.75, 0.55], [0, 0.62], [radius * 0.8, 0.5]] as const) {
        ctx.beginPath();
        ctx.arc(ox, 0, radius * rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case "rock": {
      ctx.fillStyle = def.color;
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const rr = radius * (0.82 + ((i * 37) % 10) / 40);
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "cactus": {
      ctx.fillStyle = def.color;
      roundRect(ctx, -radius * 0.45, -radius, radius * 0.9, radius * 2, radius * 0.4);
      ctx.fill();
      ctx.stroke();
      roundRect(ctx, -radius, -radius * 0.5, radius * 0.6, radius * 0.9, radius * 0.3);
      ctx.fill();
      ctx.stroke();
      roundRect(ctx, radius * 0.4, -radius * 0.3, radius * 0.6, radius * 0.9, radius * 0.3);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = Math.max(1, radius * 0.07);
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(-radius * 0.45, (i * radius) / 3);
        ctx.lineTo(-radius * 0.7, (i * radius) / 3);
        ctx.stroke();
      }
      break;
    }
    case "jelly": {
      ctx.fillStyle = def.color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(0, 0, radius, Math.PI, Math.PI * 2);
      ctx.lineTo(radius, radius * 0.2);
      ctx.quadraticCurveTo(0, radius * 0.55, -radius, radius * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = Math.max(1.5, radius * 0.12);
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo((i * radius) / 3, radius * 0.3);
        ctx.quadraticCurveTo(
          (i * radius) / 3 + Math.sin(t * 4 + i) * radius * 0.3,
          radius * 0.8,
          (i * radius) / 3 + Math.sin(t * 4 + i) * radius * 0.5,
          radius * 1.4,
        );
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case "crab": {
      legs(3, 1.0);
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * 0.78, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const claw = Math.sin(t * 5) * 0.2;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(radius * 0.85, side * radius * 0.7);
        ctx.rotate(side * (0.4 + claw));
        ctx.beginPath();
        ctx.ellipse(0, 0, radius * 0.42, radius * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = "#101010";
      ctx.beginPath();
      ctx.arc(radius * 0.35, -radius * 0.25, radius * 0.12, 0, Math.PI * 2);
      ctx.arc(radius * 0.35, radius * 0.25, radius * 0.12, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "star": {
      ctx.fillStyle = def.color;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const rr = i % 2 === 0 ? radius * 1.15 : radius * 0.48;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
  if (friendly) {
    ctx.save();
    ctx.strokeStyle = "rgba(120,255,160,0.85)";
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(x, y, radius + 8, t * 2, t * 2 + Math.PI * 1.6);
    ctx.stroke();
    ctx.restore();
  }
}

// ============================================
// 花朵绘制
// ============================================

export function drawFlower(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  self: boolean,
  hurt: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = hurt > 0 ? "#ff9d9d" : self ? "#ffe763" : "#ffd54a";
  ctx.fill();
  ctx.lineWidth = radius * 0.16;
  ctx.strokeStyle = "#d6ab27";
  ctx.stroke();
  ctx.fillStyle = "#1d1d1d";
  ctx.beginPath();
  ctx.ellipse(-radius * 0.32, -radius * 0.12, radius * 0.13, radius * 0.24, 0, 0, Math.PI * 2);
  ctx.ellipse(radius * 0.32, -radius * 0.12, radius * 0.13, radius * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = radius * 0.1;
  ctx.strokeStyle = "#1d1d1d";
  ctx.beginPath();
  ctx.arc(0, radius * 0.18, radius * 0.4, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.restore();
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
// 缓动函数
// ============================================

export const ease = {
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2),
};
