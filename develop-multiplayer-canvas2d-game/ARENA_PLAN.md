# Arena 模式实现 Plan

## 0. 总览

### 决策记录（已确认）

| 决策 | 结论 |
|------|------|
| Wheel | 仅视觉旋转，不抽奖 |
| 房间号 | 支持，不与 squad 混用 |
| 3v3 | 6 人独立 2 条命，最后存活阵营胜 |
| 奖励 | 胜方每人随机拿对方 1 张卡 |
| 消耗 | 败方卡从 bag 删除 |
| 额外奖励 | 不要 |
| AFK 超时 | 15s 判负 |
| 球形碰撞 | 高性能方案 |
| 配装 | 开始前锁死 quickslot + secondary slot |
| 天赋 | arena 内不生效 |

---

## 1. 协议扩展

### C2S（17-24）

```typescript
// protocol.ts
C2S_ARENA_CREATE   = 17  // { u8 mode(1|3) }
C2S_ARENA_LIST     = 18  // { } 拉公共房间列表
C2S_ARENA_SEARCH   = 19  // { str<32> keyword }
C2S_ARENA_JOIN     = 20  // { str<32> roomCode }
C2S_ARENA_LEAVE    = 21  // { }
C2S_ARENA_WHEEL    = 22  // { u8 bagSlot(0..4095) } 把 bag 某张卡放到 wheel
C2S_ARENA_READY    = 23  // { u8 ready(0|1) }
C2S_ARENA_LOADOUT  = 24  // { u8[10] cells } arena 独立配装（开始前锁死）
```

### S2C（14-19）

```typescript
S2C_ARENA_LOBBY    = 14  // { str code, u8 hostSeat, u8 size, u8 mode, PlayerBrief[seats] }
S2C_ARENA_UPDATE   = 15  // { u8 type(join|leave|ready|wheel), seat, payload }
S2C_ARENA_START    = 16  // { u32 seed, u16 wallCount, Wall[walls] }
S2C_ARENA_EVENT    = 17  // { u8 type(life_lost|rarity_mismatch), seat, payload }
S2C_ARENA_RESULT   = 18  // { u8 winnerTeam, u8 wonCardCount, Cell[count] }
S2C_ARENA_LIST     = 19  // { u8 count, RoomBrief[count] }
```

### 数据结构

```typescript
// shared/protocol.ts
interface PlayerBrief {
  id: number;
  name: string;
  level: number;
  maxRarity: number;
  team: number; // 0 or 1
  alive: boolean;
  lives: number;
  ready: boolean;
  hasWheel: boolean; // 是否已放卡
}

interface RoomBrief {
  code: string;
  hostName: string;
  mode: number; // 1 or 3
  filled: number;
  capacity: number; // mode * 2
  hasPwd: boolean;
}
```

### C++ 同步

```cpp
// main.cpp enum C2S — 追加 17-24
// main.cpp enum S2C — 追加 14-19
// 顺序和命名必须与 protocol.ts 一致
```

---

## 2. 客户端改动

### 2.1 顶部按钮 — 最小改动

**文件**: `game.ts`

- `menuActionRects()` 的 `topOrder` 数组追加 `'top_arena'`
- `TOP_BTN_COLORS` / `TOP_BTN_HOVER_COLORS` 追加 arena 色 (#e74c3c / #c0392b)
- `_drawTopBtnIcon(ctx, key, x, y, w, h)` 追加 `case 'top_arena'` — 画一个剑盾图标
- `menuClick` 追加 `case "top_arena": this.arenaPanel.toggle(); break;`

### 2.2 新组件 ArenaPanel

**新建文件**: `src/game/client/arenaPanel.ts`

```typescript
export class ArenaPanel {
  // 状态
  state: 'closed' | 'lobby-list' | 'in-room' | 'in-game'
  panelOpen: boolean
  searchQuery: string
  
  // 房间列表
  roomList: RoomBrief[]
  
  // 当前房间
  currentRoom: {
    code: string
    seats: PlayerBrief[]
    mode: number       // 1 or 3
    mySeat: number
    myTeam: number
  } | null
  
  // Wheel
  wheelCards: Cell[]  // seats 数量，每个座位放的卡
  
  // 配装（锁 quickslot + secondary）
  loadout: (Cell | null)[10]
  
  // 生命周期
  open()
  close()
  toggle()
  update(dt: number)
  draw(ctx: CanvasRenderingContext2D, w: number, h: number)
  handleClick(x: number, y: number): string | null
  handleMouseMove(x: number, y: number)
  
  // 网络回调（由 GameClient 注入）
  onLobbyUpdate(lobby: any)
  onStart(seed: number, walls: Wall[])
  onResult(winnerTeam: number, wonCards: Cell[])
  onList(rooms: RoomBrief[])
  
  // 操作
  placeOnWheel(bagSlot: number)
  setReady(v: boolean)
  setLoadout(cells: (Cell|null)[])
}
```

### 2.3 面板布局

**lobby-list 状态**（主菜单入口）：
- 顶部搜索框 + 1v1/3v3 toggle（右上）
- 中部：创建房间按钮 + 快速加入按钮
- 下部：可滚动房间列表（每条显示 code、host、人数、模式）

**in-room 状态**（进入房间后）：
- 左右分屏：显示各队玩家头像、名字、level、最高 rarity
- 中间：Wheel 圆盘（6 个卡槽绕圆周均匀分布，每个座位一个）
- 下方：配装槽（10 格，quickslot + secondary）
- 右下：READY 按钮 + 离开按钮

**in-game 状态**（战斗中）：
- HUD 显示：自己的命数（爱心）、对方血量
- 其余全屏渲染战场

### 2.4 Wheel 渲染

- 圆盘直径 ~200px，位于面板中心
- 卡槽位置：按座位数均匀分布在圆周（2 人 = 对角，6 人 = 正六边形）
- 自己的卡槽高亮，已放卡显示卡片颜色 + rarity 边框
- 双方/全员都放完后，卡槽发光 + 小旋转动画（0.5s）
- 使用现有 `drawCell` 或 `drawItemIcon` 渲染卡片

### 2.5 球形战场渲染

**新增渲染路径**（`renderGame` 中 `if (this.arenaMode)`）：
- 圆形边界：`ctx.clip()` 用 `ctx.arc(cx, cy, R, 0, PI*2)` 裁剪
- 网格地板：同心圆条纹（每 200px 一个圆环）+ 极轴线（每 30°）
- 随机墙：用 `drawRect` 渲染服务器下发的 Wall[]（与现有 `drawWallsFromData` 逻辑一致）
- 背景色：深色渐变（#1a1a2e → #16213e）

**碰撞**（高性能方案）：
- 圆形边界用 `distance(cx, cy, p) > R - r` 直接 clamp，不建多边形碰撞体
- 内部墙用现有 `PolygonWallCollider`（与普通地图一致）
- 32 段扇形墙用于逼近圆环边界 → 但上述 clamp 方案更简单，先采用

### 2.6 主循环 hook

**`renderGame(dt)`** 中追加：
```typescript
if (this.arenaPanel.state === 'in-game') {
  this.arenaPanel.drawHUD(ctx) // 命数 + 对方信息
}
```

**`handlePacket`** 追加 S2C 分支：
- `S2C.ARENA_LOBBY` → `this.arenaPanel.onLobbyUpdate(data)`
- `S2C.ARENA_START` → `this.arenaPanel.onStart(seed, walls)`
- `S2C.ARENA_RESULT` → 结算逻辑
- `S2C.ARENA_LIST` → `this.arenaPanel.onList(rooms)`
- `S2C.ARENA_UPDATE` → 更新房间状态
- `S2C.ARENA_EVENT` → 处理事件（life_lost 等）

**`S2C.ARENA_RESULT` 处理**：
1. 把 `wonCards` push 进 bag
2. 设置 `saveDirty = true` → 触发 `persist()`
3. 展示结算弹窗 1.5s
4. 调用 `this.gotoMenu()` 回到主菜单
5. `this.arenaPanel.close()`

### 2.7 命数 HUD

- 在 HP 血条旁边画 2 个爱心（♥）
- 每失去一条命，一个爱心变灰
- 自己死亡时屏幕变灰 + 显示 "等待复活…"
- 两条命都用完 → 显示 "你被淘汰了" + 等待 ARENA_RESULT

### 2.8 天赋不生效

在 `talentHost()` 的 `getLevel` 中：
```typescript
// 如果是 arena 模式，返回 0 使天赋点归零，天赋加成不生效
if (this.arenaPanel.state === 'in-game') return 0;
```

---

## 3. 服务端改动（C++）

### 3.1 数据结构追加

```cpp
// 追加到 Player struct
int arenaSeat = -1;          // -1 = 不在 arena
int arenaTeam = 0;           // 0 or 1
int arenaLives = 0;
std::string arenaRoomCode = "";
Cell arenaWheelCard{};       // empty if not placed
bool arenaWheelReady = false;
Cell arenaLoadout[10]{};     // 开始前锁死
int64_t arenaLastInputAt = 0;
```

```cpp
// 新建 ArenaRoom struct
struct ArenaRoom {
  std::string code;
  int hostId;
  int mode;                    // 1 or 3
  int capacity;                // mode * 2
  std::vector<int> seats;      // playerId 按顺序
  int teams[2] = {0, 0};       // 每队当前存活人数
  std::map<int, int> seatOfPlayer; // playerId -> seat index
  std::vector<Cell> wheelCards;    // seat index -> Cell
  std::vector<bool> ready;         // seat index -> bool
  std::vector<int> teamOfSeat;     // seat index -> team (0/1)
  bool started = false;
  uint32_t rng;
  int64_t createdAt;
};
```

放在 `Simulation` 中：
```cpp
std::unordered_map<std::string, ArenaRoom> arenas;
```

### 3.2 房间生命周期

**C2S_ARENA_CREATE(17)**:
1. 生成 6 位随机 code（URL-safe，不冲突）
2. 创建 `ArenaRoom`，host 占 seat 0
3. 分配 team（seat 0 为 team 0）
4. 推 `S2C_ARENA_LOBBY` 给 host

**C2S_ARENA_JOIN(20)**:
1. 查找房间，校验未满
2. 分配 seat（按顺序）
3. 分配 team（交替：seat 0/1→team 0, seat 2/3→team 1, 4/5→team 0）
4. 推 `S2C_ARENA_UPDATE{type:join}` 给全员
5. 推 `S2C_ARENA_LOBBY` 给新加入者

**C2S_ARENA_LEAVE(21)**:
1. 未开始 → 移除 seat，房间空则销毁
2. 已开始 → 判负（该玩家所在队伍）

**C2S_ARENA_WHEEL(22)**:
1. 校验 bagSlot 是否有效（卡在 bag 里）
2. 从 bag 移除该卡
3. 写入 `wheelCards[seat]`
4. 推 `S2C_ARENA_UPDATE{type:wheel}` 给全员
5. 更新 `hasWheel` 状态
6. 若全员已放卡 → 推 `S2C_ARENA_EVENT{type:all_wheeled}`

**C2S_ARENA_READY(23)**:
1. 设置 `ready[seat] = true`
2. 推 `S2C_ARENA_UPDATE{type:ready}` 给全员
3. 若全员 ready → 调用 `arenaStart()`

**C2S_ARENA_LOADOUT(24)**:
1. 仅允许在 `!started` 状态下修改
2. 保存到 `arenaLoadout[seat]`
3. 推 `S2C_UPDATE` 确认

### 3.3 `arenaStart()`

```cpp
void arenaStart(ArenaRoom& room) {
  room.started = true;
  room.rng = (uint32_t)time(nullptr);
  
  // 生成程序化墙
  std::vector<Wall> walls = generateArenaWalls(room.rng);
  
  // 为每个玩家设置 arena 状态
  for (int seat : room.seats) {
    Player* p = get(seat);
    if (!p) continue;
    p->mode = Mode::Arena;
    p->arenaSeat = seat;
    p->arenaLives = 2;
    p->arenaRoomCode = room.code;
    p->arenaLastInputAt = now;
    
    // 覆盖配装
    for (int i = 0; i < 10; i++) {
      if (room.arenaLoadout[seat][i].item != EMPTY_ITEM) {
        if (i < SLOT_COUNT) p->slots[i] = room.arenaLoadout[seat][i];
        else p->secondary[i - SLOT_COUNT] = room.arenaLoadout[seat][i];
      }
    }
    
    // 传送到 spawn 点
    float angle = (float)seat / room.capacity * M_PI * 2;
    p->x = 4000 + cos(angle) * 1500;
    p->y = 4000 + sin(angle) * 1500;
    p->hp = p->maxHp;
    p->alive = true;
    p->mapId = MAP_COUNT - 1; // 最后一个 map 是 arena
  }
  
  // 推 ARENA_START
  for (int seat : room.seats) {
    // 构建 ARENA_START 包，包含 walls
    sendArenaStart(seat, walls);
  }
}
```

### 3.4 程序化墙生成

```cpp
std::vector<Wall> generateArenaWalls(uint32_t seed) {
  std::vector<Wall> walls;
  std::mt19937 rng(seed);
  // 生成 30-60 个矩形墙
  int count = 30 + rng() % 31;
  for (int i = 0; i < count; i++) {
    float x = (float)(rng() % 7000) + 500;
    float y = (float)(rng() % 7000) + 500;
    float w = (float)(rng() % 200) + 50;
    float h = (float)(rng() % 200) + 50;
    // 避开中心 spawn 区域（半径 800px 圆内无墙）
    if (dist(x + w/2, y + h/2, 4000, 4000) < 800) continue;
    walls.push_back({x, y, w, h});
  }
  return walls;
}
```

### 3.5 20Hz tick 分支

在 `Simulation::updatePlayer` 中：
```cpp
if (p->mode == Mode::Arena) {
  // 天赋不生效（healthMult / speedMult 等保持 1.0）
  // 跳过 mob 生成 / AI / 掉落
  // 玩家间敌对（team 0 vs team 1）
  // HP 归零时：
  if (p->hp <= 0 && p->alive) {
    p->arenaLives--;
    p->statsDirty = true;
    if (p->arenaLives <= 0) {
      // 彻底死亡
      p->alive = false;
      pushArenaEvent(room, EVENT_LIFE_LOST, seat);
      checkArenaEnd(room);
    } else {
      // 复活
      p->hp = p->maxHp;
      p->alive = true;
      respawnAtSeat(p, seat);
      pushArenaEvent(room, EVENT_LIFE_LOST, seat);
    }
  }
  
  // AFK 检测
  if (now - p->arenaLastInputAt > 15000) {
    // 判负
    p->arenaLives = 0;
    p->alive = false;
    checkArenaEnd(room);
  }
}
```

### 3.6 `checkArenaEnd()`

```cpp
void checkArenaEnd(ArenaRoom& room) {
  int aliveTeam0 = 0, aliveTeam1 = 0;
  for (int seat : room.seats) {
    Player* p = get(seat);
    if (!p || !p->alive) continue;
    if (room.teamOfSeat[seat] == 0) aliveTeam0++;
    else aliveTeam1++;
  }
  
  if (aliveTeam0 == 0) {
    arenaFinish(room, 1); // team 1 胜
  } else if (aliveTeam1 == 0) {
    arenaFinish(room, 0); // team 0 胜
  }
  // 双方都还有人 → 继续
}
```

### 3.7 `arenaFinish()`

```cpp
void arenaFinish(ArenaRoom& room, int winnerTeam) {
  // 收集每个胜方成员获得的卡（随机从败方 wheel 卡中分配）
  std::vector<Cell> loserCards;
  for (int seat : room.seats) {
    if (room.teamOfSeat[seat] != winnerTeam) {
      if (room.wheelCards[seat].item != EMPTY_ITEM)
        loserCards.push_back(room.wheelCards[seat]);
    }
  }
  
  for (int seat : room.seats) {
    Player* p = get(seat);
    if (!p) continue;
    p->mode = Mode::Pve;
    p->arenaSeat = -1;
    p->arenaRoomCode = "";
    p->arenaLives = 0;
    
    if (room.teamOfSeat[seat] == winnerTeam) {
      // 胜方：每人随机拿 1 张败方卡
      Cell wonCard = {0, 0, 0};
      if (!loserCards.empty()) {
        int idx = rand() % loserCards.size();
        wonCard = loserCards[idx];
        loserCards.erase(loserCards.begin() + idx);
        // 推入 bag
        p->bag.push_back(wonCard);
      }
      // 归还自己的 wheel 卡
      if (room.wheelCards[seat].item != EMPTY_ITEM)
        p->bag.push_back(room.wheelCards[seat]);
      
      // 推 S2C_INVENTORY 更新 bag
      p->dirty = true;
      
      // 推 ARENA_RESULT
      sendArenaResult(seat, winnerTeam, {wonCard, room.wheelCards[seat]});
    } else {
      // 败方：不拿卡，wheel 卡已消耗
      sendArenaResult(seat, winnerTeam, {}); // 空数组
    }
    
    // 把玩家传回主地图
    p->mapId = 0;
    p->x = 1600; p->y = 1600;
    p->hp = p->maxHp;
    p->alive = true;
    spawnPlayer(*p);
  }
  
  arenas.erase(room.code);
}
```

### 3.8 球形 MapDef

- 新增一个 MapDef（ID = MAP_COUNT，即追加到 `makeMaps()` 末尾）
- name = "Arena", width = 8000, height = 8000, mobs = {}, mobCap = 0
- walls 为空（由 ARENA_START 动态下发）
- 客户端检测 `isArenaMap` 逻辑：当 `mapId == MAPS.length - 1` 时走球形渲染

### 3.9 碰撞系统

**C++ 侧**：
- 游戏内碰撞：`distance(px, py, 4000, 4000) > 4000 - PLAYER_RADIUS` 时 clamp 回边界
- 内部墙碰撞：复用现有 `ArrayWallCollider`，用 `generateArenaWalls()` 生成的墙构造

**客户端侧**：
- 圆形边界：`dist(cx, cy, px, py) > R - r` 时 clamp
- 内部墙：用 `PolygonWallCollider` 处理（与现有逻辑一致）

### 3.10 天赋不生效

**C++ 侧**：
在 `computeTalentBonuses` 调用或 `applyLevel` 中：
```cpp
if (p->mode == Mode::Arena) {
  p->talentBonuses = {}; // 全零（默认值）
  // 跳过 talent 加成计算
}
```

---

## 4. 实现顺序

| 阶段 | 内容 | 预估文件数 |
|------|------|-----------|
| P1 | 协议扩展 + 服务器房间 CRUD | 2（protocol.ts + main.cpp） |
| P2 | 客户端 ArenaPanel（lobby-list + in-room UI） | 2（arenaPanel.ts + game.ts） |
| P3 | Wheel 放置 + Ready 流程 | 2（arenaPanel.ts + main.cpp） |
| P4 | 球形战场 + 碰撞 + 随机墙 | 3（arenaPanel.ts + main.cpp + sim.ts） |
| P5 | 战斗逻辑 + 命数 + 结算 | 2（main.cpp） |
| P6 | 奖励发放 + bag 操作 | 2（main.cpp + game.ts） |
| P7 | 断线处理 + 收尾 | 1（main.cpp） |

---

## 5. 风险 & 备选

1. **配装锁死**：`C2S_ARENA_LOADOUT` 在 `started` 后必须拒绝修改。服务器侧要在 `C2S_SWAP` / `C2S_CRAFT` 等路径加 `mode == Arena` 拦截。
2. **玩家断线重连**：当前架构不支持断线重连（玩家断开后数据清空）。建议第一期：断线 = 判负，不处理重连。
3. **Wheel 卡冲突**：如果多个玩家同时放卡（同一张卡被放多次），服务器按顺序处理，第二个人拒绝并推错误事件。
4. **败方 bag 删卡**：服务器在 `C2S_ARENA_WHEEL` 时从 bag 移除卡，而不是在结算时。结算时败方卡已经不在 bag 里了。