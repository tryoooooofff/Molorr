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

#include <chrono>
#include <cstdint>
#include <cstring>
#include <string>
#include <unordered_map>
#include <vector>

// ----------------------------------------------------------------- protocol
enum C2S : uint8_t { JOIN = 1, INPUT = 2, SWAP = 3, CRAFT = 4, CHANGE_MAP = 5, RESPAWN = 6, PING = 7 };
enum S2C : uint8_t { WELCOME = 1, SNAPSHOT = 2, INVENTORY = 3, STATS = 4, EVENT = 5, PONG = 6 };
enum EntKind : uint8_t { E_PLAYER = 0, E_MOB = 1, E_PETAL = 2, E_DROP = 3 };

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

// ---------------------------------------------------------------- world data
struct Cell { uint8_t item = 255, rarity = 0; uint16_t count = 0; };

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
  Cell slots[8];
  Cell bag[32];
};

struct PerSocket { uint16_t id = 0; };

class Simulation {
 public:
  Player& add(uint16_t id) { auto& p = players[id]; p.id = id; return p; }
  void remove(uint16_t id) { players.erase(id); }
  Player* get(uint16_t id) { auto it = players.find(id); return it == players.end() ? nullptr : &it->second; }

  // TODO: port movement, wall/mob collision boxes, petals, pets, loot, xp.
  void tick(float dt) {
    for (auto& [id, p] : players) {
      const float speed = 190.f + p.level * 0.8f;
      p.vx += (p.inDx * speed - p.vx) * std::min(1.f, dt * 9.f);
      p.vy += (p.inDy * speed - p.vy) * std::min(1.f, dt * 9.f);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    ++tickCount;
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
      body.u8v(static_cast<uint8_t>(26 * 0.7f)); // 70% player body size
      body.u8v(static_cast<uint8_t>(255.f * p.hp / p.maxHp));
      body.str(p.name);
      ++count;
    }
    w.u16v(count);
    w.b.insert(w.b.end(), body.b.begin(), body.b.end());
    return w;
  }

  std::unordered_map<uint16_t, Player> players;
  uint32_t tickCount = 0;
};

int main() {
  Simulation sim;
  uint16_t nextId = 1;
  const int port = std::getenv("PORT") ? std::atoi(std::getenv("PORT")) : 8080;

  auto app = uWS::App().ws<PerSocket>("/*", {
      .compression = uWS::DISABLED,
      .maxPayloadLength = 4 * 1024,
      .open = [&](auto* ws) {
        ws->getUserData()->id = nextId++;
        sim.add(ws->getUserData()->id);
      },
      .message = [&](auto* ws, std::string_view msg, uWS::OpCode) {
        Reader r{reinterpret_cast<const uint8_t*>(msg.data()), msg.size()};
        Player* p = sim.get(ws->getUserData()->id);
        if (!p) return;
        switch (r.u8v()) {
          case JOIN: {
            p->name = r.str();
            p->mapId = r.u8v();
            p->xp = r.u32v();
            Writer w; w.u8v(WELCOME); w.u16v(p->id); w.u8v(p->mapId);
            w.u16v(3200); w.u16v(3200); w.u16v(0);  // walls: send the map rectangles here
            ws->send(w.view(), uWS::OpCode::BINARY);
            break;
          }
          case INPUT: {
            p->inDx = static_cast<int8_t>(r.u8v()) / 100.f;
            p->inDy = static_cast<int8_t>(r.u8v()) / 100.f;
            p->flags = r.u8v();
            break;
          }
          default: break;
        }
      },
      .close = [&](auto* ws, int, std::string_view) { sim.remove(ws->getUserData()->id); },
  }).listen(port, [port](auto* token) {
      if (token) printf("[petalia-cpp] listening on :%d\n", port);
  });

  // 20 Hz authoritative loop (uWS timers run on the event loop thread)
  struct us_timer_t* timer = us_create_timer((us_loop_t*)uWS::Loop::get(), 0, 0);
  static Simulation* simPtr = &sim;
  us_timer_set(timer, [](struct us_timer_t*) { simPtr->tick(0.05f); }, 50, 50);

  app.run();
  return 0;
}
