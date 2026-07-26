/**
 * QuickSlot — dual-row hotbar (main row + secondary/backup row).
 *
 * This is purely a *view + hit-testing* layer over the authoritative cell data
 * owned by GameClient. It holds no items of its own: the main row renders
 * `host.mainCells()` and the secondary row renders `host.secondaryCells()`,
 * both of which come straight from the server's INVENTORY packet. Every
 * mutation (drag, swap, hotkey) is routed back through the host so the server
 * stays the single source of truth.
 *
 * Layout
 *   Main row      : larger cards (the petals actually orbiting the flower).
 *   Secondary row : smaller cards sitting just below, pure standby storage.
 *
 * Hotkeys (handled by GameClient, executed here)
 *   R      — swap the entire main row with the entire secondary row.
 *   1 – 8  — swap a single slot with its secondary partner.
 */

import { ITEMS, SECONDARY_SLOT_COUNT, SLOT_COUNT } from "../shared/defs";
import type { Cell } from "../shared/sim";
import { drawCard, hit, Rect, text } from "./ui";

/** Everything QuickSlot needs from the game client. */
export interface QuickSlotHost {
  /** Canvas width in CSS pixels. */
  viewWidth(): number;
  /** Canvas height in CSS pixels. */
  viewHeight(): number;
  /** Live main-row cells (length SLOT_COUNT). */
  mainCells(): (Cell | null)[];
  /** Live secondary-row cells (length SECONDARY_SLOT_COUNT). */
  secondaryCells(): (Cell | null)[];
  /** Reload progress 0..1 per main slot (1 = ready). */
  reloadProgress(slot: number): number;
  /** Remaining health 0..1 per main slot (1 = full health). */
  slotHp(slot: number): number;
  /** Flat cell index currently being dragged, or -1. */
  draggingFrom(): number;
  /** Ask the server to swap one main slot with its secondary partner. */
  requestSwapSlot(slot: number): void;
  /** Ask the server to swap both rows wholesale. */
  requestSwapAll(): void;
  /** Draw the shared item tooltip at a screen point. */
  drawTooltip(cell: Cell, x: number, y: number): void;
}

export class QuickSlot {
  private host: QuickSlotHost;

  mouseX = 0;
  mouseY = 0;

  // Sizing. The main row is deliberately chunkier than the backup row so the
  // two are never confused at a glance.
  MAIN_MAX_SIZE = 66;
  MAIN_GAP = 8;
  SECONDARY_SCALE = 0.62;
  SECONDARY_GAP = 6;
  /** Vertical gap between the two rows. */
  ROW_GAP = 6;
  /** Distance from the bottom of the canvas to the bottom of the secondary row. */
  BOTTOM_MARGIN = 14;

  constructor(host: QuickSlotHost) {
    this.host = host;
  }

  // -----------------------------------------------------------------------
  // Layout
  // -----------------------------------------------------------------------

  /**
   * Both rows are centred horizontally and stacked bottom-up: the secondary
   * row hugs the bottom edge and the main row sits directly above it.
   */
  private layout() {
    const w = this.host.viewWidth();
    const h = this.host.viewHeight();
    const isMobile = w < 640 || /Mobi|Android/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "");

    // On phone, make hotbar slots slightly larger for touch, and lift a bit for joystick clearance
    const mainSize = Math.min(this.MAIN_MAX_SIZE + (isMobile ? 8 : 0), isMobile ? w / 9.5 : w / 12);
    const secSize = Math.max(isMobile ? 22 : 18, Math.round(mainSize * this.SECONDARY_SCALE));

    const mainTotal = SLOT_COUNT * mainSize + (SLOT_COUNT - 1) * this.MAIN_GAP;
    const secTotal = SECONDARY_SLOT_COUNT * secSize + (SECONDARY_SLOT_COUNT - 1) * this.SECONDARY_GAP;

    const bottomMargin = this.BOTTOM_MARGIN + (isMobile ? 6 : 0);
    const secY = h - bottomMargin - secSize;
    const mainY = secY - this.ROW_GAP - mainSize;

    return {
      mainSize,
      secSize,
      mainX: (w - mainTotal) / 2,
      secX: (w - secTotal) / 2,
      mainY,
      secY,
    };
  }

  /** Rects of the main row, index-aligned with the main cells. */
  mainRects(): Rect[] {
    const l = this.layout();
    return new Array(SLOT_COUNT).fill(0).map((_, i) => ({
      x: l.mainX + i * (l.mainSize + this.MAIN_GAP),
      y: l.mainY,
      w: l.mainSize,
      h: l.mainSize,
    }));
  }

  /** Rects of the secondary row, index-aligned with the secondary cells. */
  secondaryRects(): Rect[] {
    const l = this.layout();
    return new Array(SECONDARY_SLOT_COUNT).fill(0).map((_, i) => ({
      x: l.secX + i * (l.secSize + this.SECONDARY_GAP),
      y: l.secY,
      w: l.secSize,
      h: l.secSize,
    }));
  }

  /** Total height both rows occupy, so panels can avoid overlapping them. */
  height(): number {
    const l = this.layout();
    return this.host.viewHeight() - l.mainY;
  }

  /**
   * Flat cell index at a screen point, or -1. Main slots map to 0..SLOT_COUNT-1
   * and secondary slots to SLOT_COUNT..HOTBAR_CELLS-1, matching the shared
   * address space the server uses.
   */
  cellIndexAtPoint(x: number, y: number): number {
    const main = this.mainRects();
    for (let i = 0; i < main.length; i++) if (hit(main[i], x, y)) return i;
    const sec = this.secondaryRects();
    for (let i = 0; i < sec.length; i++) if (hit(sec[i], x, y)) return SLOT_COUNT + i;
    return -1;
  }

  // -----------------------------------------------------------------------
  // Input
  // -----------------------------------------------------------------------

  handleMouseMove(x: number, y: number) {
    this.mouseX = x;
    this.mouseY = y;
  }

  /** Swap a single main slot with its secondary partner. */
  swapSlot(slotIndex: number) {
    if (slotIndex < 0 || slotIndex >= Math.min(SLOT_COUNT, SECONDARY_SLOT_COUNT)) return;
    this.host.requestSwapSlot(slotIndex);
  }

  /** Swap the whole main row with the whole secondary row. */
  swapAllSlots() {
    this.host.requestSwapAll();
  }

  // -----------------------------------------------------------------------
  // Drawing
  // -----------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D) {
    const mainCells = this.host.mainCells();
    const secCells = this.host.secondaryCells();
    const dragFrom = this.host.draggingFrom();
    const dragging = dragFrom >= 0;

    // Tooltip target is resolved while drawing and painted last, on top.
    let hoverCell: Cell | null = null;

    // ── Main row ──
    this.mainRects().forEach((r, i) => {
      const cell = mainCells[i] ?? null;
      const hovered = hit(r, this.mouseX, this.mouseY);
      if (hovered && cell && !dragging) hoverCell = cell;
      drawCard(ctx, r, cell, {
        hovered,
        empty: `${i + 1}`,
        dim: dragFrom === i ? 0.35 : 1,
        reload: this.host.reloadProgress(i),
        hp: this.host.slotHp(i),
      });
      if (cell && ITEMS[cell.item]?.kind === "summon") {
        text(ctx, "SUMMON", r.x + r.w / 2, r.y + 12, 9, "#ffe763");
      }
    });

    // ── Secondary row ──
    this.secondaryRects().forEach((r, i) => {
      const cell = secCells[i] ?? null;
      const idx = SLOT_COUNT + i;
      const hovered = hit(r, this.mouseX, this.mouseY);
      if (hovered && cell && !dragging) hoverCell = cell;
      drawCard(ctx, r, cell, {
        hovered,
        // Backup cards are small, so their name band is dropped to keep the
        // icon readable.
        showName: false,
        dim: dragFrom === idx ? 0.35 : 1,
      });
    });

    // Hint so players know the rows are swappable.
    const l = this.layout();
    text(
      ctx,
      `R swap all  ·  1-${SLOT_COUNT} swap one`,
      this.host.viewWidth() / 2,
      l.secY + l.secSize + 9,
      10,
      "rgba(255,255,255,0.45)",
    );

    if (hoverCell) this.host.drawTooltip(hoverCell, this.mouseX + 14, this.mouseY - 10);
  }
}
