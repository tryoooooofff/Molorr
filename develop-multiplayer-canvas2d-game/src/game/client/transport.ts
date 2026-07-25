import { GameServer } from "../shared/sim";
import { TICK_MS } from "../shared/defs";

export interface Transport {
  send(data: Uint8Array): void;
  close(): void;
  readonly kind: "local" | "remote";
  onMessage: (data: Uint8Array) => void;
  onOpen: () => void;
  onClose: () => void;
}

/** Runs the real authoritative server inside the browser (single player / offline). */
export class LocalTransport implements Transport {
  readonly kind = "local";
  onMessage: (data: Uint8Array) => void = () => {};
  onOpen: () => void = () => {};
  onClose: () => void = () => {};
  private server = new GameServer();
  private timer: ReturnType<typeof setInterval> | null = null;
  private id = 1;
  private last = Date.now();

  constructor() {
    this.server.addClient(this.id, (data) => {
      // copy so the consumer never sees a recycled buffer
      this.onMessage(new Uint8Array(data));
    });
    this.timer = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      this.server.tick(dt);
    }, TICK_MS);
    setTimeout(() => this.onOpen(), 0);
  }

  send(data: Uint8Array) {
    this.server.handleMessage(this.id, data);
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.server.removeClient(this.id);
    this.onClose();
  }
}

/** Talks to server/index.ts over a WebSocket using the same binary protocol. */
export class RemoteTransport implements Transport {
  readonly kind = "remote";
  onMessage: (data: Uint8Array) => void = () => {};
  onOpen: () => void = () => {};
  onClose: () => void = () => {};
  private ws: WebSocket;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => this.onOpen();
    this.ws.onclose = () => this.onClose();
    this.ws.onerror = () => this.onClose();
    this.ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) this.onMessage(new Uint8Array(ev.data));
    };
  }

  send(data: Uint8Array) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

export function createTransport(): Transport {
  const url = process.env.NEXT_PUBLIC_GAME_WS;
  if (url && url.length > 3) return new RemoteTransport(url);
  return new LocalTransport();
}
