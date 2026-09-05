// Shared irregular-wall geometry (client rendering AND server collision).
// ---------------------------------------------------------------------------
// The rectangle walls in defs.ts are rasterized to a grid, traced into
// contour loops, then perturbed with a deterministic hash noise. The result is
// the bumpy "irregular" wall outline the player sees and collides with.
//
// This module is the SINGLE source of truth for that outline: the canvas
// renderer (game.ts) and the authoritative player collider (sim.ts) both build
// from it, so visuals and collision can never drift apart. The C++ server
// (server-cpp/main.cpp) ports this exact algorithm step for step.
//
// Keep this file dependency-free (only `import type` from defs) so it runs in
// node, in the browser, and stays trivially portable to C++.

import type { Wall } from "./defs";

export interface WallPoint {
  x: number;
  y: number;
}

/** Noise knobs. MUST match on every implementation (TS client/server, C++). */
export const WALL_NOISE_PTS_PER_CELL = 1;
export const WALL_NOISE_BIG_AMP = 0.4;
export const WALL_NOISE_FINE_AMP = 0.2;
export const WALL_NOISE_BIG_FREQ = 0.08;
export const WALL_NOISE_FINE_FREQ = 1.8;

/**
 * Deterministic 2D hash noise in [0, 1). Pure integer bit-mixing: every
 * operation is on the low 32 bits, so the C++ port (uint32 arithmetic with
 * arithmetic right-shifts) produces bit-identical values.
 */
export function wallNoise(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h & 0x7fffffff) / 0x7fffffff;
}

/**
 * Rasterize AABB walls -> trace contour loops -> simplify -> deterministic
 * noise -> world-space polygons (each a closed loop, implicitly closed).
 *
 * The noise walks every simplified loop BACKWARDS (i = n-1 .. 0 toward the
 * previous vertex). Direction matters: the jitter is sampled at the
 * interpolated points, so forward vs backward traversal yields different
 * bumps. All implementations must use this same direction.
 */
export function buildWallPolygons(
  walls: Wall[],
  mapWidth: number,
  mapHeight: number,
  size = 256,
): WallPoint[][] {
  const cellW = mapWidth / size;
  const cellH = mapHeight / size;

  // 1. Rasterize wall rects into a binary grid.
  const grid = new Uint8Array(size * size);
  for (const w of walls) {
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

  // 2. Trace directed boundary edges into closed loops.
  const W = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && grid[y * size + x] === 1;

  const edgeMap = new Map<number, WallPoint>();
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

  const rawLoops: WallPoint[][] = [];
  const visited = new Set<number>();

  // Sorted start keys make loop discovery order deterministic across runtimes
  // (JS Map preserves insertion order, C++ unordered_map does not). For clean
  // wall boundaries every component is a simple cycle, so the start point only
  // rotates the loop and the final geometry is identical either way; the sort
  // is pure insurance for pathological (diagonally-touching) walls.
  const starts = [...edgeMap.keys()].sort((a, b) => a - b);
  for (const startKey of starts) {
    if (visited.has(startKey)) continue;
    const loop: WallPoint[] = [];
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

  // 3. Simplify: drop collinear middle points.
  const simplified = rawLoops.map((loop) => {
    const n = loop.length;
    const out: WallPoint[] = [];
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

  // 4. Deterministic noise, walking each loop backwards (client-identical).
  return simplified.map((loop) => {
    const pts: WallPoint[] = [];
    const n = loop.length;

    for (let i = n - 1; i >= 0; i--) {
      const p1 = loop[i];
      const p2 = loop[(i - 1 + n) % n];

      const horizontal = p1.y === p2.y;
      const len = horizontal ? Math.abs(p2.x - p1.x) : Math.abs(p2.y - p1.y);
      const steps = Math.max(1, Math.round(len * WALL_NOISE_PTS_PER_CELL));

      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const wx = p1.x + (p2.x - p1.x) * t;
        const wy = p1.y + (p2.y - p1.y) * t;

        let j = 0;
        if (s !== 0) {
          // Corners stay sharp (s === 0 keeps j = 0 at every vertex).
          const big =
            (wallNoise(
              Math.floor(wx * WALL_NOISE_BIG_FREQ * 1000),
              Math.floor(wy * WALL_NOISE_BIG_FREQ * 1000),
            ) -
              0.5) *
            2 *
            WALL_NOISE_BIG_AMP;
          const fine =
            (wallNoise(
              Math.floor(wx * WALL_NOISE_FINE_FREQ * 1000),
              Math.floor(wy * WALL_NOISE_FINE_FREQ * 1000),
            ) -
              0.5) *
            2 *
            WALL_NOISE_FINE_AMP;
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

/** Max noise displacement in px for a map (both amplitudes stacked). */
export function wallMaxJitterPx(mapWidth: number, mapHeight: number, size = 256): number {
  return (
    (WALL_NOISE_BIG_AMP + WALL_NOISE_FINE_AMP) *
    Math.min(mapWidth / size, mapHeight / size)
  );
}
