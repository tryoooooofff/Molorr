// Pure canvas2d drawing kit: every widget in this game is painted here.
import { ITEMS, MOBS, RARITIES } from "../shared/defs";
import type { Cell } from "../shared/sim";

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

/** Draw the artwork of an item (petal or summon). */
export function drawItemIcon(ctx: CanvasRenderingContext2D, itemId: number, x: number, y: number, size: number, spin = 0) {
  const def = ITEMS[itemId];
  if (!def) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);

  ctx.lineWidth = Math.max(1.5, size * 0.15);
  ctx.strokeStyle = def.outline;
  ctx.fillStyle = def.color;
  ctx.lineJoin = "round";

  if (def.name === "Wing") {
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.quadraticCurveTo(size * 0.5, 0, 0, size);
    ctx.quadraticCurveTo(size * 1.5, 0, 0, -size);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (def.name === "Sand") {
    const drawHexagon = (hx: number, hy: number, hr: number, rotateHex: boolean) => {
      ctx.save();
      ctx.translate(hx, hy);
      if (rotateHex) ctx.rotate(Math.PI / 6);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        const px = hr * Math.cos(a);
        const py = hr * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    const hexR = size * 0.45;
    const offset = size * 0.65;
    drawHexagon(-offset, 0, hexR, false);
    drawHexagon(offset, 0, hexR, false);
    drawHexagon(0, -offset, hexR, true);
    drawHexagon(0, offset, hexR, true);
    ctx.restore();
    return;
  }

  switch (def.shape) {
    case "leaf": {
      ctx.beginPath();
      ctx.moveTo(0, size * 1.2);
      ctx.quadraticCurveTo(-size * 1.2, 0, 0, -size * 1.2);
      ctx.quadraticCurveTo(size * 1.2, 0, 0, size * 1.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, size * 0.9);
      ctx.quadraticCurveTo(size * 0.2, 0, 0, -size * 0.8);
      ctx.lineCap = "round";
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, size * 1.2);
      ctx.lineTo(0, size * 1.5);
      ctx.stroke();
      break;
    }
    case "stick": {
      ctx.rotate(-Math.PI / 12);
      const drawBranch = () => {
        const r = (bx: number, by: number, bw: number, bh: number) => {
          roundRect(ctx, bx, by, bw, bh, size * 0.15);
        };
        ctx.save();
        r(-size * 0.2, -size * 0.1, size * 0.4, size * 1.8);
        ctx.restore();
        ctx.save();
        ctx.rotate(Math.PI / 6);
        r(-size * 0.2, -size * 1.5, size * 0.4, size * 1.5);
        ctx.restore();
        ctx.save();
        ctx.rotate(-Math.PI / 5);
        r(-size * 0.2, -size * 1.2, size * 0.4, size * 1.2);
        ctx.restore();
      };

      ctx.beginPath();
      drawBranch();
      ctx.fillStyle = ctx.strokeStyle = def.outline;
      ctx.lineWidth = size * 0.3;
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      drawBranch();
      ctx.fillStyle = ctx.strokeStyle = def.color;
      ctx.lineWidth = size * 0.05;
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "triangle": {
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.3);
      ctx.lineTo(-size * 0.5, size * 0.9);
      ctx.lineTo(size * 0.5, size * 0.9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "square": {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
        const rx = Math.cos(a) * size;
        const ry = Math.sin(a) * size;
        if (i === 0) ctx.moveTo(rx, ry);
        else ctx.lineTo(rx, ry);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "circle": {
      ctx.beginPath();
      ctx.arc(0, 0, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "egg": {
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.85, size * 1.15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
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
  }
  ctx.restore();
}

/** Inventory / hotbar card. */
export function drawCard(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  cell: Cell | null,
  opts: { hovered?: boolean; empty?: string; scale?: number; showName?: boolean; dim?: number } = {},
) {
  const scale = opts.scale ?? 1;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
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
  const rarity = RARITIES[cell.rarity] || RARITIES[0];
  
  // 1. 卡片外框（稀有度原色）
  roundRect(ctx, r.x, r.y, r.w, r.h, 8);
  ctx.fillStyle = rarity.color;
  ctx.fill();
  
  // 2. 卡片纯色内边底色（采用提亮后的单色平铺，无渐变/微光）
  roundRect(ctx, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 6);
  ctx.fillStyle = shade(rarity.color, 20);
  ctx.fill();

  // 3. 边框描边
  ctx.lineWidth = 3;
  ctx.strokeStyle = opts.hovered ? "#ffffff" : "rgba(0,0,0,0.35)";
  roundRect(ctx, r.x, r.y, r.w, r.h, 8);
  ctx.stroke();
  
  // 4. 图标与文字绘制
  drawItemIcon(ctx, cell.item, cx, cy - (opts.showName ? r.h * 0.08 : 0), Math.min(r.w, r.h) * 0.26);
  if (opts.showName !== false) {
    text(ctx, ITEMS[cell.item].name, cx, r.y + r.h - 11, Math.max(9, r.h * 0.16), "#ffffff");
  }
  if (cell.count > 1) {
    text(ctx, "x" + cell.count, r.x + r.w - 6, r.y + 11, Math.max(9, r.h * 0.16), "#ffffff", "right");
  }
  ctx.restore();
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

export const ease = {
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2),
};
