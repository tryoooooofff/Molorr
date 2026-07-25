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

/** 绘制物品图标（支持 Light, Stick, Wing, Sand, Stinger, Rock, Leaf 等） */
export function drawItemIcon(ctx: CanvasRenderingContext2D, itemId: number, x: number, y: number, size: number, spin = 0) {
  const def = ITEMS[itemId];
  if (!def) return;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);

  // 基础样式
  ctx.lineWidth = Math.max(1.5, size * 0.15);
  ctx.strokeStyle = def.outline;
  ctx.fillStyle = def.color;
  ctx.lineJoin = "round";

  switch (def.shape) {
    case "leaf": {
      // 树叶轮廓
      ctx.beginPath();
      ctx.moveTo(0, size * 1.2);
      ctx.quadraticCurveTo(-size * 1.2, 0, 0, -size * 1.2);
      ctx.quadraticCurveTo(size * 1.2, 0, 0, size * 1.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 叶脉与叶柄
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

      // 描边底层
      ctx.beginPath();
      drawBranch();
      ctx.fillStyle = ctx.strokeStyle = def.outline;
      ctx.lineWidth = size * 0.3;
      ctx.fill();
      ctx.stroke();

      // 填充顶层
      ctx.beginPath();
      drawBranch();
      ctx.fillStyle = ctx.strokeStyle = def.color;
      ctx.lineWidth = size * 0.05;
      ctx.fill();
      ctx.stroke();
      break;
    }

    case "triangle": {
      // Stinger / 三角针刺
      const count = 1; // 可根据 rarity 动态增加数量
      for (let i = 0; i < count; i++) {
        ctx.save();
        ctx.rotate((i * 2 * Math.PI) / count - Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.3);
        ctx.lineTo(-size * 0.5, size * 0.9);
        ctx.lineTo(size * 0.5, size * 0.9);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      break;
    }

    case "square": {
      // Rock 五边形/多边形块
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
      if (def.name === "Sand") {
        // Sand 六边形组合
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
      } else {
        // 普通圆形 (Basic, Pearl 等)
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
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
// ui.ts

export function drawCard(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  cell: Cell | null,
  active = false,
  hover = false,
) {
  const r = 10;
  ctx.save();

  if (!cell || cell.item === 0) {
    // 空槽位：保持较暗的虚线框
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, r);
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.stroke();
    ctx.restore();
    return;
  }

  const rarity = RARITIES[cell.rarity] || RARITIES[0];

  // 1. 绘制外边框（稀有度主色）
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, r);
  ctx.fillStyle = rarity.color;
  ctx.fill();

  // 2. 绘制卡片内底色（将原来的负数 -34 改为更亮的值，或适当加亮）
  // 提高此处的亮度：由原先较暗的颜色提升为更亮、更鲜艳的色调
  const innerBg = shade(rarity.color, 15); // 调整为正值以提高底色亮度

  const pad = 4;
  roundRect(ctx, rect.x + pad, rect.y + pad, rect.w - pad * 2, rect.h - pad * 2, r - 2);
  ctx.fillStyle = innerBg;
  ctx.fill();

  // 可选：添加一层顶部微光（高光效果），让底色看起来更有质感且更亮
  ctx.save();
  roundRect(ctx, rect.x + pad, rect.y + pad, rect.w - pad * 2, (rect.h - pad * 2) * 0.45, r - 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
  ctx.fill();
  ctx.restore();

  // 3. 绘制 Hover 或选中高光
  if (hover || active) {
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, r);
    ctx.lineWidth = 3;
    ctx.strokeStyle = active ? "#ffffff" : "rgba(255, 255, 255, 0.7)";
    ctx.stroke();
  }

  // 4. 绘制物品图标与数量/名称
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2 - (rect.h > 60 ? 6 : 0);
  const iconSize = Math.min(rect.w, rect.h) * 0.28;

  drawItemIcon(ctx, cell.item, cx, cy, iconSize);

  if (cell.count > 1) {
    text(ctx, `x${cell.count}`, rect.x + rect.w - 6, rect.y + rect.h - 8, 12, "#ffffff", "right");
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
