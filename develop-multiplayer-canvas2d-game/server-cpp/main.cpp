// Petalia.io — Full C++ game server.
// Complete authoritative game logic ported from sim.ts + defs.ts.
//
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
#include <sstream>
#include <functional>
#include <set>
#include <map>
#include <ctime>
#include <numeric>
#include <fstream>
#include <filesystem>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// =====================================================================
// Constants
// =====================================================================
constexpr int SLOT_COUNT = 10;
constexpr int SECONDARY_SLOT_COUNT = 10;
constexpr int HOTBAR_CELLS = SLOT_COUNT + SECONDARY_SLOT_COUNT;
constexpr int BAG_COUNT = 32;
constexpr int BAG_MAX = 4096;
constexpr int TOTAL_CELLS = HOTBAR_CELLS + BAG_MAX;
constexpr uint8_t EMPTY_ITEM = 255;
constexpr int MAX_RARITY = 10;
constexpr int MAX_CRAFT_RARITY = 9;
constexpr int CRAFT_CARD_COUNT = 5;
constexpr float CRAFT_CARDS_PER_ATTEMPT = 3.5f;
constexpr int ORACLE_SKIP = 1;
constexpr float ORACLE_COOLDOWN_HOURS = 2;
constexpr float TRADE_COOLDOWN_HOURS = 3;
constexpr int TRINKET_ITEM = 10;
constexpr int CLOVER_ITEM = 11;
constexpr int ROSE_ITEM = 30;
constexpr int SHELL_ITEM = 38;
constexpr int ANTENNAE_ITEM = 43;
constexpr int THIRD_EYE_ITEM = 48;
constexpr int MISSILE_ITEM = 52;
constexpr float ROSE_HEAL_DELAY = 1.0f;
constexpr float ROSE_ABSORB_TIME = 0.4f;
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
constexpr float PETAL_TARGET_RECHECK_FRAMES = 3;
constexpr float MOB_WALL_CELL_SIZE = 250.f;
constexpr float REGION_SIZE = 2000.f;
constexpr float VIEW_RADIUS = 1300.f;
constexpr float VIEW_SCALE = 1.0f; // 视野缩放系数，可调整碰撞检测的范围
constexpr float ZONE_REFILL_INTERVAL = 5.f;
constexpr int BLOCK_GRID_COLS = 40;
constexpr int BLOCK_GRID_ROWS = 40;
constexpr int SQUAD_CODE_LENGTH = 6;
constexpr int SQUAD_MAX_MEMBERS = 4;
constexpr int SQUAD_LEVEL_GAP_MAX = 30;
constexpr float DNA_UPGRADE_BASE_CHANCE = 0.01f;
constexpr float DEFAULT_SPAWN_PROTECTION = 1.0f;
constexpr int MAX_DROPPED_CARDS = 220;
constexpr int DROP_TRIM_COUNT = 5;
constexpr float DROP_STACK_RADIUS = 34;
constexpr int DROP_STACK_MAX = 99;
constexpr float AFK_IDLE_SECONDS = 180.f;
constexpr float AFK_CHECK_SECONDS = 45.f;
constexpr int AFK_CLOSE_CODE = 4001;
constexpr int MAGIC_CORE_ITEM = -1;

// =====================================================================
// Protocol opcodes
// =====================================================================
enum C2S : uint8_t {
  C2S_JOIN = 1, C2S_INPUT = 2, C2S_SWAP = 3, C2S_CRAFT = 4,
  C2S_CHANGE_MAP = 5, C2S_RESPAWN = 6, C2S_PING = 7, C2S_ORACLE = 8,
  C2S_TRADE = 9, C2S_SWAP_ROW = 10, C2S_BONUS_STATUS = 11, C2S_CHAT = 12,
  C2S_AFK_ACK = 13, C2S_TALENT = 14, C2S_SYNC_LEVEL = 15, C2S_LOADOUT = 16,
  C2S_ARENA_CREATE = 17, C2S_ARENA_LIST = 18, C2S_ARENA_SEARCH = 19,
  C2S_ARENA_JOIN = 20, C2S_ARENA_LEAVE = 21, C2S_ARENA_WHEEL = 22,
  C2S_ARENA_READY = 23, C2S_ARENA_LOADOUT = 24
};
enum S2C : uint8_t {
  S2C_WELCOME = 1, S2C_SNAPSHOT = 2, S2C_INVENTORY = 3, S2C_STATS = 4,
  S2C_EVENT = 5, S2C_PONG = 6, S2C_CHAT = 7, S2C_SQUAD_UPDATE = 8,
  S2C_AFK_CHECK = 9, S2C_DEBUG = 10, S2C_TALENT_BONUSES = 11,
  S2C_SQUAD_MEMBER_STATE = 12, S2C_LOADOUT_DATA = 13,
  S2C_ARENA_LOBBY = 14, S2C_ARENA_UPDATE = 15, S2C_ARENA_START = 16,
  S2C_ARENA_EVENT = 17, S2C_ARENA_RESULT = 18, S2C_ARENA_LIST = 19
};
enum EntKind : uint8_t { ENT_PLAYER = 0, ENT_MOB = 1, ENT_PETAL = 2, ENT_DROP = 3, ENT_PROJECTILE = 4 };
enum Team : uint8_t { TEAM_HOSTILE = 0, TEAM_FRIENDLY = 1, TEAM_SELF = 2 };
enum EvtKind : uint8_t {
  EVT_XP = 0, EVT_LOOT = 1, EVT_CRAFT_OK = 2, EVT_CRAFT_FAIL = 3,
  EVT_DEATH = 4, EVT_KILL = 5, EVT_HIT = 6, EVT_ORACLE_OK = 7,
  EVT_ORACLE_FAIL = 8, EVT_TRADE_OK = 9, EVT_TRADE_FAIL = 10, EVT_HEAL = 11
};
enum LoadoutOp : uint8_t { LOADOUT_SAVE = 0, LOADOUT_LOAD = 1, LOADOUT_DELETE = 2 };
constexpr uint8_t SWAP_ROW_ALL = 0xff;

// =====================================================================
// Writer / Reader
// =====================================================================
struct Writer {
  std::vector<uint8_t> b;
  void u8v(uint8_t v) { b.push_back(v); }
  void i8v(int8_t v) { b.push_back(static_cast<uint8_t>(v)); }
  void u16v(uint16_t v) { b.push_back(v >> 8); b.push_back(v & 0xff); }
  void i16v(int16_t v) { u16v(static_cast<uint16_t>(v)); }
  void u32v(uint32_t v) { for (int i = 3; i >= 0; --i) b.push_back((v >> (i * 8)) & 0xff); }
  void f32v(float v) { uint32_t x; memcpy(&x, &v, 4); u32v(x); }
  void str(const std::string& s) {
    uint8_t n = static_cast<uint8_t>(s.size() > 250 ? 250 : s.size());
    b.push_back(n);
    b.insert(b.end(), s.begin(), s.begin() + n);
  }
  std::string_view view() const { return {reinterpret_cast<const char*>(b.data()), b.size()}; }
};

struct Reader {
  const uint8_t* p; size_t n; size_t o = 0;
  Reader() : p(nullptr), n(0) {}
  Reader(const uint8_t* ptr, size_t len) : p(ptr), n(len) {}
  uint8_t u8v() { return o < n ? p[o++] : 0; }
  int8_t i8v() { return static_cast<int8_t>(u8v()); }
  uint16_t u16v() { uint16_t v = (u8v() << 8); return v | u8v(); }
  int16_t i16v() { return static_cast<int16_t>(u16v()); }
  uint32_t u32v() { uint32_t v = 0; for (int i = 0; i < 4; ++i) v = (v << 8) | u8v(); return v; }
  float f32v() { uint32_t x = u32v(); float v; memcpy(&v, &x, 4); return v; }
  std::string str() {
    uint8_t len = u8v();
    std::string s;
    for (uint8_t i = 0; i < len; ++i) s.push_back(static_cast<char>(u8v()));
    return s;
  }
  size_t remaining() const { return n - o; }
};

// =====================================================================
// Forward declarations
// =====================================================================
struct Cell;
struct PetalState;
struct Mob;
struct Projectile;
struct Drop;
struct DormantMob;
struct Player;
struct ClientState;
struct Squad;
struct SquadMember;
struct LoadoutConfig;
struct TalentBonuses;
struct Wall;
struct MapDef;
class Simulation;
struct CollisionCounter;

// =====================================================================
// Map data
// =====================================================================
struct Wall { float x, y, w, h; };

struct MapDef {
  int id;
  std::string name;
  float width, height;
  std::vector<Wall> walls;
  std::vector<int> mobs;
  int mobCap;
  float rarityBias;
};

static std::vector<MapDef> makeMaps();
static const std::vector<MapDef> MAPS = makeMaps();
static const int MAP_COUNT = static_cast<int>(MAPS.size());

// =====================================================================
// Rarity definitions
// =====================================================================
struct RarityDef {
  std::string name;
  float mult;
  float enemyMult;
  float craftChance; // 0 = not craftable
};

static const std::vector<RarityDef> RARITIES = {
  {"Common", 1, 1, 0.64f},
  {"Unusual", 3, 3.75f, 0.32f},
  {"Rare", 9, 13.5f, 0.16f},
  {"Epic", 27, 54, 0.08f},
  {"Legendary", 81, 405, 0.04f},
  {"Mythic", 243, 2430, 0.02f},
  {"Ultra", 729, 24500, 0.01f},
  {"Super", 2187, 177800, 0.005f},
  {"Omega", 19683, 510510, 0.0005f},
  {"Eternal", 31415, 5059830, 0},
  {"Unique", 30000, 3059830, 0},
};

static float rarityMult(int r) {
  int idx = std::max(0, std::min(MAX_RARITY, r));
  return RARITIES[idx].mult;
}

static float enemyRarityMult(int r) {
  int idx = std::max(0, std::min(MAX_RARITY, r));
  return RARITIES[idx].enemyMult;
}

static float enemyDamageMult(int r) {
  static const float PROGRESSIVE[] = {1, 3, 9, 27, 81, 205, 620, 2187, 6561, 18000, 50683};
  int idx = std::max(0, std::min(MAX_RARITY, r));
  return PROGRESSIVE[idx];
}

static float mobSizeMult(int r) {
  static const float MULTS[] = {1, 1.2f, 1.5f, 2, 2.6f, 3.5f, 5, 6.5f, 8, 10, 10};
  int idx = std::max(0, std::min(MAX_RARITY, r));
  return MULTS[idx];
}

static float friendlyMobSizeMult(int r) {
  static const float MULTS[] = {1, 1.1f, 1.2f, 1.4f, 1.8f, 2.5f, 3.8f, 5, 6.5f, 8, 8};
  int idx = std::max(0, std::min(MAX_RARITY, r));
  return MULTS[idx];
}

static float craftChanceFor(int r) {
  if (r < 0 || r >= (int)RARITIES.size()) return 0;
  return RARITIES[r].craftChance;
}

static int xpForLevel(int level) {
  return (int)std::floor(18 * std::pow(level, 1.7));
}

static int levelFromXp(uint32_t xp) {
  int lvl = 1;
  while (lvl < 90 && xp >= (uint32_t)xpForLevel(lvl + 1)) lvl++;
  return lvl;
}

// =====================================================================
// Item definitions
// =====================================================================
enum ItemKind { IK_PETAL, IK_SUMMON, IK_TRINKET, IK_DNA };

struct ItemDef {
  int id;
  std::string name;
  ItemKind kind;
  float radius;
  float damage;
  float health;
  float reload;
  float heal;
  float healPerSec;
  float healPerSecThreshold;
  float magnetRange;
  float shieldPerSec;
  float shield;
  float healthBonus;
  float speed;
  int petMob;
  bool noDowngrade;
  float poisonDamage;
  float poisonDuration;
  float poisonInitialMult;
  float poisonStableMult;
  bool poisonCanStack;
};

static bool orbitsAsPetal(ItemKind kind) {
  return kind != IK_TRINKET;
}

static bool isAbsorbItem(int itemId) {
  return itemId == ROSE_ITEM || itemId == SHELL_ITEM;
}

static std::vector<ItemDef> makeItems() {
  std::vector<ItemDef> items;
  items.push_back({0, "Basic", IK_PETAL, 8, 10, 10, 2.0f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({1, "Leaf", IK_PETAL, 12, 8, 12, 2.0f, 0,3,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({2, "Stinger", IK_PETAL, 6, 100, 1, 8.0f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({3, "Rock", IK_PETAL, 10, 15, 55, 3.0f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({4, "Sand", IK_PETAL, 10, 14, 16, 1.0f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({5, "Bubble", IK_PETAL, 10, 3, 1, 2.6f, 0,0,1,0,0,0,0,2,0,false,0,0,0,0,false});
  items.push_back({6, "Pearl", IK_PETAL, 15, 20, 25, 3.5f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({7, "Wing", IK_PETAL, 10, 14, 9, 1.1f, 0,0,1,0,0,0,0,5,0,false,0,0,0,0,false});
  items.push_back({8, "Ladybug Egg", IK_SUMMON, 10, 4, 20, 3.0f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({9, "Stick", IK_SUMMON, 10, 6, 22, 4.0f, 0,0,1,0,0,0,0,0,11,false,0,0,0,0,false});
  items.push_back({10, "Coin", IK_PETAL, 7, 10, 15, 2.5f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({11, "Clover", IK_PETAL, 8, 6, 10, 1.0f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({12, "Soldier Ant Egg", IK_SUMMON, 10, 5, 24, 3.5f, 0,0,1,0,0,0,0,0,3,false,0,0,0,0,false});
  items.push_back({13, "Corn", IK_PETAL, 10, 3, 100, 1.1f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({14, "Worker Ant Egg", IK_SUMMON, 10, 4, 18, 3.2f, 0,0,1,0,0,0,0,0,10,false,0,0,0,0,false});
  items.push_back({15, "Rock Egg", IK_SUMMON, 11, 5, 40, 4.5f, 0,0,1,0,0,0,0,0,2,false,0,0,0,0,false});
  items.push_back({16, "Heavy", IK_PETAL, 15, 6, 80, 2.8f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({17, "Moon", IK_PETAL, 12, 1, 10000, 60.0f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({18, "Pollen", IK_PETAL, 7, 7, 11, 1.0f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({19, "Honey", IK_PETAL, 8, 5, 14, 1.0f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({20, "Bee Egg", IK_SUMMON, 10, 5, 22, 3.4f, 0,0,1,0,0,0,0,0,1,false,0,0,0,0,false});
  items.push_back({21, "Starfish", IK_PETAL, 10, 11, 15, 1.2f, 0,5,0.75f,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({22, "Salt", IK_PETAL, 10, 10, 9, 1.0f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({23, "Starfish Egg", IK_SUMMON, 10, 4, 24, 3.6f, 0,0,1,0,0,0,0,0,9,false,0,0,0,0,false});
  items.push_back({24, "Jelly", IK_PETAL, 8, 8, 12, 1.1f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({25, "Lightning", IK_PETAL, 7, 30, 6, 1.4f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({26, "Jellyfish Egg", IK_SUMMON, 10, 5, 20, 3.5f, 0,0,1,0,0,0,0,0,7,false,0,0,0,0,false});
  items.push_back({27, "Claw", IK_PETAL, 11, 22, 12, 3.5f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({28, "Powder", IK_PETAL, 8, 9, 11, 3.0f, 0,0,1,0,0,0,0,10,0,false,0,0,0,0,false});
  items.push_back({29, "Crab Egg", IK_SUMMON, 10, 6, 26, 8.0f, 0,0,1,0,0,0,0,0,8,false,0,0,0,0,false});
  items.push_back({30, "Rose", IK_PETAL, 12, 1, 5, 3.5f, 7.5f,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({31, "Light", IK_PETAL, 8, 6, 10, 1.0f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({32, "Glass", IK_PETAL, 8, 12, 8, 2.5f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({33, "Bone", IK_PETAL, 10, 14, 18, 1.5f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({34, "Beetle Egg", IK_SUMMON, 11, 6, 28, 5.0f, 0,0,1,0,0,0,0,0,6,false,0,0,0,0,false});
  items.push_back({35, "Pincer", IK_PETAL, 8, 20, 11, 3.0f, 0,0,1,0,0,0,0,0,0,false,8,3000,1.3f,0.5f,false});
  items.push_back({36, "Iris", IK_PETAL, 10, 10, 12, 2.5f, 0,0,1,0,0,0,0,0,0,false,10,2000,1.1f,0.8f,false});
  items.push_back({37, "Scorpion Egg", IK_SUMMON, 10, 7, 26, 4.5f, 0,0,1,0,0,0,0,0,5,false,0,0,0,0,false});
  items.push_back({38, "Shell", IK_PETAL, 16, 6, 20, 3.5f, 0,0,1,0,0,12,0,0,0,false,0,0,0,0,false});
  items.push_back({39, "Magnet", IK_PETAL, 10, 4, 10, 1.0f, 0,0,1,80,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({40, "Shell Egg", IK_SUMMON, 10, 4, 22, 8.0f, 0,0,1,0,0,0,0,0,12,false,0,0,0,0,false});
  items.push_back({41, "Cactus", IK_PETAL, 12, 8, 22, 1.5f, 0,0,1,0,0,0,100,0,0,false,0,0,0,0,false});
  items.push_back({42, "Cactus Egg", IK_SUMMON, 10, 5, 26, 4.0f, 0,0,1,0,0,0,0,0,4,false,0,0,0,0,false});
  items.push_back({43, "Antennae", IK_TRINKET, 10, 4, 1, 1.5f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({44, "Soil", IK_PETAL, 12, 4, 10, 2.5f, 0,0,1,0,0,0,100,0,0,false,0,0,0,0,false});
  items.push_back({45, "Fang", IK_PETAL, 10, 4, 18, 2.5f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({46, "Orange", IK_PETAL, 18, 25, 18, 3.5f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({47, "Ant Hole Egg", IK_SUMMON, 14, 1, 22, 15.5f, 0,0,1,0,0,0,0,0,10,false,0,0,0,0,false});
  items.push_back({48, "Third Eye", IK_TRINKET, 10, 0, 0, 1.0f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  items.push_back({49, "Hornet Egg", IK_SUMMON, 14, 1, 10, 5.5f, 0,0,1,0,0,0,0,0,16,false,0,0,0,0,false});
  items.push_back({50, "Faster", IK_PETAL, 10, 10, 10, 2.5f, 0,0,1,0,0,0,0,10,0,false,0,0,0,0,false});
  items.push_back({51, "Spider Egg", IK_SUMMON, 12, 1, 10, 8.0f, 0,0,1,0,0,0,0,0,17,false,0,0,0,0,false});
  items.push_back({52, "Missile", IK_PETAL, 10, 15, 10, 2.0f, 0,0,1,0,0,0,0,0,0,false,0,0,0,0,false});
  return items;
}

static const std::vector<ItemDef> ITEMS = makeItems();

// =====================================================================
// Mob definitions
// =====================================================================
struct MobDef {
  int id;
  std::string name;
  float radius;
  float health;
  float damage;
  float speed;
  int xp;
  std::vector<std::pair<int, float>> drops; // item, chance
  bool isSpawner;
  std::vector<float> spawnThresholds;
  std::vector<int> spawnMobIds;
};

static std::vector<MobDef> makeMobs() {
  std::vector<MobDef> mobs;
  mobs.push_back({0, "Ladybug", 22, 100, 10, 42, 10, {{30,0.7f},{31,0.7f},{8,0.07f}}, false, {}, {}});
  mobs.push_back({1, "Bee", 18, 50, 50, 62, 14, {{2,0.7f},{18,0.7f},{19,0.7f},{20,0.06f}}, false, {}, {}});
  mobs.push_back({2, "Rock", 26, 300, 30, 0, 12, {{15,0.32f},{3,0.7f},{16,0.7f},{17,0.005f}}, false, {}, {}});
  mobs.push_back({3, "Soldier Ant", 17, 100, 15, 60, 9, {{7,0.7f},{11,0.7f},{12,0.07f}}, false, {}, {}});
  mobs.push_back({4, "Cactus", 25, 120, 70, 0, 18, {{41,0.7f},{42,0.07f}}, false, {}, {}});
  mobs.push_back({5, "Scorpion", 21, 100, 15, 70, 24, {{36,0.7f},{37,0.28f},{35,0.7f}}, false, {}, {}});
  mobs.push_back({6, "Beetle", 23, 100, 24, 48, 20, {{33,0.7f},{35,0.7f},{36,0.7f}}, false, {}, {}});
  mobs.push_back({7, "Jellyfish", 22, 78, 28, 38, 20, {{24,0.7f},{25,0.7f},{26,0.07f}}, false, {}, {}});
  mobs.push_back({8, "Crab", 24, 120, 32, 44, 26, {{27,0.7f},{28,0.7f},{29,0.07f},{4,0.7f}}, false, {}, {}});
  mobs.push_back({9, "Starfish", 20, 95, 18, 36, 18, {{21,0.7f},{22,0.7f},{4,0.7f},{23,0.07f}}, false, {}, {}});
  mobs.push_back({10, "Worker Ant", 14, 50, 10, 68, 6, {{1,0.7f},{13,0.7f},{14,0.07f}}, false, {}, {}});
  mobs.push_back({11, "Sandstorm", 28, 150, 22, 24, 22, {{9,0.18f},{4,0.7f},{32,0.7f}}, false, {}, {}});
  mobs.push_back({12, "Shell", 22, 100, 14, 18, 16, {{38,0.7f},{39,0.7f},{6,0.7f},{40,0.07f}}, false, {}, {}});
  mobs.push_back({13, "Ant Hole", 30, 650, 8, 0, 60, {{44,0.55f},{47,0.55f},{31,0.05f},{39,0.04f}}, true, {0.85f,0.60f,0.35f,0.10f}, {10,3}});
  mobs.push_back({14, "Crab Cave", 30, 350, 20, 0, 35, {{27,0.55f},{28,0.55f},{29,0.05f},{4,0.55f},{5,0.25f}}, true, {0.85f,0.60f,0.35f,0.10f}, {8,8}});
  mobs.push_back({15, "Hive", 28, 600, 60, 0, 28, {{2,0.55f},{18,0.55f},{19,0.55f},{20,0.05f}}, true, {0.85f,0.60f,0.35f,0.10f}, {1,1}});
  mobs.push_back({16, "Hornet", 16, 80, 22, 50, 18, {{43,0.7f},{46,0.7f},{49,0.7f},{52,0.5f}}, false, {}, {}});
  mobs.push_back({17, "Spider", 18, 80, 22, 50, 18, {{51,0.7f},{45,0.7f},{50,0.7f},{48,0.01f}}, false, {}, {}});
  return mobs;
}

static const std::vector<MobDef> MOBS = makeMobs();

// =====================================================================
// Block zones and spawn weights
// =====================================================================
struct ZoneEntry { int rarityIndex; float chance; };

static std::unordered_map<std::string, std::vector<ZoneEntry>> BLOCK_ZONES = {
  {"A", {{0,0.80f},{1,0.20f}}},
  {"B", {{0,0.20f},{1,0.70f},{2,0.10f}}},
  {"C", {{1,0.20f},{2,0.70f},{3,0.10f}}},
  {"D", {{2,0.10f},{3,0.75f},{4,0.15f}}},
  {"E", {{3,0.10f},{4,0.75f},{5,0.15f}}},
  {"F", {{4,0.05f},{5,0.90f},{6,0.05f}}},
  {"G", {{5,0.05f},{6,0.89f},{7,0.05f},{8,0.01f}}},
};

static const std::vector<std::string> ZONE_LETTERS = {"A","B","C","D","E","F","G"};

static std::unordered_map<int, std::unordered_map<int, float>> SPAWN_WEIGHTS = {
  {0, {{0,30},{1,50},{2,10},{3,50},{10,40},{13,5},{15,5},{16,10},{17,40}}},
  {1, {{4,30},{5,40},{6,50},{2,15},{11,20}}},
  {2, {{7,40},{8,50},{9,40},{12,30},{14,5}}},
};

static std::unordered_map<std::string, int> ZONE_MOB_LIMITS = {
  {"A",10},{"B",20},{"C",25},{"D",30},{"E",16},{"F",15},{"G",10},
};

// Grids for each map (40x40)
static const std::vector<std::string> MAP_GRID_0 = {
  "1111111111111111111111111111111111111111",
  "1111111111111111111111111111111111111111",
  "11CCC1111111CC1111CC11111CC111111CCCC111",
  "11CCCCC111111C1111CCC1111C11111CCCCC1111",
  "1111CCCCCCCCCCC1111CC111CC11CCCCCC111111",
  "1111CCCCCCCCCCCCC11BC11CCCCCCCCCC1111111",
  "11111CCCCCCCCCCCCC11BBCCCCCCCCCCC1111C11",
  "1111CCCCC111111CCBBBBBBCC111CCCCCCCCCC11",
  "1111CCCC111111111BBBBBBB111111CCCCDDD111",
  "111DDCC111111G111BBBBBB11111111CCCDD1111",
  "111DDD11111GGGG11BBBBBB111111111CDDD1111",
  "111DDD111GGGGGG111BBBBBB11111111DDDD1111",
  "11DDDD111GGGGGG111B1BBBB111111111DDD1111",
  "11DDDDD11GGGGGGG11BBBB11111111111DDD1111",
  "11DD1DD11GGGGGGG11BBB11111GGG1111DDD1111",
  "11DD1DD111GGGGG111BB11111GGGGGG11DDD1111",
  "11DD1DD1111GG11111BB1111GGG1GGG11DDD1111",
  "111DDDD1111GG11111BB1111GGG11GG111DD1111",
  "111DDDD111GGG1111ABAAA111GG11GG111DDD111",
  "11DDD1D111GGG1111AAAAA111GG11GGG11DDD111",
  "11D1D1D1111GGG111AA2AA111GG11GGG11DDD111",
  "11D1DDD1111GGG1111AAA1111GG11GG111DDD111",
  "11D1DDDE1111GG11111111111GG11GG111DDD111",
  "11EEED1E1111GG1111111111GGG11FGG11EEE111",
  "1111EE1E1111GGG111111111GGG11FF111EEE111",
  "111EEEEE1111GGG1F111111GGG111FF111EEE111",
  "11EEEEE11111FFFFFG111GGGGG111FFF111EE111",
  "11E1EE11111FFFFFFG1GGGGG1111FFFF111EE111",
  "1111E1111111FFF1GGGGGGG111111FFF11EEE111",
  "111EE1111111FFF11GGGGG111111FFFF11EE1111",
  "111EE1111111FF111GGG11111111FFFF11EE1111",
  "11EEE111111FF111111111111111FFFFFEEE1111",
  "11EEE1111FFF111F111111111111FFFFFEEEE111",
  "111EEE1FFFFF11FFFF11FFF111FFFFFFFEEEE111",
  "111EEEFFF11FFFFFFFFFFFFFFFFFFFFEEEEEEE11",
  "111EEEEF111FFFF1FFFF111FFFFFFFFEEEEEEE11",
  "111EEEEEF1FFFF111FFFFFFFFFFFFFFEEEEEEE11",
  "1111EEEEFFFFFFFFFFFFFFFF111FFFEEEEEEE111",
  "1111111111111111111111111111111111111111",
  "1111111111111111111111111111111111111111",
};

static const std::vector<std::string> MAP_GRID_1 = {
  "1111111111111111111111111111111111111111",
  "1111111111111111111111111111111111111111",
  "1111AAAAA11BB11111BB11111111111111111111",
  "11A2AAAAAABBBBBB1BBBBB111111CCCCDD111111",
  "11AAAAAAAABBBBBBBBBBBBB1111CCCCDDDDD1111",
  "111AAAAAAABB11BBBB1BBBC1CCCCCCD1DDDD1111",
  "111111AA11B111BB111BBBCCCCCCCDD111DD1111",
  "111111111111111B11111CCCC111CDD111DD1111",
  "11111111111111111111CCC111111DDD11DDD111",
  "1111111111111111111CCC11111111DD111DD111",
  "111111111111111111CCCC111111111DD11DD111",
  "11111111111111111CCCCCCC1111111DDD1DD111",
  "1111FF11111111111CCCCCCCCC111111DDDDDD11",
  "1111FF111111111CCCCCCCCCCCC111111DDDDE11",
  "111FFFF11111DDDDDDD111DDDDCC11111111DEE1",
  "111FFF111111DDDDD111111DDDD111111111EE11",
  "111FFF111111DDDDD11111DDDDD1111111111111",
  "111FFF111111DDDDDDDDDDDDDDD1111111111111",
  "11FFFFF1111111DDDDDDDDDDD111111111111111",
  "11FFFFF111111DDDDDDDDD111111111111111111",
  "1111FFF111111DDD111DDD11111111111GG11111",
  "1111EFE1111EEDD1111DD111111111GGGGGG1111",
  "1111EEEEEEEEEDD1111DD11111111GGGGGGG1111",
  "1111EEEEEEEEEE11111EE11111111GGGGGGGG111",
  "1111EEEEEEEE1111111EE1111111GGGGGGGGG111",
  "111EEEEEEEEE111111EEE111111GGGGGGGGGGG11",
  "1111EFFFFFF111111EEEE11111GGGGGGG11GGG11",
  "1111FFFFFFF111111EEE11111GGGGGGG111GGG11",
  "111FFFFFFF111111EEE11111FGGGGGGG111GGG11",
  "1111FFFFFF111111EE11111FGGGGGGGG111GGG11",
  "1111FFFFF1111111EE1111FFFFGG1GGGG1GGGG11",
  "111FFFFFF111111EEEEE1FFFFFG11GGGGGGGG111",
  "111FFFFFF1111111EEEFFFFFF11111GGGGGGG111",
  "111FFFFFFF111111EEEFFFFFF111111GGGGGG111",
  "11FFFFFFFF1111111EFFFFFFFFF1111GGGGG1111",
  "11FFFFGFFF1111111111FFFFFFFFGGGGGGG11111",
  "111FFFFFFF111111111111FFFFFFGGGGGG111111",
  "1111F1FF111111111111111111FFFGGG11111111",
  "1111111111111111111111111111111111111111",
  "1111111111111111111111111111111111111111",
};

static const std::vector<std::string> MAP_GRID_2 = {
  "1111111111111111111111111111111111111111",
  "1111111111111111111111111111111111111111",
  "1111GG11111111111111111111EEEEDDDDDDD111",
  "111GGG111111111111111111EEEEEEEDDDDDDD11",
  "111GGGGGGG111111111FFFEEEEEEEEEDD11DDD11",
  "111GGGGGGGG11111111FFFFEEEEEEEE11111DD11",
  "111GGGGGGGGG111111FFFFFFEEEEEE111111DD11",
  "111GGG11GGGG1111111FFFFFEEEE111111DDDD11",
  "111GGG111GGGG111111FFFFFEE11111111DDDD11",
  "111GGGG111GGF111111FFFFFE111111111DDD111",
  "111GGGG11GGFFF111111FFFF1111111111DD1111",
  "111GGGGGGGFFFF111111FF1111111111DDD11111",
  "111GGFFFFFFFFF111111FF1111111111DDD11111",
  "111FFFFFFFF1FFF11111111111111DDDDDD11111",
  "111FFFFFF111FFF1111111111111DDDDDDDD1111",
  "111FFFFFF1111EE1111111111111DDD111DDD111",
  "1111FFFFF111EEEE111111111111DDDD111CC111",
  "1111FFFFFFFEEEEE1111111111111CCCC1CCC111",
  "1111FFFFFFEEEEEE111111111111111CCCCC1111",
  "1111FFFFFEEEEEED1111111D11111111CCCC1111",
  "111111FFEEEEEEDD111111DD11111111CCCC1111",
  "111111FEEEEEEDDDD1111DD111111111CCCC1111",
  "11111111EEEEDDDDD11CCDD111111111CC1C1111",
  "11111111111EEDDDDCCCCC111111111CCC1C1111",
  "111111111111111DDCCCCC11111111CC1CCC1111",
  "111111111111111CCCCC111111111BB11CCC1111",
  "11111111111111DDCCCC1111C1111BBBCC111111",
  "1111111111111DD11CCC11CCB1111BBB11111111",
  "111111111DDDDD1111CCCCCC1111BBB111111111",
  "11111111DDDD11111CCCCCB1111BBB1111111111",
  "1111111DDD1111111CCCBBBB1111BB1111111111",
  "111EE11EE1111111CCC11BBBB1111BB111111111",
  "11EEEE1EE111111CC11111BBBBBBBBAA11111111",
  "11EEEEEEE11111CC11111BB11BBBBBAAAAAA1111",
  "11FEEEEE1111111111111BB111BB111AA1AA1111",
  "11FEEEEEEE1111111111BB111BB1111AAA2AA111",
  "11FEEEEEEE111111111BB111BB11111AAAAAA111",
  "11FEE1E111111111111B111111111111A1AA1111",
  "1111111111111111111111111111111111111111",
  "1111111111111111111111111111111111111111",
};

static std::vector<std::vector<std::string>> MAP_GRIDS = {MAP_GRID_0, MAP_GRID_1, MAP_GRID_2, {}};

static std::string getBlockAt(int mapId, float x, float y) {
  if (mapId < 0 || mapId >= (int)MAP_GRIDS.size()) return "1";
  const auto& grid = MAP_GRIDS[mapId];
  if (grid.empty()) return "1";
  const auto& map = MAPS[mapId];
  float tileW = map.width / BLOCK_GRID_COLS;
  float tileH = map.height / BLOCK_GRID_ROWS;
  int col = (int)std::floor(x / tileW);
  int row = (int)std::floor(y / tileH);
  if (row < 0 || row >= BLOCK_GRID_ROWS || col < 0 || col >= BLOCK_GRID_COLS) return "1";
  char ch = grid[row][col];
  if (ch == '2') return "A";
  return std::string(1, ch);
}

static int rollZoneRarity(const std::string& zone) {
  auto it = BLOCK_ZONES.find(zone);
  if (it == BLOCK_ZONES.end()) return 0;
  float roll = (float)rand() / (float)RAND_MAX;
  float cumulative = 0;
  for (const auto& entry : it->second) {
    cumulative += entry.chance;
    if (roll <= cumulative) return std::min(entry.rarityIndex, MAX_RARITY);
  }
  return std::min(it->second.back().rarityIndex, MAX_RARITY);
}

static std::vector<std::pair<int,int>> findSpawnTiles(int mapId) {
  std::vector<std::pair<int,int>> result;
  if (mapId < 0 || mapId >= (int)MAP_GRIDS.size()) return result;
  const auto& grid = MAP_GRIDS[mapId];
  if (grid.empty()) return result;
  for (int row = 0; row < BLOCK_GRID_ROWS; row++) {
    for (int col = 0; col < BLOCK_GRID_COLS; col++) {
      if (grid[row][col] == '2') result.push_back({row, col});
    }
  }
  return result;
}

static int pickWeightedMob(int mapId, const std::vector<int>& defaultMobs) {
  auto it = SPAWN_WEIGHTS.find(mapId);
  if (it == SPAWN_WEIGHTS.end()) {
    return defaultMobs[rand() % defaultMobs.size()];
  }
  float totalWeight = 0;
  for (int mobType : defaultMobs) {
    auto wit = it->second.find(mobType);
    totalWeight += (wit != it->second.end()) ? wit->second : 1;
  }
  float r = (float)rand() / (float)RAND_MAX * totalWeight;
  for (int mobType : defaultMobs) {
    auto wit = it->second.find(mobType);
    float w = (wit != it->second.end()) ? wit->second : 1;
    r -= w;
    if (r <= 0) return mobType;
  }
  return defaultMobs.back();
}

// Drop rarity tables — matches defs.ts RARITY_DROP_RATES exactly
// RARITY_DROP_RATES[mobRarityIdx][dropRarityIdx] = probability
static const float RARITY_DROP_RATES[11][11] = {
  // Common
  {0.80f, 0.20f, 0,    0,    0,   0,   0,   0,   0,   0,   0},
  // Unusual
  {0.45f, 0.55f, 0,    0,    0,   0,   0,   0,   0,   0,   0},
  // Rare
  {0.25f, 0.60f, 0.15f,0,    0,   0,   0,   0,   0,   0,   0},
  // Epic
  {0,     0.13f, 0.77f,0.10f,0,   0,   0,   0,   0,   0,   0},
  // Legendary
  {0,     0,     0.10f,0.86f,0.04f,0,   0,   0,   0,   0,   0},
  // Mythic
  {0,     0,     0,    0.08f,0.90f,0.02f,0,   0,   0,   0,   0},
  // Ultra
  {0,     0,     0,    0,    0.38f,0.617f,0.003f,0, 0,   0,   0},
  // Super
  {0,     0,     0,    0,    0,   0.88f,0.1199f,0.0001f,0,0, 0},
  // Omega
  {0,     0,     0,    0,    0,   0.15f,0.845f,0.005f,0, 0,   0},
  // Eternal
  {0,     0,     0,    0,    0,   0.01f,0.96f, 0.02f, 0, 0,   0},
  // Unique
  {0,     0,     0,    0,    0,   0,   0,    0,    0,  0,   0},
};

/**
 * Pick the rarity of a single drop from the mob's rarity row.
 * The `chance` parameter influences the rarity selection:
 *   - Higher chance (e.g. 0.7) → the item is common, rolls toward lower rarities
 *   - Lower chance (e.g. 0.005) → the item is rare, rolls toward higher rarities
 * The chance is used as an inverse bias: 1 - chance shifts probability mass
 * toward higher rarities when the item is rare.
 */
static int getDropRarityByItem(int mobRarityIdx, float chance = 0.5f) {
  int idx = std::max(0, std::min(MAX_RARITY, mobRarityIdx));
  float rarityBias = std::max(0.0f, std::min(1.0f, 1.0f - chance));

  // Copy weights and apply bias
  float weights[11];
  int nWeights = 0;
  for (int i = 0; i <= MAX_RARITY; i++) {
    weights[i] = std::max(0.0f, RARITY_DROP_RATES[idx][i]);
    if (weights[i] > 0) nWeights = i + 1;
  }

  if (rarityBias > 0.001f) {
    // Shift probability mass toward higher rarities
    for (int i = 0; i < nWeights; i++) {
      float t = (float)i / std::max(1, nWeights - 1); // 0..1, 0 = lowest, 1 = highest
      weights[i] *= (1.0f + (t - 0.5f) * rarityBias * 2.0f);
    }
  }

  float total = 0;
  for (int i = 0; i < nWeights; i++) total += std::max(0.0f, weights[i]);
  if (total <= 0) return 0;

  float roll = (float)rand() / (float)RAND_MAX * total;
  for (int i = 0; i < nWeights; i++) {
    float w = std::max(0.0f, weights[i]);
    if (w <= 0) continue;
    roll -= w;
    if (roll <= 0) return i;
  }
  return nWeights - 1;
}

// =====================================================================
// Summon config
// =====================================================================
struct SummonCfg {
  int maxCount;
  int spawnCount;
  float spawnProtection;
};

static std::unordered_map<int, SummonCfg> SUMMON_CFG = {
  {8,  {1, 1, DEFAULT_SPAWN_PROTECTION}},
  {9,  {2, 2, DEFAULT_SPAWN_PROTECTION}},
  {12, {3, 1, DEFAULT_SPAWN_PROTECTION}},
  {14, {4, 2, DEFAULT_SPAWN_PROTECTION}},
  {15, {1, 1, 1.5f}},
  {20, {1, 1, DEFAULT_SPAWN_PROTECTION}},
  {23, {3, 1, DEFAULT_SPAWN_PROTECTION}},
  {26, {2, 1, DEFAULT_SPAWN_PROTECTION}},
  {29, {1, 1, DEFAULT_SPAWN_PROTECTION}},
  {34, {1, 1, 1.5f}},
  {37, {2, 1, DEFAULT_SPAWN_PROTECTION}},
  {40, {2, 1, DEFAULT_SPAWN_PROTECTION}},
  {42, {1, 1, 1.5f}},
  {47, {8, 8, DEFAULT_SPAWN_PROTECTION}},
  {49, {2, 2, DEFAULT_SPAWN_PROTECTION}},
  {51, {3, 3, DEFAULT_SPAWN_PROTECTION}},
};

static int getSummonCount(int itemId) {
  auto it = SUMMON_CFG.find(itemId);
  return it != SUMMON_CFG.end() ? it->second.maxCount : 1;
}

static int getSummonBatch(int itemId) {
  auto it = SUMMON_CFG.find(itemId);
  if (it == SUMMON_CFG.end()) return 1;
  return std::max(1, std::min(it->second.spawnCount, it->second.maxCount));
}

static float getSpawnProtection(int itemId) {
  auto it = SUMMON_CFG.find(itemId);
  return it != SUMMON_CFG.end() ? it->second.spawnProtection : DEFAULT_SPAWN_PROTECTION;
}

static int mapRarityToSummonRarity(int rarity) {
  return std::max(0, std::min(MAX_RARITY, rarity) - 1);
}

static const std::vector<float> CLOVER_DNA_UPGRADE_BONUS = {
  0.001f, 0.002f, 0.003f, 0.004f, 0.005f, 0.006f, 0.007f, 0.008f, 0.010f, 0.012f, 0.012f,
};

static float cloverDnaBonus(const std::vector<int>& cloverRarities) {
  float bonus = 0;
  for (int r : cloverRarities) {
    int tier = std::max(0, std::min(MAX_RARITY, r));
    bonus += CLOVER_DNA_UPGRADE_BONUS[tier];
  }
  return bonus;
}

// =====================================================================
// Talent system
// =====================================================================
static const std::vector<std::string> TALENT_KEYS = {
  "reload", "petalDamage", "summonDamage", "summonHealth", "health", "speed", "bodyDamage"
};

struct TalentBonuses {
  float reloadReduction = 0;
  float petalDmgMult = 1;
  float summonDmgMult = 1;
  float summonHpMult = 1;
  float healthMult = 1;
  float speedMult = 1;
  float bodyDamageMult = 1;
};

struct TalentTreeLevels {
  int reload = 0;
  int petalDamage = 0;
  int summonDamage = 0;
  int summonHealth = 0;
  int health = 0;
  int speed = 0;
  int bodyDamage = 0;
};

static const int TALENT_MAX_LEVELS[] = {7, 7, 7, 7, 7, 7, 7};

static const float TALENT_BRANCH_EFFECT[] = {0.05f, 0.05f, 0.05f, 0.05f, 0.05f, 0.05f, 0.04f};

static TalentBonuses computeTalentBonuses(const TalentTreeLevels& levels) {
  TalentBonuses b;
  b.reloadReduction = std::min(0.5f, (float)std::max(0, std::min(TALENT_MAX_LEVELS[0], levels.reload)) * TALENT_BRANCH_EFFECT[0]);
  b.petalDmgMult = 1 + std::max(0, std::min(TALENT_MAX_LEVELS[1], levels.petalDamage)) * TALENT_BRANCH_EFFECT[1];
  b.summonDmgMult = 1 + std::max(0, std::min(TALENT_MAX_LEVELS[2], levels.summonDamage)) * TALENT_BRANCH_EFFECT[2];
  b.summonHpMult = 1 + std::max(0, std::min(TALENT_MAX_LEVELS[3], levels.summonHealth)) * TALENT_BRANCH_EFFECT[3];
  b.healthMult = 1 + std::max(0, std::min(TALENT_MAX_LEVELS[4], levels.health)) * TALENT_BRANCH_EFFECT[4];
  b.speedMult = 1 + std::max(0, std::min(TALENT_MAX_LEVELS[5], levels.speed)) * TALENT_BRANCH_EFFECT[5];
  b.bodyDamageMult = 1 + std::max(0, std::min(TALENT_MAX_LEVELS[6], levels.bodyDamage)) * TALENT_BRANCH_EFFECT[6];
  return b;
}

static TalentTreeLevels readTalentLevels(Reader& r) {
  TalentTreeLevels t;
  t.reload = std::min(TALENT_MAX_LEVELS[0], (int)r.u8v());
  t.petalDamage = std::min(TALENT_MAX_LEVELS[1], (int)r.u8v());
  t.summonDamage = std::min(TALENT_MAX_LEVELS[2], (int)r.u8v());
  t.summonHealth = std::min(TALENT_MAX_LEVELS[3], (int)r.u8v());
  t.health = std::min(TALENT_MAX_LEVELS[4], (int)r.u8v());
  t.speed = std::min(TALENT_MAX_LEVELS[5], (int)r.u8v());
  t.bodyDamage = std::min(TALENT_MAX_LEVELS[6], (int)r.u8v());
  return t;
}

static void writeTalentBonuses(Writer& w, const TalentBonuses& b) {
  w.f32v(b.reloadReduction);
  w.f32v(b.petalDmgMult);
  w.f32v(b.summonDmgMult);
  w.f32v(b.summonHpMult);
  w.f32v(b.healthMult);
  w.f32v(b.speedMult);
  w.f32v(b.bodyDamageMult);
}

// =====================================================================
// Data structures
// =====================================================================
struct Cell {
  uint8_t item = EMPTY_ITEM;
  uint8_t rarity = 0;
  uint16_t count = 0;
};

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
  std::unordered_set<float> spawnedThresholds;

  Mob() {}
  Mob(int id_, int type_, int mapId_, float x_, float y_, int rarity_, bool friendly_ = false)
    : id(id_), type(type_), mapId(mapId_), x(x_), y(y_), rarity(rarity_), friendly(friendly_)
  {
    const auto& def = MOBS[type_];
    float m = friendly_ ? rarityMult(rarity_) : enemyRarityMult(rarity_);
    maxHp = std::round(def.health * m);
    hp = maxHp;
    radius = def.radius * (friendly_ ? friendlyMobSizeMult(rarity_) : mobSizeMult(rarity_));
    damage = def.damage * enemyDamageMult(rarity_);
    speed = def.speed;
  }
};

struct Projectile {
  int id = 0, mapId = 0;
  float x = 0, y = 0, vx = 0, vy = 0;
  float angle = 0;
  float ttl = 0, hitCd = 0;
  float damage = 0, radius = 10;
  float hp = 1, maxHp = 1;
  int team = 0;
  int ownerId = 0, sourceType = 0, rarity = 0;
  bool isPiercing = false;
  float maxDistance = 0, distanceTraveled = 0;
};

struct Drop {
  int id = 0, mapId = 0;
  float x = 0, y = 0;
  uint8_t item = 0, rarity = 0;
  uint16_t count = 1;
  int ownerId = 0;
  float ttl = 50;
  float groundTimer = 0.5f;
  float suctionTimer = 0;
  std::unordered_set<int> allowedPlayerIds; // empty = anyone can loot
  bool hasAllowList = false;
};

struct DormantMob {
  int type, rarity;
  float x, y, vx, vy;
  float health, maxHealth;
  int lastHitBy;
  std::vector<std::pair<int, float>> damageByPlayer;
  std::vector<float> spawnedThresholds;
};

struct LoadoutConfig {
  std::string name;
  std::vector<Cell> slots;
};

struct SquadMember {
  int clientId;
  int playerId;
  std::string name;
  int level;
  int rarity;
};

struct Squad {
  std::string code;
  bool isPublic;
  std::unordered_map<int, SquadMember> members; // key = playerId
  int64_t createdAt;
};

enum class Mode : uint8_t { Pve = 0, Arena = 1 };

struct ArenaRoom {
  std::string code;
  int hostId;
  int mode; // 1 or 3
  int capacity; // mode * 2
  std::vector<int> seats; // playerId 按顺序
  std::map<int, int> seatOfPlayer; // playerId -> seat index
  std::vector<Cell> wheelCards; // seat index -> Cell
  std::vector<bool> ready;
  std::vector<int> teamOfSeat;
  bool started = false;
  uint32_t rng;
  int64_t createdAt;
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
  bool menuMode = false;
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
  float bonusMultiplier = 1;
  int64_t bonusEndsAt = 0;
  int64_t nextOracleAt = 0;
  int64_t nextTradeAt = 0;
  std::string squadCode = "";
  // Arena 模式
  int arenaSeat = -1;
  int arenaTeam = 0;
  int arenaLives = 0;
  std::string arenaRoomCode = "";
  Cell arenaWheelCard{};  // item=255 if empty
  bool arenaWheelReady = false;
  Cell arenaLoadout[10]{}; // 锁死配装
  int64_t arenaLastInputAt = 0;
  Mode mode = Mode::Pve;

  Cell slots[SLOT_COUNT];
  Cell secondary[SECONDARY_SLOT_COUNT];
  std::vector<Cell> bag;
  PetalState petals[SLOT_COUNT];
  std::vector<int> pets[SLOT_COUNT]; // store mob IDs for pointer safety
  std::vector<LoadoutConfig> loadouts;
  TalentTreeLevels talentLevels;
  TalentBonuses talentBonuses;

  Player() {
    for (int i = 0; i < SLOT_COUNT; i++) {
      slots[i] = Cell{EMPTY_ITEM, 0, 0};
      secondary[i] = Cell{EMPTY_ITEM, 0, 0};
    }
    bag.resize(BAG_COUNT);
  }
};

// =====================================================================
// Player data persistence (save/load to disk)
// =====================================================================
static const std::string SAVE_DIR = "saves";

struct SavedPlayerData {
  uint32_t xp = 0;
  uint8_t mapId = 0;
  Cell slots[SLOT_COUNT];
  Cell secondary[SECONDARY_SLOT_COUNT];
  std::vector<Cell> bag;
  int64_t nextOracleAt = 0;
  int64_t nextTradeAt = 0;
};

static std::string savePathFor(const std::string& name) {
  // Simple hash to avoid special characters in filenames
  std::hash<std::string> hasher;
  auto h = hasher(name);
  return SAVE_DIR + "/p_" + std::to_string(h) + ".bin";
}

static void savePlayerData(const Player& p) {
  if (p.name.empty()) return;
  try {
    if (!std::filesystem::exists(SAVE_DIR))
      std::filesystem::create_directories(SAVE_DIR);
    std::ofstream f(savePathFor(p.name), std::ios::binary);
    if (!f) return;
    uint32_t xp = p.xp;
    uint8_t mapId = p.mapId;
    f.write((const char*)&xp, sizeof(xp));
    f.write((const char*)&mapId, sizeof(mapId));
    f.write((const char*)p.slots, sizeof(Cell) * SLOT_COUNT);
    f.write((const char*)p.secondary, sizeof(Cell) * SECONDARY_SLOT_COUNT);
    uint16_t bagSize = (uint16_t)p.bag.size();
    f.write((const char*)&bagSize, sizeof(bagSize));
    if (bagSize > 0) f.write((const char*)p.bag.data(), sizeof(Cell) * bagSize);
    int64_t now = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::system_clock::now().time_since_epoch()).count();
    int64_t oracleRemaining = p.nextOracleAt > now ? p.nextOracleAt - now : 0;
    int64_t tradeRemaining = p.nextTradeAt > now ? p.nextTradeAt - now : 0;
    f.write((const char*)&oracleRemaining, sizeof(oracleRemaining));
    f.write((const char*)&tradeRemaining, sizeof(tradeRemaining));
  } catch (...) { /* ignore save errors */ }
}

static SavedPlayerData loadPlayerData(const std::string& name) {
  SavedPlayerData d;
  if (name.empty()) return d;
  try {
    std::ifstream f(savePathFor(name), std::ios::binary);
    if (!f) return d;
    uint32_t xp;
    uint8_t mapId;
    f.read((char*)&xp, sizeof(xp));
    f.read((char*)&mapId, sizeof(mapId));
    d.xp = xp; d.mapId = mapId;
    f.read((char*)d.slots, sizeof(Cell) * SLOT_COUNT);
    f.read((char*)d.secondary, sizeof(Cell) * SECONDARY_SLOT_COUNT);
    uint16_t bagSize;
    f.read((char*)&bagSize, sizeof(bagSize));
    if (bagSize > 0) {
      d.bag.resize(bagSize);
      f.read((char*)d.bag.data(), sizeof(Cell) * bagSize);
    }
    int64_t oracleRemaining, tradeRemaining;
    f.read((char*)&oracleRemaining, sizeof(oracleRemaining));
    f.read((char*)&tradeRemaining, sizeof(tradeRemaining));
    int64_t now = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::system_clock::now().time_since_epoch()).count();
    d.nextOracleAt = oracleRemaining > 0 ? now + oracleRemaining : 0;
    d.nextTradeAt = tradeRemaining > 0 ? now + tradeRemaining : 0;
  } catch (...) { /* ignore load errors */ }
  return d;
}

struct ClientState {
  uint16_t playerId = 0;
  Player* player = nullptr;
  std::vector<std::vector<uint8_t>> events;
  float idleSeconds = 0;
  bool afkPending = false;
  float afkSecondsLeft = 0;
  int afkLastSent = -1;
  bool kick = false;
  float lastInDx = 0, lastInDy = 0;
  uint8_t lastFlags = 0;
};

struct PerSocket {
  uint16_t id = 0;
  ClientState* client = nullptr;
};

// =====================================================================
// Collision counter
// =====================================================================
struct CollisionCounter { int n = 0; };

// =====================================================================
// Wall colliders (from existing code, kept as-is)
// =====================================================================

// ArrayWallCollider
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

  std::pair<float, float> collideCircle(float x, float y, float r, CollisionCounter* counter = nullptr, float inflate = 0) const {
    auto cands = candidates(x, y, r, inflate);
    if (cands.empty()) return {x, y};
    if (counter) counter->n++;
    for (int pass = 0; pass < 2; pass++) {
      bool moved = false;
      for (const auto* w : cands) {
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
  mutable std::vector<std::vector<const Wall*>> grid_;
};

// PolygonWallCollider
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
  std::vector<WallEdge>* edges = nullptr;
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

    auto grid = rasterizeWalls(walls, gridResolution);
    auto loops = extractContours(grid, gridResolution);
    for (auto& loop : loops) loop = simplifyLoop(loop);

    float cellW = mapWidth / gridResolution;
    float cellH = mapHeight / gridResolution;
    polygons_.reserve(loops.size());
    for (auto& loop : loops) {
      polygons_.push_back(addNoise(loop, cellW, cellH));
    }

    for (const auto& poly : polygons_) {
      size_t n = poly.size();
      for (size_t i = 0; i < n; i++) {
        float x1 = poly[i].first, y1 = poly[i].second;
        float x2 = poly[(i + 1) % n].first, y2 = poly[(i + 1) % n].second;
        float dx = x2 - x1, dy = y2 - y1;
        float len = std::hypot(dx, dy);
        if (len < 0.001f) continue;
        float nx = -dy / len, ny = dx / len;
        edges_.push_back({x1, y1, x2, y2, nx, ny, len});
      }
    }

    bvh_ = buildBVH(edges_);
    buildSpatialGrid();

    printf("[PolygonWallCollider] Preprocessed %zu walls => %zu edges, %d BVH nodes\n",
           walls.size(), edges_.size(), bvhNodeCount);
  }

  ~PolygonWallCollider() {
    freeBVH(bvh_);
  }

  std::pair<float, float> collideCircle(float x, float y, float r, CollisionCounter* counter = nullptr) const {
    if (!bvh_) return {x, y};
    if (!circleNeedsPreciseCheck(x, y, r)) return {x, y};
    if (counter) counter->n++;
    for (int pass = 0; pass < 2; pass++) {
      bool moved = false;
      auto candidates = queryBVH(bvh_, x, y, r);
      for (const auto& e : candidates) {
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

  BVHNode* buildBVH(std::vector<WallEdge>& edges) {
    if (edges.empty()) return nullptr;
    return buildBVHRecursive(edges, 0, 0, (int)edges.size());
  }

  BVHNode* buildBVHRecursive(std::vector<WallEdge>& edges, int start, int end, int depth) {
    auto* node = new BVHNode();
    bvhNodeCount++;
    bvhMaxDepth = std::max(bvhMaxDepth, depth);

    node->aabb = computeEdgesAABB(edges, start, end);

    const int maxEdgesPerLeaf = 8;
    int count = end - start;
    if (count <= maxEdgesPerLeaf) {
      bvhLeafCount++;
      node->edges = new std::vector<WallEdge>(edges.begin() + start, edges.begin() + end);
      return node;
    }

    float extentX = node->aabb.maxX - node->aabb.minX;
    float extentY = node->aabb.maxY - node->aabb.minY;
    int axis = extentX >= extentY ? 0 : 1;

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

  std::vector<WallEdge> queryBVH(BVHNode* node, float x, float y, float r) const {
    std::vector<WallEdge> results;
    if (!node) return results;
    std::vector<BVHNode*> stack;
    stack.push_back(node);
    while (!stack.empty()) {
      auto* cur = stack.back(); stack.pop_back();
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

// =====================================================================
// Helper functions
// =====================================================================
static float clampf(float v, float a, float b) {
  return v < a ? a : v > b ? b : v;
}

static void writeCell(Writer& w, const Cell& cell) {
  if (cell.item == EMPTY_ITEM || cell.count == 0) {
    w.u8v(EMPTY_ITEM); w.u8v(0); w.u16v(0);
  } else {
    w.u8v(cell.item); w.u8v(cell.rarity); w.u16v(cell.count);
  }
}

static Cell readCell(Reader& r) {
  Cell c;
  c.item = r.u8v();
  c.rarity = r.u8v();
  c.count = r.u16v();
  if (c.item == EMPTY_ITEM || c.count == 0 || c.item >= (int)ITEMS.size()) {
    c.item = EMPTY_ITEM; c.rarity = 0; c.count = 0;
  }
  return c;
}

// =====================================================================
// Spatial Grid – 空间网格划分，将 O(n²) 碰撞检测降为 O(n * k)
// 每个 Entity 只与同格 + 相邻 8 格的 Entity 做碰撞检测
// =====================================================================
constexpr float SPATIAL_GRID_CELL_SIZE = 400.f; // 每格 400px（≈1/4 视野半径）

struct SpatialGrid {
  std::unordered_map<uint64_t, std::vector<int>> cells;

  // 清空网格，准备下一帧重建
  void clear() { cells.clear(); }

  // 获取 (col, row) 对应的 cell key
  static uint64_t key(int col, int row) {
    return ((uint64_t)(uint32_t)col << 32) | (uint32_t)row;
  }

  // 将 entity index 插入所在格子
  void insert(int entityIdx, float x, float y, float radius) {
    int minCol = (int)std::floor((x - radius) / SPATIAL_GRID_CELL_SIZE);
    int maxCol = (int)std::floor((x + radius) / SPATIAL_GRID_CELL_SIZE);
    int minRow = (int)std::floor((y - radius) / SPATIAL_GRID_CELL_SIZE);
    int maxRow = (int)std::floor((y + radius) / SPATIAL_GRID_CELL_SIZE);
    for (int col = minCol; col <= maxCol; col++) {
      for (int row = minRow; row <= maxRow; row++) {
        cells[key(col, row)].push_back(entityIdx);
      }
    }
  }

  // 查询与 (x, y, r) 重叠的格子中的所有 entity index
  // 返回一个 set 避免重复（一个 entity 可能跨多个格子）
  std::vector<int> query(float x, float y, float radius) const {
    int minCol = (int)std::floor((x - radius) / SPATIAL_GRID_CELL_SIZE);
    int maxCol = (int)std::floor((x + radius) / SPATIAL_GRID_CELL_SIZE);
    int minRow = (int)std::floor((y - radius) / SPATIAL_GRID_CELL_SIZE);
    int maxRow = (int)std::floor((y + radius) / SPATIAL_GRID_CELL_SIZE);
    std::unordered_set<int> seen;
    std::vector<int> result;
    for (int col = minCol; col <= maxCol; col++) {
      for (int row = minRow; row <= maxRow; row++) {
        auto it = cells.find(key(col, row));
        if (it == cells.end()) continue;
        for (int idx : it->second) {
          if (seen.insert(idx).second) result.push_back(idx);
        }
      }
    }
    return result;
  }
};

// =====================================================================
// Simulation class
// =====================================================================
class Simulation {
public:
  CollisionCounter collisionCounter;
  uint32_t tickCount = 0;
  std::unordered_map<uint16_t, Player> players;
  std::unordered_map<std::string, Squad> squads;
  std::unordered_map<std::string, ArenaRoom> arenas;
  int nextMobId = 10000;
  int nextProjId = 20000;
  int nextDropId = 30000;
  float zoneRefillTimer = 0;
  float persistTimer = 0;
  int mobCollisionSkipFrames = 0;

  // 空间网格：每帧构建一次，用于加速碰撞检测
  SpatialGrid mobGrid;

  // Per-map worlds
  struct World {
    std::vector<Mob> mobs;
    std::vector<Drop> drops;
    std::vector<DormantMob> dormantMobs;
    std::vector<Projectile> projectiles;
  };
  std::vector<World> worlds;

  // Per-map zone counts
  std::vector<std::unordered_map<std::string, int>> zoneMobCounts;

  // Client map reference (set externally from main) for event pushing
  std::unordered_map<uint16_t, ClientState*>* clientMap = nullptr;

  Simulation() {
    worlds.resize(MAP_COUNT);
    zoneMobCounts.resize(MAP_COUNT);
    for (int i = 0; i < MAP_COUNT; i++) {
      playerWallColliders_.push_back(
        std::make_unique<ArrayWallCollider>(MAPS[i].walls, MAPS[i].width, MAPS[i].height, 256));
      wallColliders_.push_back(
        std::make_unique<ArrayWallCollider>(MAPS[i].walls, MAPS[i].width, MAPS[i].height, 256));
    }
    // Pre-spawn mobs on all maps
    for (int i = 0; i < MAP_COUNT; i++) {
      preSpawnMap(i);
    }
  }

  Player& add(uint16_t id) {
    auto& p = players[id];
    p.id = id;
    return p;
  }

  void remove(uint16_t id) {
    auto it = players.find(id);
    if (it != players.end()) {
      Player& p = it->second;
      // Save player data to disk before removal
      savePlayerData(p);
      // Remove all pets (including friendly mobs) on disconnect
      for (int i = 0; i < SLOT_COUNT; i++) {
        for (int petId : p.pets[i]) {
          for (int m = 0; m < MAP_COUNT; m++) {
            removeMobFromWorld(m, petId);
          }
        }
        p.pets[i].clear();
      }
      // Remove from squad
      if (!p.squadCode.empty()) {
        removePlayerFromSquad(p);
      }
      // Remove from arena
      if (!p.arenaRoomCode.empty()) {
        auto ait = arenas.find(p.arenaRoomCode);
        if (ait != arenas.end()) {
          auto& room = ait->second;
          if (!room.started) {
            room.seats.erase(std::remove(room.seats.begin(), room.seats.end(), p.id), room.seats.end());
            room.seatOfPlayer.erase(p.id);
            if (room.seats.empty()) arenas.erase(ait);
          } else {
            p.arenaLives = 0;
            p.alive = false;
            checkArenaEnd(room);
          }
        }
        p.arenaRoomCode = "";
      }
    }
    players.erase(id);
  }

  Player* get(uint16_t id) {
    auto it = players.find(id);
    return it == players.end() ? nullptr : &it->second;
  }

  Player* getPlayer(uint16_t id) { return get(id); }

  // ---- Mob lookup helpers (for pet ID-based storage) ----
  Mob* findMobById(int mapId, int mobId) {
    World& w = worlds[mapId];
    for (auto& m : w.mobs) {
      if (m.id == mobId) return &m;
    }
    return nullptr;
  }

  void removeMobFromWorld(int mapId, int mobId) {
    World& w = worlds[mapId];
    w.mobs.erase(std::remove_if(w.mobs.begin(), w.mobs.end(), [mobId](const Mob& m) { return m.id == mobId; }), w.mobs.end());
  }

  // ---- Cell access helpers ----
  Cell* cellAt(Player& p, int idx) {
    if (idx >= 0 && idx < SLOT_COUNT) return &p.slots[idx];
    if (idx >= SLOT_COUNT && idx < HOTBAR_CELLS) return &p.secondary[idx - SLOT_COUNT];
    int bagIdx = idx - HOTBAR_CELLS;
    if (bagIdx >= 0 && bagIdx < (int)p.bag.size()) return &p.bag[bagIdx];
    return nullptr;
  }

  void setCell(Player& p, int idx, const Cell& cell) {
    if (idx >= 0 && idx < SLOT_COUNT) { p.slots[idx] = cell; return; }
    if (idx >= SLOT_COUNT && idx < HOTBAR_CELLS) { p.secondary[idx - SLOT_COUNT] = cell; return; }
    int bagIdx = idx - HOTBAR_CELLS;
    while ((int)p.bag.size() <= bagIdx) p.bag.push_back(Cell{EMPTY_ITEM, 0, 0});
    p.bag[bagIdx] = cell;
  }

  bool isHotbarCell(int idx) { return idx >= 0 && idx < HOTBAR_CELLS; }
  bool isMainCell(int idx) { return idx >= 0 && idx < SLOT_COUNT; }
  bool isBagCell(int idx) { return idx >= HOTBAR_CELLS && idx < TOTAL_CELLS; }

  // ---- Inventory management ----
  void swapCells(Player& p, int a, int b) {
    if (a == b || a >= TOTAL_CELLS || b >= TOTAL_CELLS) return;
    Cell ca = *cellAt(p, a);
    Cell cb = *cellAt(p, b);
    bool bothHotbar = isHotbarCell(a) && isHotbarCell(b);
    if (!bothHotbar && ca.item != EMPTY_ITEM && cb.item != EMPTY_ITEM && ca.item == cb.item && ca.rarity == cb.rarity && ca.count < 999 && cb.count < 999) {
      cb.count += ca.count;
      setCell(p, a, Cell{EMPTY_ITEM, 0, 0});
      setCell(p, b, cb);
    } else {
      setCell(p, a, cb);
      setCell(p, b, ca);
    }
    if (isMainCell(a) || isMainCell(b)) rebuildPetals(p);
    p.dirty = true;
  }

  void swapRowSlot(Player& p, int slot) {
    if (slot < 0 || slot >= std::min(SLOT_COUNT, SECONDARY_SLOT_COUNT)) return;
    Cell main = p.slots[slot];
    Cell backup = p.secondary[slot];
    p.slots[slot] = backup;
    p.secondary[slot] = main;
    rebuildPetals(p);
    startReload(p, slot);
    p.dirty = true;
  }

  void swapAllRows(Player& p) {
    int n = std::min(SLOT_COUNT, SECONDARY_SLOT_COUNT);
    bool touched = false;
    for (int i = 0; i < n; i++) {
      Cell m = p.slots[i];
      Cell b = p.secondary[i];
      if (m.item == EMPTY_ITEM && b.item == EMPTY_ITEM) continue;
      p.slots[i] = b;
      p.secondary[i] = m;
      touched = true;
    }
    if (!touched) return;
    rebuildPetals(p);
    for (int i = 0; i < n; i++) startReload(p, i);
    p.dirty = true;
  }

  void startReload(Player& p, int slot) {
    Cell& cell = p.slots[slot];
    PetalState& st = p.petals[slot];
    if (cell.item == EMPTY_ITEM) return;
    const ItemDef& def = ITEMS[cell.item];
    if (!orbitsAsPetal(def.kind)) return;
    st.alive = false;
    st.timer = def.reload > 0 ? applyTalentReload(p, def.reload) : 0.001f;
  }

  void moveOneFromBag(Player& p, int from, int to) {
    if (from == to || !isBagCell(from) || to >= TOTAL_CELLS) return;
    Cell* source = cellAt(p, from);
    if (!source || source->item == EMPTY_ITEM || source->count == 0) return;
    Cell one;
    one.item = source->item; one.rarity = source->rarity; one.count = 1;
    Cell* target = cellAt(p, to);
    if (isHotbarCell(to)) {
      if (target && target->item != EMPTY_ITEM) {
        if (!addItem(p, target->item, target->rarity, target->count)) return;
      }
      setCell(p, to, one);
      if (isMainCell(to)) rebuildPetals(p);
    } else {
      if (target && target->item != EMPTY_ITEM && (target->item != one.item || target->rarity != one.rarity || target->count >= 999)) return;
      if (target && target->item != EMPTY_ITEM) target->count += 1;
      else setCell(p, to, one);
    }
    source->count -= 1;
    if (source->count == 0) setCell(p, from, Cell{EMPTY_ITEM, 0, 0});
    p.dirty = true;
  }

  bool addItem(Player& p, uint8_t item, uint8_t rarity, uint16_t count) {
    if (count <= 0) return true;
    int left = count;
    for (auto& cell : p.bag) {
      if (left <= 0) break;
      if (cell.item == item && cell.rarity == rarity && cell.count < 999) {
        uint16_t room = 999 - cell.count;
        uint16_t put = std::min((uint16_t)room, (uint16_t)left);
        cell.count += put;
        left -= put;
      }
    }
    while (left > 0) {
      int idx = -1;
      for (int i = 0; i < (int)p.bag.size(); i++) {
        if (p.bag[i].item == EMPTY_ITEM) { idx = i; break; }
      }
      if (idx < 0) {
        if ((int)p.bag.size() >= BAG_MAX) { p.dirty = true; return false; }
        idx = (int)p.bag.size();
        p.bag.push_back(Cell{EMPTY_ITEM, 0, 0});
      }
      uint16_t put = (uint16_t)std::min<int>(999, left);
      p.bag[idx] = Cell{item, rarity, put};
      left -= put;
    }
    p.dirty = true;
    return true;
  }

  int takeFromBag(Player& p, uint8_t item, uint8_t rarity, int count) {
    int need = count;
    for (int i = 0; i < (int)p.bag.size() && need > 0; i++) {
      Cell& cell = p.bag[i];
      if (cell.item == EMPTY_ITEM || cell.item != item || cell.rarity != rarity) continue;
      int take = std::min(need, (int)cell.count);
      cell.count -= take;
      need -= take;
      if (cell.count == 0) p.bag[i] = Cell{EMPTY_ITEM, 0, 0};
    }
    return count - need;
  }

  int countOf(Player& p, uint8_t item, uint8_t rarity) {
    int have = 0;
    for (auto& cell : p.bag) {
      if (cell.item == item && cell.rarity == rarity) have += cell.count;
    }
    return have;
  }

  // ---- Crafting ----
  void craft(ClientState& cs, Player& p, uint8_t item, uint8_t rarity, uint16_t totalCards) {
    if (item >= (int)ITEMS.size()) return;
    float successRate = craftChanceFor(rarity);
    if (rarity >= MAX_CRAFT_RARITY || successRate <= 0) return;
    int needed = std::max(1, (int)totalCards);
    if (countOf(p, item, rarity) < needed) return;
    int used = takeFromBag(p, item, rarity, needed);
    if (used != needed) return;
    int attempts = std::max(1, (int)std::floor(needed / CRAFT_CARDS_PER_ATTEMPT));
    int successes = 0;
    for (int i = 0; i < attempts; i++) {
      if ((float)rand() / (float)RAND_MAX < successRate) successes++;
    }
    if (successes > 0) {
      addItem(p, item, rarity + 1, successes);
      pushEvent(cs, EVT_CRAFT_OK, p.x, p.y, successes, item, rarity + 1);
    } else {
      int kept = 1 + (int)((float)rand() / (float)RAND_MAX * std::min(4, needed));
      addItem(p, item, rarity, kept);
      pushEvent(cs, EVT_CRAFT_FAIL, p.x, p.y, needed - kept, item, rarity);
    }
    p.dirty = true;
  }

  int oracleRequiredCount(int rarity) {
    if (rarity < 0 || rarity + ORACLE_SKIP > MAX_CRAFT_RARITY) return -1;
    return 15 + rarity * 5;
  }

  void oracle(ClientState& cs, Player& p, uint8_t item, uint8_t rarity) {
    if (item >= (int)ITEMS.size()) return;
    int required = oracleRequiredCount(rarity);
    if (required < 0) return;
    int64_t now = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::system_clock::now().time_since_epoch()).count();
    if (now < p.nextOracleAt) return;
    int have = countOf(p, item, rarity);
    if (have < required) return;
    takeFromBag(p, item, rarity, required);
    uint8_t targetRarity = rarity + ORACLE_SKIP;
    addItem(p, item, targetRarity, 1);
    p.nextOracleAt = now + (int64_t)(ORACLE_COOLDOWN_HOURS * 3600 * 1000);
    pushEvent(cs, EVT_ORACLE_OK, p.x, p.y, 0, item, targetRarity);
    p.dirty = true;
    p.statsDirty = true;
  }

  void trade(ClientState& cs, Player& p, uint8_t item, uint8_t rarity, uint16_t requestedCount) {
    if (item >= (int)ITEMS.size()) return;
    int64_t now = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::system_clock::now().time_since_epoch()).count();
    if (now < p.nextTradeAt) return;
    int have = countOf(p, item, rarity);
    int want = requestedCount > 0 ? std::min((int)requestedCount, have) : have;
    if (want <= 0) return;
    int used = takeFromBag(p, item, rarity, want);
    if (used <= 0) return;
    addItem(p, TRINKET_ITEM, rarity, used);
    p.nextTradeAt = now + (int64_t)(TRADE_COOLDOWN_HOURS * 3600 * 1000);
    pushEvent(cs, EVT_TRADE_OK, p.x, p.y, used, TRINKET_ITEM, rarity);
    p.dirty = true;
    p.statsDirty = true;
  }

  // ---- Health bonus ----
  float healthBonusOf(Player& p) {
    float bonus = 0;
    for (int i = 0; i < SLOT_COUNT; i++) {
      Cell& cell = p.slots[i];
      if (cell.item == EMPTY_ITEM) continue;
      const ItemDef& def = ITEMS[cell.item];
      if (def.healthBonus > 0) bonus += def.healthBonus * rarityMult(cell.rarity);
    }
    return bonus;
  }

  float soilRadiusBonusOf(Player& p) {
    float bonus = 0;
    for (int i = 0; i < SLOT_COUNT; i++) {
      Cell& cell = p.slots[i];
      if (cell.item == EMPTY_ITEM) continue;
      const ItemDef& def = ITEMS[cell.item];
      if (def.name == "Soil") {
        bonus += 10 + cell.rarity * 2;
      }
    }
    return bonus;
  }

  float applyTalentReload(Player& p, float baseReload) {
    if (baseReload <= 0) return baseReload;
    float scaled = baseReload * (1 - p.talentBonuses.reloadReduction);
    return scaled < 0.05f ? 0.05f : scaled;
  }

  void applyLevel(Player& p) {
    // Arena 模式天赋不生效
    if (p.mode == Mode::Arena) {
      p.talentBonuses = TalentBonuses{};
    }
    int lvl = levelFromXp(p.xp);
    float maxHp = std::round((110 + lvl * 16 + healthBonusOf(p)) * p.talentBonuses.healthMult);
    if ((int)maxHp != (int)p.maxHp) {
      float ratio = p.hp / p.maxHp;
      p.maxHp = maxHp;
      p.hp = std::min(maxHp, std::max(1.f, ratio * maxHp));
      if (p.shield > p.maxHp) p.shield = p.maxHp;
      p.statsDirty = true;
    }
    if (lvl != (int)p.level) { p.level = lvl; p.statsDirty = true; }
  }

  // ---- Petal system ----
  void despawnPets(Player& p, int slot) {
    for (int petId : p.pets[slot]) {
      for (int m = 0; m < MAP_COUNT; m++) {
        removeMobFromWorld(m, petId);
      }
    }
    p.pets[slot].clear();
  }

  void cleanupPets(Player& p, int slot) {
    std::vector<int> active;
    for (int petId : p.pets[slot]) {
      Mob* pet = findMobById(p.mapId, petId);
      if (pet && pet->hp > 0) active.push_back(petId);
      else {
        for (int m = 0; m < MAP_COUNT; m++) {
          removeMobFromWorld(m, petId);
        }
      }
    }
    p.pets[slot] = active;
  }

  int getSummonRarityWithDna(Player& p, Cell& cell) {
    const ItemDef& def = ITEMS[cell.item];
    if (def.kind != IK_SUMMON) return 0;
    int summonRarity = std::max(0, std::min(MAX_RARITY, (int)cell.rarity));
    int mappedRarity = def.noDowngrade ? summonRarity : mapRarityToSummonRarity(summonRarity);
    bool hasValidDna = false;
    std::vector<int> cloverRarities;
    for (int i = 0; i < SLOT_COUNT; i++) {
      Cell& other = p.slots[i];
      if (other.item == EMPTY_ITEM) continue;
      const ItemDef& otherDef = ITEMS[other.item];
      PetalState& st = p.petals[i];
      bool broken = !st.alive;
      if (broken) continue;
      if (otherDef.kind == IK_DNA && other.rarity >= summonRarity) hasValidDna = true;
      if (other.item == CLOVER_ITEM) cloverRarities.push_back(other.rarity);
    }
    if (!hasValidDna) return mappedRarity;
    float totalChance = std::min(1.0f, DNA_UPGRADE_BASE_CHANCE + cloverDnaBonus(cloverRarities));
    if ((float)rand() / (float)RAND_MAX < totalChance && mappedRarity < MAX_RARITY) return mappedRarity + 1;
    return mappedRarity;
  }

  void hatchPet(Player& p, int slot, Cell& cell) {
    const ItemDef& def = ITEMS[cell.item];
    if (def.petMob < 0 || def.petMob >= (int)MOBS.size()) return;
    int room = getSummonCount(cell.item) - (int)p.pets[slot].size();
    int toSpawn = std::min(getSummonBatch(cell.item), std::max(0, room));
    if (toSpawn <= 0) return;
    int rarity = getSummonRarityWithDna(p, cell);
    float protection = getSpawnProtection(cell.item);
    const MapDef& map = MAPS[p.mapId];
    auto* collider = wallColliders_[p.mapId].get();
    float petRadius = MOBS[def.petMob].radius * friendlyMobSizeMult(rarity);
    for (int i = 0; i < toSpawn; i++) {
      float sx = p.x, sy = p.y;
      bool placed = false;
      for (int tries = 0; tries < 12; tries++) {
        float angle = (float)rand() / (float)RAND_MAX * (float)M_PI * 2;
        float dist = 40 + (float)rand() / (float)RAND_MAX * 30;
        float tx = clampf(p.x + std::cos(angle) * dist, petRadius + 4, map.width - petRadius - 4);
        float ty = clampf(p.y + std::sin(angle) * dist, petRadius + 4, map.height - petRadius - 4);
        auto [rx, ry] = collider->collideCircle(tx, ty, petRadius + 4, &collisionCounter, MOB_WALL_INFLATE);
        if (std::abs(rx - tx) < 0.01f && std::abs(ry - ty) < 0.01f) {
          sx = tx; sy = ty; placed = true; break;
        }
        sx = rx; sy = ry;
      }
      Mob m(nextMobId++, def.petMob, p.mapId, sx, sy, rarity, true);
      m.ownerId = p.id; m.ownerSlot = slot; m.sourceItem = cell.item; m.sourceRarity = cell.rarity;
      float summonHpScale = 1.4f * p.talentBonuses.summonHpMult;
      m.maxHp = std::max(1.0f, std::round(m.maxHp * summonHpScale));
      m.hp = m.maxHp;
      m.damage = m.damage * p.talentBonuses.summonDmgMult;
      if (m.speed > 0) m.speed = std::max(70.f, m.speed * 1.5f);
      m.spawnProtection = protection;
      int mobId = m.id;
      worlds[p.mapId].mobs.push_back(m);
      p.pets[slot].push_back(mobId);
    }
  }

  void rebuildPetals(Player& p) {
    for (int i = 0; i < SLOT_COUNT; i++) {
      PetalState* old = &p.petals[i];
      Cell& cell = p.slots[i];
      const ItemDef* def = cell.item != EMPTY_ITEM ? &ITEMS[cell.item] : nullptr;
      bool orbits = def && orbitsAsPetal(def->kind);

      // Check if the slot previously had a summon that needs despawning
      // (when the summon card is swapped out, removed, or changed)
      const ItemDef* oldDef = old->item != EMPTY_ITEM ? &ITEMS[old->item] : nullptr;
      bool wasSummon = oldDef && oldDef->kind == IK_SUMMON && !p.pets[i].empty();
      if (wasSummon) {
        bool sameSummon = def && def->kind == IK_SUMMON;
        if (sameSummon) {
          for (int petId : p.pets[i]) {
            Mob* pet = findMobById(p.mapId, petId);
            if (!pet || pet->type != def->petMob || pet->sourceItem != cell.item || pet->sourceRarity != cell.rarity) {
              sameSummon = false; break;
            }
          }
        }
        if (!sameSummon) despawnPets(p, i);
      }

      bool cellChanged = old->item != cell.item || old->rarity != cell.rarity;

      if (!cellChanged && !orbits) {
        continue;
      }

      if (!cellChanged) {
        continue;
      }

      // Create new petal state
      PetalState st;
      st.id = old->id ? old->id : nextMobId++;
      st.item = cell.item;
      st.rarity = cell.rarity;
      st.alive = orbits;
      float maxHp = orbits ? def->health * rarityMult(cell.rarity) : 1;
      st.hp = maxHp;
      st.maxHp = maxHp;
      st.timer = 0;
      st.x = p.x; st.y = p.y;
      st.hitCd = 0;
      st.specialTimer = (cell.item != EMPTY_ITEM && isAbsorbItem(cell.item)) ? ROSE_HEAL_DELAY : 0;
      st.absorbTimer = 0;
      st.targetCheckTimer = (int)((float)rand() / (float)RAND_MAX * PETAL_TARGET_RECHECK_FRAMES);
      st.targetId = 0;
      st.fireTimer = 0;
      p.petals[i] = st;
    }
  }

  // ---- Spawn player ----
  void spawnPlayer(Player& p) {
    const MapDef& map = MAPS[p.mapId];
    auto* collider = playerWallColliders_[p.mapId].get();
    float spawnR = PLAYER_RADIUS + soilRadiusBonusOf(p);
    auto spawnTiles = findSpawnTiles(p.mapId);
    if (!spawnTiles.empty()) {
      auto& tile = spawnTiles[rand() % spawnTiles.size()];
      float tileW = map.width / BLOCK_GRID_COLS;
      float tileH = map.height / BLOCK_GRID_ROWS;
      for (int tries = 0; tries < 20; tries++) {
        float x = tile.second * tileW + (float)rand() / (float)RAND_MAX * tileW;
        float y = tile.first * tileH + (float)rand() / (float)RAND_MAX * tileH;
        auto [cx, cy] = collider->collideCircle(x, y, spawnR, &collisionCounter);
        if (std::abs(cx - x) < 0.01f && std::abs(cy - y) < 0.01f) {
          p.x = x; p.y = y; p.hp = p.maxHp; p.alive = true; p.statsDirty = true;
          return;
        }
      }
    }
    // Fallback
    float fallbackX = 200 + (float)rand() / (float)RAND_MAX * (map.width - 400);
    float fallbackY = 200 + (float)rand() / (float)RAND_MAX * (map.height - 400);
    auto [fCX, fCY] = collider->collideCircle(fallbackX, fallbackY, spawnR, &collisionCounter);
    for (int tries = 0; tries < 60; tries++) {
      float x = 200 + (float)rand() / (float)RAND_MAX * (map.width - 400);
      float y = 200 + (float)rand() / (float)RAND_MAX * (map.height - 400);
      auto [cx, cy] = collider->collideCircle(x, y, spawnR, &collisionCounter);
      if (std::abs(cx - x) < 0.01f && std::abs(cy - y) < 0.01f) { p.x = x; p.y = y; break; }
      fallbackX = cx; fallbackY = cy;
      p.x = fallbackX; p.y = fallbackY;
    }
    p.hp = p.maxHp; p.alive = true; p.statsDirty = true;
  }

  // ---- Mob spawning ----
  void preSpawnMap(int mapId) {
    const MapDef& map = MAPS[mapId];
    int targetMobs = (int)std::floor((float)map.mobCap);
    int spawned = 0;
    int attempts = 0;
    while (spawned < targetMobs && attempts < targetMobs * 200) {
      attempts++;
      float x = 50 + (float)rand() / (float)RAND_MAX * (map.width - 200);
      float y = 50 + (float)rand() / (float)RAND_MAX * (map.height - 200);
      std::string zone = getBlockAt(mapId, x, y);
      if (zone == "1" || zone < "A" || zone > "G") continue;
      if (zoneFull(mapId, zone)) continue;
      int type = pickWeightedMob(mapId, map.mobs);
      int rarity = rollZoneRarity(zone);
      zoneMobCounts[mapId][zone]++;
      worlds[mapId].mobs.push_back(Mob(nextMobId++, type, mapId, x, y, rarity));
      spawned++;
    }
    printf("[preSpawnMap] Map %d: spawned %d/%d mobs (%d attempts)\n", mapId, spawned, targetMobs, attempts);
  }

  void spawnMob(int mapId, const std::string& zoneHint = "", float x = -1, float y = -1) {
    const MapDef& map = MAPS[mapId];
    auto* collider = wallColliders_[mapId].get();
    int type = pickWeightedMob(mapId, map.mobs);
    int rarity = 0;
    float spawnX = 0, spawnY = 0;
    std::string zone;
    bool placed = false;

    if (x >= 0 && y >= 0) {
      zone = getBlockAt(mapId, x, y);
      if (zone == "1" || zone < "A" || zone > "G") return;
      if (zoneFull(mapId, zone)) return;
      int cr = rollZoneRarity(zone);
      float crRadius = MOBS[type].radius * mobSizeMult(cr);
      auto [cx, cy] = collider->collideCircle(x, y, crRadius + 6, &collisionCounter, MOB_WALL_INFLATE);
      if (std::abs(cx - x) < 0.01f && std::abs(cy - y) < 0.01f) {
        spawnX = x; spawnY = y; rarity = cr; placed = true;
      }
    } else {
      const auto& grid = mapId < (int)MAP_GRIDS.size() ? MAP_GRIDS[mapId] : std::vector<std::string>();
      float tileW = map.width / BLOCK_GRID_COLS;
      float tileH = map.height / BLOCK_GRID_ROWS;
      std::vector<std::pair<int,int>> tiles;
      if (!grid.empty()) {
        for (int row = 0; row < BLOCK_GRID_ROWS; row++) {
          for (int col = 0; col < BLOCK_GRID_COLS; col++) {
            char ch = grid[row][col];
            std::string letter = (ch == '2') ? "A" : std::string(1, ch);
            if (letter == "1") continue;
            if (!zoneHint.empty() && letter != zoneHint) continue;
            tiles.push_back({row, col});
          }
        }
      }
      if (!tiles.empty()) {
        for (int tries = 0; tries < 60; tries++) {
          auto& tile = tiles[rand() % tiles.size()];
          spawnX = tile.second * tileW + (float)rand() / (float)RAND_MAX * tileW;
          spawnY = tile.first * tileH + (float)rand() / (float)RAND_MAX * tileH;
          zone = getBlockAt(mapId, spawnX, spawnY);
          if (zoneFull(mapId, zone)) continue;
          int cr = rollZoneRarity(zone);
          float crRadius = MOBS[type].radius * mobSizeMult(cr);
          auto [cx, cy] = collider->collideCircle(spawnX, spawnY, crRadius + 6, &collisionCounter, MOB_WALL_INFLATE);
          if (std::abs(cx - spawnX) >= 0.01f || std::abs(cy - spawnY) >= 0.01f) continue;
          rarity = cr; placed = true; break;
        }
      } else {
        for (int tries = 0; tries < 80; tries++) {
          spawnX = 200 + (float)rand() / (float)RAND_MAX * (map.width - 400);
          spawnY = 200 + (float)rand() / (float)RAND_MAX * (map.height - 400);
          zone = getBlockAt(mapId, spawnX, spawnY);
          if (zone < "A" || zone > "G") continue;
          if (!zoneHint.empty() && zone != zoneHint) continue;
          if (zoneFull(mapId, zone)) continue;
          int cr = rollZoneRarity(zone);
          float crRadius = MOBS[type].radius * mobSizeMult(cr);
          auto [cx, cy] = collider->collideCircle(spawnX, spawnY, crRadius + 6, &collisionCounter, MOB_WALL_INFLATE);
          if (std::abs(cx - spawnX) >= 0.01f || std::abs(cy - spawnY) >= 0.01f) continue;
          rarity = cr; placed = true; break;
        }
      }
    }
    if (!placed) return;
    zoneMobCounts[mapId][zone]++;
    worlds[mapId].mobs.push_back(Mob(nextMobId++, type, mapId, spawnX, spawnY, rarity));
  }

  std::string zoneAt(int mapId, float x, float y) {
    std::string z = getBlockAt(mapId, x, y);
    return (z >= "A" && z <= "G") ? z : "";
  }

  void decZoneCount(int mapId, const std::string& zone) {
    if (zone.empty()) return;
    auto it = zoneMobCounts[mapId].find(zone);
    if (it != zoneMobCounts[mapId].end() && it->second > 0) it->second--;
  }

  void incZoneCount(int mapId, const std::string& zone) {
    if (zone.empty()) return;
    zoneMobCounts[mapId][zone]++;
  }

  bool zoneFull(int mapId, const std::string& zone) {
    auto limitIt = ZONE_MOB_LIMITS.find(zone);
    if (limitIt == ZONE_MOB_LIMITS.end()) return false;
    auto it = zoneMobCounts[mapId].find(zone);
    return it != zoneMobCounts[mapId].end() && it->second >= limitIt->second;
  }

  void refillZoneMobs(int mapId, const std::vector<Player*>& players) {
    int hostiles = 0;
    for (auto& m : worlds[mapId].mobs) if (!m.friendly) hostiles++;
    if (hostiles >= (int)std::floor((float)MAPS[mapId].mobCap)) return;

    std::vector<std::pair<float,float>> positions;
    for (auto* p : players) {
      if (p->mapId == mapId) {
        positions.push_back(p->alive ? std::make_pair(p->x, p->y) : std::make_pair(p->deathX, p->deathY));
      }
    }
    if (positions.empty()) return;

    const auto& grid = MAP_GRIDS[mapId];
    if (grid.empty()) return;
    const auto& map = MAPS[mapId];
    float tileW = map.width / BLOCK_GRID_COLS;
    float tileH = map.height / BLOCK_GRID_ROWS;
    float viewRadius = 1400;
    float viewRadiusSq = viewRadius * viewRadius;
    std::unordered_set<std::string> inViewZones;

    for (int row = 0; row < BLOCK_GRID_ROWS; row++) {
      for (int col = 0; col < BLOCK_GRID_COLS; col++) {
        char ch = grid[row][col];
        std::string letter = (ch == '2') ? "A" : std::string(1, ch);
        if (letter == "1" || inViewZones.count(letter)) continue;
        float tx = (col + 0.5f) * tileW;
        float ty = (row + 0.5f) * tileH;
        for (auto& pos : positions) {
          float dx = tx - pos.first, dy = ty - pos.second;
          if (dx * dx + dy * dy < viewRadiusSq) { inViewZones.insert(letter); break; }
        }
      }
    }

    for (const auto& zone : ZONE_LETTERS) {
      if (!inViewZones.count(zone)) continue;
      if (!zoneFull(mapId, zone)) spawnMob(mapId, zone);
    }
  }

  void pushOutOfWall(Mob& mob, int mapId) {
    const MapDef& map = MAPS[mapId];
    auto* collider = wallColliders_[mapId].get();
    float r = mob.radius;
    float ox = mob.x, oy = mob.y;
    float angles[8] = {0, 45, 90, 135, 180, 225, 270, 315};
    for (int step = 5; step <= 50; step += 5) {
      for (int i = 0; i < 8; i++) {
        float rad = angles[i] * (M_PI / 180.f);
        float tx = ox + std::cos(rad) * step;
        float ty = oy + std::sin(rad) * step;
        if (tx < r || tx > map.width - r || ty < r || ty > map.height - r) continue;
        if (collider->isFree(tx, ty, r, MOB_WALL_INFLATE)) {
          mob.x = tx; mob.y = ty;
          mob.vx = std::cos(rad + (float)M_PI) * 5;
          mob.vy = std::sin(rad + (float)M_PI) * 5;
          return;
        }
      }
    }
    // Fallback: teleport to same zone
    std::string zone = zoneAt(mapId, ox, oy);
    const auto& grid = MAP_GRIDS[mapId];
    if (!grid.empty() && !zone.empty()) {
      float tileW = map.width / BLOCK_GRID_COLS;
      float tileH = map.height / BLOCK_GRID_ROWS;
      std::vector<std::pair<int,int>> candidates;
      for (int row = 0; row < BLOCK_GRID_ROWS; row++) {
        for (int col = 0; col < BLOCK_GRID_COLS; col++) {
          char ch = grid[row][col];
          std::string tileZone = (ch == '2') ? "A" : std::string(1, ch);
          if (tileZone == zone) candidates.push_back({row, col});
        }
      }
      for (int tries = 0; tries < 30; tries++) {
        if (candidates.empty()) break;
        auto& tile = candidates[rand() % candidates.size()];
        float tx = (tile.second + 0.5f) * tileW + ((float)rand() / (float)RAND_MAX - 0.5f) * tileW * 0.8f;
        float ty = (tile.first + 0.5f) * tileH + ((float)rand() / (float)RAND_MAX - 0.5f) * tileH * 0.8f;
        float cx = std::max(r, std::min(map.width - r, tx));
        float cy = std::max(r, std::min(map.height - r, ty));
        if (collider->isFree(cx, cy, r, MOB_WALL_INFLATE)) {
          mob.x = cx; mob.y = cy; mob.vx = 0; mob.vy = 0; return;
        }
      }
    }
    // Ultimate fallback: center
    mob.x = map.width * 0.5f; mob.y = map.height * 0.5f;
    auto [cx, cy] = collider->collideCircle(mob.x, mob.y, r, nullptr, MOB_WALL_INFLATE);
    mob.x = cx; mob.y = cy; mob.vx = 0; mob.vy = 0;
  }

  // ---- Drop system ----
  void spawnDrop(int mapId, uint8_t item, uint8_t rarity, float x, float y, int ownerId, const std::unordered_set<int>& allowed) {
    World& world = worlds[mapId];
    for (auto& d : world.drops) {
      if (d.item != item || d.rarity != rarity || d.count >= DROP_STACK_MAX) continue;
      if (std::hypot(d.x - x, d.y - y) > DROP_STACK_RADIUS) continue;
      if (d.hasAllowList != !allowed.empty()) continue;
      if (d.hasAllowList) {
        bool same = d.allowedPlayerIds.size() == allowed.size();
        if (same) {
          for (int pid : allowed) { if (!d.allowedPlayerIds.count(pid)) { same = false; break; } }
        }
        if (!same) continue;
      }
      d.count++; d.ttl = std::max(d.ttl, 45.f);
      d.groundTimer = 0.8f;
      d.suctionTimer = 0;
      if (d.ownerId != ownerId) d.ownerId = 0;
      return;
    }
    Drop nd;
    nd.id = nextDropId++;
    nd.mapId = mapId;
    nd.x = x; nd.y = y;
    nd.item = item; nd.rarity = rarity;
    nd.count = 1;
    nd.ownerId = ownerId;
    nd.ttl = 50;
    nd.groundTimer = 0.5f;
    nd.suctionTimer = 0;
    nd.hasAllowList = !allowed.empty();
    nd.allowedPlayerIds = allowed;
    world.drops.push_back(nd);
  }

  // ---- Helper for eligible looters ----
  std::unordered_set<int> computeEligibleLooters(Mob& mob) {
    std::unordered_set<int> eligible;
    float maxHp = mob.maxHp > 0 ? mob.maxHp : 1;
    float perPlayerThreshold = maxHp * 0.05f;
    // Group by squad
    std::unordered_map<int, std::string> playerToSquad;
    for (auto& [code, squad] : squads) {
      for (auto& [pid, member] : squad.members) {
        playerToSquad[pid] = code;
      }
    }
    // Squad-based eligibility
    std::unordered_set<std::string> processedSquads;
    for (auto& [code, squad] : squads) {
      if (processedSquads.count(code)) continue;
      processedSquads.insert(code);
      std::vector<int> memberIds;
      for (auto& [pid, member] : squad.members) memberIds.push_back(pid);
      if (memberIds.empty()) continue;
      float total = 0;
      for (int pid : memberIds) {
        auto it = mob.damageByPlayer.find(pid);
        if (it != mob.damageByPlayer.end()) total += it->second;
      }
      float required = perPlayerThreshold * memberIds.size();
      if (total >= required) {
        for (int pid : memberIds) eligible.insert(pid);
      }
    }
    // Individual players (not in squad)
    for (auto& [pid, dmg] : mob.damageByPlayer) {
      if (playerToSquad.count(pid)) continue;
      if (dmg >= perPlayerThreshold) eligible.insert(pid);
    }
    return eligible;
  }

  void onMobKilled(Mob& mob, int mapId) {
    if (mob.friendly) return;
    const MobDef& def = MOBS[mob.type];
    World& world = worlds[mapId];

    // XP and kill event for last hitter
    if (mob.lastHitBy) {
      Player* killer = get(mob.lastHitBy);
      if (killer) {
        int xp = std::round(def.xp * (1 + mob.rarity * 0.9f));
        killer->xp += xp;
        applyLevel(*killer);
        killer->statsDirty = true;
        // Push XP event to killer's client
        if (clientMap) {
          for (auto& [csId, cs] : *clientMap) {
            if (cs->player == killer) {
              pushEvent(*cs, EVT_XP, mob.x, mob.y, xp);
              pushEvent(*cs, EVT_KILL, mob.x, mob.y, mob.type);
              break;
            }
          }
        }
      }
    }

    // Drop loot — 100% drop for all non-friendly mobs
    if (world.drops.size() >= (size_t)MAX_DROPPED_CARDS) {
      world.drops.erase(world.drops.begin(), world.drops.begin() + DROP_TRIM_COUNT);
    }
    auto eligible = computeEligibleLooters(mob);
    // 即使没有玩家造成足够伤害，也确保掉落100%触发
    // 回退到 lastHitBy 玩家或地图上所有玩家
    if (eligible.empty()) {
      if (mob.lastHitBy) {
        eligible.insert(mob.lastHitBy);
      } else {
        // 没有玩家参与击杀，但仍然掉落（给所有在线的玩家）
        for (auto& [pid, p] : players) {
          if (p.mapId == mapId) eligible.insert(pid);
        }
      }
    }

    for (int looterId : eligible) {
      Player* looter = get(looterId);
      if (!looter) continue;

      // Calculate how many times to roll each drop based on bonus multiplier
      int totalRolls = 1;
      if (looter->bonusEndsAt > 0 && (int64_t)std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::system_clock::now().time_since_epoch()).count() < looter->bonusEndsAt) {
        totalRolls = (int)std::ceil(looter->bonusMultiplier);
      }

      std::vector<std::pair<uint8_t, uint8_t>> rolled;
      for (auto& drop : def.drops) {
        for (int i = 0; i < totalRolls; i++) {
          // Roll drop rarity using RARITY_DROP_RATES table (matches sim.ts exactly)
          // drop.second (chance) influences the rarity roll: lower chance → higher rarity
          uint8_t rarity = (uint8_t)getDropRarityByItem(mob.rarity, drop.second);
          rolled.push_back({(uint8_t)drop.first, rarity});
        }
      }

      for (auto& roll : rolled) {
        float angle = (float)rand() / (float)RAND_MAX * (float)M_PI * 2;
        float distance = ((float)rand() / (float)RAND_MAX * 20 + 10) * (1 + roll.second * 0.5f);
        float x = mob.x + std::cos(angle) * distance;
        float y = mob.y + std::sin(angle) * distance;
        std::unordered_set<int> allowSet = {looterId};
        spawnDrop(mapId, roll.first, roll.second, x, y, looterId, allowSet);
      }
    }
  }

  // ---- Fire projectile ----
  int fireProjectile(int mapId, float x, float y, float angle, float speed, float damage,
                     int team, int ownerId, int sourceType, int rarity, float radius = 10,
                     bool isPiercing = false, float maxDistance = 0, float projHp = 1) {
    Projectile p;
    p.id = nextProjId++;
    p.mapId = mapId;
    p.x = x; p.y = y;
    p.vx = std::cos(angle) * speed;
    p.vy = std::sin(angle) * speed;
    p.angle = angle;
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
    p.maxHp = projHp;
    worlds[mapId].projectiles.push_back(p);
    return p.id;
  }

  void killPlayer(Player& p) {
    p.alive = false;
    p.hp = 0;
    p.shield = 0;
    p.statsDirty = true;
    p.deathX = p.x;
    p.deathY = p.y;
    // Remove pets
    for (int i = 0; i < SLOT_COUNT; i++) {
      for (int petId : p.pets[i]) {
        for (int m = 0; m < MAP_COUNT; m++) {
          removeMobFromWorld(m, petId);
        }
      }
      p.pets[i].clear();
    }
    // Push EVT_DEATH event
    if (clientMap) {
      for (auto& [csId, cs] : *clientMap) {
        if (cs->player == &p) {
          pushEvent(*cs, EVT_DEATH, p.x, p.y, (int)p.level);
          break;
        }
      }
    }
  }

  // ---- Arena death/respawn handler ----
  void handleArenaPlayerDeath(Player& p) {
    if (p.mode != Mode::Arena) return;
    p.hp = 0;
    p.alive = false;
    p.arenaLives--;
    p.statsDirty = true;

    auto it = arenas.find(p.arenaRoomCode);
    if (it != arenas.end()) {
      auto& room = it->second;
      // 推事件
      for (int otherId : room.seats) {
        if (clientMap) {
          for (auto& [csId, cs] : *clientMap) {
            if (cs->player && cs->player->id == otherId) {
              Writer ew;
              ew.u8v(S2C_ARENA_EVENT);
              ew.u8v(0); // type=life_lost
              ew.u8v(p.arenaSeat);
              ew.u16v(p.arenaLives >= 0 ? (uint16_t)p.arenaLives : 0);
              cs->events.push_back(ew.b);
              break;
            }
          }
        }
      }

      if (p.arenaLives <= 0) {
        // 彻底死亡
        checkArenaEnd(room);
      } else {
        // 复活
        p.hp = p.maxHp;
        p.alive = true;
        float angle = (float)p.arenaSeat / room.capacity * M_PI * 2;
        p.x = 4000 + cos(angle) * 1500;
        p.y = 4000 + sin(angle) * 1500;
        p.statsDirty = true;
      }
    }
  }

  // ---- Events ----
  void pushEvent(ClientState& cs, uint8_t kind, float x, float y, int value, uint8_t item = EMPTY_ITEM, uint8_t rarity = 0) {
    Writer w;
    w.u8v(S2C_EVENT);
    w.u8v(kind);
    w.i16v((int16_t)std::round(x));
    w.i16v((int16_t)std::round(y));
    w.u32v(std::max(0, value));
    w.u8v(item);
    w.u8v(rarity);
    cs.events.push_back(w.b);
  }

  // ---- Arena helpers ----
  std::string generateArenaCode() {
    static const char chars[] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    std::string code;
    for (int i = 0; i < 6; i++) code += chars[rand() % (sizeof(chars) - 1)];
    auto it = arenas.find(code);
    if (it != arenas.end()) return generateArenaCode();
    return code;
  }

  std::vector<Wall> generateArenaWalls(uint32_t seed) {
    std::vector<Wall> walls;
    srand(seed);
    int count = 30 + rand() % 31;
    for (int i = 0; i < count; i++) {
      float x = (float)(rand() % 7000) + 500;
      float y = (float)(rand() % 7000) + 500;
      float w = (float)(rand() % 200) + 50;
      float h = (float)(rand() % 200) + 50;
      float cx = x + w / 2, cy = y + h / 2;
      if (sqrt((cx - 4000) * (cx - 4000) + (cy - 4000) * (cy - 4000)) < 800) continue;
      walls.push_back({x, y, w, h});
    }
    return walls;
  }

  void arenaStart(ArenaRoom& room) {
    room.started = true;
    room.rng = (uint32_t)time(nullptr);
    auto walls = generateArenaWalls(room.rng);

    for (size_t si = 0; si < room.seats.size(); si++) {
      int pid = room.seats[si];
      Player* p = get(pid);
      if (!p) continue;
      p->mode = Mode::Arena;
      p->arenaSeat = (int)si;
      p->arenaTeam = room.teamOfSeat[si];
      p->arenaLives = 2;
      p->arenaRoomCode = room.code;
      p->arenaLastInputAt = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();

      // 覆盖配装
      for (int i = 0; i < 10; i++) {
        Cell c = p->arenaLoadout[i];
        if (c.item != 255) {
          if (i < SLOT_COUNT) p->slots[i] = c;
          else if (i - SLOT_COUNT < SECONDARY_SLOT_COUNT) p->secondary[i - SLOT_COUNT] = c;
        }
      }
      rebuildPetals(*p);

      // 传到 spawn 点（均匀分布在圆周上）
      float angle = (float)si / room.capacity * M_PI * 2;
      p->x = 4000 + cos(angle) * 1500;
      p->y = 4000 + sin(angle) * 1500;
      p->hp = p->maxHp;
      p->alive = true;
      p->mapId = MAP_COUNT - 1;
      p->statsDirty = true;
      p->dirty = true;

      // 发送 ARENA_START 给每个玩家
      if (clientMap) {
        for (auto& [csId, cs] : *clientMap) {
          if (cs->player == p) {
            Writer w;
            w.u8v(S2C_ARENA_START);
            w.u32v(room.rng);
            w.u16v((uint16_t)walls.size());
            for (auto& wall : walls) {
              w.u16v((uint16_t)wall.x);
              w.u16v((uint16_t)wall.y);
              w.u16v((uint16_t)wall.w);
              w.u16v((uint16_t)wall.h);
            }
            cs->events.push_back(w.b);
            break;
          }
        }
      }
    }
  }

  void checkArenaEnd(ArenaRoom& room) {
    int aliveTeam0 = 0, aliveTeam1 = 0;
    for (size_t i = 0; i < room.seats.size(); i++) {
      Player* p = get(room.seats[i]);
      if (p && p->alive && p->arenaLives > 0) {
        if (room.teamOfSeat[i] == 0) aliveTeam0++;
        else aliveTeam1++;
      }
    }

    if (aliveTeam0 == 0 && aliveTeam1 > 0) arenaFinish(room, 1);
    else if (aliveTeam1 == 0 && aliveTeam0 > 0) arenaFinish(room, 0);
  }

  void arenaFinish(ArenaRoom& room, int winnerTeam) {
    // 收集败方 wheel 卡
    std::vector<Cell> loserCards;
    for (size_t i = 0; i < room.seats.size(); i++) {
      if (room.teamOfSeat[i] != winnerTeam && room.wheelCards.size() > i) {
        if (room.wheelCards[i].item != 255) loserCards.push_back(room.wheelCards[i]);
      }
    }

    for (size_t i = 0; i < room.seats.size(); i++) {
      int pid = room.seats[i];
      Player* p = get(pid);
      if (!p) continue;

      p->mode = Mode::Pve;
      p->arenaSeat = -1;
      p->arenaRoomCode = "";
      p->arenaLives = 0;
      p->arenaWheelCard = Cell{0, 0, 255};
      p->arenaWheelReady = false;

      // 归还自己的 wheel 卡
      if (room.wheelCards.size() > i && room.wheelCards[i].item != 255) {
        p->bag.push_back(room.wheelCards[i]);
      }

      std::vector<Cell> wonCards;
      if (room.teamOfSeat[i] == winnerTeam) {
        // 胜方：每人随机拿 1 张败方卡
        if (!loserCards.empty()) {
          int idx = rand() % loserCards.size();
          wonCards.push_back(loserCards[idx]);
          p->bag.push_back(loserCards[idx]);
          loserCards.erase(loserCards.begin() + idx);
        }
      }

      // 推送到玩家事件队列
      if (clientMap) {
        for (auto& [csId, cs] : *clientMap) {
          if (cs->player == p) {
            Writer w;
            w.u8v(S2C_ARENA_RESULT);
            w.u8v((uint8_t)winnerTeam);
            w.u8v((uint8_t)wonCards.size());
            for (auto& c : wonCards) {
              w.u8v(c.item);
              w.u8v(c.rarity);
              w.u16v(c.count);
            }
            cs->events.push_back(w.b);

            // 传送回主地图
            p->mapId = 0;
            p->x = 1600; p->y = 1600;
            p->hp = p->maxHp;
            p->alive = true;
            p->dirty = true;
            p->statsDirty = true;
            break;
          }
        }
      }
    }

    arenas.erase(room.code);
  }

  // ---- Main tick ----
  void tick(float dt) {
    tickCount++;
    collisionCounter = {0};

    // Gather active players (not in menu mode)
    std::vector<Player*> activePlayers;
    for (auto& [id, p] : players) {
      if (!p.menuMode || p.mode == Mode::Arena) activePlayers.push_back(&p);
    }

    // Update players
    for (auto* p : activePlayers) updatePlayer(*p, dt, activePlayers);

    // Update worlds
    for (int m = 0; m < MAP_COUNT; m++) updateWorld(m, dt, activePlayers);

    // Zone refill
    zoneRefillTimer += dt;
    if (zoneRefillTimer >= ZONE_REFILL_INTERVAL) {
      zoneRefillTimer = 0;
      for (int m = 0; m < MAP_COUNT; m++) refillZoneMobs(m, activePlayers);
    }

    // Update petals (pass activePlayers for PvP damage)
    for (auto* p : activePlayers) updatePetals(*p, dt, activePlayers);

    // Pickup drops
    for (auto* p : activePlayers) pickupDrops(*p, dt);

    // Update projectiles
    for (int m = 0; m < MAP_COUNT; m++) updateProjectiles(m, dt, activePlayers);

    // Arena AFK 检测
    {
      int64_t now = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
      for (auto it = arenas.begin(); it != arenas.end(); ) {
        auto& room = it->second;
        if (!room.started) { ++it; continue; }
        bool changed = false;
        for (int pid : room.seats) {
          Player* ap = get(pid);
          if (ap && ap->alive && now - ap->arenaLastInputAt > 15000) {
            ap->arenaLives = 0;
            ap->alive = false;
            checkArenaEnd(room);
            changed = true;
            break;
          }
        }
        if (changed) { it = arenas.begin(); continue; }
        ++it;
      }
    }

    // Periodic save: every 30 seconds, save all online players
    persistTimer += dt;
    if (persistTimer >= 30.0f) {
      persistTimer = 0;
      for (auto& [id, p] : players) {
        savePlayerData(p);
      }
    }
  }

  // ---- Player update ----
  void updatePlayer(Player& p, float dt, std::vector<Player*>& allPlayers) {
    if (!p.alive) return;
    const MapDef& map = MAPS[p.mapId];
    auto* collider = playerWallColliders_[p.mapId].get();

    // Speed bonus from petals
    float speedBonus = 0;
    for (int i = 0; i < SLOT_COUNT; i++) {
      Cell& cell = p.slots[i];
      if (cell.item == EMPTY_ITEM) continue;
      const ItemDef& def = ITEMS[cell.item];
      bool alive = orbitsAsPetal(def.kind) ? p.petals[i].alive : true;
      if (!alive) continue;
      if (def.speed > 0) speedBonus += def.speed * (1 + cell.rarity * 0.12f);
    }

    float speed = (190 + p.level * 0.8f) * (1 + speedBonus / 100) * p.talentBonuses.speedMult;
    p.currentSpeed = speed;
    float mag = std::hypot(p.inDx, p.inDy);
    float nx = mag > 1 ? p.inDx / mag : p.inDx;
    float ny = mag > 1 ? p.inDy / mag : p.inDy;
    p.vx += (nx * speed - p.vx) * std::min(1.f, dt * 9.f);
    p.vy += (ny * speed - p.vy) * std::min(1.f, dt * 9.f);

    // Wall collision
    float playerRadius = PLAYER_RADIUS + soilRadiusBonusOf(p);
    auto [newX, newY] = collider->moveCircle(p.x, p.y, p.vx * dt, p.vy * dt, playerRadius, &collisionCounter);
    p.x = clampf(newX, playerRadius, map.width - playerRadius);
    p.y = clampf(newY, playerRadius, map.height - playerRadius);

    // Player-to-player push - optimized but visually identical: check only within sum radii
    for (auto* o : allPlayers) {
      if (o == &p || o->mapId != p.mapId || !o->alive) continue;
      float oRadius = PLAYER_RADIUS + soilRadiusBonusOf(*o);
      float minDist = playerRadius + oRadius;
      float checkDist = minDist + 10.f;
      float dx = p.x - o->x;
      float dy = p.y - o->y;
      if (dx * dx + dy * dy > checkDist * checkDist) continue;
      collisionCounter.n++;
      float d = std::hypot(dx, dy);
      if (d < minDist && d > 0.001f) {
        float push = (minDist - d) * 0.5f;
        p.x += (dx / d) * push;
        p.y += (dy / d) * push;
      }
    }
    p.x = clampf(p.x, playerRadius, map.width - playerRadius);
    p.y = clampf(p.y, playerRadius, map.height - playerRadius);

    // Arena 圆形边界
    if (p.mapId == MAP_COUNT - 1) {
      float cx = 4000, cy = 4000, R = 4000;
      float dist = sqrt((p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy));
      float maxDist = R - playerRadius;
      if (dist > maxDist) {
        float angle = atan2(p.y - cy, p.x - cx);
        p.x = cx + cos(angle) * maxDist;
        p.y = cy + sin(angle) * maxDist;
      }
    }

    // Stuck-in-wall safety net
    pushPlayerOutOfWall(p, playerRadius);

    p.hurtCd = std::max(0.f, p.hurtCd - dt);
    bool attack = (p.flags & 1) != 0;
    bool defend = (p.flags & 2) != 0;

    // Bubble: trigger on rising edge of defend
    if (defend && !p.wasDefending) {
      breakBubbles(p);
    }
    p.wasDefending = defend;

    // Third Eye orbit bonus
    float eyeBonus = thirdEyeOrbitBonus(p);
    float targetOrbit = attack ? 118 + eyeBonus : defend ? 34 : 62;
    p.orbit += (targetOrbit - p.orbit) * std::min(1.f, dt * 6.f);
    p.baseAngle += dt * (attack ? 3.4f : 2.2f);

    applyLevel(p);
  }

  float thirdEyeOrbitBonus(Player& p) {
    float best = -1;
    for (int i = 0; i < SLOT_COUNT; i++) {
      Cell& cell = p.slots[i];
      if (cell.item == THIRD_EYE_ITEM && cell.rarity > best) best = cell.rarity;
    }
    return best >= 0 ? 30 * (best + 1) : 0;
  }

  // ---- Push player out of wall ----
  void pushPlayerOutOfWall(Player& p, float playerRadius) {
    if (!p.alive) return;
    auto* collider = playerWallColliders_[p.mapId].get();
    if (!collider) return;

    if (!collider->circleNeedsPreciseCheck(p.x, p.y, playerRadius)) {
      p.lastSafeX = p.x;
      p.lastSafeY = p.y;
      return;
    }

    auto [nx, ny] = collider->collideCircle(p.x, p.y, playerRadius, &collisionCounter);
    float disp = std::abs(nx - p.x) + std::abs(ny - p.y);

    if (disp < PUSH_OUT_THRESHOLD) {
      p.x = nx; p.y = ny;
      p.lastSafeX = p.x; p.lastSafeY = p.y;
      return;
    }

    if (p.lastSafeX != 0 || p.lastSafeY != 0) {
      p.x = p.lastSafeX;
      p.y = p.lastSafeY;
    } else {
      const MapDef& map = MAPS[p.mapId];
      auto spawnTiles = findSpawnTiles(p.mapId);
      if (!spawnTiles.empty()) {
        auto& tile = spawnTiles[rand() % spawnTiles.size()];
        p.x = (tile.second + 0.5f) * (map.width / BLOCK_GRID_COLS);
        p.y = (tile.first + 0.5f) * (map.height / BLOCK_GRID_ROWS);
        auto [cx, cy] = collider->collideCircle(p.x, p.y, playerRadius);
        p.x = cx; p.y = cy;
      }
    }
    p.vx = 0; p.vy = 0;
  }

  // ---- Break bubbles ----
  void breakBubbles(Player& p) {
    for (int i = 0; i < SLOT_COUNT; i++) {
      Cell& cell = p.slots[i];
      if (cell.item == EMPTY_ITEM) continue;
      const ItemDef& def = ITEMS[cell.item];
      if (def.name != "Bubble") continue;
      PetalState& st = p.petals[i];
      if (!st.alive) continue;

      float mult = rarityMult(cell.rarity);
      float pushForce = 800 * std::min(4.0f, mult);
      float dx = p.x - st.x;
      float dy = p.y - st.y;
      float dist = std::hypot(dx, dy);
      float vx, vy;
      if (dist > 0.01f) {
        vx = (dx / dist) * pushForce;
        vy = (dy / dist) * pushForce;
      } else {
        float angle = (float)rand() / (float)RAND_MAX * (float)M_PI * 2;
        vx = std::cos(angle) * pushForce;
        vy = std::sin(angle) * pushForce;
      }
      p.vx += vx;
      p.vy += vy;

      // Push Moon petals
      for (int j = 0; j < SLOT_COUNT; j++) {
        if (j == i) continue;
        Cell& mcell = p.slots[j];
        if (mcell.item == EMPTY_ITEM) continue;
        const ItemDef& mdef = ITEMS[mcell.item];
        if (mdef.name != "Moon") continue;
        PetalState& mst = p.petals[j];
        if (!mst.alive) continue;
        mst.x += vx * 0.1f;
        mst.y += vy * 0.1f;
      }

      st.alive = false;
      st.hp = 0;
      st.timer = def.reload > 0 ? applyTalentReload(p, def.reload) : 0.001f;
    }
  }

  // ---- Petal update ----
  void updatePetals(Player& p, float dt, std::vector<Player*>& allPlayers) {
    if (!p.alive) return;
    World& world = worlds[p.mapId];

    int liveCount = 0;
    for (int i = 0; i < SLOT_COUNT; i++) {
      Cell& cell = p.slots[i];
      if (cell.item == EMPTY_ITEM) continue;
      if (orbitsAsPetal(ITEMS[cell.item].kind)) liveCount++;
    }

    // Moon orbit center
    PetalState* moonSt = nullptr;
    for (int i = 0; i < SLOT_COUNT; i++) {
      Cell& cell = p.slots[i];
      if (cell.item == EMPTY_ITEM) continue;
      const ItemDef& def = ITEMS[cell.item];
      if (def.name == "Moon") { moonSt = &p.petals[i]; break; }
    }
    bool moonAlive = moonSt && moonSt->alive;
    float orbitCenterX = moonAlive ? moonSt->x : p.x;
    float orbitCenterY = moonAlive ? moonSt->y : p.y;

    int index = 0;
    for (int i = 0; i < SLOT_COUNT; i++) {
      Cell& cell = p.slots[i];
      PetalState& st = p.petals[i];
      if (cell.item == EMPTY_ITEM) continue;
      const ItemDef& def = ITEMS[cell.item];
      bool isSummon = def.kind == IK_SUMMON;
      if (!orbitsAsPetal(def.kind)) continue;

      if (isSummon) cleanupPets(p, i);

      float slotAngle = p.baseAngle + (float)index / (float)std::max(1, liveCount) * (float)M_PI * 2;
      index++;

      st.hitCd = std::max(0.f, st.hitCd - dt);

      if (!st.alive) {
        st.timer -= dt;
        if (st.timer <= 0) {
          st.alive = true;
          st.maxHp = def.health * rarityMult(cell.rarity);
          st.hp = st.maxHp;
          st.specialTimer = isAbsorbItem(cell.item) ? ROSE_HEAL_DELAY : 0;
          st.absorbTimer = 0;
          st.x = p.x; st.y = p.y;
        }
        continue;
      }

      if (isSummon && (int)p.pets[i].size() < getSummonCount(cell.item)) {
        hatchPet(p, i, cell);
        st.alive = false; st.hp = 0; st.timer = applyTalentReload(p, def.reload);
        continue;
      }

      bool absorbs = isAbsorbItem(cell.item) && (def.heal > 0 || def.shield > 0);
      bool staysTight = isSummon || def.name == "Magnet" || def.name == "Bubble";
      float orbitRadius = (absorbs || staysTight) ? std::min(p.orbit, 62.f) : p.orbit;
      bool isMoon = (def.name == "Moon");
      float cx = isMoon ? p.x : orbitCenterX;
      float cy = isMoon ? p.y : orbitCenterY;
      float tx = cx + std::cos(slotAngle) * orbitRadius;
      float ty = cy + std::sin(slotAngle) * orbitRadius;

      if (absorbs) {
        float missing = def.heal > 0 ? std::max(0.f, p.maxHp - p.hp) : std::max(0.f, p.maxHp - p.shield);
        st.specialTimer = std::max(0.f, st.specialTimer - dt);
        if (st.absorbTimer > 0) {
          float travelStep = std::min(1.f, dt / std::max(dt, st.absorbTimer));
          st.x += (p.x - st.x) * travelStep;
          st.y += (p.y - st.y) * travelStep;
          st.absorbTimer = std::max(0.f, st.absorbTimer - dt);
          if (st.absorbTimer <= 0 && missing > 0) {
            float amount = std::min(missing, (def.heal > 0 ? def.heal : def.shield) * rarityMult(cell.rarity));
            if (def.heal > 0) p.hp += amount; else p.shield += amount;
            p.statsDirty = true;
            st.alive = false; st.hp = 0; st.timer = applyTalentReload(p, def.reload);
          }
          continue;
        }
        st.x += (tx - st.x) * std::min(1.f, dt * 14.f);
        st.y += (ty - st.y) * std::min(1.f, dt * 14.f);
        if (st.specialTimer <= 0 && missing > 0) { st.absorbTimer = ROSE_ABSORB_TIME; continue; }
      } else {
        st.x += (tx - st.x) * std::min(1.f, dt * 14.f);
        st.y += (ty - st.y) * std::min(1.f, dt * 14.f);
      }

      // Heal per sec
      if (def.healPerSec > 0 && p.hp < p.maxHp) {
        float threshold = def.healPerSecThreshold > 0 ? def.healPerSecThreshold : 1;
        if (p.hp / p.maxHp < threshold) {
          float restored = std::min(p.maxHp - p.hp, def.healPerSec * rarityMult(cell.rarity) * dt);
          if (restored > 0) { p.hp += restored; p.statsDirty = true; }
        }
      }

      // Shield per sec
      if (def.shieldPerSec > 0) {
        if (p.shield < p.maxHp) {
          p.shield = std::min(p.maxHp, p.shield + def.shieldPerSec * rarityMult(cell.rarity) * dt);
          p.statsDirty = true;
        }
      }

      // Petal-to-mob collision damage - optimized but visually identical
      // Pre-filter by player->mob distance <= orbit + mob.radius + pr + 50
      if (st.hitCd <= 0 && !isSummon) {
        float pr = def.radius * (1 + cell.rarity * 0.06f);
        for (auto& mob : world.mobs) {
          if (mob.friendly && mob.ownerId == p.id) continue;
          if (mob.hp <= 0) continue;
          float mdx = mob.x - p.x, mdy = mob.y - p.y;
          float preFilterDist = p.orbit + mob.radius + pr + 50.f;
          if (mdx * mdx + mdy * mdy > preFilterDist * preFilterDist) continue;
          collisionCounter.n++;
          float dx = mob.x - st.x, dy = mob.y - st.y;
          float rSum = mob.radius + pr;
          if (dx * dx + dy * dy < rSum * rSum) {
            float d = std::hypot(dx, dy);
            if (d < 0.001f) continue;
            float dmg = def.damage * rarityMult(cell.rarity) * p.talentBonuses.petalDmgMult;
            mob.hp -= dmg;
            mob.lastHitBy = p.id;
            mob.damageByPlayer[p.id] += dmg;
            mob.targetId = p.id;
            st.hp -= mob.damage * 0.5f;
            st.hitCd = 0.03f;
            // Knockback
            float kb = 90.f / (mob.radius / 20.f);
            mob.vx += ((mob.x - st.x) / d) * kb;
            mob.vy += ((mob.y - st.y) / d) * kb;
            if (st.hp <= 0) {
              st.alive = false;
              st.timer = applyTalentReload(p, def.reload);
            }
            break;
          }
        }
      }

      // Petal-to-player collision damage (PvP)
      if (st.hitCd <= 0 && !isSummon) {
        float pr = def.radius * (1 + cell.rarity * 0.06f);
        for (auto* other : allPlayers) {
          if (other->id == p.id || other->mapId != p.mapId || !other->alive) continue;
          if (other->hurtCd > 0) continue;
          collisionCounter.n++;
          float dx = other->x - st.x, dy = other->y - st.y;
          float plRadius = PLAYER_RADIUS + soilRadiusBonusOf(*other);
          float rSum = plRadius + pr;
          if (dx * dx + dy * dy < rSum * rSum) {
            float dmg = def.damage * rarityMult(cell.rarity) * p.talentBonuses.petalDmgMult;
            if (other->shield > 0 && dmg > 0) {
              float absorbed = std::min(other->shield * 2.f, dmg);
              other->shield -= absorbed / 2.f;
              dmg -= absorbed;
            }
            other->hp -= dmg;
            other->hurtCd = 0.1f;
            other->statsDirty = true;
            st.hp -= 1;
            st.hitCd = 0.03f;
            if (other->hp <= 0) { killPlayer(*other); handleArenaPlayerDeath(*other); }
            if (st.hp <= 0) {
              st.alive = false;
              st.timer = applyTalentReload(p, def.reload);
            }
            break;
          }
        }
      }
    }
  }

  // ---- World update ----
  void updateWorld(int mapId, float dt, std::vector<Player*>& allPlayers) {
    const MapDef& map = MAPS[mapId];
    auto* collider = wallColliders_[mapId].get();
    World& world = worlds[mapId];
    auto& mobs = world.mobs;
    auto& proj = world.projectiles;

    std::vector<Player*> here;
    for (auto* p : allPlayers) {
      if (p->mapId == mapId && p->alive) here.push_back(p);
    }

    // Player positions (including dead players for dormant system)
    std::vector<std::pair<float,float>> playerPositions;
    for (auto& [id, p] : players) {
      if (p.mapId == mapId) {
        playerPositions.push_back(p.alive ? std::make_pair(p.x, p.y) : std::make_pair(p.deathX, p.deathY));
      }
    }

    // Dormant system
    float viewRadius = VIEW_RADIUS * VIEW_SCALE;
    float viewRadiusSq = viewRadius * viewRadius;

    // Move out-of-view mobs to dormant
    std::vector<DormantMob> toDormant;
    for (int i = (int)mobs.size() - 1; i >= 0; i--) {
      Mob& mob = mobs[i];
      bool inView = false;
      if (mob.ownerId != 0) {
        inView = true;
      } else {
        for (auto& pos : playerPositions) {
          float dx = mob.x - pos.first, dy = mob.y - pos.second;
          if (dx * dx + dy * dy < viewRadiusSq) { inView = true; break; }
        }
      }
      if (!inView) {
        if (!mob.friendly) decZoneCount(mapId, zoneAt(mapId, mob.x, mob.y));
        DormantMob d;
        d.type = mob.type; d.rarity = mob.rarity;
        d.x = mob.x; d.y = mob.y; d.vx = mob.vx; d.vy = mob.vy;
        d.health = mob.hp; d.maxHealth = mob.maxHp;
        d.lastHitBy = mob.lastHitBy;
        for (auto& [pid, dmg] : mob.damageByPlayer) d.damageByPlayer.push_back({pid, dmg});
        for (float t : mob.spawnedThresholds) d.spawnedThresholds.push_back(t);
        toDormant.push_back(d);
        mobs.erase(mobs.begin() + i);
      }
    }
    world.dormantMobs.insert(world.dormantMobs.end(), toDormant.begin(), toDormant.end());

    // Wake up dormant mobs
    std::vector<DormantMob> stillDormant;
    for (auto& d : world.dormantMobs) {
      bool inView = false;
      for (auto& pos : playerPositions) {
        float dx = d.x - pos.first, dy = d.y - pos.second;
        if (dx * dx + dy * dy < viewRadiusSq) { inView = true; break; }
      }
      if (inView) {
        Mob m(nextMobId++, d.type, mapId, d.x, d.y, d.rarity);
        m.hp = d.health; m.maxHp = d.maxHealth;
        m.vx = d.vx; m.vy = d.vy;
        m.lastHitBy = d.lastHitBy;
        for (auto& [pid, dmg] : d.damageByPlayer) m.damageByPlayer[pid] = dmg;
        for (float t : d.spawnedThresholds) m.spawnedThresholds.insert(t);
        mobs.push_back(m);
        incZoneCount(mapId, zoneAt(mapId, m.x, m.y));
      } else {
        stillDormant.push_back(d);
      }
    }
    world.dormantMobs = stillDormant;

    // Region-based update
    std::unordered_set<std::string> playerRegionKeys;
    for (auto& pos : playerPositions) {
      int rx = (int)std::floor(pos.first / REGION_SIZE);
      int ry = (int)std::floor(pos.second / REGION_SIZE);
      for (int dx = -1; dx <= 1; dx++) {
        for (int dy = -1; dy <= 1; dy++) {
          playerRegionKeys.insert(std::to_string(rx + dx) + "," + std::to_string(ry + dy));
        }
      }
    }

    // 构建空间网格 + 计算最大半径（用于无损优化）
    mobGrid.clear();
    float maxMobRadius = 60.f;
    for (int i = 0; i < (int)mobs.size(); i++) {
      mobGrid.insert(i, mobs[i].x, mobs[i].y, mobs[i].radius);
      if (mobs[i].radius > maxMobRadius) maxMobRadius = mobs[i].radius;
    }

    for (int i = (int)mobs.size() - 1; i >= 0; i--) {
      Mob& mob = mobs[i];
      mob.hitCd = std::max(0.f, mob.hitCd - dt);
      mob.spawnProtection = std::max(0.f, mob.spawnProtection - dt);
      mob.thinkTimer -= dt;

      std::string mobRegionKey = std::to_string((int)std::floor(mob.x / REGION_SIZE)) + "," + std::to_string((int)std::floor(mob.y / REGION_SIZE));
      bool inPlayerRegion = playerRegionKeys.count(mobRegionKey) > 0;

      if (!inPlayerRegion) {
        // Basic movement only
        if (mob.speed > 0) {
          mob.vx *= 0.98f;
          mob.vy *= 0.98f;
        } else {
          mob.vx *= 0.9f;
          mob.vy *= 0.9f;
        }
        mob.x += mob.vx * dt;
        mob.y += mob.vy * dt;
        mob.x = clampf(mob.x, mob.radius, map.width - mob.radius);
        mob.y = clampf(mob.y, mob.radius, map.height - mob.radius);
        if (mob.hp <= 0) {
          if (!mob.friendly) decZoneCount(mapId, zoneAt(mapId, mob.x, mob.y));
          mobs.erase(mobs.begin() + i);
          if (mob.friendly && mob.ownerSlot >= 0) {
            auto owner = get(mob.ownerId);
            if (owner) {
              auto& ownerPets = owner->pets[mob.ownerSlot];
              ownerPets.erase(std::remove(ownerPets.begin(), ownerPets.end(), mob.id), ownerPets.end());
            }
          }
        }
        continue;
      }

      // ---- Target finding ----
      struct TargetInfo { float x, y; int id; };
      TargetInfo* target = nullptr;
      TargetInfo targetStorage;
      float best = 1e30f;

      if (mob.thinkTimer <= 0) {
        mob.thinkTimer = MOB_THINK_INTERVAL + (float)rand() / (float)RAND_MAX * 0.05f;

        if (mob.friendly) {
          auto nearby = mobGrid.query(mob.x, mob.y, 520);
          for (int oi : nearby) {
            if (oi == i || oi >= (int)mobs.size()) continue;
            auto& other = mobs[oi];
            if (!other.friendly && other.hp > 0) {
              float d = std::hypot(other.x - mob.x, other.y - mob.y);
              if (d < 520 && d < best) { best = d; targetStorage = {other.x, other.y, other.id}; target = &targetStorage; }
            }
          }
          auto owner = get(mob.ownerId);
          if (owner) {
            float od = std::hypot(owner->x - mob.x, owner->y - mob.y);
            if (!target || od > 260) { targetStorage = {owner->x, owner->y, owner->id}; target = &targetStorage; }
          }
        } else {
          for (auto* p : here) {
            float d = std::hypot(p->x - mob.x, p->y - mob.y);
            if (d < 460 && d < best) { best = d; targetStorage = {p->x, p->y, p->id}; target = &targetStorage; }
          }
          auto nearby = mobGrid.query(mob.x, mob.y, 380);
          for (int oi : nearby) {
            if (oi == i || oi >= (int)mobs.size()) continue;
            auto& other = mobs[oi];
            if (other.friendly && other.hp > 0) {
              float d = std::hypot(other.x - mob.x, other.y - mob.y);
              if (d < 380 && d < best) { best = d; targetStorage = {other.x, other.y, other.id}; target = &targetStorage; }
            }
          }
        }
        if (target) {
          mob.targetId = target->id;
          mob.cachedTargetX = target->x;
          mob.cachedTargetY = target->y;
        } else {
          mob.targetId = 0;
        }
      } else {
        // Reuse cached target
        if (mob.targetId != 0) {
          if (mob.friendly) {
            bool found = false;
            for (auto& other : mobs) {
              if (other.id == mob.targetId && !other.friendly && other.hp > 0) {
                targetStorage = {other.x, other.y, other.id}; target = &targetStorage; found = true; break;
              }
            }
            if (!found) {
              auto owner = get(mob.ownerId);
              if (owner) { targetStorage = {owner->x, owner->y, owner->id}; target = &targetStorage; }
              else mob.targetId = 0;
            }
          } else {
            bool found = false;
            for (auto* p : here) {
              if (p->id == (uint16_t)mob.targetId) { targetStorage = {p->x, p->y, p->id}; target = &targetStorage; found = true; break; }
            }
            if (!found) {
              for (auto& other : mobs) {
                if (other.id == mob.targetId && other.friendly && other.hp > 0) {
                  targetStorage = {other.x, other.y, other.id}; target = &targetStorage; found = true; break;
                }
              }
              if (!found) mob.targetId = 0;
            }
          }
        }
      }

      // ---- Movement ----
      if (target && mob.speed > 0) {
        float dx = target->x - mob.x, dy = target->y - mob.y;
        float d = std::hypot(dx, dy);
        if (d > 0.01f) {
          mob.vx += ((dx / d) * mob.speed - mob.vx) * std::min(1.f, dt * 4.f);
          mob.vy += ((dy / d) * mob.speed - mob.vy) * std::min(1.f, dt * 4.f);
          mob.angle = std::atan2(dy, dx);
        }
      } else if (mob.speed > 0) {
        mob.wander -= dt;
        if (mob.wander <= 0) {
          mob.wander = 1.5f + (float)rand() / (float)RAND_MAX * 3;
          mob.angle = (float)rand() / (float)RAND_MAX * (float)M_PI * 2;
        }
        mob.vx += (std::cos(mob.angle) * mob.speed * 0.4f - mob.vx) * std::min(1.f, dt * 2.f);
        mob.vy += (std::sin(mob.angle) * mob.speed * 0.4f - mob.vy) * std::min(1.f, dt * 2.f);
      } else {
        mob.vx *= 0.9f;
        mob.vy *= 0.9f;
      }

      // ---- Position update ----
      mob.x += mob.vx * dt;
      mob.y += mob.vy * dt;
      mob.x = clampf(mob.x, mob.radius, map.width - mob.radius);
      mob.y = clampf(mob.y, mob.radius, map.height - mob.radius);

      // ---- Wall collision ---- optimized: broadphase skip when far from walls
      float wallX = mob.x, wallY = mob.y;
      if (collider->circleNeedsPreciseCheck(mob.x, mob.y, mob.radius, MOB_WALL_INFLATE)) {
        std::tie(wallX, wallY) = collider->collideCircle(mob.x, mob.y, mob.radius, &collisionCounter, MOB_WALL_INFLATE);
      }
      if (std::abs(wallX - mob.x) >= PUSH_OUT_THRESHOLD || std::abs(wallY - mob.y) >= PUSH_OUT_THRESHOLD) {
        if (mob.pushOutCooldown <= 0) {
          mob.pushOutCooldown = 0.8f;
          pushOutOfWall(mob, mapId);
        }
      } else {
        mob.x = wallX; mob.y = wallY;
      }
      mob.pushOutCooldown = std::max(0.f, mob.pushOutCooldown - dt);

      // ---- Mob-to-mob collision (空间网格加速) ----
      // Optimized but visually identical: query radius = mob.radius + maxMobRadius + 10
      // Guarantees any colliding pair is found, but reduces candidates 10x for typical worlds.
      bool isStationary = mob.speed <= 0;
      if (!isStationary) {
        mob.collisionTimer -= dt;
        if (mob.collisionTimer <= 0) {
          float interval = mob.speed <= MOB_COLLISION_SLOW_SPEED ? MOB_COLLISION_SLOW_INTERVAL : MOB_COLLISION_FAST_INTERVAL;
          mob.collisionTimer = interval + (float)(rand() % 20) / 1000.f;
          auto nearby = mobGrid.query(mob.x, mob.y, mob.radius + maxMobRadius + 10.f);
          for (int otherIdx : nearby) {
            if (otherIdx == i || otherIdx >= (int)mobs.size()) continue;
            auto& other = mobs[otherIdx];
            float minDist = mob.radius + other.radius;
            float checkDist = minDist + 10.f;
            float dx = mob.x - other.x, dy = mob.y - other.y;
            if (dx * dx + dy * dy > checkDist * checkDist) continue;
            collisionCounter.n++;
            float d = std::hypot(dx, dy);
            if (d < minDist && d > 0.001f) {
              float push = (minDist - d) * 0.4f;
              mob.x += (dx / d) * push;
              mob.y += (dy / d) * push;
              if (mob.hitCd <= 0) {
                // 允许友方生物被伤害：
                // 1. 非友方生物 vs 友方生物 → 非友方攻击友方
                // 2. 不同玩家的友方生物互伤
                // 3. 跳过同一玩家的友方生物互伤
                bool sameOwner = mob.friendly && other.friendly && mob.ownerId != 0 && mob.ownerId == other.ownerId;
                if (sameOwner) { /* skip own pets */ }
                else if (mob.friendly && other.friendly) {
                  // 不同玩家的友方生物：互相伤害
                  if (mob.spawnProtection <= 0) {
                    float dmg = other.damage * 0.6f;
                    mob.hp -= dmg;
                    mob.lastHitBy = other.ownerId;
                    mob.damageByPlayer[other.ownerId] += dmg;
                  }
                  if (other.spawnProtection <= 0) {
                    float dmg = mob.damage * 0.6f;
                    other.hp -= dmg;
                    other.lastHitBy = mob.ownerId;
                    other.damageByPlayer[mob.ownerId] += dmg;
                  }
                } else if (mob.friendly || other.friendly) {
                  // 至少一个是友方：双方互相伤害
                  auto& nonFriendly = mob.friendly ? other : mob;
                  auto& friendly = mob.friendly ? mob : other;
                  // 非友方攻击友方
                  if (friendly.spawnProtection <= 0) {
                    float dmg = nonFriendly.damage * 0.6f;
                    friendly.hp -= dmg;
                    friendly.lastHitBy = nonFriendly.ownerId;
                    friendly.damageByPlayer[nonFriendly.ownerId] += dmg;
                  }
                  // 友方攻击非友方
                  if (nonFriendly.spawnProtection <= 0 && friendly.damage > 0) {
                    float dmg = friendly.damage * 0.6f;
                    nonFriendly.hp -= dmg;
                    nonFriendly.lastHitBy = friendly.ownerId;
                    nonFriendly.damageByPlayer[friendly.ownerId] += dmg;
                  }
                }
                mob.hitCd = 0.1f;
                other.hitCd = 0.1f;
              }
            }
          }
        }
      }

      // ---- Mob-to-player collision ---- optimized but visually identical
      if (!mob.friendly) {
        for (auto* p : here) {
          float pRadius = PLAYER_RADIUS + soilRadiusBonusOf(*p);
          float minDist = mob.radius + pRadius;
          float checkDist = minDist + 20.f;
          float dx = p->x - mob.x, dy = p->y - mob.y;
          if (dx * dx + dy * dy > checkDist * checkDist) continue;
          collisionCounter.n++;
          float d = std::hypot(dx, dy);
          if (d < minDist) {
            float push = (minDist - d) * 0.5f;
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
              if (p->hp <= 0) { killPlayer(*p); handleArenaPlayerDeath(*p); }
            }

            // Player body-contact damage to mob
            if (mob.hitCd <= 0 && mob.hp > 0 && p->bodyDamage > 0) {
              float bodyDmg = std::max(1.f, p->bodyDamage * p->talentBonuses.bodyDamageMult);
              mob.hp -= bodyDmg;
              mob.lastHitBy = p->id;
              mob.damageByPlayer[p->id] += bodyDmg;
              mob.hitCd = 0.1f;
            }
          }
        }
      }

      // ---- Hornet missile ----
      if (mob.type == 16 && target && !mob.friendly) {
        mob.missileTimer -= dt;
        if (mob.missileTimer <= 0) {
          float tdx = target->x - mob.x, tdy = target->y - mob.y;
          float tdist = std::hypot(tdx, tdy);
          if (tdist < HORNET_MISSILE_RANGE) {
            mob.missileTimer = HORNET_MISSILE_INTERVAL;
            mob.angle = std::atan2(tdy, tdx);
            float muzzleX = mob.x + std::cos(mob.angle) * (mob.radius + 6);
            float muzzleY = mob.y + std::sin(mob.angle) * (mob.radius + 6);
            float dmg = mob.damage * 0.6f * (1 + mob.rarity * 0.25f);
            fireProjectile(mapId, muzzleX, muzzleY, mob.angle, MISSILE_SPEED, dmg,
                          TEAM_HOSTILE, mob.id, mob.type, mob.rarity, 10);
          }
        }
      }

      // ---- Scorpion projectile ----
      if (mob.type == SCORPION_TYPE && target && !mob.friendly) {
        mob.missileTimer -= dt;
        if (mob.missileTimer <= 0) {
          float tdx = target->x - mob.x, tdy = target->y - mob.y;
          float tdist = std::hypot(tdx, tdy);
          if (tdist < SCORPION_MISSILE_RANGE) {
            mob.missileTimer = SCORPION_MISSILE_INTERVAL;
            mob.angle = std::atan2(tdy, tdx);
            float muzzleX = mob.x + std::cos(mob.angle) * (mob.radius + 6);
            float muzzleY = mob.y + std::sin(mob.angle) * (mob.radius + 6);
            float dmg = mob.damage * 0.5f * (1 + mob.rarity * 0.2f);
            fireProjectile(mapId, muzzleX, muzzleY, mob.angle, SCORPION_MISSILE_SPEED, dmg,
                          TEAM_HOSTILE, mob.id, mob.type, mob.rarity, 8,
                          true, SCORPION_PROJECTILE_MAX_DISTANCE,
                          std::round(SCORPION_PROJECTILE_BASE_HP * rarityMult(mob.rarity)));
          }
        }
      }

      // ---- Spawner logic ----
      if (!mob.friendly) {
        const MobDef& mobDef = MOBS[mob.type];
        if (mobDef.isSpawner) {
          float hpPct = mob.hp / mob.maxHp;
          for (float threshold : mobDef.spawnThresholds) {
            if (hpPct <= threshold && !mob.spawnedThresholds.count(threshold)) {
              mob.spawnedThresholds.insert(threshold);
              for (int spawnId : mobDef.spawnMobIds) {
                const MobDef& spawnDef = MOBS[spawnId];
                float angle = (float)rand() / (float)RAND_MAX * (float)M_PI * 2;
                float dist = mob.radius + spawnDef.radius + 12 + (float)rand() / (float)RAND_MAX * 28;
                float sx = clampf(mob.x + std::cos(angle) * dist, spawnDef.radius + 4, map.width - spawnDef.radius - 4);
                float sy = clampf(mob.y + std::sin(angle) * dist, spawnDef.radius + 4, map.height - spawnDef.radius - 4);
                mobs.push_back(Mob(nextMobId++, spawnId, mapId, sx, sy, mob.rarity));
              }
            }
          }
        }
      }

      // ---- Death check ----
      if (mob.hp <= 0) {
        if (!mob.friendly) {
          decZoneCount(mapId, zoneAt(mapId, mob.x, mob.y));
          onMobKilled(mob, mapId);  // 必须在erase之前调用，否则mob引用悬空
        }
        mobs.erase(mobs.begin() + i);
        if (mob.friendly) {
          auto owner = get(mob.ownerId);
          if (owner && mob.ownerSlot >= 0) {
            auto& ownerPets = owner->pets[mob.ownerSlot];
            ownerPets.erase(std::remove(ownerPets.begin(), ownerPets.end(), mob.id), ownerPets.end());
          }
          continue;
        }
        continue;
      }
    }

    // ---- Drop updates ----
    for (int i = (int)world.drops.size() - 1; i >= 0; i--) {
      Drop& d = world.drops[i];
      d.ttl -= dt;
      if (d.groundTimer > 0) d.groundTimer = std::max(0.f, d.groundTimer - dt);
      if (d.suctionTimer > 0) d.suctionTimer = std::max(0.f, d.suctionTimer - dt);
      if (d.ttl <= 0) world.drops.erase(world.drops.begin() + i);
    }
  }

  // ---- Pickup drops ----
  float basicPickupRadiusFor(Player& p) {
    return PLAYER_RADIUS + soilRadiusBonusOf(p) + 20.f;
  }

  void pickupDrops(Player& p, float dt) {
    if (!p.alive) return;
    World& world = worlds[p.mapId];
    float basicRadius = basicPickupRadiusFor(p);
    float magnetBonus = magnetRangeFor(p);
    float totalMagnetRange = basicRadius + magnetBonus; // additive magnet
    int looted = 0;

    for (int i = (int)world.drops.size() - 1; i >= 0; i--) {
      Drop& d = world.drops[i];

      // Per-player filtering
      if (d.hasAllowList && !d.allowedPlayerIds.count(p.id)) continue;
      if (d.groundTimer > 0) continue;

      float dist = std::hypot(d.x - p.x, d.y - p.y);

      // Unified attraction: basicRadius is 100% collect (player radius +20)
      // magnetBonus adds to radius, same collection logic, with suction animation.
      if (dist < totalMagnetRange) {
        if (d.suctionTimer <= 0) d.suctionTimer = 0.25f;
        float move = dist * dt / std::max(d.suctionTimer, dt);
        if (dist > 0.001f) {
          d.x += ((p.x - d.x) / dist) * move;
          d.y += ((p.y - d.y) / dist) * move;
        }
        if (dist < 16 || d.suctionTimer <= dt) {
          if (addItem(p, d.item, d.rarity, d.count)) {
            world.drops.erase(world.drops.begin() + i);
            looted++;
          }
          continue;
        }
      } else {
        d.suctionTimer = 0;
      }
    }

    // Push EVT_LOOT event if anything was picked up
    if (looted > 0 && clientMap) {
      for (auto& [csId, cs] : *clientMap) {
        if (cs->player == &p) {
          pushEvent(*cs, EVT_LOOT, p.x, p.y, looted);
          break;
        }
      }
    }
  }

  float magnetRangeFor(Player& p) {
    static const float MAGNET_RARITY_BONUS[] = {0, 1, 1.2f, 2, 2.5f, 3, 4.5f, 6, 9, 14, 14};
    float total = 0;
    for (int i = 0; i < SLOT_COUNT; i++) {
      Cell& cell = p.slots[i];
      if (cell.item == EMPTY_ITEM) continue;
      const ItemDef& def = ITEMS[cell.item];
      if (def.magnetRange <= 0) continue;
      PetalState& st = p.petals[i];
      if (!st.alive) continue;
      int bonusIdx = std::min((int)cell.rarity, (int)(sizeof(MAGNET_RARITY_BONUS)/sizeof(MAGNET_RARITY_BONUS[0])) - 1);
      float bonus = MAGNET_RARITY_BONUS[bonusIdx];
      total += std::round(def.magnetRange + bonus * 150);
    }
    return total;
  }

  // ---- Projectile update ----
  void updateProjectiles(int mapId, float dt, std::vector<Player*>& players) {
    auto& proj = worlds[mapId].projectiles;
    const MapDef& map = MAPS[mapId];
    auto* collider = wallColliders_[mapId].get();
    auto& mobs = worlds[mapId].mobs;
    float projViewRadiusSq = (VIEW_RADIUS * VIEW_SCALE) * (VIEW_RADIUS * VIEW_SCALE);

    for (int i = (int)proj.size() - 1; i >= 0; i--) {
      Projectile& p = proj[i];
      p.ttl -= dt;
      if (p.ttl <= 0) { proj.erase(proj.begin() + i); continue; }
      p.hitCd = std::max(0.f, p.hitCd - dt);

      // Position update
      float prevX = p.x, prevY = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.distanceTraveled += std::hypot(p.x - prevX, p.y - prevY);
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
        // Hit players
        for (auto* pl : players) {
          if (pl->mapId != mapId || !pl->alive || p.hitCd > 0) continue;
          float pdx = pl->x - p.x, pdy = pl->y - p.y;
          if (pdx * pdx + pdy * pdy > projViewRadiusSq) continue; // 视野裁剪
          float d = std::hypot(pdx, pdy);
          float plRadius = PLAYER_RADIUS + soilRadiusBonusOf(*pl);
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
            if (pl->hp <= 0) { killPlayer(*pl); handleArenaPlayerDeath(*pl); }
            if (!p.isPiercing) { proj.erase(proj.begin() + i); break; }
            p.hp -= 1;
            if (p.hp <= 0) { proj.erase(proj.begin() + i); break; }
          }
        }
      } else {
        // Hit hostile mobs and friendly mobs — 使用空间网格加速
        SpatialGrid projMobGrid;
        for (int mi = 0; mi < (int)mobs.size(); mi++) {
          projMobGrid.insert(mi, mobs[mi].x, mobs[mi].y, mobs[mi].radius);
        }
        auto nearbyMobs = projMobGrid.query(p.x, p.y, p.radius + 400);
        for (int otherIdx : nearbyMobs) {
          if (otherIdx >= (int)mobs.size()) continue;
          auto& mob = mobs[otherIdx];
          if (mob.hp <= 0 || p.hitCd > 0) continue;
          float mdx = mob.x - p.x, mdy = mob.y - p.y;
          if (mdx * mdx + mdy * mdy > projViewRadiusSq) continue; // 视野裁剪
          float d = std::hypot(mdx, mdy);
          if (d < mob.radius + p.radius) {
            mob.hp -= p.damage;
            mob.lastHitBy = p.ownerId;
            mob.damageByPlayer[p.ownerId] += p.damage;
            p.hitCd = PROJECTILE_HIT_CD;
            if (!p.isPiercing) { proj.erase(proj.begin() + i); break; }
            p.hp -= mob.damage * 0.5f;
            if (p.hp <= 0) { proj.erase(proj.begin() + i); break; }
          }
        }
      }
    }
  }

  // ---- AFK handling ----
  void markActive(ClientState& cs, bool canDismiss = false) {
    if (cs.afkPending) {
      if (!canDismiss) return;
      cs.afkPending = false;
      cs.afkSecondsLeft = 0;
      cs.idleSeconds = 0;
      cs.afkLastSent = -1;
      return;
    }
    cs.idleSeconds = 0;
  }

  static Writer afkPacket(const ClientState& cs) {
    Writer w;
    w.u8v(S2C_AFK_CHECK);
    w.u8v(cs.afkPending ? 1 : 0);
    float left = cs.afkSecondsLeft < 0 ? 0 : cs.afkSecondsLeft;
    w.u16v(static_cast<uint16_t>(std::ceil(left)));
    return w;
  }

  void updateAfk(float dt, std::vector<uint16_t>& changed, std::unordered_map<uint16_t, ClientState*>& clientMap) {
    for (auto& [id, p] : players) {
      auto it = clientMap.find(id);
      if (it == clientMap.end()) continue;
      ClientState& cs = *it->second;
      if (cs.kick) continue;
      if (cs.afkPending) {
        cs.afkSecondsLeft -= dt;
        if (cs.afkSecondsLeft <= 0) {
          cs.afkSecondsLeft = 0;
          cs.kick = true;
          changed.push_back(id);
          continue;
        }
        int secs = static_cast<int>(std::ceil(cs.afkSecondsLeft));
        if (secs != cs.afkLastSent) {
          cs.afkLastSent = secs;
          changed.push_back(id);
        }
        continue;
      }
      cs.idleSeconds += dt;
      if (cs.idleSeconds >= AFK_IDLE_SECONDS) {
        cs.afkPending = true;
        cs.afkSecondsLeft = AFK_CHECK_SECONDS;
        cs.afkLastSent = static_cast<int>(AFK_CHECK_SECONDS);
        changed.push_back(id);
      }
    }
  }

  // ---- Squad system ----
  std::string generateSquadCode() {
    static const char* chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    std::string code;
    for (int i = 0; i < SQUAD_CODE_LENGTH; i++) {
      code += chars[rand() % 32];
    }
    return code;
  }

  void removePlayerFromSquad(Player& p) {
    if (p.squadCode.empty()) return;
    auto it = squads.find(p.squadCode);
    if (it != squads.end()) {
      it->second.members.erase(p.id);
      if (it->second.members.empty()) squads.erase(it);
    }
    p.squadCode = "";
  }

  std::string canJoinSquad(Player& p, Squad& squad) {
    if ((int)squad.members.size() >= SQUAD_MAX_MEMBERS) return "Squad is full.";
    for (auto& [pid, member] : squad.members) {
      if (std::abs((int)p.level - member.level) > SQUAD_LEVEL_GAP_MAX) {
        return "Level gap too large (max " + std::to_string(SQUAD_LEVEL_GAP_MAX) + ").";
      }
    }
    return "";
  }

  // ---- Snapshot writer ----
  Writer snapshotFor(Player& me, uint32_t tickCount, std::unordered_map<uint16_t, ClientState*>& clientMap) {
    Writer w;
    w.u8v(S2C_SNAPSHOT);
    w.u32v(tickCount);

    World& world = worlds[me.mapId];
    Writer body;
    body.b.reserve(2048); // 预分配减少 realloc
    uint16_t count = 0;
    float snapViewX = VIEW_RADIUS * VIEW_SCALE;
    float snapViewY = snapViewX * 0.73f; // 保持宽高比

    // Players
    for (auto& [id, other] : players) {
      if (other.mapId != me.mapId || !other.alive) continue;
      if (&other != &me && (std::abs(other.x - me.x) >= snapViewX || std::abs(other.y - me.y) >= snapViewY)) continue;
      float opRadius = PLAYER_RADIUS + soilRadiusBonusOf(other);
      body.u8v(ENT_PLAYER);
      body.u16v(other.id);
      body.u8v(other.flags);
      body.u8v(&other == &me ? TEAM_SELF : TEAM_FRIENDLY);
      body.i16v((int16_t)std::round(other.x));
      body.i16v((int16_t)std::round(other.y));
      body.u16v((uint16_t)std::round((fmod(other.baseAngle, M_PI * 2) / (M_PI * 2)) * 65535));
      body.u8v((uint8_t)std::round(opRadius));
      float hpPct = other.maxHp > 0 ? other.hp / other.maxHp : 0;
      body.u8v((uint8_t)(255.f * std::min(1.f, hpPct)));
      body.str(other.name);
      count++;

      // Petals for this player
      for (int pi = 0; pi < SLOT_COUNT; pi++) {
        Cell& pcell = other.slots[pi];
        PetalState& pst = other.petals[pi];
        if (pcell.item == EMPTY_ITEM || !pst.alive) continue;
        if (!orbitsAsPetal(ITEMS[pcell.item].kind)) continue;
        float pr = ITEMS[pcell.item].radius * (1 + pcell.rarity * 0.06f);
        if (ITEMS[pcell.item].name == "Moon") pr *= 4;
        body.u8v(ENT_PETAL);
        body.u16v(pst.id);
        body.u8v(pcell.item);
        body.u8v(pcell.rarity);
        body.i16v((int16_t)std::round(pst.x));
        body.i16v((int16_t)std::round(pst.y));
        body.u16v(0);
        body.u8v((uint8_t)std::round(pr));
        float phpPct = pst.maxHp > 0 ? pst.hp / pst.maxHp : 0;
        body.u8v((uint8_t)(255.f * std::min(1.f, phpPct)));
        count++;
      }
    }

    // Mobs
    for (auto& mob : world.mobs) {
      if (std::abs(mob.x - me.x) >= snapViewX || std::abs(mob.y - me.y) >= snapViewY) continue;
      body.u8v(ENT_MOB);
      body.u16v(mob.id);
      body.u8v(mob.type);
      int team = mob.friendly ? (mob.ownerId == me.id ? TEAM_SELF : TEAM_FRIENDLY) : TEAM_HOSTILE;
      body.u8v(team);
      body.i16v((int16_t)std::round(mob.x));
      body.i16v((int16_t)std::round(mob.y));
      float normAngle = fmod(mob.angle, M_PI * 2);
      if (normAngle < 0) normAngle += M_PI * 2;
      body.u16v((uint16_t)std::round((normAngle / (M_PI * 2)) * 65535));
      body.u16v(std::min(65535, (int)std::round(mob.radius)));
      float mhpPct = mob.maxHp > 0 ? mob.hp / mob.maxHp : 0;
      body.u8v((uint8_t)std::max(0, (int)std::round(mhpPct * 255)));
      body.u8v(mob.rarity);
      count++;
    }

    // Drops
    for (auto& d : world.drops) {
      if (std::abs(d.x - me.x) >= snapViewX || std::abs(d.y - me.y) >= snapViewY) continue;
      if (d.hasAllowList && !d.allowedPlayerIds.count(me.id)) continue;
      uint8_t dropRadius = d.suctionTimer > 0 ? (12 | 0x80) : 12;
      body.u8v(ENT_DROP);
      body.u16v(d.id);
      body.u8v(d.item);
      body.u8v(d.rarity);
      body.i16v((int16_t)std::round(d.x));
      body.i16v((int16_t)std::round(d.y));
      body.u16v(0);
      body.u8v(dropRadius);
      body.u8v(std::min(255, (int)d.count));
      count++;
    }

    // Projectiles
    for (auto& proj : world.projectiles) {
      if (proj.mapId != me.mapId) continue;
      if (std::abs(proj.x - me.x) >= 1300 || std::abs(proj.y - me.y) >= 950) continue;
      body.u8v(ENT_PROJECTILE);
      body.u16v(proj.id);
      body.u8v(proj.sourceType);
      body.u8v(proj.team);
      body.i16v((int16_t)std::round(proj.x));
      body.i16v((int16_t)std::round(proj.y));
      float pAngle = fmod(proj.angle, M_PI * 2);
      if (pAngle < 0) pAngle += M_PI * 2;
      body.u16v((uint16_t)std::round((pAngle / (M_PI * 2)) * 65535));
      body.u8v((uint8_t)std::round(proj.radius));
      float php = proj.maxHp > 0 ? proj.hp / proj.maxHp : 0;
      body.u8v((uint8_t)std::max(0, std::min(255, (int)std::round(php * 255))));
      body.u8v(proj.rarity);
      count++;
    }

    // Reload progress
    for (int si = 0; si < SLOT_COUNT; si++) {
      Cell& scell = me.slots[si];
      PetalState& sst = me.petals[si];
      const ItemDef* sdef = scell.item != EMPTY_ITEM ? &ITEMS[scell.item] : nullptr;
      if (!scell.item != EMPTY_ITEM && sst.alive && sdef && orbitsAsPetal(sdef->kind)) {
        body.u8v(255);
      } else if (scell.item != EMPTY_ITEM && sdef && orbitsAsPetal(sdef->kind)) {
        float total = sdef->reload > 0 ? sdef->reload : 1;
        float progress = 1 - std::max(0.f, std::min(1.f, sst.timer / total));
        body.u8v((uint8_t)std::round(progress * 255));
      } else {
        body.u8v(255);
      }
    }

    // Petal HP
    for (int si = 0; si < SLOT_COUNT; si++) {
      PetalState& sst = me.petals[si];
      Cell& scell = me.slots[si];
      if (scell.item == EMPTY_ITEM || !sst.alive) {
        body.u8v(255);
      } else {
        float php = sst.maxHp > 0 ? sst.hp / sst.maxHp : 0;
        body.u8v((uint8_t)std::max(0, std::min(255, (int)std::round(php * 255))));
      }
    }

    w.u16v(count);
    w.b.insert(w.b.end(), body.b.begin(), body.b.end());
    return w;
  }

  // ---- Inventory writer ----
  Writer inventoryFor(Player& p) {
    Writer w;
    w.u8v(S2C_INVENTORY);
    w.u8v(SLOT_COUNT);
    for (int i = 0; i < SLOT_COUNT; i++) writeCell(w, p.slots[i]);
    w.u8v(SECONDARY_SLOT_COUNT);
    for (int i = 0; i < SECONDARY_SLOT_COUNT; i++) writeCell(w, p.secondary[i]);
    int bagLen = (int)p.bag.size();
    while (bagLen > BAG_COUNT && bagLen > 0 && p.bag[bagLen - 1].item == EMPTY_ITEM) bagLen--;
    w.u16v(bagLen);
    for (int i = 0; i < bagLen; i++) writeCell(w, p.bag[i]);
    return w;
  }

  // ---- Stats writer ----
  Writer statsFor(Player& p) {
    int64_t now = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::system_clock::now().time_since_epoch()).count();
    uint32_t oracleSecLeft = std::max(0, (int)std::ceil((p.nextOracleAt - now) / 1000.0));
    uint32_t tradeSecLeft = std::max(0, (int)std::ceil((p.nextTradeAt - now) / 1000.0));
    Writer w;
    w.u8v(S2C_STATS);
    w.u32v(p.xp);
    w.u16v(p.level);
    w.u16v(std::max(0, (int)std::round(p.hp)));
    w.u16v((int)std::round(p.maxHp));
    w.u8v(p.mapId);
    w.u8v(p.alive ? 1 : 0);
    w.u32v(oracleSecLeft);
    w.u32v(tradeSecLeft);
    w.u16v(std::max(0, (int)std::round(p.shield)));
    return w;
  }

  // ---- Send chat ----
  void sendChat(ClientState& cs, const std::string& text, const std::string& sender, bool isSystem, bool isCraftReport) {
    Writer w;
    w.u8v(S2C_CHAT);
    w.str(text.substr(0, 200));
    w.str(sender.substr(0, 30));
    w.u8v(isSystem ? 1 : 0);
    w.u8v(isCraftReport ? 1 : 0);
    cs.events.push_back(w.b);
  }

  // ---- Send squad update ----
  Writer squadUpdateWriter(const std::string& squadCode) {
    Writer w;
    w.u8v(S2C_SQUAD_UPDATE);
    w.str(squadCode.substr(0, SQUAD_CODE_LENGTH));
    return w;
  }

  // ---- Send squad member state ----
  Writer squadMemberStateWriter(uint16_t playerId, uint16_t level, uint8_t rarity) {
    Writer w;
    w.u8v(S2C_SQUAD_MEMBER_STATE);
    w.u16v(playerId);
    w.u16v(level);
    w.u8v(rarity);
    return w;
  }

  // ---- Loadout sync ----
  Writer loadoutDataWriter(Player& p) {
    Writer w;
    w.u8v(S2C_LOADOUT_DATA);
    w.u8v((uint8_t)p.loadouts.size());
    for (auto& lo : p.loadouts) {
      w.str(lo.name);
      w.u8v((uint8_t)lo.slots.size());
      for (auto& cell : lo.slots) writeCell(w, cell);
    }
    return w;
  }

  // ---- Bonus status ----
  void setBonusStatus(Player& p, uint8_t multiplier, uint16_t seconds) {
    int safeMultiplier = std::max(1, std::min(5, (int)multiplier));
    int safeSeconds = std::max(0, std::min(60 * 60, (int)seconds));
    p.bonusMultiplier = safeSeconds > 0 ? safeMultiplier : 1;
    p.bonusEndsAt = safeSeconds > 0 ?
      std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count() + safeSeconds * 1000 : 0;
  }

  // ---- Chat commands ----
  void handleChatCommand(ClientState& cs, Player& p, const std::string& cmd, std::unordered_map<uint16_t, ClientState*>& clientMap) {
    std::istringstream iss(cmd);
    std::string command;
    iss >> command;
    if (command == "/claim") {
      sendChat(cs, "Daily bonus can be claimed from the main menu.", "System", true, false);
    } else if (command == "/create_public_squad" || command == "/create_private_squad") {
      if (!p.squadCode.empty()) {
        sendChat(cs, "Already in a squad. Use /leave_squad first.", "System", true, false);
        return;
      }
      std::string key = generateSquadCode();
      Squad sq;
      sq.code = key;
      sq.isPublic = (command == "/create_public_squad");
      sq.createdAt = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
      SquadMember sm;
      sm.clientId = cs.playerId;
      sm.playerId = p.id;
      sm.name = p.name;
      sm.level = p.level;
      sm.rarity = 0;
      sq.members[p.id] = sm;
      squads[key] = sq;
      p.squadCode = key;
      sendChat(cs, (sq.isPublic ? "Public" : "Private") + std::string(" squad created! Code: ") + key, "System", true, false);
      Writer w = squadUpdateWriter(key);
      cs.events.push_back(w.b);
    } else if (command == "/join_squad") {
      std::string code;
      iss >> code;
      if (code.empty()) {
        sendChat(cs, "Usage: /join_squad <CODE>", "System", true, false);
        return;
      }
      // Convert to uppercase
      for (auto& c : code) c = toupper(c);
      if (!p.squadCode.empty()) {
        sendChat(cs, "Already in a squad.", "System", true, false);
        return;
      }
      auto it = squads.find(code);
      if (it == squads.end()) {
        sendChat(cs, "Squad not found.", "System", true, false);
        return;
      }
      std::string err = canJoinSquad(p, it->second);
      if (!err.empty()) {
        sendChat(cs, err, "System", true, false);
        return;
      }
      SquadMember sm;
      sm.clientId = cs.playerId;
      sm.playerId = p.id;
      sm.name = p.name;
      sm.level = p.level;
      sm.rarity = 0;
      it->second.members[p.id] = sm;
      p.squadCode = code;
      sendChat(cs, "Joined squad! Code: " + code + " (" + std::to_string(it->second.members.size()) + " members)", "System", true, false);
      Writer w = squadUpdateWriter(code);
      cs.events.push_back(w.b);
      // Send existing members' states
      for (auto& [pid, member] : it->second.members) {
        if (pid != p.id) {
          Writer mw = squadMemberStateWriter(member.playerId, member.level, member.rarity);
          cs.events.push_back(mw.b);
        }
      }
    } else if (command == "/leave_squad") {
      if (p.squadCode.empty()) {
        sendChat(cs, "Not in a squad.", "System", true, false);
        return;
      }
      std::string old = p.squadCode;
      removePlayerFromSquad(p);
      sendChat(cs, "Left the squad.", "System", true, false);
      Writer w = squadUpdateWriter("");
      cs.events.push_back(w.b);
    } else if (command == "/find_public_squad") {
      if (!p.squadCode.empty()) {
        sendChat(cs, "Already in a squad.", "System", true, false);
        return;
      }
      Squad* chosen = nullptr;
      for (auto& [code, sq] : squads) {
        if (!sq.isPublic || (int)sq.members.size() >= SQUAD_MAX_MEMBERS) continue;
        if (canJoinSquad(p, sq).empty()) { chosen = &sq; break; }
      }
      if (!chosen) {
        sendChat(cs, "No available public squads found.", "System", true, false);
        return;
      }
      SquadMember sm;
      sm.clientId = cs.playerId;
      sm.playerId = p.id;
      sm.name = p.name;
      sm.level = p.level;
      sm.rarity = 0;
      chosen->members[p.id] = sm;
      p.squadCode = chosen->code;
      sendChat(cs, "Auto-joined public squad! Code: " + chosen->code + " (" + std::to_string(chosen->members.size()) + " members)", "System", true, false);
      Writer w = squadUpdateWriter(chosen->code);
      cs.events.push_back(w.b);
      for (auto& [pid, member] : chosen->members) {
        if (pid != p.id) {
          Writer mw = squadMemberStateWriter(member.playerId, member.level, member.rarity);
          cs.events.push_back(mw.b);
        }
      }
    } else if (command == "/help") {
      sendChat(cs, "/claim  Daily bonus from main menu", "System", true, false);
      sendChat(cs, "/create_public_squad  Create a public squad", "System", true, false);
      sendChat(cs, "/create_private_squad  Create a private squad", "System", true, false);
      sendChat(cs, "/join_squad <CODE>  Join a squad by code", "System", true, false);
      sendChat(cs, "/leave_squad  Leave current squad", "System", true, false);
      sendChat(cs, "/find_public_squad  Auto-join a public squad", "System", true, false);
      sendChat(cs, "/help  Show this help message", "System", true, false);
    } else {
      sendChat(cs, "Unknown command: " + command, "System", true, false);
    }
  }

  // ---- Entity count ----
  int entityCount() {
    int count = 0;
    for (auto& [id, p] : players) {
      count++;
      for (int i = 0; i < SLOT_COUNT; i++) {
        if (p.petals[i].alive) count++;
      }
    }
    for (int m = 0; m < MAP_COUNT; m++) {
      count += (int)worlds[m].mobs.size() + (int)worlds[m].drops.size();
    }
    return count;
  }

  int playerCount() {
    return (int)players.size();
  }

private:
  std::vector<std::unique_ptr<ArrayWallCollider>> playerWallColliders_;
  std::vector<std::unique_ptr<ArrayWallCollider>> wallColliders_;
};

// =====================================================================
// Map data
// =====================================================================
static std::vector<MapDef> makeMaps() {
  std::vector<MapDef> maps;
  // Map 0: Garden
  maps.push_back({0, "Garden", 8000, 8000, {
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
  }, {0,1,2,3,10,13,15,16,17}, 85, 0});
  // Map 1: Desert
  maps.push_back({1, "Desert", 8000, 8000, {
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
  }, {4,5,6,2,11}, 80, 0.12f});
  // Map 2: Ocean
  maps.push_back({2, "Ocean", 8000, 8000, {
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
  }, {7,8,9,12,14}, 85, 0.22f});
  // Map 3: Arena（无 mob，无预置墙，由 ARENA_START 动态下发）
  maps.push_back({3, "Arena", 8000, 8000, {}, {}, 0, 1.0f});
  return maps;
}

// =====================================================================
// main
// =====================================================================
int main() {
  std::srand((unsigned int)std::time(nullptr));

  Simulation sim;
  uint16_t nextId = 1;
  using WS = uWS::WebSocket<false, true, PerSocket>;
  std::unordered_map<uint16_t, WS*> sockets;
  std::unordered_map<uint16_t, ClientState*> clientStates;
  sim.clientMap = &clientStates;

  const int port = std::getenv("PORT") ? std::atoi(std::getenv("PORT")) : 8080;

  auto app = uWS::App().ws<PerSocket>("/*", {
      .compression = uWS::DISABLED,
      .maxPayloadLength = 4 * 1024,
      .open = [&](auto* ws) {
        auto* data = ws->getUserData();
        data->id = nextId++;
        auto* cs = new ClientState();
        cs->playerId = data->id;
        data->client = cs;
        clientStates[data->id] = cs;
        Player& player = sim.add(data->id);
        cs->player = &player;
        sockets[data->id] = ws;
      },
      .message = [&](auto* ws, std::string_view msg, uWS::OpCode) {
        Reader r(reinterpret_cast<const uint8_t*>(msg.data()), msg.size());
        auto* data = ws->getUserData();
        Player* p = sim.get(data->id);
        if (!p) return;
        ClientState* cs = data->client;
        if (!cs) return;

        uint8_t type = r.u8v();
        if (type != C2S_INPUT && type != C2S_PING && type != C2S_BONUS_STATUS) {
          sim.markActive(*cs, type == C2S_AFK_ACK);
        }

        switch (type) {
          case C2S_JOIN: {
            sim.markActive(*cs);
            p->name = r.str().substr(0, 14);
            if (p->name.empty()) p->name = "flower";
            p->mapId = r.u8v();
            if (p->mapId >= MAP_COUNT) p->mapId = 0;
            p->xp = r.u32v();
            for (int i = 0; i < SLOT_COUNT; i++) {
              Cell c = readCell(r);
              if (c.item != EMPTY_ITEM) p->slots[i] = c;
            }
            for (int i = 0; i < SECONDARY_SLOT_COUNT; i++) {
              Cell c = readCell(r);
              if (c.item != EMPTY_ITEM) p->secondary[i] = c;
            }
            int bagCount = std::min((int)r.u16v(), BAG_MAX);
            if ((int)p->bag.size() < bagCount) p->bag.resize(bagCount);
            for (int i = 0; i < bagCount; i++) {
              Cell c = readCell(r);
              if (c.item != EMPTY_ITEM) p->bag[i] = c;
            }
            uint32_t oracleSecLeft = r.u32v();
            uint32_t tradeSecLeft = r.u32v();
            int64_t now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
            p->nextOracleAt = oracleSecLeft > 0 ? now + oracleSecLeft * 1000 : 0;
            p->nextTradeAt = tradeSecLeft > 0 ? now + tradeSecLeft * 1000 : 0;
            if (r.remaining() >= 3) {
              uint8_t mult = r.u8v();
              uint16_t secs = r.u16v();
              sim.setBonusStatus(*p, mult, secs);
            }
            p->menuMode = r.remaining() >= 1 ? r.u8v() == 1 : false;

            // Check if player has empty inventory and give starter items
            bool hasItems = false;
            for (int i = 0; i < SLOT_COUNT; i++) if (p->slots[i].item != EMPTY_ITEM) { hasItems = true; break; }
            if (!hasItems) {
              for (int i = 0; i < SECONDARY_SLOT_COUNT; i++) if (p->secondary[i].item != EMPTY_ITEM) { hasItems = true; break; }
            }
            if (!hasItems) {
              for (auto& c : p->bag) if (c.item != EMPTY_ITEM) { hasItems = true; break; }
            }
            if (!hasItems) {
              // Try to load saved data from disk
              SavedPlayerData saved = loadPlayerData(p->name);
              bool hasSaved = false;
              for (int i = 0; i < SLOT_COUNT; i++) if (saved.slots[i].item != EMPTY_ITEM) { hasSaved = true; break; }
              if (hasSaved) {
                p->xp = saved.xp;
                p->mapId = saved.mapId;
                for (int i = 0; i < SLOT_COUNT; i++) p->slots[i] = saved.slots[i];
                for (int i = 0; i < SECONDARY_SLOT_COUNT; i++) p->secondary[i] = saved.secondary[i];
                p->bag = saved.bag;
                p->nextOracleAt = saved.nextOracleAt;
                p->nextTradeAt = saved.nextTradeAt;
              } else {
                p->slots[0] = Cell{0, 0, 1};
                p->slots[1] = Cell{0, 0, 1};
                p->slots[2] = Cell{1, 0, 1};
                p->slots[3] = Cell{0, 0, 1};
                p->secondary[0] = Cell{2, 0, 1};
                p->secondary[1] = Cell{8, 0, 1};
              }
            }

            sim.applyLevel(*p);
            if (!p->menuMode) {
              sim.rebuildPetals(*p);
              sim.spawnPlayer(*p);
            }

            // Send WELCOME
            {
              const MapDef& map = MAPS[p->mapId];
              Writer w;
              w.u8v(S2C_WELCOME);
              w.u16v(p->id);
              w.u8v(p->mapId);
              w.u16v((uint16_t)map.width);
              w.u16v((uint16_t)map.height);
              w.u16v((uint16_t)map.walls.size());
              for (auto& wall : map.walls) {
                w.u16v((uint16_t)wall.x);
                w.u16v((uint16_t)wall.y);
                w.u16v((uint16_t)wall.w);
                w.u16v((uint16_t)wall.h);
              }
              ws->send(w.view(), uWS::OpCode::BINARY);
              p->dirty = true;
              p->statsDirty = true;
            }

            // Send TALENT_BONUSES
            {
              Writer tw;
              tw.u8v(S2C_TALENT_BONUSES);
              writeTalentBonuses(tw, p->talentBonuses);
              ws->send(tw.view(), uWS::OpCode::BINARY);
            }
            break;
          }

          case C2S_INPUT: {
            p->inDx = r.i8v() / 100.f;
            p->inDy = r.i8v() / 100.f;
            p->flags = r.u8v();
            if (p->inDx != cs->lastInDx || p->inDy != cs->lastInDy || p->flags != cs->lastFlags) {
              cs->lastInDx = p->inDx;
              cs->lastInDy = p->inDy;
              cs->lastFlags = p->flags;
              sim.markActive(*cs);
            }
            // Arena 活跃标记
            if (p->mode == Mode::Arena) {
              p->arenaLastInputAt = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();
            }
            break;
          }

          case C2S_AFK_ACK: {
            break;
          }

          case C2S_SWAP: {
            uint16_t from = r.u16v();
            uint16_t to = r.u16v();
            if (sim.isBagCell(from)) sim.moveOneFromBag(*p, from, to);
            else sim.swapCells(*p, from, to);
            break;
          }

          case C2S_SWAP_ROW: {
            uint8_t which = r.u8v();
            if (which == SWAP_ROW_ALL) sim.swapAllRows(*p);
            else sim.swapRowSlot(*p, which);
            break;
          }

          case C2S_CRAFT: {
            uint8_t item = r.u8v();
            uint8_t rarity = r.u8v();
            uint16_t totalCards = r.u16v();
            if (totalCards == 0) totalCards = CRAFT_CARD_COUNT;
            sim.craft(*cs, *p, item, rarity, totalCards);
            break;
          }

          case C2S_ORACLE: {
            uint8_t item = r.u8v();
            uint8_t rarity = r.u8v();
            sim.oracle(*cs, *p, item, rarity);
            break;
          }

          case C2S_TRADE: {
            uint8_t item = r.u8v();
            uint8_t rarity = r.u8v();
            uint16_t count = r.u16v();
            sim.trade(*cs, *p, item, rarity, count);
            break;
          }

          case C2S_CHANGE_MAP: {
            uint8_t mapId = r.u8v();
            if (mapId >= MAP_COUNT) mapId = 0;
            if (mapId == p->mapId) break;
            // Remove pets
            for (int i = 0; i < SLOT_COUNT; i++) sim.despawnPets(*p, i);
            p->mapId = mapId;
            sim.spawnPlayer(*p);
            sim.rebuildPetals(*p);
            // Send WELCOME
            {
              const MapDef& map = MAPS[p->mapId];
              Writer w;
              w.u8v(S2C_WELCOME);
              w.u16v(p->id);
              w.u8v(p->mapId);
              w.u16v((uint16_t)map.width);
              w.u16v((uint16_t)map.height);
              w.u16v((uint16_t)map.walls.size());
              for (auto& wall : map.walls) {
                w.u16v((uint16_t)wall.x);
                w.u16v((uint16_t)wall.y);
                w.u16v((uint16_t)wall.w);
                w.u16v((uint16_t)wall.h);
              }
              ws->send(w.view(), uWS::OpCode::BINARY);
              p->dirty = true;
              p->statsDirty = true;
            }
            break;
          }

          case C2S_RESPAWN: {
            if (p->alive) break;
            p->alive = true;
            sim.applyLevel(*p);
            p->hp = p->maxHp;
            p->shield = 0;
            sim.spawnPlayer(*p);
            sim.rebuildPetals(*p);
            p->statsDirty = true;
            break;
          }

          case C2S_PING: {
            uint32_t stamp = r.u32v();
            Writer w;
            w.u8v(S2C_PONG);
            w.u32v(stamp);
            ws->send(w.view(), uWS::OpCode::BINARY);
            break;
          }

          case C2S_BONUS_STATUS: {
            if (r.remaining() >= 3) {
              uint8_t mult = r.u8v();
              uint16_t secs = r.u16v();
              sim.setBonusStatus(*p, mult, secs);
            }
            break;
          }

          case C2S_CHAT: {
            std::string msg = r.str();
            if (msg.empty()) break;
            if (msg[0] == '/') {
              sim.handleChatCommand(*cs, *p, msg, clientStates);
            } else {
              // Broadcast to all players on same map
              for (auto& [id, otherCs] : clientStates) {
                if (otherCs->player && otherCs->player->mapId == p->mapId) {
                  sim.sendChat(*otherCs, msg, p->name, false, false);
                }
              }
            }
            break;
          }

          case C2S_TALENT: {
            p->talentLevels = readTalentLevels(r);
            p->talentBonuses = computeTalentBonuses(p->talentLevels);
            sim.applyLevel(*p);
            if (!p->menuMode) sim.rebuildPetals(*p);
            Writer tw;
            tw.u8v(S2C_TALENT_BONUSES);
            writeTalentBonuses(tw, p->talentBonuses);
            ws->send(tw.view(), uWS::OpCode::BINARY);
            break;
          }

          case C2S_SYNC_LEVEL: {
            if (p->squadCode.empty()) break;
            uint16_t level = r.u16v();
            uint8_t rarity = r.u8v();
            auto it = sim.squads.find(p->squadCode);
            if (it != sim.squads.end()) {
              auto mit = it->second.members.find(p->id);
              if (mit != it->second.members.end()) {
                mit->second.level = level;
                mit->second.rarity = rarity;
              }
            }
            // Broadcast to all squad members
            for (auto& [pid, member] : it->second.members) {
              auto sit = clientStates.find(member.clientId);
              if (sit != clientStates.end()) {
                Writer mw = sim.squadMemberStateWriter(p->id, level, rarity);
                sit->second->events.push_back(mw.b);
              }
            }
            break;
          }

          case C2S_LOADOUT: {
            uint8_t op = r.u8v();
            if (op == LOADOUT_SAVE) {
              std::string name = r.str();
              uint8_t slotCount = r.u8v();
              std::vector<Cell> slots;
              for (int i = 0; i < slotCount; i++) {
                slots.push_back(readCell(r));
              }
              // Update existing or append
              bool found = false;
              for (auto& lo : p->loadouts) {
                if (lo.name == name) { lo.slots = slots; found = true; break; }
              }
              if (!found) {
                p->loadouts.push_back({name, slots});
              }
              Writer lw = sim.loadoutDataWriter(*p);
              ws->send(lw.view(), uWS::OpCode::BINARY);
            } else if (op == LOADOUT_LOAD) {
              uint8_t index = r.u8v();
              if (index < (int)p->loadouts.size()) {
                auto& config = p->loadouts[index];
                // Move current hotbar items to bag
                std::unordered_set<std::string> loadoutKeys;
                for (auto& target : config.slots) {
                  if (target.item != EMPTY_ITEM) loadoutKeys.insert(std::to_string(target.item) + "|" + std::to_string(target.rarity));
                }
                for (int i = 0; i < SLOT_COUNT; i++) {
                  if (p->slots[i].item == EMPTY_ITEM) continue;
                  std::string key = std::to_string(p->slots[i].item) + "|" + std::to_string(p->slots[i].rarity);
                  if (loadoutKeys.count(key)) continue;
                  sim.addItem(*p, p->slots[i].item, p->slots[i].rarity, p->slots[i].count);
                  p->slots[i] = Cell{EMPTY_ITEM, 0, 0};
                }
                // Fill from bag
                for (int i = 0; i < std::min((int)config.slots.size(), SLOT_COUNT); i++) {
                  auto& target = config.slots[i];
                  if (target.item == EMPTY_ITEM) {
                    p->slots[i] = Cell{EMPTY_ITEM, 0, 0};
                    continue;
                  }
                  // Check if current slot already matches
                  if (p->slots[i].item == target.item && p->slots[i].rarity == target.rarity && p->slots[i].count >= target.count) continue;
                  // Search other slots
                  bool found = false;
                  for (int j = i; j < SLOT_COUNT; j++) {
                    if (p->slots[j].item == target.item && p->slots[j].rarity == target.rarity && p->slots[j].count >= target.count) {
                      if (i != j) std::swap(p->slots[i], p->slots[j]);
                      found = true; break;
                    }
                  }
                  if (found) continue;
                  // Take from bag
                  int taken = sim.takeFromBag(*p, target.item, target.rarity, target.count);
                  if (taken > 0) {
                    p->slots[i] = Cell{target.item, target.rarity, (uint16_t)taken};
                  } else {
                    p->slots[i] = Cell{EMPTY_ITEM, 0, 0};
                  }
                }
                p->dirty = true;
                sim.rebuildPetals(*p);
                Writer lw = sim.loadoutDataWriter(*p);
                ws->send(lw.view(), uWS::OpCode::BINARY);
              }
            } else if (op == LOADOUT_DELETE) {
              uint8_t index = r.u8v();
              if (index < (int)p->loadouts.size()) {
                p->loadouts.erase(p->loadouts.begin() + index);
                Writer lw = sim.loadoutDataWriter(*p);
                ws->send(lw.view(), uWS::OpCode::BINARY);
              }
            }
            break;
          }

          case C2S_ARENA_CREATE: {
            uint8_t mode = r.u8v();
            if (mode != 1 && mode != 3) { mode = 1; }
            ArenaRoom room;
            room.code = sim.generateArenaCode();
            room.hostId = p->id;
            room.mode = mode;
            room.capacity = mode * 2;
            room.seats.push_back(p->id);
            room.seatOfPlayer[p->id] = 0;
            room.wheelCards.resize(room.capacity, Cell{0, 0, 255});
            room.ready.resize(room.capacity, false);
            room.teamOfSeat.resize(room.capacity, 0);
            room.createdAt = std::chrono::duration_cast<std::chrono::milliseconds>(
              std::chrono::system_clock::now().time_since_epoch()).count();
            sim.arenas[room.code] = room;

            p->arenaRoomCode = room.code;

            // 推 ARENA_LOBBY
            Writer w;
            w.u8v(S2C_ARENA_LOBBY);
            w.str(room.code);
            w.u8v(0); // hostSeat
            w.u8v(1); // size = 1 (只有 host)
            w.u8v(mode);
            w.u8v(1); // seatCount
            w.u16v(p->id); w.str(p->name); w.u16v(p->level);
            uint8_t maxRarity = 0;
            for (auto& c : p->bag) if (c.rarity > maxRarity) maxRarity = c.rarity;
            w.u8v(maxRarity);
            w.u8v(0); // team
            w.u8v(1); // alive
            w.u8v(2); // lives
            w.u8v(0); // ready
            w.u8v(0); // hasWheel
            ws->send(w.view(), uWS::OpCode::BINARY);
            break;
          }

          case C2S_ARENA_LIST: {
            Writer w;
            w.u8v(S2C_ARENA_LIST);
            std::vector<decltype(sim.arenas.begin())> list;
            for (auto it = sim.arenas.begin(); it != sim.arenas.end(); ++it) {
              if (!it->second.started && (int)it->second.seats.size() < it->second.capacity)
                list.push_back(it);
            }
            w.u8v((uint8_t)std::min(list.size(), (size_t)20));
            for (size_t i = 0; i < std::min(list.size(), (size_t)20); i++) {
              auto& room = list[i]->second;
              Player* host = sim.get(room.hostId);
              w.str(room.code);
              w.str(host ? host->name : "?");
              w.u8v(room.mode);
              w.u8v((uint8_t)room.seats.size());
              w.u8v(room.capacity);
            }
            ws->send(w.view(), uWS::OpCode::BINARY);
            break;
          }

          case C2S_ARENA_SEARCH: {
            std::string keyword = r.str();
            Writer w;
            w.u8v(S2C_ARENA_LIST);
            std::vector<decltype(sim.arenas.begin())> list;
            for (auto it = sim.arenas.begin(); it != sim.arenas.end(); ++it) {
              if (!it->second.started && (int)it->second.seats.size() < it->second.capacity) {
                if (keyword.empty() || it->first.find(keyword) == 0) {
                  list.push_back(it);
                }
              }
            }
            w.u8v((uint8_t)std::min(list.size(), (size_t)20));
            for (size_t i = 0; i < std::min(list.size(), (size_t)20); i++) {
              auto& room = list[i]->second;
              Player* host = sim.get(room.hostId);
              w.str(room.code);
              w.str(host ? host->name : "?");
              w.u8v(room.mode);
              w.u8v((uint8_t)room.seats.size());
              w.u8v(room.capacity);
            }
            ws->send(w.view(), uWS::OpCode::BINARY);
            break;
          }

          case C2S_ARENA_JOIN: {
            std::string code = r.str();
            auto it = sim.arenas.find(code);
            if (it == sim.arenas.end()) break;
            auto& room = it->second;
            if (room.started) break;
            if ((int)room.seats.size() >= room.capacity) break;

            int seatIdx = (int)room.seats.size();
            room.seats.push_back(p->id);
            room.seatOfPlayer[p->id] = seatIdx;
            room.teamOfSeat[seatIdx] = seatIdx % 2;
            p->arenaRoomCode = code;

            // 推 ARENA_LOBBY 给新加入者
            Writer w;
            w.u8v(S2C_ARENA_LOBBY);
            w.str(room.code);
            w.u8v(0); // hostSeat
            w.u8v((uint8_t)room.seats.size());
            w.u8v(room.mode);
            w.u8v((uint8_t)room.seats.size());
            for (size_t i = 0; i < room.seats.size(); i++) {
              Player* sp = sim.get(room.seats[i]);
              if (!sp) continue;
              w.u16v(sp->id); w.str(sp->name); w.u16v(sp->level);
              uint8_t mr = 0;
              for (auto& c : sp->bag) if (c.rarity > mr) mr = c.rarity;
              w.u8v(mr); w.u8v(room.teamOfSeat[i]); w.u8v(1); w.u8v(2);
              w.u8v(room.ready[i] ? 1 : 0);
              w.u8v(room.wheelCards[i].item != 255 ? 1 : 0);
            }
            ws->send(w.view(), uWS::OpCode::BINARY);

            // 推 ARENA_UPDATE(join) 给其他成员
            for (int otherId : room.seats) {
              if (otherId == p->id) continue;
              if (sim.clientMap) {
                for (auto& [csId, cs] : *sim.clientMap) {
                  if (cs->player && cs->player->id == otherId) {
                    Writer uw;
                    uw.u8v(S2C_ARENA_UPDATE);
                    uw.u8v(0); // type=join
                    uw.u8v(seatIdx);
                    uw.u16v(p->id); uw.str(p->name); uw.u16v(p->level);
                    uint8_t mr = 0;
                    for (auto& c : p->bag) if (c.rarity > mr) mr = c.rarity;
                    uw.u8v(mr); uw.u8v(room.teamOfSeat[seatIdx]); uw.u8v(1); uw.u8v(2);
                    uw.u8v(0); uw.u8v(0);
                    cs->events.push_back(uw.b);
                    break;
                  }
                }
              }
            }
            break;
          }

          case C2S_ARENA_LEAVE: {
            auto it = sim.arenas.find(p->arenaRoomCode);
            if (it == sim.arenas.end()) break;
            auto& room = it->second;

            if (!room.started) {
              auto& seats = room.seats;
              seats.erase(std::remove(seats.begin(), seats.end(), p->id), seats.end());
              room.seatOfPlayer.erase(p->id);
              p->arenaRoomCode = "";
              if (seats.empty()) { sim.arenas.erase(it); }
            } else {
              p->arenaLives = 0;
              p->alive = false;
              sim.checkArenaEnd(room);
            }
            break;
          }

          case C2S_ARENA_WHEEL: {
            auto it = sim.arenas.find(p->arenaRoomCode);
            if (it == sim.arenas.end()) break;
            auto& room = it->second;
            if (room.started) break;

            int seatIdx = room.seatOfPlayer[p->id];
            uint16_t bagSlot = r.u16v();

            if (bagSlot >= p->bag.size()) break;
            Cell card = p->bag[bagSlot];
            if (card.item == 255) break;

            p->bag.erase(p->bag.begin() + bagSlot);

            if ((size_t)seatIdx < room.wheelCards.size())
              room.wheelCards[seatIdx] = card;
            p->arenaWheelCard = card;

            // 推 UPDATE 给全员
            for (int otherId : room.seats) {
              if (sim.clientMap) {
                for (auto& [csId, cs] : *sim.clientMap) {
                  if (cs->player && cs->player->id == otherId) {
                    Writer uw;
                    uw.u8v(S2C_ARENA_UPDATE);
                    uw.u8v(3); // type=wheel
                    uw.u8v(seatIdx);
                    uw.u16v(card.item);
                    uw.u8v(card.rarity);
                    uw.u16v(card.count);
                    cs->events.push_back(uw.b);
                    break;
                  }
                }
              }
            }
            p->dirty = true;
            break;
          }

          case C2S_ARENA_READY: {
            uint8_t ready = r.u8v();
            auto it = sim.arenas.find(p->arenaRoomCode);
            if (it == sim.arenas.end()) break;
            auto& room = it->second;
            if (room.started) break;

            int seatIdx = room.seatOfPlayer[p->id];
            room.ready[seatIdx] = ready == 1;
            p->arenaWheelReady = ready == 1;

            // 推 UPDATE 给全员
            for (int otherId : room.seats) {
              if (sim.clientMap) {
                for (auto& [csId, cs] : *sim.clientMap) {
                  if (cs->player && cs->player->id == otherId) {
                    Writer uw;
                    uw.u8v(S2C_ARENA_UPDATE);
                    uw.u8v(2); // type=ready
                    uw.u8v(seatIdx);
                    uw.u8v(ready);
                    cs->events.push_back(uw.b);
                    break;
                  }
                }
              }
            }

            // 检查是否全员 ready 且放了卡
            bool allReady = true;
            for (size_t i = 0; i < room.seats.size(); i++) {
              if (!room.ready[i]) { allReady = false; break; }
            }
            for (size_t i = 0; i < room.seats.size(); i++) {
              if (room.wheelCards[i].item == 255) { allReady = false; break; }
            }
            if (allReady) sim.arenaStart(room);
            break;
          }

          case C2S_ARENA_LOADOUT: {
            auto it = sim.arenas.find(p->arenaRoomCode);
            if (it != sim.arenas.end() && it->second.started) break;

            for (int i = 0; i < 10; i++) {
              p->arenaLoadout[i] = readCell(r);
            }
            break;
          }

          default:
            break;
        }
      },
      .close = [&](auto* ws, int, std::string_view) {
        uint16_t id = ws->getUserData()->id;
        auto it = clientStates.find(id);
        if (it != clientStates.end()) {
          delete it->second;
          clientStates.erase(it);
        }
        sockets.erase(id);
        sim.remove(id);
      },
  }).listen(port, [port](auto* token) {
      if (token) printf("[petalia-cpp] listening on :%d\n", port);
  });

  // 20 Hz authoritative loop
  struct us_timer_t* timer = us_create_timer((us_loop_t*)uWS::Loop::get(), 0, 0);
  static Simulation* simPtr = &sim;
  static std::unordered_map<uint16_t, WS*>* socketsPtr = &sockets;
  static std::unordered_map<uint16_t, ClientState*>* clientStatesPtr = &clientStates;
  us_timer_set(timer, [](struct us_timer_t*) {
    simPtr->tick(0.05f);

    // AFK handling
    std::vector<uint16_t> afkChanged;
    simPtr->updateAfk(0.05f, afkChanged, *clientStatesPtr);
    for (uint16_t id : afkChanged) {
      auto it = socketsPtr->find(id);
      if (it == socketsPtr->end()) continue;
      Player* p = simPtr->get(id);
      if (!p) continue;
      auto csIt = clientStatesPtr->find(id);
      if (csIt == clientStatesPtr->end()) continue;
      it->second->send(Simulation::afkPacket(*csIt->second).view(), uWS::OpCode::BINARY);
      if (csIt->second->kick) {
        it->second->end(AFK_CLOSE_CODE, "afk");
      }
    }

    // State sync for all players (every other tick = 10 Hz)
    for (auto& [id, ws] : *socketsPtr) {
      Player* p = simPtr->get(id);
      if (!p) continue;
      auto csIt = clientStatesPtr->find(id);
      if (csIt == clientStatesPtr->end()) continue;
      ClientState* cs = csIt->second;

      // Snapshot (10 Hz to reduce CPU load)
      if ((!p->menuMode || p->mode == Mode::Arena) && (simPtr->tickCount & 1)) {
        Writer snap = simPtr->snapshotFor(*p, simPtr->tickCount, *clientStatesPtr);
        ws->send(snap.view(), uWS::OpCode::BINARY);
      }

      // Inventory
      if (p->dirty) {
        p->dirty = false;
        Writer inv = simPtr->inventoryFor(*p);
        ws->send(inv.view(), uWS::OpCode::BINARY);
      }

      // Stats
      if (p->statsDirty || simPtr->tickCount % 10 == 0) {
        p->statsDirty = false;
        Writer st = simPtr->statsFor(*p);
        ws->send(st.view(), uWS::OpCode::BINARY);
      }

      // Debug (every 20 ticks)
      if (simPtr->tickCount % 20 == 0) {
        Writer dw;
        dw.u8v(S2C_DEBUG);
        dw.u32v(simPtr->collisionCounter.n);
        dw.u16v(std::min(65535, simPtr->entityCount()));
        dw.u16v(std::min(65535, simPtr->playerCount()));
        dw.f32v(p->currentSpeed);
        ws->send(dw.view(), uWS::OpCode::BINARY);
      }

      // Events
      for (auto& evt : cs->events) {
        ws->send({reinterpret_cast<const char*>(evt.data()), evt.size()}, uWS::OpCode::BINARY);
      }
      cs->events.clear();
    }
  }, 50, 50);

  app.run();
  return 0;
}