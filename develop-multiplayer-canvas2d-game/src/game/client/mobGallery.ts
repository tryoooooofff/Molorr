import {
  dropRarityChancesForMob,
  enemyDamageMult,
  enemyRarityMult,
  ITEMS,
  MAPS,
  MOBS,
  RARITIES,
} from "../shared/defs";
import { drawItemIcon, drawMob, FONT_FAMILY, Rect, roundRect } from "./ui";

/** The normal rarity ladder has ten display columns (Common through Eternal). */
const GALLERY_RARITY_COUNT = 10;
const MAX_VISIBLE_ROWS = 6;

type GalleryCell = { mobId: number; rarity: number };

interface GalleryLayout {
  panel: Rect;
  padding: number;
  headerHeight: number;
  slot: number;
  gap: number;
  itemHeight: number;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
  visibleRows: number;
}

const contains = (rect: Rect | null, x: number, y: number) =>
  !!rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;

/**
 * A self-contained, canvas-only bestiary for the main menu. It deliberately
 * uses the same mob and item renderers as the game world, so new mobs added to
 * `MOBS` automatically appear here without a duplicate sprite table.
 */
export class MobGallery {
  visible = false;

  private readonly cols = GALLERY_RARITY_COUNT;
  private currentBiome = "All";
  private biomeDropOpen = false;
  private search = "";
  private searchActive = false;
  private scrollY = 0;
  private maxScrollY = 0;
  private mouseX = 0;
  private mouseY = 0;
  private hovered: GalleryCell | null = null;

  private layout: GalleryLayout | null = null;
  private closeRect: Rect | null = null;
  private searchRect: Rect | null = null;
  private filterRect: Rect | null = null;
  private filterOptionRects: Array<{ biome: string; rect: Rect }> = [];
  private scrollThumb: Rect | null = null;
  private scrollTrack: Rect | null = null;
  private draggingScroll = false;
  private scrollDragStartY = 0;
  private scrollAtDragStart = 0;

  open() {
    this.visible = true;
    this.scrollY = 0;
    this.hovered = null;
    this.searchActive = false;
    this.biomeDropOpen = false;
    this.draggingScroll = false;
  }

  close() {
    this.visible = false;
    this.hovered = null;
    this.searchActive = false;
    this.biomeDropOpen = false;
    this.draggingScroll = false;
  }

  toggle() {
    if (this.visible) this.close();
    else this.open();
  }

  /** Persist collection progress independently from the normal character save. */
  recordKill(mobId: number, rarity: number) {
    if (!MOBS[mobId] || rarity < 0 || rarity >= this.cols || typeof localStorage === "undefined") return;
    const key = this.killKey(mobId, rarity);
    try {
      const count = Number.parseInt(localStorage.getItem(key) ?? "0", 10) || 0;
      localStorage.setItem(key, String(count + 1));
    } catch {
      // Collection tracking should never make gameplay depend on storage access.
    }
  }

  /** Handles search input and Escape while the gallery is open. */
  handleKey(key: string): boolean {
    if (!this.visible) return false;
    if (key === "Escape") {
      if (this.searchActive) this.searchActive = false;
      else this.close();
      return true;
    }
    if (!this.searchActive) return false;
    if (key === "Backspace") this.search = this.search.slice(0, -1);
    else if (key === "Enter") this.searchActive = false;
    else if (key.length === 1 && this.search.length < 24) this.search += key;
    else return true;
    this.scrollY = 0;
    this.hovered = null;
    return true;
  }

  handleMouseMove(x: number, y: number) {
    this.mouseX = x;
    this.mouseY = y;
    if (!this.visible || !this.layout) return;

    if (this.draggingScroll && this.scrollTrack && this.scrollThumb && this.maxScrollY > 0) {
      const maxDrag = this.scrollTrack.h - this.scrollThumb.h;
      if (maxDrag > 0) {
        const scrollDelta = ((y - this.scrollDragStartY) / maxDrag) * this.maxScrollY;
        this.scrollY = Math.max(0, Math.min(this.maxScrollY, this.scrollAtDragStart + scrollDelta));
      }
      return;
    }

    this.hovered = this.cellAtPoint(x, y);
  }

  handleMouseUp() {
    this.draggingScroll = false;
  }

  handleWheel(deltaY: number): boolean {
    if (!this.visible || !this.layout || !contains(this.layout.panel, this.mouseX, this.mouseY)) return false;
    this.updateScrollRange(this.layout, this.filteredMobs().length);
    const amount = Math.abs(deltaY) > 100 ? 60 : Math.abs(deltaY) < 30 ? 15 : 30;
    this.scrollY = Math.max(0, Math.min(this.maxScrollY, this.scrollY + (deltaY > 0 ? amount : -amount)));
    return true;
  }

  /** Returns true whenever the gallery consumed the click. */
  handleClick(x: number, y: number): boolean {
    if (!this.visible) return false;

    if (contains(this.closeRect, x, y)) {
      this.close();
      return true;
    }

    if (contains(this.filterRect, x, y)) {
      this.biomeDropOpen = !this.biomeDropOpen;
      this.searchActive = false;
      return true;
    }

    if (this.biomeDropOpen) {
      const selected = this.filterOptionRects.find(({ rect }) => contains(rect, x, y));
      if (selected) {
        this.currentBiome = selected.biome;
        this.scrollY = 0;
        this.hovered = null;
      }
      this.biomeDropOpen = false;
      return true;
    }

    if (contains(this.searchRect, x, y)) {
      this.searchActive = true;
      return true;
    }

    if (contains(this.scrollThumb, x, y)) {
      this.draggingScroll = true;
      this.scrollDragStartY = y;
      this.scrollAtDragStart = this.scrollY;
      return true;
    }

    if (!this.layout) return true;

    if (!contains(this.layout.panel, x, y)) {
      this.close();
      return true;
    }

    this.searchActive = false;
    return true;
  }

  draw(ctx: CanvasRenderingContext2D, time: number, viewW?: number, viewH?: number) {
    if (!this.visible) return;

    const w = viewW ?? Math.round(ctx.canvas.width / (window.devicePixelRatio || 1));
    const h = viewH ?? Math.round(ctx.canvas.height / (window.devicePixelRatio || 1));
    const layout = this.getLayout(w, h);
    this.layout = layout;
    const mobs = this.filteredMobs();
    this.updateScrollRange(layout, mobs.length);

    const { panel, padding, headerHeight, slot, gap, itemHeight, gridX, gridY, gridW, gridH, visibleRows } = layout;

    // Floating, bottom-left panel — the menu remains visible around it.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.48)";
    ctx.shadowBlur = 18;
    roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 14);
    ctx.fillStyle = "#e6e281";
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#8b864a";
    roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 14);
    ctx.stroke();

    this.drawTopUI(ctx, layout);

    ctx.save();
    ctx.beginPath();
    ctx.rect(gridX, gridY, gridW, gridH);
    ctx.clip();

    const firstRow = Math.floor(this.scrollY / itemHeight);
    const yOffset = -(this.scrollY % itemHeight);
    for (let row = 0; row < visibleRows + 2; row++) {
      const mob = mobs[firstRow + row];
      const y = gridY + row * itemHeight + yOffset;
      if (y + slot < gridY || y > gridY + gridH) continue;
      for (let col = 0; col < this.cols; col++) {
        const x = gridX + col * (slot + gap);
        this.drawSlot(ctx, x, y, slot, mob?.id, col, time);
      }
    }
    ctx.restore();

    this.drawScrollbar(ctx, layout, mobs.length);
    if (this.hovered && !this.draggingScroll && !this.biomeDropOpen) this.drawTooltip(ctx, this.hovered, w, h);
    // The expanded list must sit above the grid and tooltip.
    this.drawBiomeDropdown(ctx, layout);

    // Avoid an unused local when a caller narrows the layout implementation.
    void padding;
    void headerHeight;
  }

  private getLayout(canvasW: number, canvasH: number): GalleryLayout {
    const margin = Math.max(12, Math.min(20, Math.floor(Math.min(canvasW, canvasH) * 0.035)));
    const panelW = Math.max(280, Math.min(691, canvasW - margin * 2));
    const padding = panelW < 430 ? 10 : 14;
    const gap = panelW < 430 ? 3 : 7;
    const slot = Math.max(22, Math.min(60, Math.floor((panelW - padding * 2 - gap * (this.cols - 1)) / this.cols)));
    const headerHeight = panelW < 430 ? 56 : 60;
    const itemHeight = slot + gap;
    const maxGridHeight = Math.max(itemHeight * 2, canvasH - margin * 2 - headerHeight - padding);
    const visibleRows = Math.max(2, Math.min(MAX_VISIBLE_ROWS, Math.floor((maxGridHeight + gap) / itemHeight)));
    const gridW = this.cols * slot + (this.cols - 1) * gap;
    const gridH = visibleRows * slot + (visibleRows - 1) * gap;
    const panelH = headerHeight + gridH + padding;
    const panel: Rect = { x: margin, y: Math.max(margin, canvasH - panelH - margin), w: panelW, h: panelH };
    return {
      panel,
      padding,
      headerHeight,
      slot,
      gap,
      itemHeight,
      gridX: panel.x + padding,
      gridY: panel.y + headerHeight,
      gridW,
      gridH,
      visibleRows,
    };
  }

  private drawTopUI(ctx: CanvasRenderingContext2D, layout: GalleryLayout) {
    const { panel } = layout;
    const compact = panel.w < 430;
    const topY = panel.y + 8;
    const closeW = 28;
    const filterW = compact ? 80 : 100;
    const searchW = compact ? 105 : 140;
    const closeX = panel.x + panel.w - 16 - closeW;
    const filterX = closeX - 8 - filterW;

    this.searchRect = { x: panel.x + 10, y: topY, w: searchW, h: 27 };
    roundRect(ctx, this.searchRect.x, this.searchRect.y, this.searchRect.w, this.searchRect.h, 5);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fill();
    ctx.lineWidth = this.searchActive ? 2.5 : 2;
    ctx.strokeStyle = this.searchActive ? "#5a9cf0" : "#3b3b2b";
    ctx.stroke();
    ctx.save();
    ctx.font = `12px ${FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = this.search ? "#252525" : "#676767";
    const caret = this.searchActive && Math.floor(performance.now() / 500) % 2 === 0 ? "|" : "";
    ctx.fillText(this.truncate(ctx, this.search || "Search...", searchW - 16) + caret, this.searchRect.x + 8, topY + 14);
    ctx.restore();

    this.filterRect = { x: filterX, y: topY, w: filterW, h: 27 };
    roundRect(ctx, filterX, topY, filterW, 27, 5);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#3b3b2b";
    ctx.stroke();
    ctx.save();
    ctx.font = `12px ${FONT_FAMILY}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#252525";
    ctx.fillText(this.truncate(ctx, this.currentBiome, filterW - 24), filterX + 7, topY + 14);
    ctx.textAlign = "right";
    ctx.fillStyle = "#555";
    ctx.font = `10px ${FONT_FAMILY}`;
    ctx.fillText(this.biomeDropOpen ? "▲" : "▼", filterX + filterW - 7, topY + 14);
    ctx.restore();

    this.closeRect = { x: closeX, y: topY, w: closeW, h: 27 };
    roundRect(ctx, closeX, topY, closeW, 27, 5);
    ctx.fillStyle = "#d94b48";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#692b29";
    ctx.stroke();
    this.strokedText(ctx, "×", closeX + closeW / 2, topY + 14, 19, "#fff", "#6b1b1b", 2);

    this.strokedText(ctx, "Mob Gallery", panel.x + panel.w / 2, panel.y + 43, compact ? 13 : 16, "#fff", "#514f2a", 3);
  }

  private drawSlot(ctx: CanvasRenderingContext2D, x: number, y: number, slot: number, mobId: number | undefined, rarity: number, time: number) {
    roundRect(ctx, x, y, slot, slot, Math.max(4, slot * 0.13));
    ctx.fillStyle = "#d1cc6b";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#8b864a";
    ctx.stroke();
    if (mobId === undefined) return;

    const count = this.killCount(mobId, rarity);
    if (count <= 0) return;
    const rarityDef = RARITIES[rarity];
    if (!rarityDef) return;

    roundRect(ctx, x, y, slot, slot, Math.max(4, slot * 0.13));
    ctx.fillStyle = rarityDef.color;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = rarityDef.border;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    roundRect(ctx, x + 2, y + 2, slot - 4, slot - 4, Math.max(3, slot * 0.1));
    ctx.clip();
    drawMob(ctx, mobId, x + slot / 2, y + slot / 2, Math.max(7, slot * 0.31), 0, 0, false, rarity, 0);
    ctx.restore();

    const label = this.formatCount(count);
    if (!label) return;
    ctx.save();
    ctx.font = `${Math.max(8, Math.floor(slot * 0.19))}px ${FONT_FAMILY}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#1a1a1a";
    ctx.strokeText(label, x + slot - 4, y + 4);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x + slot - 4, y + 4);
    ctx.restore();
  }

  private drawScrollbar(ctx: CanvasRenderingContext2D, layout: GalleryLayout, mobCount: number) {
    if (mobCount <= layout.visibleRows) {
      this.scrollTrack = null;
      this.scrollThumb = null;
      return;
    }
    const track: Rect = {
      x: layout.panel.x + layout.panel.w - 12,
      y: layout.gridY,
      w: 4,
      h: layout.gridH,
    };
    const totalHeight = mobCount * layout.itemHeight - layout.gap;
    const handleH = Math.max(20, (layout.gridH / totalHeight) * track.h);
    const ratio = this.maxScrollY > 0 ? this.scrollY / this.maxScrollY : 0;
    const thumb: Rect = { x: track.x - 3, y: track.y + (track.h - handleH) * ratio, w: 10, h: handleH };
    this.scrollTrack = track;
    this.scrollThumb = thumb;

    ctx.fillStyle = "rgba(70,90,120,0.28)";
    ctx.fillRect(track.x, track.y, track.w, track.h);
    ctx.fillStyle = this.draggingScroll ? "rgba(40,55,75,0.9)" : "rgba(70,90,120,0.72)";
    ctx.fillRect(track.x, thumb.y, track.w, thumb.h);
  }

  private drawBiomeDropdown(ctx: CanvasRenderingContext2D, layout: GalleryLayout) {
    if (!this.biomeDropOpen || !this.filterRect) {
      this.filterOptionRects = [];
      return;
    }
    const options = this.biomes();
    const optH = 22;
    const listH = options.length * optH + 6;
    const listY = Math.max(6, this.filterRect.y - listH - 4);
    const rect: Rect = { x: this.filterRect.x, y: listY, w: this.filterRect.w, h: listH };

    ctx.save();
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 5);
    ctx.fillStyle = "rgba(18,25,34,0.96)";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.stroke();
    ctx.restore();

    this.filterOptionRects = [];
    options.forEach((biome, index) => {
      const option: Rect = { x: rect.x + 3, y: rect.y + 3 + index * optH, w: rect.w - 6, h: optH - 1 };
      this.filterOptionRects.push({ biome, rect: option });
      const selected = biome === this.currentBiome;
      const hovered = contains(option, this.mouseX, this.mouseY);
      if (selected || hovered) {
        ctx.fillStyle = selected ? "rgba(85,170,255,0.3)" : "rgba(255,255,255,0.1)";
        ctx.fillRect(option.x, option.y, option.w, option.h);
      }
      ctx.save();
      ctx.font = `11px ${FONT_FAMILY}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = selected ? "#79baff" : "rgba(255,255,255,0.9)";
      ctx.fillText(this.truncate(ctx, biome, option.w - 12), option.x + 6, option.y + option.h / 2);
      ctx.restore();
    });

    // Keep TypeScript aware that `layout` is intentionally part of the API;
    // it anchors the list to the current draw pass rather than stale geometry.
    void layout;
  }

  private drawTooltip(ctx: CanvasRenderingContext2D, cell: GalleryCell, viewW: number, viewH: number) {
    const mob = MOBS[cell.mobId];
    const rarity = RARITIES[cell.rarity];
    if (!mob || !rarity) return;

    const drops = mob.drops.map((drop) => ITEMS[drop.item]).filter((item): item is NonNullable<typeof item> => !!item);
    const width = Math.min(272, viewW - 16);
    const height = 134 + drops.length * 30;
    let x = this.mouseX - width - 16;
    let y = this.mouseY + 16;
    if (x < 8) x = Math.min(viewW - width - 8, this.mouseX + 16);
    if (y + height > viewH - 8) y = viewH - height - 8;
    y = Math.max(8, y);

    ctx.save();
    roundRect(ctx, x, y, width, height, 10);
    ctx.fillStyle = "rgba(15,15,25,0.93)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = rarity.border;
    ctx.stroke();

    this.strokedText(ctx, `${rarity.name} ${mob.name}`, x + 12, y + 17, 15, rarity.color, "#000", 3, "left");
    const kills = this.killCount(cell.mobId, cell.rarity);
    this.strokedText(ctx, `Defeated: ${this.formatCount(kills)}`, x + width - 12, y + 17, 11, "#fff", "#000", 2, "right");

    const health = Math.floor(mob.health * enemyRarityMult(cell.rarity));
    const damage = Math.floor(mob.damage * enemyDamageMult(cell.rarity));
    this.tooltipStat(ctx, "Health", this.formatValue(health), "#ff7777", x + 12, y + 42, width - 24);
    this.tooltipStat(ctx, "Damage", this.formatValue(damage), "#6baeff", x + 12, y + 61, width - 24);
    this.tooltipStat(ctx, "Speed", this.formatValue(mob.speed), "#ffd16b", x + 12, y + 80, width - 24);

    const chanceText = dropRarityChancesForMob(cell.rarity)
      .slice(0, 3)
      .map(({ rarity: dropRarity, chance }) => `${dropRarity} ${(chance * 100).toFixed(chance * 100 < 1 ? 2 : 0)}%`)
      .join("  ·  ");
    this.strokedText(ctx, "Drops on every defeat", x + 12, y + 104, 11, "#d6d6d6", "#000", 2, "left");
    this.strokedText(ctx, chanceText, x + 12, y + 119, 9, "#c6d8ff", "#000", 2, "left");

    drops.forEach((item, index) => {
      const rowY = y + 137 + index * 30;
      ctx.save();
      roundRect(ctx, x + 12, rowY - 11, 22, 22, 4);
      ctx.fillStyle = "#526b50";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#8db48c";
      ctx.stroke();
      drawItemIcon(ctx, item.id, x + 23, rowY, 10, 0, 0);
      ctx.restore();
      this.strokedText(ctx, item.name, x + 42, rowY, 11, "#fff", "#000", 2, "left");
    });
    ctx.restore();
  }

  private tooltipStat(ctx: CanvasRenderingContext2D, label: string, value: string, color: string, x: number, y: number, width: number) {
    this.strokedText(ctx, label, x, y, 12, color, "#000", 2, "left");
    this.strokedText(ctx, value, x + width, y, 12, "#fff", "#000", 2, "right");
  }

  private strokedText(
    ctx: CanvasRenderingContext2D,
    value: string,
    x: number,
    y: number,
    size: number,
    fill: string,
    stroke: string,
    lineWidth: number,
    align: CanvasTextAlign = "center",
  ) {
    ctx.save();
    ctx.font = `bold ${size}px ${FONT_FAMILY}`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke;
    ctx.strokeText(value, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(value, x, y);
    ctx.restore();
  }

  private cellAtPoint(x: number, y: number): GalleryCell | null {
    const layout = this.layout;
    if (!layout || this.biomeDropOpen || !contains({ x: layout.gridX, y: layout.gridY, w: layout.gridW, h: layout.gridH }, x, y)) return null;
    const col = Math.floor((x - layout.gridX) / layout.itemHeight);
    const row = Math.floor((y - layout.gridY + this.scrollY) / layout.itemHeight);
    const slotX = layout.gridX + col * layout.itemHeight;
    const slotY = layout.gridY + row * layout.itemHeight - this.scrollY;
    if (col < 0 || col >= this.cols || x > slotX + layout.slot || y > slotY + layout.slot) return null;
    const mob = this.filteredMobs()[row];
    if (!mob || this.killCount(mob.id, col) <= 0) return null;
    return { mobId: mob.id, rarity: col };
  }

  private filteredMobs() {
    const search = this.search.trim().toLowerCase();
    const map = MAPS.find((entry) => entry.name === this.currentBiome);
    return MOBS
      .filter((mob) => {
        if (map && !map.mobs.includes(mob.id)) return false;
        return !search || mob.name.toLowerCase().includes(search);
      })
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private biomes() {
    return ["All", ...MAPS.map((map) => map.name)];
  }

  private updateScrollRange(layout: GalleryLayout, mobCount: number) {
    const totalHeight = Math.max(0, mobCount * layout.itemHeight - layout.gap);
    this.maxScrollY = Math.max(0, totalHeight - layout.gridH);
    this.scrollY = Math.max(0, Math.min(this.maxScrollY, this.scrollY));
  }

  private killKey(mobId: number, rarity: number) {
    return `petalia.mob_kill_${mobId}_${rarity}`;
  }

  private killCount(mobId: number, rarity: number) {
    if (typeof localStorage === "undefined") return 0;
    try {
      return Number.parseInt(localStorage.getItem(this.killKey(mobId, rarity)) ?? "0", 10) || 0;
    } catch {
      return 0;
    }
  }

  private truncate(ctx: CanvasRenderingContext2D, value: string, maxWidth: number) {
    if (ctx.measureText(value).width <= maxWidth) return value;
    let text = value;
    while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
    return `${text}…`;
  }

  private formatCount(value: number) {
    if (value <= 0) return "";
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return `x${value}`;
  }

  private formatValue(value: number) {
    if (!Number.isFinite(value)) return "0";
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return Math.floor(value).toLocaleString();
  }
}
