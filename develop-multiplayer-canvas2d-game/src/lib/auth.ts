import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SECRET = process.env.AUTH_SECRET || "petalia-dev-secret";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 32);
  const known = Buffer.from(hash, "hex");
  if (known.length !== test.length) return false;
  return timingSafeEqual(known, test);
}

export function makeToken(userId: number): string {
  const payload = String(userId);
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex").slice(0, 32);
  return `${payload}.${sig}`;
}

export function readToken(token: string | null | undefined): number | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", SECRET).update(payload).digest("hex").slice(0, 32);
  if (expected !== sig) return null;
  const id = Number(payload);
  return Number.isFinite(id) ? id : null;
}
