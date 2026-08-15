import { C2S, Writer } from "../shared/protocol";
import type { Cell } from "../shared/sim";
import type { Wall } from "../shared/defs";
import { EMPTY_ITEM } from "../shared/defs";
import { panel, button, searchField, text, roundRect, drawCard, type Rect, hit } from "./ui";

// 接口定义
export interface PlayerBrief {
  id: number; name: string; level: number; maxRarity: number;
  team: number; alive: boolean; lives: number; ready: boolean; hasWheel: boolean;
}
export interface RoomBrief { code: string; hostName: string; mode: number; filled: number; capacity: number; }

export class ArenaPanel {
  state: 'closed' | 'lobby-list' | 'in-room' | 'in-game' = 'closed';
  panelOpen = false;
  searchQuery = '';
  searchActive = false;
  roomList: RoomBrief[] = [];
  currentRoom: { code: string; seats: PlayerBrief[]; mode: number; mySeat: number; myTeam: number } | null = null;
  wheelCards: (Cell | null)[] = [];
  loadout: (Cell | null)[] = new Array(10).fill(null);
  ready = false;
  lives = 2;
  // 背包数据（由 GameClient 设置）
  bagData: (Cell | null)[] = [];
  // 网络回调（由 GameClient 注入）
  sendPacket: ((data: Uint8Array) => void) | null = null;

  // 面板布局
  panelX = 0; panelY = 0; panelW = 520; panelH = 700;
  searchFieldRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  createBtnRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  quickJoinBtnRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  toggle1v1 = true; // true=1v1, false=3v3
  toggleBtnRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  roomListRects: Rect[] = [];
  readyBtnRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  leaveBtnRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  wheelCenterX = 0; wheelCenterY = 0; wheelRadius = 100;

  // 背包网格
  bagCardSize = 38;
  bagCardGap = 4;
  bagCols = 12;
  bagStartX = 0;
  bagStartY = 0;
  bagRects: Rect[] = [];

  // 滚动
  scrollOffset = 0;
  private hoveredBtn: string | null = null;
  private hoveredBagSlot: number = -1;
  private hoveredLoadoutSlot: number = -1;

  open() { this.panelOpen = true; if (this.state === 'closed') this.state = 'lobby-list'; }
  close() { this.panelOpen = false; }
  toggle() { if (this.panelOpen) this.close(); else this.open(); }

  setBag(bag: (Cell | null)[]) {
    this.bagData = bag;
  }

  update(dt: number) {}

  draw(ctx: CanvasRenderingContext2D) {
    if (!this.panelOpen) return;

    // 面板居中
    this.panelX = 10;
    this.panelY = 60;

    // 半透明遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // 使用现有 panel 风格（深色背景 + 黑色描边）
    panel(ctx, { x: this.panelX, y: this.panelY, w: this.panelW, h: this.panelH });

    ctx.save();
    ctx.translate(this.panelX, this.panelY);

    // 标题
    text(ctx, 'Arena', this.panelW / 2, 28, 22, '#ffffff', 'center');

    if (this.state === 'lobby-list') this.drawLobbyList(ctx);
    else if (this.state === 'in-room') this.drawInRoom(ctx);
    else if (this.state === 'in-game') this.drawInGame(ctx);

    ctx.restore();
  }

  private drawLobbyList(ctx: CanvasRenderingContext2D) {
    // 搜索框
    this.searchFieldRect = { x: 20, y: 55, w: this.panelW - 170, h: 34 };
    searchField(ctx, this.searchFieldRect, this.searchQuery, this.searchActive, 'searching the room…');

    // 1v1/3v3 toggle
    this.toggleBtnRect = { x: this.panelW - 130, y: 55, w: 110, h: 34 };
    ctx.save();
    roundRect(ctx, this.toggleBtnRect.x, this.toggleBtnRect.y, this.toggleBtnRect.w, this.toggleBtnRect.h, 5);
    ctx.fillStyle = this.toggle1v1 ? '#e74c3c' : '#555';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
    text(ctx, this.toggle1v1 ? '1v1' : '3v3', this.toggleBtnRect.x + this.toggleBtnRect.w / 2, this.toggleBtnRect.y + this.toggleBtnRect.h / 2, 14, '#ffffff', 'center', false);
    ctx.restore();

    // 创建房间按钮
    this.createBtnRect = { x: 20, y: 110, w: (this.panelW - 60) / 2, h: 42 };
    const createHovered = this.hoveredBtn === 'create';
    button(ctx, this.createBtnRect, 'create room', '#27ae60', createHovered, 16);

    // 快速加入按钮
    this.quickJoinBtnRect = { x: 40 + (this.panelW - 60) / 2, y: 110, w: (this.panelW - 60) / 2, h: 42 };
    const quickHovered = this.hoveredBtn === 'quick';
    button(ctx, this.quickJoinBtnRect, 'quick join', '#2980b9', quickHovered, 16);

    // 房间列表
    const listY = 175;
    const itemH = 42;
    this.roomListRects = [];
    ctx.save();
    ctx.beginPath(); ctx.rect(10, listY, this.panelW - 20, this.panelH - listY - 20); ctx.clip();
    for (let i = 0; i < this.roomList.length; i++) {
      const r = this.roomList[i];
      const ry = listY + i * itemH + this.scrollOffset;
      if (ry + itemH < listY || ry > this.panelH - 20) continue;
      const rect: Rect = { x: 12, y: ry, w: this.panelW - 24, h: itemH - 4 };
      this.roomListRects.push(rect);
      ctx.save();
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 5);
      ctx.fillStyle = i % 2 === 0 ? '#2a3644' : '#1e2a36';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.stroke();
      ctx.restore();
      text(ctx, `${r.code}  ${r.hostName}`, rect.x + 12, rect.y + rect.h / 2, 13, '#ddd', 'left');
      text(ctx, `${r.filled}/${r.capacity}  ${r.mode === 1 ? '1v1' : '3v3'}`, rect.x + rect.w - 12, rect.y + rect.h / 2, 13, '#aaa', 'right');
    }
    ctx.restore();
  }

  private drawInRoom(ctx: CanvasRenderingContext2D) {
    if (!this.currentRoom) return;
    const seats = this.currentRoom.seats;
    const team0 = seats.filter(s => s.team === 0);
    const team1 = seats.filter(s => s.team === 1);

    // 队伍面板
    this.drawTeamPanel(ctx, 10, 50, this.panelW / 2 - 15, team0, 0);
    this.drawTeamPanel(ctx, this.panelW / 2 + 5, 50, this.panelW / 2 - 15, team1, 1);

    // 中央 Wheel 圆盘
    this.wheelCenterX = this.panelW / 2;
    this.wheelCenterY = 260;
    this.wheelRadius = 95;

    // wheel 圆盘背景
    ctx.save();
    ctx.beginPath(); ctx.arc(this.wheelCenterX, this.wheelCenterY, this.wheelRadius, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#1a1a2e'; ctx.fill();
    for (let r = this.wheelRadius; r > 10; r -= 20) {
      ctx.strokeStyle = r % 40 === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)';
      ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(this.wheelCenterX, this.wheelCenterY, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.arc(this.wheelCenterX, this.wheelCenterY, this.wheelRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();

    // 卡槽
    const totalSeats = this.currentRoom.mode * 2;
    for (let i = 0; i < totalSeats; i++) {
      const angle = (i / totalSeats) * Math.PI * 2 - Math.PI / 2;
      const cx = this.wheelCenterX + Math.cos(angle) * (this.wheelRadius - 28);
      const cy = this.wheelCenterY + Math.sin(angle) * (this.wheelRadius - 28);
      const slotR = 20;
      const isMine = seats[i] && seats[i].id === this.currentRoom!.mySeat;
      // 用 drawCard 渲染槽位小卡片
      const cardRect: Rect = { x: cx - slotR, y: cy - slotR, w: slotR * 2, h: slotR * 2 };
      const card = this.wheelCards[i];
      const hovered = isMine && this.hoveredBagSlot === -2;
      drawCard(ctx, cardRect, card, {
        hovered,
        empty: isMine ? (card ? '' : '+') : '',
        scale: 0.85,
        showName: false,
      });
    }

    // 配装槽
    const loadoutY = 375;
    const loadoutW = 42;
    const loadoutGap = 6;
    const totalLoadoutW = 10 * loadoutW + 9 * loadoutGap;
    const loadoutStartX = (this.panelW - totalLoadoutW) / 2;
    for (let i = 0; i < 10; i++) {
      const lx = loadoutStartX + i * (loadoutW + loadoutGap);
      const cardRect: Rect = { x: lx, y: loadoutY, w: loadoutW, h: loadoutW };
      const hovered = this.hoveredLoadoutSlot === i;
      drawCard(ctx, cardRect, this.loadout[i], { hovered, empty: '', showName: false });
    }

    // 准备按钮
    this.readyBtnRect = { x: this.panelW / 2 - 65, y: 440, w: 130, h: 42 };
    const readyHovered = this.hoveredBtn === 'ready';
    button(ctx, this.readyBtnRect, this.ready ? 'stop' : 'ready', this.ready ? '#e74c3c' : '#27ae60', readyHovered, 16);

    // 离开按钮
    this.leaveBtnRect = { x: this.panelW - 85, y: 12, w: 70, h: 32 };
    const leaveHovered = this.hoveredBtn === 'leave';
    button(ctx, this.leaveBtnRect, 'leave', '#c0392b', leaveHovered, 14);

    // ─── 背包网格 ───
    this.drawBagGrid(ctx);
  }

  private drawBagGrid(ctx: CanvasRenderingContext2D) {
    const bagY = 495;
    const padX = 10;
    this.bagStartX = padX;
    this.bagStartY = bagY;
    this.bagRects = [];

    // 标题
    text(ctx, 'Backpack', this.panelW / 2, bagY - 8, 14, '#aaa', 'center');

    // 计算网格
    const cols = this.bagCols;
    const size = this.bagCardSize;
    const gap = this.bagCardGap;

    this.bagStartX = padX;
    this.bagStartY = bagY + 4;

    // 裁剪区域
    const gridH = Math.ceil(this.bagData.length / cols) * (size + gap);
    const maxVisibleH = this.panelH - this.bagStartY - 10;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.bagStartX, this.bagStartY, this.panelW - padX * 2, Math.min(gridH, maxVisibleH));
    ctx.clip();

    for (let i = 0; i < this.bagData.length; i++) {
      const cell = this.bagData[i];
      if (!cell || cell.item === EMPTY_ITEM) continue;
      const row = Math.floor(i / cols);
      const col = i % cols;
      const bx = this.bagStartX + col * (size + gap);
      const by = this.bagStartY + row * (size + gap);
      const rect: Rect = { x: bx, y: by, w: size, h: size };
      this.bagRects[i] = rect;
      const hovered = this.hoveredBagSlot === i;
      // 检查该卡是否已在 wheel 上（自己的 slot）
      const mySeat = this.currentRoom?.mySeat ?? -1;
      const wheelCard = mySeat >= 0 ? this.wheelCards[mySeat] : null;
      const dimmed = wheelCard !== null && wheelCard.item === cell.item && wheelCard.rarity === cell.rarity;
      drawCard(ctx, rect, cell, { hovered, dim: dimmed ? 0.35 : 1, showName: false });
    }
    ctx.restore();
  }

  private drawTeamPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, players: PlayerBrief[], team: number) {
    ctx.save();
    roundRect(ctx, x, y, w, 140, 5);
    ctx.fillStyle = team === 0 ? 'rgba(231,76,60,0.15)' : 'rgba(41,128,185,0.15)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.stroke();
    text(ctx, `team ${team + 1}`, x + w / 2, y + 22, 15, '#fff', 'center', false);
    players.forEach((p, i) => {
      const py = y + 40 + i * 32;
      text(ctx, `${p.name}  Lv.${p.level}`, x + 12, py + 8, 12, '#ddd', 'left', false);
      ctx.save();
      ctx.fillStyle = p.ready ? '#2ecc71' : '#7f8c8d';
      ctx.beginPath(); ctx.arc(x + w - 22, py + 8, 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
    ctx.restore();
  }

  private drawInGame(ctx: CanvasRenderingContext2D) {
    // 游戏内 HUD
    text(ctx, 'Arena', 70, 20, 18, '#e74c3c', 'center');
    const hearts = 'Life'.repeat(Math.max(0, this.lives)) + 'Life'.repeat(Math.max(0, 2 - this.lives));
    text(ctx, hearts, 70, 42, 16, '#e74c3c', 'center', false);
  }

  handleMouseMove(mx: number, my: number) {
    const px = mx - this.panelX;
    const py = my - this.panelY;
    this.hoveredBtn = null;
    this.hoveredBagSlot = -1;
    this.hoveredLoadoutSlot = -1;
    if (px < 0 || px > this.panelW || py < 0 || py > this.panelH) return;
    if (this.state === 'lobby-list') {
      if (hit(this.createBtnRect, px, py)) this.hoveredBtn = 'create';
      else if (hit(this.quickJoinBtnRect, px, py)) this.hoveredBtn = 'quick';
    } else if (this.state === 'in-room') {
      if (hit(this.readyBtnRect, px, py)) this.hoveredBtn = 'ready';
      else if (hit(this.leaveBtnRect, px, py)) this.hoveredBtn = 'leave';
      // 背包格子悬停
      for (let i = 0; i < this.bagRects.length; i++) {
        if (this.bagRects[i] && hit(this.bagRects[i], px, py)) {
          this.hoveredBagSlot = i;
          return;
        }
      }
    }
  }

  handleClick(mx: number, my: number): string | null {
    if (!this.panelOpen) return null;
    const px = mx - this.panelX;
    const py = my - this.panelY;
    if (px < 0 || px > this.panelW || py < 0 || py > this.panelH) return null;

    if (this.state === 'lobby-list') {
      if (hit(this.createBtnRect, px, py)) {
        this.sendPacket?.(this.makePacket(C2S.ARENA_CREATE, [this.toggle1v1 ? 1 : 3]));
        return 'arena_create';
      }
      if (hit(this.quickJoinBtnRect, px, py)) {
        this.sendPacket?.(this.makePacket(C2S.ARENA_LIST, []));
        return 'arena_quick_join';
      }
      if (hit(this.toggleBtnRect, px, py)) {
        this.toggle1v1 = !this.toggle1v1;
        return 'arena_toggle';
      }
      if (hit(this.searchFieldRect, px, py)) {
        this.searchActive = true;
        return 'arena_search';
      }
      this.searchActive = false;
      for (let i = 0; i < this.roomListRects.length; i++) {
        if (hit(this.roomListRects[i], px, py)) {
          const room = this.roomList[i];
          if (room) {
            const w = new Writer(40);
            w.u8(C2S.ARENA_JOIN).str(room.code);
            this.sendPacket?.(w.bytes());
            return 'arena_join';
          }
        }
      }
    }

    if (this.state === 'in-room') {
      if (hit(this.readyBtnRect, px, py)) {
        this.ready = !this.ready;
        const w = new Writer(2);
        w.u8(C2S.ARENA_READY).u8(this.ready ? 1 : 0);
        this.sendPacket?.(w.bytes());
        return 'arena_ready';
      }
      if (hit(this.leaveBtnRect, px, py)) {
        this.sendPacket?.(new Uint8Array([C2S.ARENA_LEAVE]));
        this.state = 'lobby-list';
        this.currentRoom = null;
        return 'arena_leave';
      }

      // 背包格子点击 -> 放置到 Wheel
      for (let i = 0; i < this.bagRects.length; i++) {
        if (this.bagRects[i] && hit(this.bagRects[i], px, py)) {
          const cell = this.bagData[i];
          if (!cell || cell.item === EMPTY_ITEM) continue;
          // 发送 C2S_ARENA_WHEEL (op=22, bagSlot=u16)
          const w = new Writer(3);
          w.u8(C2S.ARENA_WHEEL).u16(i);
          this.sendPacket?.(w.bytes());
          return 'arena_wheel';
        }
      }
    }

    return null;
  }

  private makePacket(op: number, payload: number[]): Uint8Array {
    const w = new Writer(1 + payload.length);
    w.u8(op);
    for (const v of payload) w.u8(v);
    return w.bytes();
  }

  // ---- 网络回调 ----
  onLobbyUpdate(data: any) {
    this.state = 'in-room';
    this.currentRoom = {
      code: data.code,
      seats: data.seats || [],
      mode: data.mode || 1,
      mySeat: data.mySeat || 0,
      myTeam: data.myTeam || 0,
    };
    this.wheelCards = new Array((data.mode || 1) * 2).fill(null);
    this.ready = false;
  }

  onStart(seed: number, walls: Wall[]) {
    this.state = 'in-game';
    this.panelOpen = false;
    this.lives = 2;
  }

  onResult(winnerTeam: number, wonCards: Cell[]) {
    // 由 GameClient 处理
  }

  onList(rooms: RoomBrief[]) {
    this.roomList = rooms;
  }

  onUpdate(type: number, seat: number, payload: any) {
    if (type === 0 && this.currentRoom) {
      // join
    } else if (type === 1) {
      // leave
    } else if (type === 2) {
      // ready
      if (this.currentRoom?.seats[seat]) this.currentRoom.seats[seat].ready = payload === 1;
    } else if (type === 3) {
      // wheel - payload 是 Cell 对象
      this.wheelCards[seat] = payload;
    }
  }

  onLifeLost(seat: number) {
    if (this.currentRoom?.seats[seat]) this.currentRoom.seats[seat].lives--;
    if (seat === this.currentRoom?.mySeat) this.lives--;
  }

  handleKeyInput(char: string) {
    if (this.state === 'lobby-list' && this.searchActive) {
      if (char === '\b') this.searchQuery = this.searchQuery.slice(0, -1);
      else if (char.length === 1 && this.searchQuery.length < 32) this.searchQuery += char;
      const w = new Writer(40);
      w.u8(C2S.ARENA_SEARCH).str(this.searchQuery);
      this.sendPacket?.(w.bytes());
    }
  }
}