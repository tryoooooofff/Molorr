import { C2S, Writer } from "../shared/protocol";
import type { Cell } from "../shared/sim";
import type { Wall } from "../shared/defs";

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
  roomList: RoomBrief[] = [];
  currentRoom: { code: string; seats: PlayerBrief[]; mode: number; mySeat: number; myTeam: number } | null = null;
  wheelCards: (Cell | null)[] = [];
  loadout: (Cell | null)[] = new Array(10).fill(null);
  ready = false;
  lives = 2;
  // 网络回调（由 GameClient 注入）
  sendPacket: ((data: Uint8Array) => void) | null = null;

  // 面板布局
  panelX = 0; panelY = 0; panelW = 500; panelH = 600;
  searchFieldRect = { x: 0, y: 0, w: 0, h: 0 };
  createBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  quickJoinBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  toggle1v1 = true; // true=1v1, false=3v3
  toggleBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  roomListRects: { x: number; y: number; w: number; h: number }[] = [];
  readyBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  leaveBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  wheelCenterX = 0; wheelCenterY = 0; wheelRadius = 100;

  // 滚动
  scrollOffset = 0;

  open() { this.panelOpen = true; if (this.state === 'closed') this.state = 'lobby-list'; }
  close() { this.panelOpen = false; }
  toggle() { if (this.panelOpen) this.close(); else this.open(); }

  update(dt: number) {}

  draw(ctx: CanvasRenderingContext2D) {
    if (!this.panelOpen) return;
    // 半透明背景
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // 面板背景 (居中)
    this.panelX = (ctx.canvas.width - this.panelW) / 2;
    this.panelY = (ctx.canvas.height - this.panelH) / 2;
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath(); ctx.roundRect(this.panelX, this.panelY, this.panelW, this.panelH, 12); ctx.fill();
    ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(this.panelX, this.panelY, this.panelW, this.panelH, 12); ctx.stroke();

    ctx.save();
    ctx.translate(this.panelX, this.panelY);

    // 标题
    ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center';
    ctx.fillText('Arena', this.panelW / 2, 30);

    if (this.state === 'lobby-list') this.drawLobbyList(ctx);
    else if (this.state === 'in-room') this.drawInRoom(ctx);
    else if (this.state === 'in-game') this.drawInGame(ctx);

    ctx.restore();
  }

  private drawLobbyList(ctx: CanvasRenderingContext2D) {
    // 搜索框
    this.searchFieldRect = { x: 20, y: 50, w: this.panelW - 160, h: 32 };
    // 使用已有 searchField 风格
    ctx.fillStyle = '#34495e'; ctx.beginPath(); ctx.roundRect(this.searchFieldRect.x, this.searchFieldRect.y, this.searchFieldRect.w, this.searchFieldRect.h, 6); ctx.fill();
    ctx.fillStyle = '#aaa'; ctx.font = '14px Arial'; ctx.textAlign = 'left';
    ctx.fillText(this.searchQuery || '搜索房间…', this.searchFieldRect.x + 10, this.searchFieldRect.y + 22);

    // 1v1/3v3 toggle
    this.toggleBtnRect = { x: this.panelW - 120, y: 50, w: 100, h: 32 };
    ctx.fillStyle = this.toggle1v1 ? '#e74c3c' : '#555';
    ctx.beginPath(); ctx.roundRect(this.toggleBtnRect.x, this.toggleBtnRect.y, this.toggleBtnRect.w, this.toggleBtnRect.h, 6); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center';
    ctx.fillText(this.toggle1v1 ? '1v1' : '3v3', this.toggleBtnRect.x + this.toggleBtnRect.w/2, this.toggleBtnRect.y + 22);

    // 创建房间按钮
    this.createBtnRect = { x: 20, y: 100, w: (this.panelW - 60) / 2, h: 40 };
    ctx.fillStyle = '#27ae60'; ctx.beginPath(); ctx.roundRect(this.createBtnRect.x, this.createBtnRect.y, this.createBtnRect.w, this.createBtnRect.h, 8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Arial'; ctx.textAlign = 'center';
    ctx.fillText('创建房间', this.createBtnRect.x + this.createBtnRect.w/2, this.createBtnRect.y + 27);

    // 快速加入按钮
    this.quickJoinBtnRect = { x: 40 + (this.panelW - 60) / 2, y: 100, w: (this.panelW - 60) / 2, h: 40 };
    ctx.fillStyle = '#2980b9'; ctx.beginPath(); ctx.roundRect(this.quickJoinBtnRect.x, this.quickJoinBtnRect.y, this.quickJoinBtnRect.w, this.quickJoinBtnRect.h, 8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Arial';
    ctx.fillText('快速加入', this.quickJoinBtnRect.x + this.quickJoinBtnRect.w/2, this.quickJoinBtnRect.y + 27);

    // 房间列表
    const listY = 160;
    const itemH = 40;
    this.roomListRects = [];
    ctx.save();
    ctx.beginPath(); ctx.rect(10, listY, this.panelW - 20, this.panelH - listY - 20); ctx.clip();
    for (let i = 0; i < this.roomList.length; i++) {
      const r = this.roomList[i];
      const ry = listY + i * itemH + this.scrollOffset;
      if (ry + itemH < listY || ry > this.panelH - 20) continue;
      this.roomListRects.push({ x: 10, y: ry, w: this.panelW - 20, h: itemH - 4 });
      ctx.fillStyle = i % 2 === 0 ? '#34495e' : '#2c3e50';
      ctx.beginPath(); ctx.roundRect(10, ry, this.panelW - 20, itemH - 4, 4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '13px Arial'; ctx.textAlign = 'left';
      ctx.fillText(`${r.code} - ${r.hostName}`, 20, ry + 16);
      ctx.fillStyle = '#aaa'; ctx.textAlign = 'right';
      ctx.fillText(`${r.filled}/${r.capacity} (${r.mode === 1 ? '1v1' : '3v3'})`, this.panelW - 20, ry + 16);
    }
    ctx.restore();
  }

  private drawInRoom(ctx: CanvasRenderingContext2D) {
    if (!this.currentRoom) return;
    const seats = this.currentRoom.seats;

    // 左右分屏显示玩家
    const team0 = seats.filter(s => s.team === 0);
    const team1 = seats.filter(s => s.team === 1);

    // team 0 (左)
    this.drawTeamPanel(ctx, 10, 50, this.panelW / 2 - 15, team0, 0);
    // team 1 (右)
    this.drawTeamPanel(ctx, this.panelW / 2 + 5, 50, this.panelW / 2 - 15, team1, 1);

    // 中间 Wheel 圆盘
    this.wheelCenterX = this.panelW / 2;
    this.wheelCenterY = 250;
    this.wheelRadius = 90;

    // 画 wheel 圆盘
    ctx.save();
    ctx.beginPath(); ctx.arc(this.wheelCenterX, this.wheelCenterY, this.wheelRadius, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#1a1a2e'; ctx.fill();
    // 同心圆装饰
    for (let r = this.wheelRadius; r > 10; r -= 20) {
      ctx.strokeStyle = r % 40 === 0 ? '#444' : '#2a2a4e';
      ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(this.wheelCenterX, this.wheelCenterY, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(this.wheelCenterX, this.wheelCenterY, this.wheelRadius, 0, Math.PI * 2); ctx.stroke();

    // 画卡槽
    const totalSeats = this.currentRoom.mode * 2;
    for (let i = 0; i < totalSeats; i++) {
      const angle = (i / totalSeats) * Math.PI * 2 - Math.PI / 2;
      const cx = this.wheelCenterX + Math.cos(angle) * (this.wheelRadius - 25);
      const cy = this.wheelCenterY + Math.sin(angle) * (this.wheelRadius - 25);
      const slotR = 18;
      // 自己的卡槽高亮
      const isMine = seats[i] && seats[i].id === this.currentRoom!.mySeat;
      ctx.fillStyle = isMine ? '#e74c3c' : '#555';
      ctx.beginPath(); ctx.arc(cx, cy, slotR, 0, Math.PI * 2); ctx.fill();
      if (this.wheelCards[i]) {
        ctx.fillStyle = '#f1c40f'; ctx.beginPath(); ctx.arc(cx, cy, slotR - 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, slotR, 0, Math.PI * 2); ctx.stroke();
    }

    // 下方配装槽
    const loadoutY = 360;
    for (let i = 0; i < 10; i++) {
      const lx = 20 + i * 46;
      ctx.fillStyle = '#34495e'; ctx.strokeStyle = '#555';
      ctx.beginPath(); ctx.roundRect(lx, loadoutY, 42, 42, 4); ctx.fill(); ctx.stroke();
      if (this.loadout[i]) {
        // 画卡片颜色
        ctx.fillStyle = '#f1c40f'; ctx.beginPath(); ctx.roundRect(lx + 4, loadoutY + 4, 34, 34, 3); ctx.fill();
      }
    }

    // READY 按钮
    this.readyBtnRect = { x: this.panelW / 2 - 60, y: 430, w: 120, h: 40 };
    ctx.fillStyle = this.ready ? '#e74c3c' : '#27ae60';
    ctx.beginPath(); ctx.roundRect(this.readyBtnRect.x, this.readyBtnRect.y, this.readyBtnRect.w, this.readyBtnRect.h, 8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Arial'; ctx.textAlign = 'center';
    ctx.fillText(this.ready ? '取消准备' : '准备', this.readyBtnRect.x + 60, this.readyBtnRect.y + 27);

    // 离开按钮
    this.leaveBtnRect = { x: this.panelW - 80, y: 10, w: 60, h: 30 };
    ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.roundRect(this.leaveBtnRect.x, this.leaveBtnRect.y, this.leaveBtnRect.w, this.leaveBtnRect.h, 6); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '13px Arial';
    ctx.fillText('离开', this.leaveBtnRect.x + 30, this.leaveBtnRect.y + 21);
  }

  private drawTeamPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, players: PlayerBrief[], team: number) {
    ctx.fillStyle = team === 0 ? 'rgba(231,76,60,0.2)' : 'rgba(41,128,185,0.2)';
    ctx.beginPath(); ctx.roundRect(x, y, w, 130, 8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center';
    ctx.fillText(`队伍 ${team + 1}`, x + w / 2, y + 20);
    players.forEach((p, i) => {
      const py = y + 35 + i * 30;
      ctx.fillStyle = '#ddd'; ctx.font = '12px Arial'; ctx.textAlign = 'left';
      ctx.fillText(`${p.name} Lv.${p.level}`, x + 10, py + 10);
      ctx.fillStyle = p.alive ? '#2ecc71' : '#e74c3c';
      ctx.fillText(p.ready ? '✓' : '○', x + w - 20, py + 10);
    });
  }

  private drawInGame(ctx: CanvasRenderingContext2D) {
    // 游戏内 HUD
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Arial'; ctx.textAlign = 'left';
    ctx.fillText(`命数: ${'♥'.repeat(this.lives)}${'♡'.repeat(2 - this.lives)}`, 10, 25);
  }

  handleClick(mx: number, my: number): string | null {
    if (!this.panelOpen) return null;
    // 转换坐标到面板内
    const px = mx - this.panelX;
    const py = my - this.panelY;
    if (px < 0 || px > this.panelW || py < 0 || py > this.panelH) return null;

    if (this.state === 'lobby-list') {
      if (this.hit(px, py, this.createBtnRect)) {
        // 发送创建房间
        this.sendPacket?.(this.makePacket(C2S.ARENA_CREATE, [this.toggle1v1 ? 1 : 3]));
        return 'arena_create';
      }
      if (this.hit(px, py, this.quickJoinBtnRect)) {
        // 快速加入 - 发送空列表请求然后自动加入第一个
        this.sendPacket?.(this.makePacket(C2S.ARENA_LIST, []));
        return 'arena_quick_join';
      }
      if (this.hit(px, py, this.toggleBtnRect)) {
        this.toggle1v1 = !this.toggle1v1;
        return 'arena_toggle';
      }
      // 搜索框点击
      if (this.hit(px, py, this.searchFieldRect)) {
        // 打开键盘输入搜索
        return 'arena_search';
      }
      // 房间列表点击
      for (let i = 0; i < this.roomListRects.length; i++) {
        if (this.hit(px, py, this.roomListRects[i])) {
          const room = this.roomList[i];
          if (room) {
            // 加入房间
            const w = new Writer(40);
            w.u8(C2S.ARENA_JOIN).str(room.code);
            this.sendPacket?.(w.bytes());
            return 'arena_join';
          }
        }
      }
    }

    if (this.state === 'in-room') {
      if (this.hit(px, py, this.readyBtnRect)) {
        this.ready = !this.ready;
        const w = new Writer(2);
        w.u8(C2S.ARENA_READY).u8(this.ready ? 1 : 0);
        this.sendPacket?.(w.bytes());
        return 'arena_ready';
      }
      if (this.hit(px, py, this.leaveBtnRect)) {
        this.sendPacket?.(new Uint8Array([C2S.ARENA_LEAVE]));
        this.state = 'lobby-list';
        this.currentRoom = null;
        return 'arena_leave';
      }
    }

    return null;
  }

  /** 判断点是否在矩形内 */
  private hit(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
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
    this.lives = 2;
  }

  onResult(winnerTeam: number, wonCards: Cell[]) {
    // 由 GameClient 处理
  }

  onList(rooms: RoomBrief[]) {
    this.roomList = rooms;
  }

  onUpdate(type: number, seat: number, payload: any) {
    if (type === 0 && this.currentRoom) { // join
      // 更新 seats
    } else if (type === 1) { // leave
    } else if (type === 2) { // ready
      if (this.currentRoom?.seats[seat]) this.currentRoom.seats[seat].ready = payload === 1;
    } else if (type === 3) { // wheel
      this.wheelCards[seat] = payload;
    }
  }

  onLifeLost(seat: number) {
    if (this.currentRoom?.seats[seat]) this.currentRoom.seats[seat].lives--;
    if (seat === this.currentRoom?.mySeat) this.lives--;
  }

  handleKeyInput(char: string) {
    if (this.state === 'lobby-list') {
      if (char === '\b') this.searchQuery = this.searchQuery.slice(0, -1);
      else if (char.length === 1 && this.searchQuery.length < 32) this.searchQuery += char;
      // 发送搜索
      const w = new Writer(40);
      w.u8(C2S.ARENA_SEARCH).str(this.searchQuery);
      this.sendPacket?.(w.bytes());
    }
  }
}