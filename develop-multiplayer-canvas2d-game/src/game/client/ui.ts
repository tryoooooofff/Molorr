// Pure canvas2d drawing kit: every widget in this game is painted here.
import { ITEMS, MOBS, RARITIES, getSummonCount } from "../shared/defs";
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
  // Basic (id: 0) - 永远 1 个
  if (itemId === 0) return 1;
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

/** One-shot success burst drawn over the craft slots. `t` goes 1 -> 0. */
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
// 核心绘制函数 - drawItemIcon (支持稀有度)
// ============================================

/** Draw the artwork of an item (petal or summon). */
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
  ctx.scale(0.8, 0.8);

  // Normalize each item's artwork so every icon occupies roughly the same
  // visual area and is centered on the cell. `k` scales the shape, while
  // (ox, oy) (in units of `size`) re-centers shapes whose geometry is offset.
  const ICON_NORM: Record<number, { k: number; ox: number; oy: number }> = {
    0: { k: 0.66, ox: 0, oy: 0.5 },      // Basic: shrink a bit + center the petal ring
    7: { k: 1.25, ox: 0.375, oy: 0 },    // Wing: enlarge + shift right (it sat too far left)
    9: { k: 1.25, ox: 0.15, oy: 0.28 },  // Stick: enlarge + re-center
    // Starfish at 85% of original 3x (2.55x) — reduced by 15% per request.
    // This applies consistently to its world petal, card, and drag artwork.
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
    case 0: { // Basic (Light)
      const count = getLightPetalCount(rarity);
      for(let i=0;i<count;i++){
        const a = (i * 2 * Math.PI / count) - Math.PI / 2;
        const px = size * 1.0 * Math.cos(a);
        const py = -size * 0.5 + size * 1.0 * Math.sin(a);
        ctx.beginPath();
        ctx.arc(px, py, size * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 1: { // Leaf
      ctx.beginPath();
      ctx.moveTo(0, size);
      ctx.quadraticCurveTo(-size, 0, 0, -size);
      ctx.quadraticCurveTo(size, 0, 0, size);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = size * 0.1;
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
      if (count === 1) {
        // A lone stinger triangle should sit in the middle of the icon
        // (pointing up), not off to the side facing the center.
        const R = size * 1.15;
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
          ctx.moveTo(0, size * 0.4);
          ctx.lineTo(-size * 0.5, size * 1.4);
          ctx.lineTo(size * 0.5, size * 1.4);
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
    case 11: { // Clover — three overlapping two-tone leaves around a dark hub
      // Authored with leaf ellipses 40x60 at r=65 plus a r=28 hub. The measured
      // ink box is 203x223 centered on (22.5, -0.5), so scale by its half-height
      // and shift by that offset to sit dead center in the cell.
      const k = (size * 1.2) / 111.5;
      ctx.save();
      ctx.scale(k, k);
      ctx.translate(-22.5, 0.5);
      const leaf = (a: number) => {
        ctx.save();
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(0, -65, 40, 60, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#2d6833";
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, -65, 30, 50, 0, 0, Math.PI * 2);
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
      // Authored in a 145px-tall space; its true ink center is (77.5, 83.5),
      // measured from the stroked path, so translate by that to center it.
      const k = (size * 2.2) / 145;
      ctx.save();
      ctx.scale(k, k);
      ctx.translate(-77.5, -83.5);
      ctx.beginPath();
      ctx.moveTo(70, 20);
      ctx.bezierCurveTo(120, 10, 155, 60, 125, 110);
      ctx.bezierCurveTo(95, 160, 70, 160, 70, 120);
      ctx.bezierCurveTo(70, 80, 20, 90, 20, 50);
      ctx.bezierCurveTo(20, 20, 40, 25, 70, 20);
      ctx.closePath();
      ctx.fillStyle = "#eade45";
      ctx.fill();
      ctx.lineWidth = 15;
      ctx.strokeStyle = "#a2901c";
      ctx.lineJoin = ctx.lineCap = "round";
      ctx.stroke();
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
    case 25: { // Lightning — a 10-point cyan star
      const k = (size * 1.2) / 60;
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
      ctx.lineWidth = 10;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 36: { // Iris — a single, notably small purple ball
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.52, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1.2, size * 0.12);
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
      ctx.translate(4.4, 8.3);
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
    case 35: { // Pincer — a curved claw blade
      const k = size / 32;
      ctx.save();
      ctx.scale(k, k);
      // Shifts the claw's drawing-space coordinates so it's centered on (0,0).
      ctx.translate(-92, -93);
      ctx.beginPath();
      ctx.moveTo(68, 76);
      ctx.quadraticCurveTo(120, 30, 116, 125);
      ctx.quadraticCurveTo(100, 72, 68, 76);
      ctx.closePath();
      ctx.fillStyle = "#2c353d";
      ctx.lineWidth = 8;
      ctx.strokeStyle = "#222222";
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.fill();
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
      ctx.lineWidth = size * 0.2;
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
    default: {
      switch (def.shape) {
        case "circle": {
          ctx.beginPath();
          ctx.arc(0, 0, size, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;
        }
        case "square": {
          roundRect(ctx, -size, -size, size * 2, size * 2, size * 0.3);
          ctx.fill();
          ctx.stroke();
          break;
        }
        case "egg": {
          const count = getSummonCount(def.id);
          const isCircleEgg = (def.id === 12 || def.id === 14);

          if (isCircleEgg) {
            // Draw circle arrangement
            const overlapPercent = 0.15 + 0.05 * count;
            const shapeRadius = size * 0.55; // Proportional radius
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
              ctx.stroke();
            }
          } else {
            // Draw narrow ellipse arrangement
            const overlapPercent = 0.15;
            const shapeRadius = size * 0.72; // Proportional radius for nice fit
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
              ctx.stroke();
            }
          }
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
  drawItemIcon(ctx, cell.item, cx, iconCy, iconSize, 0, cell.rarity);

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

    const fontSize = Math.max(14, Math.floor(18 * size / 70));
    ctx.font = `900 ${fontSize}px "Trebuchet MS", "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.translate(r.x + r.w - 10, r.y + 5);
    ctx.rotate(0.3);
    ctx.strokeStyle = "black";
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.strokeText(countStr, 0, 0);
    ctx.fillStyle = "white";
    ctx.fillText(countStr, 0, 0);

    ctx.restore();
  }

  // Reload overlay: darkens the card and drains a clockwise wedge as the petal
  // (or summon) comes back. Mirrors the classic florr reload sweep.
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
  const sl = 10 * totalScale, sw2 = 8 * totalScale;
  context.fillStyle = "#000";
  context.beginPath();
  context.moveTo(bx + 2, cy - sw2); // +2 像素确保没入身体内部
  context.lineTo(bx + 2, cy + sw2);
  context.lineTo(bx - sl, cy);
  context.closePath();
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
    context.arc(ex, ey, antennaTip, 0, Math.PI * 2); // 绝对居中
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
) {
  const def = MOBS[type];
  if (!def || radius <= 0) return;

  const css = (rgb: readonly number[] | string) => {
    if (typeof rgb === "string") return rgb;
    if (rgb.length >= 4) return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${rgb[3]})`;
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  };
  const rarityName = RARITIES[Math.max(0, Math.min(RARITIES.length - 1, rarity))]?.name ?? "Common";

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

  const drawAntAntenna = (
    ctx: CanvasRenderingContext2D,
    headX: number,
    headY: number,
    scale: number,
    animationTimer: number,
    antennaColor: readonly number[] | string,
  ) => {
    // Simple two-curve ant antennae: one quadratic curve to the right of the
    // head, one mirrored to the left. A small `jawRotation` opens and closes
    // them like mandibles; the `t` animation makes them wave gently.
    const baseRotation = Math.PI / 5; // ~36° half-spread when idle
    const swing = Math.sin(animationTimer * 8) * 0.08; // tiny breathing motion
    const jawRotation = baseRotation + swing;

    ctx.strokeStyle = css(antennaColor);
    ctx.lineWidth = Math.max(1.5, 2.2 * scale);
    ctx.lineCap = "round";

    // 1. Right antenna (rotated +jawRotation around the head).
    ctx.save();
    ctx.translate(headX, headY);
    ctx.rotate(jawRotation);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(25 * scale, 15 * scale, 55 * scale, 8 * scale);
    ctx.stroke();
    ctx.restore();

    // 2. Left antenna (mirrored).
    ctx.save();
    ctx.translate(headX, headY);
    ctx.rotate(-jawRotation);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(25 * scale, -15 * scale, 55 * scale, -8 * scale);
    ctx.stroke();
    ctx.restore();
  };

  const drawJellyfish = () => {
    const scaledSize = radius * 2.2;
    const BODY = friendly ? "rgba(255,215,0,0.8)" : "rgba(200,215,235,0.8)";
    const STROKE = friendly ? "rgba(255,235,120,0.85)" : "rgba(240,240,240,0.9)";
    const TENT = friendly ? "rgba(200,160,0,0.9)" : "rgba(220,230,245,0.85)";
    const scale = scaledSize / 180;
    const R = 80 * scale;
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
      const by = Math.sin(baseAngle) * R;
      const ex = Math.cos(baseAngle) * (R + 55 * scale) + Math.sin(baseAngle) * wave;
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
    ctx.lineWidth = 5 * scale;
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
    const scale = (radius * 2) / 110;
    const colors = friendly
      ? { body: "#ffe667", stroke: "#d1bb54", dark: "#333333", stingerColor: "#333333" }
      : { body: "#ffd363", stroke: "#d3ad46", dark: "#333333", stingerColor: "#333333" };
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const bodyW = 55 * scale;
    const bodyH = 75 * scale;
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
    bodyPath(hw - 3.5 * vf, hh - 3.5 * vf);
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
    const rarityMult = 1 + rarity * 0.15;
    const legWidthMult = 0.65 + rarity * 0.15;
    const clawSizeMult = 0.4 + rarity * 0.1;
    const scale = (radius * 2) / 90;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    const anim = t * 3;
    const drawLeg = (baseX: number, baseY: number, dirX: number, dirY: number, phase: number) => {
      const swing = Math.sin(anim * 2.6 + phase) * 0.25;
      const cos = Math.cos(swing), sin = Math.sin(swing);
      const lx = dirX * cos - dirY * sin;
      const ly = dirX * sin + dirY * cos;
      ctx.beginPath();
      ctx.moveTo(baseX * scale, baseY * scale);
      ctx.lineTo((baseX + lx * 0.7) * scale * rarityMult, (baseY + ly * 0.7) * scale * rarityMult);
      ctx.strokeStyle = css(limbColor);
      ctx.lineWidth = 4 * scale * legWidthMult;
      ctx.lineCap = "round";
      ctx.stroke();
    };
    [-1, 3, 7, 12].forEach((ly, i) => {
      const len = [7, 6, 6, 3][i];
      drawLeg(26, ly, len, (i - 1.5) * 3, i * 0.7);
      drawLeg(-26, ly, -len, (i - 1.5) * 3, i * 0.7);
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
      ctx.strokeStyle = "#111111";
      ctx.lineWidth = 3 * s;
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
    const visualScale = Math.sqrt(scale);
    const clawAngle = Math.sin(anim * 2.5) * 0.2;
    drawClaw(-visualScale * 25, -10, 1, clawAngle);
    drawClaw(visualScale * 25, -10, -1, clawAngle);
    const wFront = 160 * scale * rarityMult / 3;
    const wBack = 132 * scale * rarityMult / 3;
    const H = 95 * scale * rarityMult / 3;
    const r = 30 * scale * rarityMult / 3;
    const arc = 24 * scale * rarityMult / 3;
    const xFL = -wFront / 2, xFR = wFront / 2, xBL = -wBack / 2, xBR = wBack / 2;
    const yF = -H / 2, yB = H / 2;
    ctx.fillStyle = css(bodyColor);
    ctx.strokeStyle = css(bodyStrokeColor);
    ctx.lineWidth = 5 * scale * rarityMult / 2;
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
    ctx.lineWidth = 4 * scale * rarityMult / 3;
    [[-15, -20, -11, 8, -13, 22], [15, -20, 11, 8, 13, 22]].forEach(([ax, ay, bx, by, ex, ey]) => {
      const s = scale * rarityMult / 3;
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
    const headX = Math.cos(angle) * headRadius * 0.3;
    const headY = Math.sin(angle) * headRadius * 0.3;
    ctx.save();
    ctx.translate(x, y);
    drawAntAntenna(ctx, headX, headY, scaledSize / 22, t, antennaColor);
    drawCircle(-Math.cos(angle) * bodyRadius * 0.8, -Math.sin(angle) * bodyRadius * 0.8, bodyRadius, bodyColor);
    drawCircle(-Math.cos(angle) * bodyRadius * 0.8, -Math.sin(angle) * bodyRadius * 0.8, bodyRadius * 0.7, innerBodyColor);
    drawCircle(headX, headY, headRadius, bodyColor);
    drawCircle(headX, headY, headRadius * 0.7, innerBodyColor);
    ctx.restore();
  };

  const drawLadybug = () => {
    const scaledSize = radius * 2;
    const DEEP_RED = friendly ? "#B8860B" : "#8B0000";
    const DARK_RED = friendly ? "#DAA520" : "#A52A2A";
    const BLACK = "#000000";
    const BODY_OUTER_RADIUS = scaledSize * 0.5;
    const BODY_INNER_RADIUS = scaledSize * 0.44;
    const spots = [
      { xRatio: -0.36, yRatio: -0.28, radiusRatio: 0.18 },
      { xRatio: 0.34, yRatio: -0.20, radiusRatio: 0.16 },
      { xRatio: -0.22, yRatio: 0.20, radiusRatio: 0.15 },
      { xRatio: 0.30, yRatio: 0.28, radiusRatio: 0.19 },
      { xRatio: 0.02, yRatio: 0.00, radiusRatio: 0.13 },
    ];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.beginPath();
    ctx.arc(0, 0, BODY_OUTER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = DEEP_RED;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, BODY_INNER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = DARK_RED;
    ctx.fill();
    ctx.fillStyle = BLACK;
    for (const spot of spots) {
      ctx.beginPath();
      ctx.arc(BODY_INNER_RADIUS * spot.xRatio, BODY_INNER_RADIUS * spot.yRatio, BODY_INNER_RADIUS * spot.radiusRatio, 0, Math.PI * 2);
      ctx.fill();
    }
    const ellipseY = -BODY_INNER_RADIUS;
    const ellipseRx = BODY_INNER_RADIUS * 0.5;
    const ellipseRy = BODY_INNER_RADIUS * 0.3;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, ellipseY, ellipseRx, ellipseRy, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(0, ellipseY, ellipseRx + 1, ellipseRy + 1, 0, 0, Math.PI * 2);
    ctx.fillStyle = BLACK;
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, -5 * (scaledSize / 90), BODY_INNER_RADIUS, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(0, ellipseY, ellipseRx, ellipseRy, 0, 0, Math.PI * 2);
    ctx.strokeStyle = DEEP_RED;
    ctx.lineWidth = Math.max(1, 5 * (scaledSize / 90));
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  };

  const drawScorpion = () => {
    const scale = (radius * 2) / 100;
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
    const spikeCount = 18 + level * 2;
    const baseRadius = scaledSize * 0.6;
    const spikeHeight = scaledSize * 0.2;
    const currentBaseRadius = baseRadius + Math.sin(t * 3) * 1.5;
    const angleStep = (Math.PI * 2) / spikeCount;
    const spikeWidthFactor = 0.3;
    const tips: { x: number; y: number; angle: number }[] = [];
    ctx.save();
    for (let i = 0; i < spikeCount; i++) {
      const a = i * angleStep;
      tips.push({ x: x + Math.cos(a) * (currentBaseRadius + spikeHeight), y: y + Math.sin(a) * (currentBaseRadius + spikeHeight), angle: a });
    }
    ctx.fillStyle = "rgb(30,30,30)";
    const triHeight = scaledSize * 0.13;
    const triWidth = scaledSize * 0.1;
    const offsetDistance = spikeHeight * 0.6;
    for (const pos of tips) {
      ctx.save();
      ctx.translate(pos.x - Math.cos(pos.angle) * offsetDistance, pos.y - Math.sin(pos.angle) * offsetDistance);
      ctx.rotate(pos.angle);
      ctx.beginPath();
      ctx.moveTo(triHeight, 0);
      ctx.lineTo(0, -triWidth / 2);
      ctx.lineTo(0, triWidth / 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    for (let i = 0; i < spikeCount; i++) {
      const centerAngle = i * angleStep;
      const leftAngle = centerAngle - angleStep * spikeWidthFactor;
      const rightAngle = centerAngle + angleStep * spikeWidthFactor;
      const nextLeftAngle = (i + 1) * angleStep - angleStep * spikeWidthFactor;
      const leftX = x + Math.cos(leftAngle) * currentBaseRadius;
      const leftY = y + Math.sin(leftAngle) * currentBaseRadius;
      const rightX = x + Math.cos(rightAngle) * currentBaseRadius;
      const rightY = y + Math.sin(rightAngle) * currentBaseRadius;
      const nextLeftX = x + Math.cos(nextLeftAngle) * currentBaseRadius;
      const nextLeftY = y + Math.sin(nextLeftAngle) * currentBaseRadius;
      if (i === 0) ctx.moveTo(leftX, leftY);
      ctx.quadraticCurveTo(tips[i].x, tips[i].y, rightX, rightY);
      ctx.lineTo(nextLeftX, nextLeftY);
    }
    ctx.closePath();
    ctx.fillStyle = css(cactusColor);
    ctx.fill();
    ctx.strokeStyle = css(outlineColor);
    ctx.lineWidth = baseRadius * 0.1;
    ctx.lineJoin = "round";
    ctx.stroke();
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
    const scales: Record<string, number> = { Common: 1.0, Unusual: 1.2, Rare: 1.4, Epic: 1.6, Legendary: 1.8, Mythic: 2.0, Ultra: 2.3, Super: 2.6, Omega: 3.0, Eternal: 3.5 };
    const baseScale = radius * 2.2 * (scales[rarityName] || 1.0);
    const lightColor = friendly ? "rgb(255, 235, 120)" : "rgb(255, 150, 80)";
    const darkColor = friendly ? "rgb(255, 215, 0)" : "rgb(200, 90, 40)";
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * 5.2);
    const outerR = baseScale * 0.45;
    const innerR = baseScale * 0.14;
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

  switch (type) {
    case 0: drawLadybug(); break;
    case 1: drawBee(ctx, x, y, radius * 2, t, angle, level, 1.0, { isFriendly: friendly }); break;
    case 2: drawRock(); break;
    case 3: drawWorkerAnt(); break;
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
    default: drawRock(); break;
  }

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

  // 2. Eyes — plain black eye socket with a white pupil that shifts toward
  // the cursor, clipped inside the eye's ellipse.
  const eyePositions = [
    { x: -7, y: -5 },
    { x: 7, y: -5 },
  ];

  const pOffX = Math.cos(angleToMouse) * 2;
  const pOffY = Math.sin(angleToMouse) * 2;

  eyePositions.forEach((eye) => {
    ctx.save();

    // 绘制黑色眼眶
    ctx.beginPath();
    ctx.ellipse(eye.x, eye.y, 2.2, 6, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#000000";
    ctx.fill();

    // 设置裁剪区域
    ctx.beginPath();
    ctx.ellipse(eye.x, eye.y, 2.2, 6, 0, 0, Math.PI * 2);
    ctx.clip();

    // 瞳孔
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(eye.x + pOffX, eye.y + pOffY, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  });

  // 恢复画布到之前的状态
  ctx.restore();

  // 3. 嘴巴（平滑地自上而下过渡，不绕圈旋转）
  ctx.save();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();

  const baseMouthY = y + 8;
  const cyOffset = 3.5 * (1 - wSpread) - 3.5 * wSpread; 

  ctx.moveTo(x - 5.5, baseMouthY);
  ctx.quadraticCurveTo(x, baseMouthY + cyOffset, x + 5.5, baseMouthY);
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
  const zoom = viewScale > 0 ? viewScale : 1;
  const rarityIndex = Math.max(0, Math.min(RARITIES.length - 1, info.rarity | 0));
  const rarity = RARITIES[rarityIndex];

  const healthWidth = 60 + rarityIndex * 5;
  const healthHeight = 16;
  const pillRadius = healthHeight / 2;

  ctx.save();
  // Re-anchor on the mob's screen position, then undo the camera zoom so
  // every size below is expressed in fixed screen pixels.
  ctx.translate(worldX, worldY);
  ctx.scale(1 / zoom, 1 / zoom);

  const healthX = -healthWidth / 2;
  const healthY = radius * zoom + 10;

  // Name label.
  const fullName = info.name;
  let nameFontSize = 13;
  ctx.font = `${nameFontSize}px ${FONT_FAMILY}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  const maxNameWidth = healthWidth;
  if (ctx.measureText(fullName).width > maxNameWidth) {
    nameFontSize = Math.max(7, nameFontSize * (maxNameWidth / ctx.measureText(fullName).width));
    ctx.font = `${nameFontSize}px ${FONT_FAMILY}`;
  }
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.strokeText(fullName, healthX, healthY - 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(fullName, healthX, healthY - 2);

  // Health bar background.
  roundRect(ctx, healthX, healthY, healthWidth, healthHeight, pillRadius);
  ctx.fillStyle = "#000000";
  ctx.fill();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 5;
  ctx.stroke();

  // Fill layers, clipped to the capsule shape.
  ctx.save();
  roundRect(ctx, healthX, healthY, healthWidth, healthHeight, pillRadius);
  ctx.clip();

  const bufferPct = Math.max(0, Math.min(1, info.displayHpPct));
  const actualPct = Math.max(0, Math.min(1, info.hpPct));

  // Lagging red buffer (shows the chunk of health just lost).
  if (bufferPct > 0) {
    ctx.fillStyle = "#ff4444";
    roundRect(ctx, healthX, healthY, healthWidth * bufferPct, healthHeight, pillRadius);
    ctx.fill();
  }
  // Current health.
  if (actualPct > 0) {
    ctx.fillStyle = info.friendly ? "#FFD700" : "#7cfc00";
    roundRect(ctx, healthX, healthY, healthWidth * actualPct, healthHeight, pillRadius);
    ctx.fill();
  }
  ctx.restore();

  // Percentage readout.
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

  // Rarity tag, centered under the bar (shrinks to fit / never overflows it).
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
