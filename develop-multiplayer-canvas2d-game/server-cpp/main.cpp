// Petalia.io — C++ server skeleton (uWebSockets).
// Speaks the exact same binary protocol as server/index.ts, so the canvas client
// works unchanged. Port src/game/shared/sim.ts into Simulation::tick() to get the
// full game running natively.
//
//   git clone --recursive https://github.com/uNetworking/uWebSockets
//   make -C uWebSockets
//   g++ -std=c++20 -O2 main.cpp -IuWebSockets/src -IuWebSockets/uSockets/src \
//       uWebSockets/uSockets/*.o -lz -lssl -lcrypto -o petalia-server
//   ./petalia-server            # PORT env, default 8080

#include <App.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include <memory>
#include <random>
#include <cstdio>
#include <cstdlib>
#include <climits>
#include <optional>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// ----------------------------------------------------------------- constants
constexpr float PLAYER_RADIUS = 26.f * 0.7f;
constexpr float MOB_WALL_INFLATE = 10.f;
constexpr float PUSH_OUT_THRESHOLD = 6.f;
constexpr float MOB_COLLISION_SLOW_INTERVAL = 0.1f;
constexpr float MOB_COLLISION_FAST_INTERVAL = 1.f / 60.f;
constexpr float MOB_COLLISION_SLOW_SPEED = 30.f;
constexpr int MOB_COLLISION_OVERLOAD_THRESHOLD = 10000;
constexpr int MOB_COLLISION_OVERLOAD_SKIP = 4;
constexpr float MOB_THINK_INTERVAL = 0.2f;
constexpr float PROJECTILE_TTL = 5.f;
constexpr float PROJECTILE_HIT_CD = 0.3f;
constexpr float HORNET_MISSILE_INTERVAL = 2.0f;
constexpr float HORNET_MISSILE_RANGE = 600.f;
constexpr float MISSILE_SPEED = 320.f;
constexpr float SCORPION_MISSILE_INTERVAL = 2.5f;
constexpr float SCORPION_MISSILE_RANGE = 500.f;
constexpr float SCORPION_PROJECTILE_MAX_DISTANCE = 1500.f;
constexpr float SCORPION_PROJECTILE_BASE_HP = 40.f;
constexpr float SCORPION_MISSILE_SPEED = 260.f;
constexpr int SCORPION_TYPE = 5;
constexpr int MISSILE_ITEM = 52;
constexpr int SLOT_COUNT = 8;
constexpr int PETAL_TARGET_RECHECK_FRAMES = 3;
constexpr float ROSE_HEAL_DELAY = 0.5f;
constexpr float ROSE_ABSORB_TIME = 0.3f;
constexpr float MOB_WALL_CELL_SIZE = 250.f;
constexpr float REGION_SIZE = 2000.f;
constexpr float VIEW_RADIUS = 1300.f;
constexpr float ZONE_REFILL_INTERVAL = 5.f;
constexpr int BLOCK_GRID_COLS = 40;
constexpr int BLOCK_GRID_ROWS = 40;

// ----------------------------------------------------------------- protocol
enum C2S : uint8_t { JOIN = 1, INPUT = 2, SWAP = 3, CRAFT = 4, CHANGE_MAP = 5, RESPAWN = 6, PING = 7,
                     AFK_ACK = 13 };
enum S2C : uint8_t { WELCOME = 1, SNAPSHOT = 2, INVENTORY = 3, STATS = 4, EVENT = 5, PONG = 6,
                     AFK_CHECK = 9, DEBUG = 10 };
enum EntKind : uint8_t { E_PLAYER = 0, E_MOB = 1, E_PETAL = 2, E_DROP = 3 };
enum Team : uint8_t { TEAM_SELF = 2, TEAM_FRIENDLY = 1, TEAM_HOSTILE = 0 };

// AFK policy
constexpr float AFK_IDLE_SECONDS = 180.f;
constexpr float AFK_CHECK_SECONDS = 45.f;
constexpr int AFK_CLOSE_CODE = 4001;

// ----------------------------------------------------------------- writers
struct Writer {
  std::vector<uint8_t> b;
  void u8v(uint8_t v) { b.push_back(v); }
  void u16v(uint16_t v) { b.push_back(v >> 8); b.push_back(v & 0xff); }
  void i16v(int16_t v) { u16v(static_cast<uint16_t>(v)); }
  void u32v(uint32_t v) { for (int i = 3; i >= 0; --i) b.push_back((v >> (i * 8)) & 0xff); }
  void str(const std::string& s) {
    uint8_t n = static_cast<uint8_t>(s.size() > 250 ? 250 : s.size());
    b.push_back(n);
    b.insert(b.end(), s.begin(), s.begin() + n);
  }
  std::string_view view() const { return {reinterpret_cast<const char*>(b.data()), b.size()}; }
};

struct Reader {
  const uint8_t* p; size_t n; size_t o = 0;
  uint8_t u8v() { return o < n ? p[o++] : 0; }
  uint16_t u16v() { uint16_t v = (u8v() << 8); return v | u8v(); }
  int16_t i16v() { return static_cast<int16_t>(u16v()); }
  uint32_t u32v() { uint32_t v = 0; for (int i = 0; i < 4; ++i) v = (v << 8) | u8v(); return v; }
  std::string str() { uint8_t len = u8v(); std::string s; for (uint8_t i = 0; i < len; ++i) s.push_back(static_cast<char>(u8v())); return s; }
};

// ---------------------------------------------------------------- map data
struct Wall { float x, y, w, h; };

struct MapDef {
  int id;
  float width, height;
  std::vector<Wall> walls;
};

// Full wall data from defs.ts — all 3 maps (Garden, Desert, Ocean)
static std::vector<MapDef> makeMaps() {
  std::vector<MapDef> maps;
  // Map 0: Garden
  maps.push_back({0, 8000, 8000, {
    {0,0,8000,400},{0,400,400,7600},{1000,400,1400,200},{2800,400,800,400},
    {4000,400,1000,200},{5400,400,1200,200},{7400,400,600,800},{1400,600,1200,200},
    {4200,600,800,200},{5200,600,1000,200},{7200,600,200,800},{400,800,400,1000},
    {3000,800,800,200},{4200,800,600,200},{5200,800,400,200},{6800,800,400,600},
    {3400,1000,400,200},{4200,1000,400,200},{6600,1000,200,400},{800,1200,200,200},
    {3600,1200,400,200},{7600,1200,400,6800},{1800,1400,1200,400},{5000,1400,600,1400},
    {1600,1600,200,5000},{3000,1600,400,1000},{4800,1600,200,1600},{5600,1600,400,1200},
    {7400,1600,200,5200},{400,1800,200,600},{1400,1800,200,2600},{1800,1800,800,200},
    {2800,1800,200,200},{4600,1800,200,400},{6000,1800,200,1200},{7200,1800,200,1800},
    {1200,2000,200,600},{1800,2000,400,200},{6200,2000,200,1800},{3400,2200,200,1400},
    {3800,2400,200,200},{6400,2400,200,3800},{3200,2600,200,2400},{4400,2600,400,2400},
    {800,2800,200,600},{4200,2800,200,800},{5000,2800,200,200},{5800,2800,200,200},
    {1800,3000,200,3400},{3000,3000,200,2200},{4000,3000,200,600},{2000,3200,200,400},
    {2600,3200,400,800},{5400,3200,200,3400},{400,3400,200,400},{5600,3400,200,2000},
    {6600,3400,200,2800},{4800,3600,200,1000},{1000,3800,200,400},{600,4000,200,600},
    {2000,4000,200,2400},{2800,4000,200,800},{3400,4200,200,1000},{4200,4200,200,1000},
    {6200,4200,200,400},{2200,4400,200,1800},{3600,4400,600,1000},{1200,4600,200,400},
    {400,4800,400,200},{6200,4800,200,400},{400,5000,200,200},{4400,5000,200,200},
    {5200,5000,200,1600},{1400,5200,200,1400},{6800,5200,200,400},{600,5400,200,400},
    {1200,5400,200,1400},{3600,5400,200,200},{4800,5400,400,1400},{400,5600,200,600},
    {1000,5600,200,1000},{3000,5600,200,800},{4600,5600,200,1200},{5600,5600,200,200},
    {3200,5800,200,800},{4400,5800,200,800},{7200,5800,200,600},{2800,6000,200,600},
    {4000,6000,400,600},{2600,6200,200,600},{3400,6200,600,400},{2400,6400,200,400},
    {400,6600,200,1400},{3600,6600,400,200},{1800,6800,400,400},{1600,7000,200,200},
    {3000,7000,200,400},{4000,7000,600,200},{1800,7200,200,200},{2800,7200,200,200},
    {3200,7200,200,200},{600,7400,200,600},{4800,7400,600,600},{7400,7400,200,600},
    {800,7600,4000,400},{5400,7600,2000,400},
  }});
  // Map 1: Desert
  maps.push_back({1, 8000, 8000, {
    {0,0,8000,400},{0,400,800,200},{1800,400,400,200},{2600,400,1000,200},
    {4000,400,4000,200},{0,600,400,7400},{3200,600,200,200},{4400,600,1200,200},
    {6800,600,1200,200},{4600,800,800,200},{7200,800,800,800},{400,1000,200,2600},
    {2400,1000,400,1800},{3600,1000,200,1000},{4600,1000,200,200},{6200,1000,200,600},
    {600,1200,600,1200},{1600,1200,400,3200},{2200,1200,200,3000},{3200,1200,400,1000},
    {6400,1200,400,800},{1200,1400,400,1400},{2000,1400,200,3000},{2800,1400,200,1400},
    {3800,1400,400,200},{5000,1400,600,1000},{3000,1600,200,1000},{3800,1600,200,200},
    {4600,1600,400,600},{5600,1600,200,3200},{7400,1600,600,800},{4400,1800,200,400},
    {5800,1800,200,2600},{6800,1800,200,600},{6000,2000,200,2200},{6600,2000,200,200},
    {3200,2200,200,400},{4800,2200,200,200},{600,2400,200,400},{5200,2400,400,200},
    {6200,2400,200,1800},{7600,2400,400,5600},{5400,2600,200,2400},{6400,2600,200,1600},
    {1400,2800,200,1600},{3800,2800,600,600},{6600,2800,400,1200},{1200,3000,200,600},
    {3400,3000,400,400},{4400,3000,200,200},{7000,3000,200,1200},{7200,3200,400,1400},
    {2400,3600,400,200},{5000,3600,400,1600},{2400,3800,200,400},{4400,3800,600,1800},
    {400,4000,400,1000},{3200,4000,600,1000},{3000,4200,200,2000},{4200,4200,200,2000},
    {2800,4600,200,3400},{7400,4600,200,400},{2400,4800,400,3200},{400,5000,200,1800},
    {3200,5000,400,200},{600,5200,200,400},{2200,5200,200,2800},{3200,5200,200,400},
    {5000,5200,200,200},{6600,5200,400,800},{4000,5400,200,1000},{6400,5400,200,600},
    {2000,5600,200,2400},{3800,5600,200,600},{4400,5600,400,200},{600,5800,200,400},
    {3600,5800,200,400},{4400,5800,200,200},{1800,6000,200,600},{5600,6000,200,1000},
    {6600,6000,200,200},{5400,6200,200,800},{7400,6200,200,1800},{3000,6400,200,1600},
    {5000,6400,400,400},{5800,6400,200,600},{6000,6600,200,400},{3200,6800,200,1200},
    {7200,6800,200,1200},{3400,7000,600,1000},{7000,7000,200,1000},{400,7200,200,800},
    {4000,7200,400,800},{6800,7200,200,800},{600,7400,200,600},{1000,7400,200,600},
    {1600,7400,400,600},{4400,7400,800,600},{6400,7400,400,600},{800,7600,200,400},
    {1200,7600,400,400},{5200,7600,1200,400},
  }});
  // Map 2: Ocean
  maps.push_back({2, 8000, 8000, {
    {0,0,8000,400},{0,400,800,200},{1200,400,4000,200},{7400,400,600,200},
    {0,600,600,5800},{1200,600,3600,200},{7600,600,400,7400},{2000,800,1800,200},
    {6600,800,400,600},{2200,1000,1600,200},{6200,1000,400,1400},{7000,1000,200,400},
    {2400,1200,1200,400},{6000,1200,200,1400},{1200,1400,400,400},{3600,1400,200,3200},
    {5600,1400,400,1200},{6600,1400,200,600},{1600,1600,200,600},{2600,1600,1000,400},
    {5200,1600,400,4200},{1400,1800,200,400},{1800,1800,200,200},{5000,1800,200,4600},
    {7400,1800,200,6200},{2800,2000,800,600},{3800,2000,200,2400},{4800,2000,200,3200},
    {7200,2000,200,1000},{4600,2200,200,1600},{7000,2200,200,600},{4400,2400,200,1600},
    {6200,2400,200,200},{2200,2600,200,800},{3000,2600,600,600},{4000,2600,400,1600},
    {5600,2600,200,200},{1800,2800,400,600},{2400,3000,200,200},{6200,3000,600,200},
    {600,3200,200,3000},{3200,3200,400,1000},{6400,3200,600,200},{5600,3400,200,2200},
    {6600,3400,200,200},{5800,3600,400,1200},{7200,3600,200,3400},{6200,3800,200,800},
    {800,4000,400,2200},{3400,4200,200,400},{4000,4200,200,200},{4600,4200,200,1200},
    {1200,4400,400,1600},{6800,4400,200,400},{1600,4600,600,1000},{4400,4600,200,800},
    {2200,4800,800,400},{5800,4800,200,200},{6400,4800,200,400},{4000,5000,400,600},
    {6200,5000,200,200},{2200,5200,600,200},{6800,5200,400,1400},{2200,5400,400,200},
    {3000,5400,400,800},{6400,5400,400,1200},{1600,5600,200,200},{2800,5600,200,1000},
    {3400,5600,200,200},{4800,5600,200,600},{6200,5600,200,800},{2400,5800,400,2200},
    {4600,5800,200,200},{5200,5800,200,600},{6000,5800,200,400},{1200,6000,200,600},
    {2000,6000,400,2000},{5400,6000,200,400},{1000,6200,200,200},{1800,6200,200,800},
    {3000,6200,200,200},{3800,6200,400,800},{5600,6200,200,200},{0,6400,400,1600},
    {3400,6400,400,1600},{4200,6400,200,200},{3200,6600,200,1400},{4600,6600,400,600},
    {1600,6800,200,200},{2800,6800,400,1200},{5000,6800,200,200},{5600,6800,600,1200},
    {6600,6800,200,200},{3800,7000,200,200},{4400,7000,200,1000},{5400,7000,200,1000},
    {4200,7200,200,800},{4600,7200,200,800},{5200,7200,200,800},{1000,7400,200,600},
    {1400,7400,600,600},{4000,7400,200,600},{4800,7400,400,600},{6200,7400,200,600},
    {6600,7400,200,600},{7200,7400,200,600},{400,7600,600,400},{1200,7600,200,400},
    {3800,7600,200,400},{6400,7600,200,400},{6800,7600,400,400},
  }});
  return maps;
}

static const std::vector<MapDef> MAPS = makeMaps();
static const int MAP_COUNT = static_cast<int>(MAPS.size());

// ---------------------------------------------------------------- collision counter
struct CollisionCounter { int n = 0; };

// ---------------------------------------------------------------- ArrayWallCollider
// AABB-based wall collider for mobs. Uses uniform grid bucketing.
class ArrayWallCollider {
public:
  float wallMaxJitterPx = 0;

  ArrayWallCollider(const std::vector<Wall>& walls, float mapWidth, float mapHeight, int gridResolution = 256)
    : mapWidth_(mapWidth), mapHeight_(mapHeight)
  {
    gridCellSize_ = std::max(mapWidth, mapHeight) / static_cast<float>(gridResolution);
    cols_ = std::max(1, static_cast<int>(std::ceil(mapWidth / gridCellSize_)));
    rows_ = std::max(1, static_cast<int>(std::ceil(mapHeight / gridCellSize_)));
    grid_.resize(cols_ * rows_);

    for (const auto& w : walls) {
      int x0 = std::max(0, (int)std::floor(w.x / gridCellSize_));
      int y0 = std::max(0, (int)std::floor(w.y / gridCellSize_));
      int x1 = std::min(cols_ - 1, (int)std::floor((w.x + w.w) / gridCellSize_));
      int y1 = std::min(rows_ - 1, (int)std::floor((w.y + w.h) / gridCellSize_));
      for (int gy = y0; gy <= y1; gy++) {
        for (int gx = x0; gx <= x1; gx++) {
          grid_[gy * cols_ + gx].push_back(&w);
        }
      }
    }
  }

  // Collect candidate walls near a circle
  std::vector<const Wall*> candidates(float x, float y, float r, float inflate = 0) const {
    std::vector<const Wall*> out;
    float rr = r + inflate;
    int gx0 = std::max(0, (int)std::floor((x - rr) / gridCellSize_));
    int gy0 = std::max(0, (int)std::floor((y - rr) / gridCellSize_));
    int gx1 = std::min(cols_ - 1, (int)std::floor((x + rr) / gridCellSize_));
    int gy1 = std::min(rows_ - 1, (int)std::floor((y + rr) / gridCellSize_));
    for (int gy = gy0; gy <= gy1; gy++) {
      for (int gx = gx0; gx <= gx1; gx++) {
        const auto& bucket = grid_[gy * cols_ + gx];
        out.insert(out.end(), bucket.begin(), bucket.end());
      }
    }
    return out;
  }

  // Push circle out of a single AABB wall
  static std::pair<float, float> pushOutOfWall(float cx, float cy, float r, const Wall& w, float inflate = 0) {
    float minX = w.x - inflate;
    float minY = w.y - inflate;
    float maxX = w.x + w.w + inflate;
    float maxY = w.y + w.h + inflate;
    float closestX = std::max(minX, std::min(cx, maxX));
    float closestY = std::max(minY, std::min(cy, maxY));
    float dx = cx - closestX;
    float dy = cy - closestY;
    float dist2 = dx * dx + dy * dy;
    if (dist2 >= r * r) return {cx, cy};

    if (dist2 < 0.0001f) {
      // Center inside wall: push out along nearest edge
      float left = cx - minX, right = maxX - cx;
      float top = cy - minY, bottom = maxY - cy;
      float minD = std::min({left, right, top, bottom});
      if (minD == left) return {minX - r, cy};
      if (minD == right) return {maxX + r, cy};
      if (minD == top) return {cx, minY - r};
      return {cx, maxY + r};
    }

    float dist = std::sqrt(dist2);
    float push = r - dist;
    return {cx + (dx / dist) * push, cy + (dy / dist) * push};
  }

  // Multi-pass circle-wall collision (main API)
  std::pair<float, float> collideCircle(float x, float y, float r, CollisionCounter* counter = nullptr, float inflate = 0) const {
    for (int pass = 0; pass < 3; pass++) {
      bool moved = false;
      for (const auto* w : candidates(x, y, r, inflate)) {
        if (counter) counter->n++;
        auto [nx, ny] = pushOutOfWall(x, y, r, *w, inflate);
        if (nx != x || ny != y) {
          moved = true;
          x = nx; y = ny;
        }
      }
      if (!moved) break;
    }
    return {x, y};
  }

  bool isFree(float x, float y, float r, float inflate = 0) const {
    auto [cx, cy] = collideCircle(x, y, r, nullptr, inflate);
    return std::abs(cx - x) < 0.01f && std::abs(cy - y) < 0.01f;
  }

  std::pair<float, float> moveCircle(float x, float y, float dx, float dy, float r, CollisionCounter* counter = nullptr, float inflate = 0) const {
    float dist = std::hypot(dx, dy);
    float maxStep = std::max(4.f, r * 0.45f);
    int steps = std::max(1, (int)std::ceil(dist / maxStep));
    float sx = dx / steps, sy = dy / steps;
    for (int i = 0; i < steps; i++) {
      x += sx; y += sy;
      auto [nx, ny] = collideCircle(x, y, r, counter, inflate);
      x = nx; y = ny;
    }
    return {x, y};
  }

  bool circleNeedsPreciseCheck(float x, float y, float r, float inflate = 0) const {
    return !candidates(x, y, r, inflate).empty();
  }

private:
  float mapWidth_, mapHeight_;
  float gridCellSize_;
  int cols_, rows_;
  std::vector<std::vector<const Wall*>> grid_;
};

// ---------------------------------------------------------------- PolygonWallCollider
// BVH-based polygon wall collider for players. Rasterizes AABB walls,
// extracts contours, adds noise, builds BVH.
struct WallEdge {
  float x1, y1, x2, y2, nx, ny, len;
};

struct AABB {
  float minX = 1e30f, minY = 1e30f, maxX = -1e30f, maxY = -1e30f;
};

struct BVHNode {
  AABB aabb;
  BVHNode* left = nullptr;
  BVHNode* right = nullptr;
  std::vector<WallEdge>* edges = nullptr; // only leaf nodes store edges
};

class PolygonWallCollider {
public:
  float wallMaxJitterPx = 0;
  int bvhNodeCount = 0, bvhLeafCount = 0, bvhMaxDepth = 0;

  PolygonWallCollider(const std::vector<Wall>& walls, float mapWidth, float mapHeight, int gridResolution = 256)
    : mapWidth_(mapWidth), mapHeight_(mapHeight)
  {
    gridCellSize_ = std::max(mapWidth, mapHeight) / static_cast<float>(gridResolution);
    gridCols_ = (int)std::ceil(mapWidth / gridCellSize_);
    gridRows_ = (int)std::ceil(mapHeight / gridCellSize_);

    // 1. Rasterize AABB walls to binary grid
    auto grid = rasterizeWalls(walls, gridResolution);

    // 2. Extract contour edges
    auto loops = extractContours(grid, gridResolution);

    // 3. Simplify: remove collinear points
    for (auto& loop : loops) loop = simplifyLoop(loop);

    // 4. Add noise and convert to world coords
    float cellW = mapWidth / gridResolution;
    float cellH = mapHeight / gridResolution;
    polygons_.reserve(loops.size());
    for (auto& loop : loops) {
      polygons_.push_back(addNoise(loop, cellW, cellH));
    }

    // 5. Build edge table with precomputed normals
    for (const auto& poly : polygons_) {
      size_t n = poly.size();
      for (size_t i = 0; i < n; i++) {
        float x1 = poly[i].first, y1 = poly[i].second;
        float x2 = poly[(i + 1) % n].first, y2 = poly[(i + 1) % n].second;
        float dx = x2 - x1, dy = y2 - y1;
        float len = std::hypot(dx, dy);
        if (len < 0.001f) continue;
        // Outward normal: contour is CCW, (-dy, dx) points outward
        float nx = -dy / len, ny = dx / len;
        edges_.push_back({x1, y1, x2, y2, nx, ny, len});
      }
    }

    // 6. Build BVH
    bvh_ = buildBVH(edges_);

    // 7. Build spatial grid
    buildSpatialGrid();

    printf("[PolygonWallCollider] Preprocessed %zu walls => %zu edges, %d BVH nodes\n",
           walls.size(), edges_.size(), bvhNodeCount);
  }

  ~PolygonWallCollider() {
    freeBVH(bvh_);
  }

  // Circle vs polygon walls (main API). Uses BVH, average O(log n).
  std::pair<float, float> collideCircle(float x, float y, float r, CollisionCounter* counter = nullptr) const {
    if (!bvh_) return {x, y};
    for (int pass = 0; pass < 3; pass++) {
      bool moved = false;
      auto candidates = queryBVH(bvh_, x, y, r, counter);
      for (const auto& e : candidates) {
        if (counter) counter->n++;
        auto result = circleSegmentCollide(x, y, r, e);
        if (result.has_value()) {
          moved = true;
          x = result->first;
          y = result->second;
        }
      }
      if (!moved) break;
    }
    return {x, y};
  }

  bool isFree(float x, float y, float r) const {
    auto [cx, cy] = collideCircle(x, y, r);
    return std::abs(cx - x) < 0.01f && std::abs(cy - y) < 0.01f;
  }

  std::pair<float, float> moveCircle(float x, float y, float dx, float dy, float r, CollisionCounter* counter = nullptr) const {
    float dist = std::hypot(dx, dy);
    float maxStep = std::max(4.f, r * 0.45f);
    int steps = std::max(1, (int)std::ceil(dist / maxStep));
    float sx = dx / steps, sy = dy / steps;
    for (int i = 0; i < steps; i++) {
      x += sx; y += sy;
      auto [nx, ny] = collideCircle(x, y, r, counter);
      x = nx; y = ny;
    }
    return {x, y};
  }

  // Coarse check: is the circle near any wall edge?
  bool circleNeedsPreciseCheck(float x, float y, float r) const {
    if (spatialGrid_.empty()) return false;
    int cx = (int)std::floor(x / gridCellSize_);
    int cy = (int)std::floor(y / gridCellSize_);
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        auto it = spatialGrid_.find(key(cx + dx, cy + dy));
        if (it == spatialGrid_.end()) continue;
        for (const auto& e : it->second) {
          float minX = std::min(e.x1, e.x2), maxX = std::max(e.x1, e.x2);
          float minY = std::min(e.y1, e.y2), maxY = std::max(e.y1, e.y2);
          float closestX = std::max(minX, std::min(x, maxX));
          float closestY = std::max(minY, std::min(y, maxY));
          float ddx = x - closestX, ddy = y - closestY;
          if (ddx * ddx + ddy * ddy <= r * r) return true;
        }
      }
    }
    return false;
  }

private:
  // Hash-based noise function (same as TS)
  static float noise(int x, int y) {
    int h = x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return (float)(h & 0x7fffffff) / (float)0x7fffffff;
  }

  std::vector<uint8_t> rasterizeWalls(const std::vector<Wall>& walls, int size) const {
    std::vector<uint8_t> grid(size * size, 0);
    float cellW = mapWidth_ / size;
    float cellH = mapHeight_ / size;
    for (const auto& w : walls) {
      int x0 = std::max(0, (int)std::floor(w.x / cellW));
      int y0 = std::max(0, (int)std::floor(w.y / cellH));
      int x1 = std::min(size - 1, (int)std::floor((w.x + w.w) / cellW));
      int y1 = std::min(size - 1, (int)std::floor((w.y + w.h) / cellH));
      for (int y = y0; y <= y1; y++)
        for (int x = x0; x <= x1; x++)
          grid[y * size + x] = 1;
    }
    return grid;
  }

  using Point = std::pair<int, int>;
  static std::vector<std::vector<Point>> extractContours(const std::vector<uint8_t>& grid, int size) {
    auto W = [&](int x, int y) -> bool {
      return x >= 0 && y >= 0 && x < size && y < size && grid[y * size + x] == 1;
    };
    auto keyOf = [&](int x, int y) { return x * (size + 1) + y; };

    std::unordered_map<int, Point> edgeMap;
    for (int y = 0; y < size; y++) {
      for (int x = 0; x < size; x++) {
        if (!W(x, y)) continue;
        if (!W(x, y - 1)) edgeMap[keyOf(x, y)] = {x + 1, y};
        if (!W(x + 1, y)) edgeMap[keyOf(x + 1, y)] = {x + 1, y + 1};
        if (!W(x, y + 1)) edgeMap[keyOf(x + 1, y + 1)] = {x, y + 1};
        if (!W(x - 1, y)) edgeMap[keyOf(x, y + 1)] = {x, y};
      }
    }

    std::vector<std::vector<Point>> rawLoops;
    std::unordered_set<int> visited;
    for (const auto& [startKey, _] : edgeMap) {
      if (visited.count(startKey)) continue;
      std::vector<Point> loop;
      int curKey = startKey;
      int guard = 0;
      while (!visited.count(curKey) && guard++ < size * size * 4) {
        visited.insert(curKey);
        loop.push_back({curKey / (size + 1), curKey % (size + 1)});
        auto it = edgeMap.find(curKey);
        if (it == edgeMap.end()) break;
        curKey = keyOf(it->second.first, it->second.second);
      }
      if (loop.size() >= 3) rawLoops.push_back(std::move(loop));
    }
    return rawLoops;
  }

  static std::vector<Point> simplifyLoop(const std::vector<Point>& loop) {
    size_t n = loop.size();
    std::vector<Point> out;
    for (size_t i = 0; i < n; i++) {
      const auto& p0 = loop[(i - 1 + n) % n];
      const auto& p1 = loop[i];
      const auto& p2 = loop[(i + 1) % n];
      bool collinear = (p1.first - p0.first) * (p2.second - p1.second) ==
                       (p1.second - p0.second) * (p2.first - p1.first);
      if (!collinear) out.push_back(p1);
    }
    if (out.size() >= 3) return out;
    return loop;
  }

  std::vector<std::pair<float, float>> addNoise(const std::vector<Point>& loop, float cellW, float cellH) {
    const float BIG_AMP = 0.4f, FINE_AMP = 0.2f;
    const float BIG_FREQ = 0.08f, FINE_FREQ = 1.8f;
    const float PTS_PER_CELL = 1.f;

    std::vector<std::pair<float, float>> pts;
    size_t n = loop.size();
    for (size_t i = 0; i < n; i++) {
      int p1x = loop[i].first, p1y = loop[i].second;
      int p2x = loop[(i + 1) % n].first, p2y = loop[(i + 1) % n].second;
      bool horizontal = (p1y == p2y);
      int len = horizontal ? std::abs(p2x - p1x) : std::abs(p2y - p1y);
      int steps = std::max(1, std::min((int)std::round(len * PTS_PER_CELL), 200));

      for (int s = 0; s < steps; s++) {
        float t = (float)s / (float)steps;
        float wx = p1x + (p2x - p1x) * t;
        float wy = p1y + (p2y - p1y) * t;
        float j = 0;
        if (s != 0) {
          float big = (noise((int)std::floor(wx * BIG_FREQ * 1000), (int)std::floor(wy * BIG_FREQ * 1000)) - 0.5f) * 2.0f * BIG_AMP;
          float fine = (noise((int)std::floor(wx * FINE_FREQ * 1000), (int)std::floor(wy * FINE_FREQ * 1000)) - 0.5f) * 2.0f * FINE_AMP;
          j = big + fine;
        }
        pts.push_back({
          (wx + (horizontal ? 0 : j)) * cellW,
          (wy + (horizontal ? j : 0)) * cellH
        });
      }
    }
    wallMaxJitterPx = std::max(wallMaxJitterPx, (BIG_AMP + FINE_AMP) * std::min(cellW, cellH));
    return pts;
  }

  // BVH
  BVHNode* buildBVH(std::vector<WallEdge>& edges) {
    if (edges.empty()) return nullptr;
    return buildBVHRecursive(edges, 0, 0, (int)edges.size());
  }

  BVHNode* buildBVHRecursive(std::vector<WallEdge>& edges, int start, int end, int depth) {
    auto* node = new BVHNode();
    bvhNodeCount++;
    bvhMaxDepth = std::max(bvhMaxDepth, depth);

    // Compute AABB
    node->aabb = computeEdgesAABB(edges, start, end);

    const int maxEdgesPerLeaf = 8;
    int count = end - start;
    if (count <= maxEdgesPerLeaf) {
      bvhLeafCount++;
      node->edges = new std::vector<WallEdge>(edges.begin() + start, edges.begin() + end);
      return node;
    }

    // Split along longest axis
    float extentX = node->aabb.maxX - node->aabb.minX;
    float extentY = node->aabb.maxY - node->aabb.minY;
    int axis = extentX >= extentY ? 0 : 1;

    // Sort slice
    std::sort(edges.begin() + start, edges.begin() + end, [axis](const WallEdge& a, const WallEdge& b) {
      float ca = axis == 0 ? (a.x1 + a.x2) * 0.5f : (a.y1 + a.y2) * 0.5f;
      float cb = axis == 0 ? (b.x1 + b.x2) * 0.5f : (b.y1 + b.y2) * 0.5f;
      return ca < cb;
    });

    int mid = start + count / 2;
    node->left = buildBVHRecursive(edges, start, mid, depth + 1);
    node->right = buildBVHRecursive(edges, mid, end, depth + 1);
    return node;
  }

  static AABB computeEdgesAABB(const std::vector<WallEdge>& edges, int start, int end) {
    AABB aabb;
    for (int i = start; i < end; i++) {
      const auto& e = edges[i];
      aabb.minX = std::min(aabb.minX, std::min(e.x1, e.x2));
      aabb.minY = std::min(aabb.minY, std::min(e.y1, e.y2));
      aabb.maxX = std::max(aabb.maxX, std::max(e.x1, e.x2));
      aabb.maxY = std::max(aabb.maxY, std::max(e.y1, e.y2));
    }
    return aabb;
  }

  void buildSpatialGrid() {
    for (const auto& e : edges_) {
      int x0 = (int)std::floor(std::min(e.x1, e.x2) / gridCellSize_);
      int y0 = (int)std::floor(std::min(e.y1, e.y2) / gridCellSize_);
      int x1 = (int)std::floor(std::max(e.x1, e.x2) / gridCellSize_);
      int y1 = (int)std::floor(std::max(e.y1, e.y2) / gridCellSize_);
      for (int gy = y0; gy <= y1; gy++) {
        for (int gx = x0; gx <= x1; gx++) {
          spatialGrid_[key(gx, gy)].push_back(e);
        }
      }
    }
  }

  static int64_t key(int gx, int gy) { return (int64_t)gx * 100000 + gy; }

  // BVH query: find edges that overlap a circle
  std::vector<WallEdge> queryBVH(BVHNode* node, float x, float y, float r, CollisionCounter* counter) const {
    std::vector<WallEdge> results;
    if (!node) return results;
    std::vector<BVHNode*> stack;
    stack.push_back(node);
    while (!stack.empty()) {
      auto* cur = stack.back(); stack.pop_back();
      if (counter) counter->n++;
      if (!circleAABBOverlap(x, y, r, cur->aabb)) continue;
      if (cur->edges) {
        results.insert(results.end(), cur->edges->begin(), cur->edges->end());
      } else {
        if (cur->left) stack.push_back(cur->left);
        if (cur->right) stack.push_back(cur->right);
      }
    }
    return results;
  }

  static bool circleAABBOverlap(float cx, float cy, float r, const AABB& aabb) {
    float closestX = std::max(aabb.minX, std::min(cx, aabb.maxX));
    float closestY = std::max(aabb.minY, std::min(cy, aabb.maxY));
    float dx = cx - closestX, dy = cy - closestY;
    return dx * dx + dy * dy <= r * r;
  }

  // Circle vs line segment collision
  static std::optional<std::pair<float, float>> circleSegmentCollide(float cx, float cy, float r, const WallEdge& e) {
    float dx = e.x2 - e.x1, dy = e.y2 - e.y1;
    float len2 = dx * dx + dy * dy;
    float t = len2 == 0 ? 0 : ((cx - e.x1) * dx + (cy - e.y1) * dy) / len2;
    t = std::max(0.f, std::min(1.f, t));
    float closestX = e.x1 + t * dx, closestY = e.y1 + t * dy;
    float dcx = cx - closestX, dcy = cy - closestY;
    float dist2 = dcx * dcx + dcy * dcy;
    if (dist2 >= r * r) return std::nullopt;
    if (dist2 < 0.0001f) return std::make_pair(cx + e.nx * r, cy + e.ny * r);
    float dist = std::sqrt(dist2);
    float push = r - dist;
    return std::make_pair(cx + (dcx / dist) * push, cy + (dcy / dist) * push);
  }

  void freeBVH(BVHNode* node) {
    if (!node) return;
    if (node->edges) delete node->edges;
    freeBVH(node->left);
    freeBVH(node->right);
    delete node;
  }

  float mapWidth_, mapHeight_;
  float gridCellSize_;
  int gridCols_, gridRows_;
  std::vector<std::vector<std::pair<float, float>>> polygons_;
  std::vector<WallEdge> edges_;
  BVHNode* bvh_ = nullptr;
  std::unordered_map<int64_t, std::vector<WallEdge>> spatialGrid_;
};

// ---------------------------------------------------------------- data structs
struct Cell { uint8_t item = 255, rarity = 0; uint16_t count = 0; };

struct PetalState {
  int id = 0;
  bool alive = false;
  float hp = 0, maxHp = 0;
  float timer = 0;
  float x = 0, y = 0;
  float hitCd = 0;
  float specialTimer = 0;
  float absorbTimer = 0;
  int targetCheckTimer = 0;
  int targetId = 0;
  uint8_t item = 0, rarity = 0;
  float fireTimer = 0;
};

struct Mob {
  int id = 0, type = 0, mapId = 0;
  float x = 0, y = 0, vx = 0, vy = 0;
  float hp = 0, maxHp = 0;
  float angle = 0;
  int rarity = 0;
  bool friendly = false;
  int ownerId = 0, ownerSlot = -1;
  int sourceItem = -1, sourceRarity = 0;
  int targetId = 0;
  float wander = 0, hitCd = 0;
  float radius = 16, damage = 10, speed = 0;
  int lastHitBy = 0;
  float spawnProtection = 0;
  float pushOutCooldown = 0;
  float thinkTimer = 0;
  float cachedTargetX = 0, cachedTargetY = 0;
  float collisionTimer = 0;
  float missileTimer = 0;
  std::unordered_map<int, float> damageByPlayer;
};

struct Projectile {
  int id = 0, mapId = 0;
  float x = 0, y = 0, vx = 0, vy = 0;
  float ttl = 0, hitCd = 0;
  float damage = 0, radius = 10;
  int team = 0;
  int ownerId = 0, sourceType = 0, rarity = 0;
  bool isPiercing = false;
  float maxDistance = 0, distanceTraveled = 0;
  float hp = 1;
};

struct Player {
  uint16_t id = 0;
  std::string name = "flower";
  uint8_t mapId = 0;
  float x = 1600, y = 1600, vx = 0, vy = 0;
  float hp = 120, maxHp = 120;
  uint32_t xp = 0;
  uint16_t level = 1;
  bool alive = true;
  float inDx = 0, inDy = 0;
  uint8_t flags = 0;
  float baseAngle = 0, orbit = 62;
  float hurtCd = 0;
  float shield = 0;
  bool dirty = true, statsDirty = true;
  float currentSpeed = 0;
  float bodyDamage = 10;
  float lastSafeX = 0, lastSafeY = 0;
  bool wasDefending = false;
  float deathX = 0, deathY = 0;
  float respawnIn = 0;

  // AFK tracking
  float idleSeconds = 0.f;
  bool afkPending = false;
  float afkSecondsLeft = 0.f;
  int afkLastSent = -1;
  bool kick = false;
  float lastInDx = 0, lastInDy = 0;
  uint8_t lastFlags = 0;

  Cell slots[8];
  Cell bag[32];
  PetalState petals[8];
  std::vector<Mob*> pets[8];
};

struct PerSocket { uint16_t id = 0; };

// ---------------------------------------------------------------- Simulation
class Simulation {
public:
  Player& add(uint16_t id) { auto& p = players[id]; p.id = id; return p; }
  void remove(uint16_t id) { players.erase(id); }
  Player* get(uint16_t id) { auto it = players.find(id); return it == players.end() ? nullptr : &it->second; }

  // Collision counter for the current tick
  CollisionCounter collisionCounter;

  // Tick counter
  uint32_t tickCount = 0;

  Player* getPlayer(uint16_t id) { return get(id); }

  Simulation() {
    // Initialize wall colliders for each map
    for (int i = 0; i < MAP_COUNT; i++) {
      playerWallColliders_.push_back(
        std::make_unique<PolygonWallCollider>(MAPS[i].walls, MAPS[i].width, MAPS[i].height, 256));
      wallColliders_.push_back(
        std::make_unique<ArrayWallCollider>(MAPS[i].walls, MAPS[i].width, MAPS[i].height, 256));
    }
  }

  // ---- Main tick ----
  void tick(float dt) {
    tickCount++;
    collisionCounter = {0};

    // Gather alive players (not in menu mode — simplified, all players are active)
    std::vector<Player*> activePlayers;
    for (auto& [id, p] : players) {
      if (p.alive) activePlayers.push_back(&p);
    }

    // Update players
    for (auto* p : activePlayers) updatePlayer(*p, dt, activePlayers);

    // Update worlds (mobs, drops, projectiles)
    for (int m = 0; m < MAP_COUNT; m++) updateWorld(m, dt, activePlayers);

    // Update petals
    for (auto* p : activePlayers) updatePetals(*p, dt);

    // Update projectiles
    for (int m = 0; m < MAP_COUNT; m++) updateProjectiles(m, dt, activePlayers);
  }

  // ---- AFK handling (unchanged) ----
  void markActive(Player& p, bool canDismiss = false) {
    if (p.afkPending) {
      if (!canDismiss) return;
      p.afkPending = false;
      p.afkSecondsLeft = 0.f;
      p.idleSeconds = 0.f;
      p.afkLastSent = -1;
      return;
    }
    p.idleSeconds = 0.f;
  }

  static Writer afkPacket(const Player& p) {
    Writer w;
    w.u8v(AFK_CHECK);
    w.u8v(p.afkPending ? 1 : 0);
    float left = p.afkSecondsLeft < 0.f ? 0.f : p.afkSecondsLeft;
    w.u16v(static_cast<uint16_t>(std::ceil(left)));
    return w;
  }

  void updateAfk(float dt, std::vector<uint16_t>& changed) {
    for (auto& [id, p] : players) {
      if (p.kick) continue;
      if (p.afkPending) {
        p.afkSecondsLeft -= dt;
        if (p.afkSecondsLeft <= 0.f) {
          p.afkSecondsLeft = 0.f;
          p.kick = true;
          changed.push_back(id);
          continue;
        }
        int secs = static_cast<int>(std::ceil(p.afkSecondsLeft));
        if (secs != p.afkLastSent) {
          p.afkLastSent = secs;
          changed.push_back(id);
        }
        continue;
      }
      p.idleSeconds += dt;
      if (p.idleSeconds >= AFK_IDLE_SECONDS) {
        p.afkPending = true;
        p.afkSecondsLeft = AFK_CHECK_SECONDS;
        p.afkLastSent = static_cast<int>(AFK_CHECK_SECONDS);
        changed.push_back(id);
      }
    }
  }

  Writer snapshotFor(const Player& me) const {
    Writer w;
    w.u8v(SNAPSHOT);
    w.u32v(tickCount);
    uint16_t count = 0;
    Writer body;
    for (const auto& [id, p] : players) {
      if (p.mapId != me.mapId || !p.alive) continue;
      body.u8v(E_PLAYER);
      body.u16v(p.id);
      body.u8v(0);
      body.u8v(p.id == me.id ? 2 : 1);
      body.i16v(static_cast<int16_t>(p.x));
      body.i16v(static_cast<int16_t>(p.y));
      body.u16v(0);
      body.u8v(static_cast<uint8_t>(26 * 0.7f));
      float hpPct = p.maxHp > 0 ? p.hp / p.maxHp : 0;
      body.u8v(static_cast<uint8_t>(255.f * std::min(1.f, hpPct)));
      body.str(p.name);
      ++count;
    }
    w.u16v(count);
    w.b.insert(w.b.end(), body.b.begin(), body.b.end());
    return w;
  }

  std::unordered_map<uint16_t, Player> players;

private:
  std::vector<std::unique_ptr<PolygonWallCollider>> playerWallColliders_;
  std::vector<std::unique_ptr<ArrayWallCollider>> wallColliders_;
  std::vector<Mob> worldMobs_[3];   // mobs per map
  std::vector<Projectile> worldProjectiles_[3];  // projectiles per map
  int nextMobId_ = 10000;
  int nextProjId_ = 20000;

  // ---- Player update with wall collision, player-player push ----
  void updatePlayer(Player& p, float dt, std::vector<Player*>& allPlayers) {
    if (!p.alive) return;
    const auto& map = MAPS[p.mapId];
    auto* collider = playerWallColliders_[p.mapId].get();

    // Movement
    float playerRadius = PLAYER_RADIUS; // simplified: no soil bonus
    float speed = 190.f + p.level * 0.8f;
    p.currentSpeed = speed;
    float mag = std::hypot(p.inDx, p.inDy);
    float nx = mag > 1 ? p.inDx / mag : p.inDx;
    float ny = mag > 1 ? p.inDy / mag : p.inDy;
    p.vx += (nx * speed - p.vx) * std::min(1.f, dt * 9.f);
    p.vy += (ny * speed - p.vy) * std::min(1.f, dt * 9.f);

    // ---- Wall collision with moveCircle (PolygonWallCollider) ----
    auto [newX, newY] = collider->moveCircle(p.x, p.y, p.vx * dt, p.vy * dt, playerRadius, &collisionCounter);
    p.x = std::clamp(newX, playerRadius, map.width - playerRadius);
    p.y = std::clamp(newY, playerRadius, map.height - playerRadius);

    // ---- Player-to-player push apart ----
    for (auto* o : allPlayers) {
      if (o == &p || o->mapId != p.mapId || !o->alive) continue;
      collisionCounter.n++;
      float dx = p.x - o->x;
      float dy = p.y - o->y;
      float d = std::hypot(dx, dy);
      float oRadius = PLAYER_RADIUS; // simplified
      float minDist = playerRadius + oRadius;
      if (d < minDist && d > 0.001f) {
        float push = (minDist - d) * 0.5f;
        p.x += (dx / d) * push;
        p.y += (dy / d) * push;
      }
    }
    p.x = std::clamp(p.x, playerRadius, map.width - playerRadius);
    p.y = std::clamp(p.y, playerRadius, map.height - playerRadius);

    // ---- Lightweight stuck-in-wall safety net ----
    pushPlayerOutOfWall(p, playerRadius);

    p.hurtCd = std::max(0.f, p.hurtCd - dt);
    bool attack = (p.flags & 1) != 0;
    bool defend = (p.flags & 2) != 0;

    // Bubble: trigger on rising edge of defend
    if (defend && !p.wasDefending) {
      breakBubbles(p);
    }
    p.wasDefending = defend;

    float targetOrbit = attack ? 118.f : (defend ? 34.f : 62.f);
    p.orbit += (targetOrbit - p.orbit) * std::min(1.f, dt * 6.f);
    p.baseAngle += dt * (attack ? 3.4f : 2.2f);
  }

  // ---- Lightweight player stuck-in-wall safety net ----
  void pushPlayerOutOfWall(Player& p, float playerRadius) {
    if (!p.alive) return;
    auto* collider = playerWallColliders_[p.mapId].get();
    if (!collider) return;

    // O(1) coarse check: far from walls -> record safe position and return
    if (!collider->circleNeedsPreciseCheck(p.x, p.y, playerRadius)) {
      p.lastSafeX = p.x;
      p.lastSafeY = p.y;
      return;
    }

    // Near walls: one collideCircle to detect and correct
    auto [nx, ny] = collider->collideCircle(p.x, p.y, playerRadius, &collisionCounter);
    float disp = std::abs(nx - p.x) + std::abs(ny - p.y);

    // Small correction: normal wall-hugging
    if (disp < PUSH_OUT_THRESHOLD) {
      p.x = nx; p.y = ny;
      p.lastSafeX = p.x; p.lastSafeY = p.y;
      return;
    }

    // Large correction: deeply stuck, fall back to last safe position
    if (p.lastSafeX != 0 || p.lastSafeY != 0) {
      p.x = p.lastSafeX;
      p.y = p.lastSafeY;
    } else {
      // No safe position: teleport to center of map
      const auto& map = MAPS[p.mapId];
      p.x = map.width * 0.5f;
      p.y = map.height * 0.5f;
      auto [cx, cy] = collider->collideCircle(p.x, p.y, playerRadius);
      p.x = cx; p.y = cy;
    }
    p.vx = 0; p.vy = 0;
  }

  // ---- Bubble break (simplified) ----
  void breakBubbles(Player& p) {
    // Simplified: no bubble break in C++ server yet
    (void)p;
  }

  // ---- World update: mobs, drops, mob-to-mob, mob-to-player ----
  void updateWorld(int mapId, float dt, std::vector<Player*>& players) {
    const auto& map = MAPS[mapId];
    auto* collider = wallColliders_[mapId].get();
    auto& mobs = worldMobs_[mapId];
    auto& proj = worldProjectiles_[mapId];

    // Filter players on this map
    std::vector<Player*> here;
    for (auto* p : players) {
      if (p->mapId == mapId) here.push_back(p);
    }

    // ---- Update all mobs ----
    for (int i = (int)mobs.size() - 1; i >= 0; i--) {
      auto& mob = mobs[i];
      mob.hitCd = std::max(0.f, mob.hitCd - dt);
      mob.spawnProtection = std::max(0.f, mob.spawnProtection - dt);
      mob.thinkTimer -= dt;

      // ---- Movement ----
      if (mob.speed > 0) {
        // Simple movement toward target or wander
        if (mob.targetId != 0) {
          // Find target
          bool found = false;
          float tx = 0, ty = 0;
          for (auto* p : here) {
            if (p->id == (uint16_t)mob.targetId) {
              tx = p->x; ty = p->y; found = true; break;
            }
          }
          if (!found) {
            for (auto& other : mobs) {
              if (other.id == mob.targetId) { tx = other.x; ty = other.y; found = true; break; }
            }
          }
          if (found) {
            float dx = tx - mob.x, dy = ty - mob.y, d = std::hypot(dx, dy);
            if (d > 0.01f) {
              mob.vx += ((dx / d) * mob.speed - mob.vx) * std::min(1.f, dt * 4.f);
              mob.vy += ((dy / d) * mob.speed - mob.vy) * std::min(1.f, dt * 4.f);
              mob.angle = std::atan2(dy, dx);
            }
          } else {
            mob.targetId = 0;
          }
        } else {
          // Wander
          mob.wander -= dt;
          if (mob.wander <= 0) {
            mob.wander = 1.5f + (float)(rand() % 3000) / 1000.f;
            mob.angle = (float)(rand() % 6283) / 1000.f;
          }
          mob.vx += (std::cos(mob.angle) * mob.speed * 0.4f - mob.vx) * std::min(1.f, dt * 2.f);
          mob.vy += (std::sin(mob.angle) * mob.speed * 0.4f - mob.vy) * std::min(1.f, dt * 2.f);
        }
      } else {
        mob.vx *= 0.9f;
        mob.vy *= 0.9f;
      }

      // ---- Position update ----
      mob.x += mob.vx * dt;
      mob.y += mob.vy * dt;
      mob.x = std::clamp(mob.x, mob.radius, map.width - mob.radius);
      mob.y = std::clamp(mob.y, mob.radius, map.height - mob.radius);

      // ---- Wall collision (ArrayWallCollider) ----
      auto [wallX, wallY] = collider->collideCircle(mob.x, mob.y, mob.radius, &collisionCounter, MOB_WALL_INFLATE);
      float stuckThreshold = std::max(PUSH_OUT_THRESHOLD, mob.radius * 0.5f);
      bool stuck = std::abs(wallX - mob.x) >= stuckThreshold || std::abs(wallY - mob.y) >= stuckThreshold;
      if (stuck && mob.pushOutCooldown <= 0) {
        mob.pushOutCooldown = 0.8f;
        pushOutOfWall(mob, mapId, *collider, map);
      } else {
        mob.x = wallX; mob.y = wallY;
      }
      mob.pushOutCooldown = std::max(0.f, mob.pushOutCooldown - dt);

      // ---- Mob-to-mob collision ----
      bool isStationary = mob.speed <= 0;
      if (!isStationary) {
        mob.collisionTimer -= dt;
        if (mob.collisionTimer <= 0) {
          float interval = mob.speed <= MOB_COLLISION_SLOW_SPEED
            ? MOB_COLLISION_SLOW_INTERVAL : MOB_COLLISION_FAST_INTERVAL;
          mob.collisionTimer = interval + (float)(rand() % 20) / 1000.f;

          for (auto& other : mobs) {
            if (&other == &mob) continue;
            collisionCounter.n++;
            float dx = mob.x - other.x, dy = mob.y - other.y;
            float d = std::hypot(dx, dy);
            float minDist = mob.radius + other.radius;
            if (d < minDist && d > 0.001f) {
              float push = (minDist - d) * 0.4f;
              mob.x += (dx / d) * push;
              mob.y += (dy / d) * push;

              // Hostile vs friendly combat
              if (mob.friendly != other.friendly && mob.hitCd <= 0) {
                auto& attacker = mob.friendly ? mob : other;
                auto& victim = mob.friendly ? other : mob;
                if (victim.spawnProtection <= 0) {
                  float dmg = attacker.damage * 0.6f;
                  victim.hp -= dmg;
                  victim.lastHitBy = attacker.ownerId;
                }
                mob.hitCd = 0.1f;
                other.hitCd = 0.1f;
              }
            }
          }
        }
      }

      // ---- Mob-to-player collision ----
      if (!mob.friendly) {
        for (auto* p : here) {
          collisionCounter.n++;
          float d = std::hypot(p->x - mob.x, p->y - mob.y);
          float pRadius = PLAYER_RADIUS; // simplified
          if (d < mob.radius + pRadius) {
            float push = (mob.radius + pRadius - d) * 0.5f;
            float ux = (p->x - mob.x) / (d > 0.001f ? d : 1);
            float uy = (p->y - mob.y) / (d > 0.001f ? d : 1);
            p->x += ux * push;
            p->y += uy * push;
            mob.x -= ux * push * 0.4f;
            mob.y -= uy * push * 0.4f;

            if (p->hurtCd <= 0) {
              float dmg = mob.damage;
              if (p->shield > 0 && dmg > 0) {
                float absorbed = std::min(p->shield * 2.f, dmg);
                p->shield -= absorbed / 2.f;
                dmg -= absorbed;
              }
              p->hp -= dmg;
              p->hurtCd = 0.1f;
              p->statsDirty = true;
              if (p->hp <= 0) killPlayer(*p);
            }

            // Player body-contact damage to mob
            if (mob.hitCd <= 0 && mob.hp > 0 && p->bodyDamage > 0) {
              float bodyDmg = std::max(1.f, p->bodyDamage); // talent bonus simplified
              mob.hp -= bodyDmg;
              mob.lastHitBy = p->id;
              mob.hitCd = 0.1f;
            }
          }
        }
      }

      // ---- Death check ----
      if (mob.hp <= 0) {
        mobs.erase(mobs.begin() + i);
      }
    }
  }

  // ---- Mob push out of wall (8-direction + zone random) ----
  void pushOutOfWall(Mob& mob, int mapId, const ArrayWallCollider& collider, const MapDef& map) {
    float ox = mob.x, oy = mob.y;
    float r = mob.radius;
    float angles[8] = {0, 45, 90, 135, 180, 225, 270, 315};
    for (int i = 0; i < 8; i++) {
      float rad = angles[i] * (M_PI / 180.f);
      for (float step = 5; step <= 50; step += 5) {
        float tx = ox + std::cos(rad) * step;
        float ty = oy + std::sin(rad) * step;
        if (tx < r || tx > map.width - r || ty < r || ty > map.height - r) continue;
        if (collider.isFree(tx, ty, r, MOB_WALL_INFLATE)) {
          mob.x = tx; mob.y = ty;
          mob.vx = std::cos(rad + (float)M_PI) * 5;
          mob.vy = std::sin(rad + (float)M_PI) * 5;
          return;
        }
      }
    }
    // Fallback: teleport to center
    mob.x = map.width * 0.5f;
    mob.y = map.height * 0.5f;
    auto [cx, cy] = collider.collideCircle(mob.x, mob.y, r, nullptr, MOB_WALL_INFLATE);
    mob.x = cx; mob.y = cy;
    mob.vx = 0; mob.vy = 0;
  }

  // ---- Petal update with petal-to-mob collision ----
  void updatePetals(Player& p, float dt) {
    if (!p.alive) return;
    auto& mobs = worldMobs_[p.mapId];

    int liveCount = 0;
    for (int i = 0; i < SLOT_COUNT; i++) {
      if (p.petals[i].alive) liveCount++;
    }

    for (int i = 0; i < SLOT_COUNT; i++) {
      auto& st = p.petals[i];
      if (!st.alive) {
        st.timer -= dt;
        if (st.timer <= 0) {
          st.alive = true;
          st.hp = st.maxHp = 100; // simplified
          st.timer = 0;
          st.x = p.x; st.y = p.y;
          st.specialTimer = 0;
          st.absorbTimer = 0;
        }
        continue;
      }

      st.hitCd = std::max(0.f, st.hitCd - dt);
      st.targetCheckTimer--;

      // Orbit around player
      float slotAngle = p.baseAngle + (float)i / (float)std::max(1, liveCount) * (float)M_PI * 2;
      float tx = p.x + std::cos(slotAngle) * p.orbit;
      float ty = p.y + std::sin(slotAngle) * p.orbit;
      st.x += (tx - st.x) * std::min(1.f, dt * 14.f);
      st.y += (ty - st.y) * std::min(1.f, dt * 14.f);

      // Petal-to-mob collision
      if (st.hitCd <= 0) {
        float pr = 10.f; // simplified petal radius
        for (auto& mob : mobs) {
          if (mob.friendly) continue;
          collisionCounter.n++;
          float dx = mob.x - st.x, dy = mob.y - st.y;
          float rSum = mob.radius + pr;
          if (dx * dx + dy * dy < rSum * rSum) {
            float d = std::hypot(dx, dy);
            if (d < 0.001f) continue;
            float dmg = 10.f; // simplified damage
            mob.hp -= dmg;
            mob.lastHitBy = p.id;
            mob.targetId = p.id;
            st.hp -= mob.damage * 0.5f;
            st.hitCd = 0.03f;
            // Knockback
            float kb = 90.f / (mob.radius / 20.f);
            mob.vx += ((mob.x - st.x) / d) * kb;
            mob.vy += ((mob.y - st.y) / d) * kb;
            if (st.hp <= 0) {
              st.alive = false;
              st.timer = 1.0f; // simplified reload
            }
            break; // hit one mob per tick
          }
        }
      }
    }
  }

  // ---- Projectile system ----
  void updateProjectiles(int mapId, float dt, std::vector<Player*>& players) {
    auto& proj = worldProjectiles_[mapId];
    const auto& map = MAPS[mapId];
    auto* collider = wallColliders_[mapId].get();
    auto& mobs = worldMobs_[mapId];

    for (int i = (int)proj.size() - 1; i >= 0; i--) {
      auto& p = proj[i];
      // TTL
      p.ttl -= dt;
      if (p.ttl <= 0) { proj.erase(proj.begin() + i); continue; }
      p.hitCd = std::max(0.f, p.hitCd - dt);

      // Position update
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.distanceTraveled += std::hypot(p.vx * dt, p.vy * dt);
      if (p.maxDistance > 0 && p.distanceTraveled >= p.maxDistance) {
        proj.erase(proj.begin() + i); continue;
      }

      // Wall collision (non-piercing)
      if (!p.isPiercing) {
        auto [cx, cy] = collider->collideCircle(p.x, p.y, p.radius, &collisionCounter);
        if (std::abs(cx - p.x) > 0.5f || std::abs(cy - p.y) > 0.5f) {
          proj.erase(proj.begin() + i); continue;
        }
        p.x = cx; p.y = cy;
      }

      // Boundary check
      if (p.x < p.radius || p.x > map.width - p.radius ||
          p.y < p.radius || p.y > map.height - p.radius) {
        proj.erase(proj.begin() + i); continue;
      }

      // Hit detection
      if (p.team == TEAM_HOSTILE) {
        // Hostile projectile -> hit players
        for (auto* pl : players) {
          if (pl->mapId != mapId || !pl->alive || p.hitCd > 0) continue;
          float d = std::hypot(pl->x - p.x, pl->y - p.y);
          float plRadius = PLAYER_RADIUS; // simplified
          if (d < plRadius + p.radius && pl->hurtCd <= 0) {
            float dmg = p.damage;
            if (pl->shield > 0 && dmg > 0) {
              float absorbed = std::min(pl->shield * 2.f, dmg);
              pl->shield -= absorbed / 2.f;
              dmg -= absorbed;
            }
            pl->hp -= dmg;
            pl->hurtCd = 0.1f;
            pl->statsDirty = true;
            p.hitCd = PROJECTILE_HIT_CD;
            if (pl->hp <= 0) killPlayer(*pl);
            if (!p.isPiercing) { proj.erase(proj.begin() + i); break; }
            p.hp -= 1;
          }
        }
      } else {
        // Friendly projectile -> hit hostile mobs
        for (auto& mob : mobs) {
          if (mob.friendly || mob.hp <= 0 || p.hitCd > 0) continue;
          float d = std::hypot(mob.x - p.x, mob.y - p.y);
          if (d < mob.radius + p.radius) {
            mob.hp -= p.damage;
            mob.lastHitBy = p.ownerId;
            p.hitCd = PROJECTILE_HIT_CD;
            if (!p.isPiercing) { proj.erase(proj.begin() + i); break; }
            p.hp -= mob.damage;
          }
        }
      }
    }
  }

  // ---- Fire projectile ----
  int fireProjectile(int mapId, float x, float y, float angle, float speed, float damage,
                      int team, int ownerId, int sourceType, int rarity, float radius = 10,
                      bool isPiercing = false, float maxDistance = 0, float projHp = 1) {
    Projectile p;
    p.id = nextProjId_++;
    p.mapId = mapId;
    p.x = x; p.y = y;
    p.vx = std::cos(angle) * speed;
    p.vy = std::sin(angle) * speed;
    p.ttl = PROJECTILE_TTL;
    p.damage = damage;
    p.radius = radius;
    p.team = team;
    p.ownerId = ownerId;
    p.sourceType = sourceType;
    p.rarity = rarity;
    p.isPiercing = isPiercing;
    p.maxDistance = maxDistance;
    p.hp = projHp;
    worldProjectiles_[mapId].push_back(p);
    return p.id;
  }

  void killPlayer(Player& p) {
    p.alive = false;
    p.deathX = p.x;
    p.deathY = p.y;
    p.respawnIn = 5.0f;
  }
};

// ---------------------------------------------------------------- main
int main() {
  Simulation sim;
  uint16_t nextId = 1;
  using WS = uWS::WebSocket<false, true, PerSocket>;
  std::unordered_map<uint16_t, WS*> sockets;
  const int port = std::getenv("PORT") ? std::atoi(std::getenv("PORT")) : 8080;

  auto app = uWS::App().ws<PerSocket>("/*", {
      .compression = uWS::DISABLED,
      .maxPayloadLength = 4 * 1024,
      .open = [&](auto* ws) {
        ws->getUserData()->id = nextId++;
        sim.add(ws->getUserData()->id);
        sockets[ws->getUserData()->id] = ws;
      },
      .message = [&](auto* ws, std::string_view msg, uWS::OpCode) {
        Reader r{reinterpret_cast<const uint8_t*>(msg.data()), msg.size()};
        Player* p = sim.get(ws->getUserData()->id);
        if (!p) return;
        switch (r.u8v()) {
          case JOIN: {
            sim.markActive(*p);
            p->name = r.str();
            p->mapId = r.u8v();
            p->xp = r.u32v();
            Writer w; w.u8v(WELCOME); w.u16v(p->id); w.u8v(p->mapId);
            w.u16v(3200); w.u16v(3200); w.u16v(0);
            ws->send(w.view(), uWS::OpCode::BINARY);
            break;
          }
          case INPUT: {
            p->inDx = static_cast<int8_t>(r.u8v()) / 100.f;
            p->inDy = static_cast<int8_t>(r.u8v()) / 100.f;
            p->flags = r.u8v();
            if (p->inDx != p->lastInDx || p->inDy != p->lastInDy || p->flags != p->lastFlags) {
              p->lastInDx = p->inDx;
              p->lastInDy = p->inDy;
              p->lastFlags = p->flags;
              sim.markActive(*p);
            }
            break;
          }
          case AFK_ACK: {
            sim.markActive(*p, true);
            ws->send(Simulation::afkPacket(*p).view(), uWS::OpCode::BINARY);
            break;
          }
          default:
            sim.markActive(*p);
            break;
        }
      },
      .close = [&](auto* ws, int, std::string_view) {
        sockets.erase(ws->getUserData()->id);
        sim.remove(ws->getUserData()->id);
      },
  }).listen(port, [port](auto* token) {
      if (token) printf("[petalia-cpp] listening on :%d\n", port);
  });

  // 20 Hz authoritative loop
  struct us_timer_t* timer = us_create_timer((us_loop_t*)uWS::Loop::get(), 0, 0);
  static Simulation* simPtr = &sim;
  static std::unordered_map<uint16_t, WS*>* socketsPtr = &sockets;
  us_timer_set(timer, [](struct us_timer_t*) {
    simPtr->tick(0.05f);
    // AFK handling
    std::vector<uint16_t> changed;
    simPtr->updateAfk(0.05f, changed);
    for (uint16_t id : changed) {
      auto it = socketsPtr->find(id);
      if (it == socketsPtr->end()) continue;
      Player* p = simPtr->get(id);
      if (!p) continue;
      it->second->send(Simulation::afkPacket(*p).view(), uWS::OpCode::BINARY);
      if (p->kick) it->second->end(AFK_CLOSE_CODE, "afk");
    }
  }, 50, 50);

  app.run();
  return 0;
}