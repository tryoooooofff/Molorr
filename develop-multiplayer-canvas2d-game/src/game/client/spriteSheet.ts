/**
 * Item sprite sheet (icon atlas).
 * -------------------------------
 * `drawItemIcon` in ui.ts is a ~1000-line vector switch: every call re-runs
 * dozens of path/fill/stroke ops. Drawing it once per card per frame (bag,
 * crafting, loadout) and once per floating menu petal is a lot of CPU for
 * artwork that never changes.
 *
 * This module bakes each icon ONCE into a shared offscreen atlas, then blits it
 * with a single `drawImage`. The vector code stays the source of truth — the
 * atlas is produced by calling it — so the artwork cannot drift.
 *
 * Why caching is safe here: the icon geometry is a pure function of
 * (itemId, rarity, compact). Verified by inspection — `drawItemIcon` contains
 * no Date.now/performance.now, no Math.random, no gradients and no alpha
 * state; `spin` is applied by the CALLER as a rotation, so it is a draw-time
 * transform rather than part of the baked pixels.
 *
 * Only two inputs actually change the geometry (everything else is
 * item-identity):
 *   - rarity  -> item 2 (Stinger) and item 31 (Light) change their petal COUNT.
 *   - compact -> item 2 (Stinger) only.
 * So the atlas is keyed on the *effective* variant, and all other items
 * collapse to a single tile shared across all 11 rarities.
 */
import { ITEMS, RARITIES } from "../shared/defs";
import { drawItemIcon, setIconRenderer } from "./ui";

/** Items whose artwork changes with rarity (petal count). */
const RARITY_SENSITIVE = new Set<number>([2, 31]);
/** Items whose artwork changes with the `compact` flag. */
const COMPACT_SENSITIVE = new Set<number>([2]);

/**
 * Pixel size each tile is rendered at (CSS px; multiplied by DPR on the
 * backing store). Icons are shown at ≤ ~40 CSS px anywhere in the game (cards
 * ~18px, menu petals ~30px), so 96 gives comfortable headroom for downscaling
 * without wasting texture memory.
 */
const TILE = 96;
/** Padding around each tile so neighbours never bleed in when scaling. */
const PAD = 4;
/** Tiles per atlas row. */
const COLS = 10;

/**
 * Exact worst-case tile count: one tile per item, plus the extra variants the
 * two rarity/compact-sensitive items need. Computing it (rather than guessing)
 * guarantees the atlas can never run out of room and silently fall back.
 */
const MAX_TILES = (() => {
  let n = 0;
  for (const def of ITEMS) {
    if (!def) continue;
    const rarities = RARITY_SENSITIVE.has(def.id) ? RARITIES.length : 1;
    const compacts = COMPACT_SENSITIVE.has(def.id) ? 2 : 1;
    n += rarities * compacts;
  }
  return n;
})();

const ATLAS_ROWS = Math.max(1, Math.ceil(MAX_TILES / COLS));

/**
 * DPR is capped at 2 for the atlas. Beyond that the texture cost grows
 * quadratically for no visible gain at these icon sizes.
 */
const MAX_ATLAS_DPR = 2;

/**
 * `drawItemIcon` draws in a coordinate space where the shape extends roughly
 * ±2*size from the origin (it applies its own 0.8 scale, and some ICON_NORM
 * entries scale up to 2.55x). Rendering with this `size` inside a TILE-wide
 * cell leaves headroom for the largest artwork without clipping.
 */
const DRAW_SIZE = TILE / 5;

interface Tile { sx: number; sy: number; }

function isCanvasAvailable(): boolean {
  return typeof document !== "undefined" && typeof document.createElement === "function";
}

/**
 * Lazily-built atlas of every item icon. One instance is shared by the whole
 * client via `itemSprites`.
 */
export class ItemSpriteSheet {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private tiles = new Map<string, Tile>();
  /** Variants whose vector artwork threw while baking; permanently un-cached. */
  private broken = new Set<string>();
  private next = 0;
  /** Device pixel ratio the atlas was baked at, so it can be rebuilt on change. */
  private bakedDpr = 1;
  private failed = false;

  /** Collapses (item, rarity, compact) to the smallest key that still varies. */
  private key(itemId: number, rarity: number, compact: boolean): string {
    const r = RARITY_SENSITIVE.has(itemId) ? rarity : 0;
    const c = COMPACT_SENSITIVE.has(itemId) ? (compact ? 1 : 0) : 0;
    return `${itemId}:${r}:${c}`;
  }

  private ensureCanvas(dpr: number): boolean {
    if (this.failed || !isCanvasAvailable()) return false;
    if (this.canvas && this.bakedDpr === dpr) return true;

    // DPR changed (monitor switch / browser zoom): drop the atlas and re-bake
    // lazily at the new resolution so icons never look soft.
    const cell = TILE + PAD * 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(COLS * cell * dpr);
    canvas.height = Math.ceil(ATLAS_ROWS * cell * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      this.failed = true;
      return false;
    }
    ctx.scale(dpr, dpr);
    this.canvas = canvas;
    this.ctx = ctx;
    this.tiles.clear();
    this.next = 0;
    this.bakedDpr = dpr;
    return true;
  }

  /** Bakes one variant into the atlas and returns its tile, or null if it can't. */
  private bake(itemId: number, rarity: number, compact: boolean, dpr: number): Tile | null {
    if (!this.ensureCanvas(dpr)) return null;
    const k = this.key(itemId, rarity, compact);
    const hit = this.tiles.get(k);
    if (hit) return hit;
    if (this.broken.has(k)) return null;

    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return null;

    const cell = TILE + PAD * 2;
    if (this.next >= MAX_TILES) return null; // caller falls back to vector

    const col = this.next % COLS;
    const row = Math.floor(this.next / COLS);
    const sx = col * cell + PAD;
    const sy = row * cell + PAD;

    // A single item's artwork throwing (bad def, unsupported ctx method on an
    // exotic canvas impl) must not poison the atlas or leave the shared context
    // mid-save. Restore unconditionally and let this variant use the vector
    // path forever after.
    ctx.save();
    try {
      // Draw at the tile centre; drawItemIcon centres its artwork on the origin.
      ctx.translate(sx + TILE / 2, sy + TILE / 2);
      // spin=0: rotation is applied at blit time, so one tile serves every angle.
      drawItemIcon(ctx, itemId, 0, 0, DRAW_SIZE, 0, rarity, compact);
      ctx.restore();
    } catch {
      // The artwork threw part-way through, so it may have left unbalanced
      // save() calls on this SHARED context — every later tile would then be
      // drawn under a stale transform. There is no way to query the save depth,
      // so discard the whole atlas: surviving tiles re-bake lazily on demand.
      // `broken` persists across the rebuild, so the bad variant is never
      // retried and this can happen at most once per variant.
      this.broken.add(k);
      this.canvas = null;
      this.ctx = null;
      this.tiles.clear();
      this.next = 0;
      return null;
    }

    const tile = { sx, sy };
    this.tiles.set(k, tile);
    this.next++;
    return tile;
  }

  /**
   * Blits a cached icon. Signature mirrors `drawItemIcon` so it is a drop-in
   * replacement; returns false if the atlas is unavailable (headless canvas,
   * atlas full) so the caller can fall back to the vector path.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    itemId: number,
    x: number,
    y: number,
    size: number,
    spin = 0,
    rarity = 0,
    compact = false,
  ): boolean {
    if (!ITEMS[itemId]) return false;
    // Bake at the resolution the icon is actually shown at, so a big menu petal
    // is not upscaled from a small tile. Clamped so one huge icon can't force a
    // giant atlas.
    const dpr = Math.min(MAX_ATLAS_DPR, Math.max(1, (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1));
    const tile = this.bake(itemId, rarity, compact, dpr);
    if (!tile || !this.canvas) return false;

    // The tile holds artwork drawn at DRAW_SIZE; scale it to the requested size.
    const scale = size / DRAW_SIZE;
    const dw = TILE * scale;
    const dh = TILE * scale;

    ctx.save();
    ctx.translate(x, y);
    if (spin) ctx.rotate(spin);
    ctx.drawImage(
      this.canvas,
      tile.sx * this.bakedDpr,
      tile.sy * this.bakedDpr,
      TILE * this.bakedDpr,
      TILE * this.bakedDpr,
      -dw / 2,
      -dh / 2,
      dw,
      dh,
    );
    ctx.restore();
    return true;
  }

  /** Number of baked tiles — used by the perf test and the debug overlay. */
  get size(): number {
    return this.tiles.size;
  }
}

/** Shared atlas for the whole client. */
export const itemSprites = new ItemSpriteSheet();

/**
 * Drop-in replacement for `drawItemIcon` that prefers the atlas and falls back
 * to the vector renderer when the atlas is unavailable.
 */
export function drawItemSprite(
  ctx: CanvasRenderingContext2D,
  itemId: number,
  x: number,
  y: number,
  size: number,
  spin = 0,
  rarity = 0,
  compact = false,
) {
  if (itemSprites.draw(ctx, itemId, x, y, size, spin, rarity, compact)) return;
  drawItemIcon(ctx, itemId, x, y, size, spin, rarity, compact);
}

// Route ui.ts's icon() call sites (cards, etc.) through the atlas. Done here so
// the dependency stays one-way: spriteSheet -> ui, never the reverse.
setIconRenderer(drawItemSprite);
