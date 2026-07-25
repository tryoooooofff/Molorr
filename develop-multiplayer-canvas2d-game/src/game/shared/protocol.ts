// Binary protocol. Every packet on the wire is a Uint8Array.

export const C2S = {
  JOIN: 1,
  INPUT: 2,
  SWAP: 3,
  CRAFT: 4,
  CHANGE_MAP: 5,
  RESPAWN: 6,
  PING: 7,
} as const;

export const S2C = {
  WELCOME: 1,
  SNAPSHOT: 2,
  INVENTORY: 3,
  STATS: 4,
  EVENT: 5,
  PONG: 6,
} as const;

export const ENT = {
  PLAYER: 0,
  MOB: 1,
  PETAL: 2,
  DROP: 3,
} as const;

export const TEAM = {
  HOSTILE: 0,
  FRIENDLY: 1,
  SELF: 2,
} as const;

export const EVT = {
  XP: 0,
  LOOT: 1,
  CRAFT_OK: 2,
  CRAFT_FAIL: 3,
  DEATH: 4,
  KILL: 5,
  HIT: 6,
} as const;

export class Writer {
  private buf: Uint8Array;
  private view: DataView;
  private off = 0;

  constructor(size = 512) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(n: number) {
    if (this.off + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.off + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  u8(v: number) { this.ensure(1); this.view.setUint8(this.off, v & 0xff); this.off += 1; return this; }
  i8(v: number) { this.ensure(1); this.view.setInt8(this.off, Math.max(-128, Math.min(127, v | 0))); this.off += 1; return this; }
  u16(v: number) { this.ensure(2); this.view.setUint16(this.off, v & 0xffff); this.off += 2; return this; }
  i16(v: number) { this.ensure(2); this.view.setInt16(this.off, Math.max(-32768, Math.min(32767, v | 0))); this.off += 2; return this; }
  u32(v: number) { this.ensure(4); this.view.setUint32(this.off, v >>> 0); this.off += 4; return this; }
  f32(v: number) { this.ensure(4); this.view.setFloat32(this.off, v); this.off += 4; return this; }

  str(s: string) {
    const bytes: number[] = [];
    for (let i = 0; i < s.length && bytes.length < 250; i++) {
      const c = s.charCodeAt(i);
      if (c < 128) bytes.push(c);
      else bytes.push(63); // '?'
    }
    this.u8(bytes.length);
    this.ensure(bytes.length);
    for (const b of bytes) this.view.setUint8(this.off++, b);
    return this;
  }

  bytes(): Uint8Array {
    return this.buf.slice(0, this.off);
  }
}

export class Reader {
  private view: DataView;
  private off = 0;

  constructor(data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get remaining() { return this.view.byteLength - this.off; }

  u8() { const v = this.view.getUint8(this.off); this.off += 1; return v; }
  i8() { const v = this.view.getInt8(this.off); this.off += 1; return v; }
  u16() { const v = this.view.getUint16(this.off); this.off += 2; return v; }
  i16() { const v = this.view.getInt16(this.off); this.off += 2; return v; }
  u32() { const v = this.view.getUint32(this.off); this.off += 4; return v; }
  f32() { const v = this.view.getFloat32(this.off); this.off += 4; return v; }

  str() {
    const len = this.u8();
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(this.u8());
    return s;
  }
}
