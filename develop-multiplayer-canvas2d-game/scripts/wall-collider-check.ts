// Regression + perf check for the detailed player wall collider.
// Run: npx tsx scripts/wall-collider-check.ts
import { BLOCK_GRID_COLS, BLOCK_GRID_ROWS, findSpawnTiles, MAPS } from "../src/game/shared/defs";
import { GameServer, PLAYER_RADIUS, PolygonWallCollider } from "../src/game/shared/sim";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
}

// ---------------------------------------------------------------------------
// 1. Full integration: GameServer constructs every map's player collider.
// ---------------------------------------------------------------------------
const tBuild0 = performance.now();
const game = new GameServer();
const tBuild1 = performance.now();
console.log(`GameServer constructed in ${(tBuild1 - tBuild0).toFixed(1)}ms`);
check("server constructs", !!game);

// Access the (private) player colliders for direct probing.
const colliders = (game as unknown as { playerWallColliders: PolygonWallCollider[] })
  .playerWallColliders;
check("player collider per map", colliders.length === MAPS.length, `${colliders.length} maps`);
const r = PLAYER_RADIUS;

// ---------------------------------------------------------------------------
// 2. Behavior per map.
// ---------------------------------------------------------------------------
for (const map of MAPS) {
  const c = colliders[map.id];
  console.log(`--- map ${map.id} ${map.name}: edges=${c.edgeCount}`);

  if (map.walls.length === 0) {
    const [x, y] = c.collideCircle(4000, 4000, r);
    check(`${map.name}: empty map passthrough`, x === 4000 && y === 4000);
    check(`${map.name}: empty map needsPrecise=false`, !c.circleNeedsPreciseCheck(4000, 4000, r));
    continue;
  }

  // 2a. Far-from-wall point: untouched, cheap early-out, free.
  // Random-scan for a verified-open probe (fixed round numbers often sit on
  // wall faces, and Ocean is wall-dense).
  let farX = -1;
  let farY = -1;
  let probeSeed = 777 + map.id * 1000;
  const probeRnd = () => {
    probeSeed = (probeSeed * 1103515245 + 12345) & 0x7fffffff;
    return probeSeed / 0x7fffffff;
  };
  for (let tries = 0; tries < 500 && farX < 0; tries++) {
    const cx = 300 + probeRnd() * (map.width - 600);
    const cy = 300 + probeRnd() * (map.height - 600);
    if (c.isFree(cx, cy, r) && !c.circleNeedsPreciseCheck(cx, cy, r)) {
      farX = cx;
      farY = cy;
    }
  }
  if (farX >= 0) {
    const [fx, fy] = c.collideCircle(farX, farY, r);
    check(`${map.name}: far point untouched`, fx === farX && fy === farY);
    check(`${map.name}: far point needsPrecise=false`, !c.circleNeedsPreciseCheck(farX, farY, r));
  } else {
    check(`${map.name}: found open probe point`, false, "no free candidate");
  }

  // 2b. Deep inside an INTERIOR wall rect: ejected out (safety net), then free.
  // (Border walls would eject outside the map — same as the old collider, but
  // a poor probe; movement clamps handle that case in gameplay.)
  const w0 =
    map.walls.find((w) => w.x > 500 && w.y > 500 && w.x + w.w < map.width - 500 && w.y + w.h < map.height - 500) ??
    map.walls[0];
  const inX = w0.x + w0.w / 2;
  const inY = w0.y + w0.h / 2;
  check(`${map.name}: deep-inside needsPrecise=true`, c.circleNeedsPreciseCheck(inX, inY, r));
  check(`${map.name}: deep-inside isFree=false`, !c.isFree(inX, inY, r));
  const [ex, ey] = c.collideCircle(inX, inY, r);
  const moved = Math.abs(ex - inX) + Math.abs(ey - inY);
  check(`${map.name}: deep-inside ejected`, moved > 1, `moved ${moved.toFixed(1)}px`);
  check(`${map.name}: ejected spot is free`, c.isFree(ex, ey, r));

  // 2c. Detailed (bumpy), not flat: resolve points hugging a long wall face and
  // confirm the resting boundary varies along the face (noise bumps).
  // Use the top border wall (y=0..400 on every map): probe below its bottom face.
  const topWall = map.walls.find((w) => w.y === 0 && w.w >= 4000);
  if (topWall) {
    const faceY = topWall.y + topWall.h;
    const rest: [number, number][] = [];
    const inOtherWall = (x: number, y: number) =>
      map.walls.some(
        (w) =>
          w !== topWall && x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h,
      );
    for (let x = 500; x <= 7500; x += 100) {
      // Only probe columns whose noise band is clear of perpendicular walls,
      // so the probe purely exercises the top face's bumpy edge path.
      if (inOtherWall(x, faceY + 1) || inOtherWall(x, faceY + r + 40)) continue;
      // Start just outside the AABB face, overlapping only the noise band.
      const [rx, ry] = c.collideCircle(x, faceY + r - 2, r);
      rest.push([rx, ry]);
    }
    check(`${map.name}: enough clean probe columns`, rest.length >= 10, `${rest.length} columns`);
    const ys = rest.map(([, ry]) => ry);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    check(
      `${map.name}: bumpy boundary (not flat AABB)`,
      max - min > 2,
      `rest y range ${min.toFixed(1)}..${max.toFixed(1)}`,
    );
    // And every resting spot must be free of penetration.
    check(
      `${map.name}: resting spots penetration-free`,
      rest.every(([rx, ry]) => c.isFree(rx, ry, r)),
    );
  }

  // 2d. Spawn tiles: every tile center must accept a fresh player.
  const tiles = findSpawnTiles(map.id);
  const tileW = map.width / BLOCK_GRID_COLS;
  const tileH = map.height / BLOCK_GRID_ROWS;
  let badTiles = 0;
  for (const t of tiles) {
    const cx = (t.col + 0.5) * tileW;
    const cy = (t.row + 0.5) * tileH;
    const [px, py] = c.collideCircle(cx, cy, r);
    if (Math.abs(px - cx) > 0.01 || Math.abs(py - cy) > 0.01 || !c.isFree(px, py, r)) {
      badTiles++;
    }
  }
  check(`${map.name}: spawn tiles all usable`, badTiles === 0, `${tiles.length} tiles, ${badTiles} bad`);

  // 2e. moveCircle: walking into a wall slides/stops instead of entering.
  if (topWall) {
    const faceY = topWall.y + topWall.h;
    const [mx, my] = c.moveCircle(4000, faceY + 200, 0, -190, r);
    void mx;
    check(`${map.name}: move into wall stops outside`, my >= faceY + r - 25, `rest y=${my.toFixed(1)}`);
    check(`${map.name}: post-move spot free`, c.isFree(mx, my, r));
  }
}

// ---------------------------------------------------------------------------
// 3. Perf: far queries (common path) + near-wall queries (worst path).
// ---------------------------------------------------------------------------
function bench(name: string, fn: () => void, iters: number) {
  // warmup
  for (let i = 0; i < 2000; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const t1 = performance.now();
  const us = ((t1 - t0) / iters) * 1000;
  console.log(`  ${name}: ${us.toFixed(3)} µs/query (${iters} iters)`);
  return us;
}

const garden = colliders[0];
let seed = 12345;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
// Precompute VERIFIED probe points: far = no walls nearby (common path),
// near = walls nearby but center in the open (worst edge path, no eject).
const farPts: [number, number][] = [];
const nearPts: [number, number][] = [];
{
  let guard = 0;
  while ((farPts.length < 2000 || nearPts.length < 2000) && guard++ < 60000) {
    const x = 200 + rnd() * 7600;
    const y = 200 + rnd() * 7600;
    if (!garden.circleNeedsPreciseCheck(x, y, r)) {
      if (farPts.length < 2000) farPts.push([x, y]);
    } else if (garden.isFree(x, y, r)) {
      if (nearPts.length < 2000) nearPts.push([x, y]);
    }
  }
}
check("bench: enough far probes", farPts.length === 2000, `${farPts.length}`);
check("bench: enough near probes", nearPts.length === 2000, `${nearPts.length}`);
let fi = 0;
let ni = 0;
const farUs = bench(
  "far-from-wall collideCircle",
  () => {
    const p = farPts[fi++ % farPts.length];
    garden.collideCircle(p[0], p[1], r);
  },
  200000,
);
const nearUs = bench(
  "near-wall collideCircle",
  () => {
    const p = nearPts[ni++ % nearPts.length];
    garden.collideCircle(p[0], p[1], r);
  },
  50000,
);
const moveUs = bench(
  "moveCircle (10px step, open)",
  () => {
    const p = farPts[fi++ % farPts.length];
    garden.moveCircle(p[0], p[1], 6, 8, r);
  },
  100000,
);
check("perf: far query < 1.5µs", farUs < 1.5, `${farUs.toFixed(3)}µs`);
check("perf: near query < 5µs", nearUs < 5, `${nearUs.toFixed(3)}µs`);
check("perf: move step < 2µs", moveUs < 2, `${moveUs.toFixed(3)}µs`);

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log("\nALL WALL COLLIDER CHECKS PASSED");
