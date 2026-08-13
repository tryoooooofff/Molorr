import { GameServer } from "../shared/sim";
import { AFK_CLOSE_CODE, TICK_MS } from "../shared/defs";

export interface Transport {
  send(data: Uint8Array): void;
  close(): void;
  readonly kind: "local" | "remote";
  onMessage: (data: Uint8Array) => void;
  onOpen: () => void;
  /** `code` is the WebSocket close code; AFK_CLOSE_CODE means an AFK kick. */
  onClose: (code?: number) => void;
}

/** Runs the real authoritative server inside the browser (single player / offline). */
export class LocalTransport implements Transport {
  readonly kind = "local";
  onMessage: (data: Uint8Array) => void = () => {};
  onOpen: () => void = () => {};
  onClose: (code?: number) => void = () => {};
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
      // Offline play runs the same AFK rules; ignoring the check ends the
      // session exactly as it would against a hosted server.
      if (this.server.drainKicks().includes(this.id)) this.close(AFK_CLOSE_CODE);
    }, TICK_MS);
    setTimeout(() => this.onOpen(), 0);
  }

  send(data: Uint8Array) {
    this.server.handleMessage(this.id, data);
  }

  close(code?: number) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.server.removeClient(this.id);
    this.onClose(code);
  }
}

/** Talks to server/index.ts over a WebSocket using the same binary protocol. */
export class RemoteTransport implements Transport {
  readonly kind = "remote";
  onMessage: (data: Uint8Array) => void = () => {};
  onOpen: () => void = () => {};
  onClose: (code?: number) => void = () => {};
  private ws: WebSocket;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => this.onOpen();
    this.ws.onclose = (ev) => this.onClose(ev.code);
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

export function createTransport(serverUrl?: string): Transport {
  const url = serverUrl || process.env.NEXT_PUBLIC_GAME_WS;
  if (url && url.length > 3) return new RemoteTransport(url);
  return new LocalTransport();
}
