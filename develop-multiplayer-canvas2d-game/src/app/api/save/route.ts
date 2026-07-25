import { db } from "@/db";
import { saves } from "@/db/schema";
import { readToken } from "@/lib/auth";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const userId = readToken(token);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const rows = await db.select().from(saves).where(eq(saves.userId, userId)).limit(1);
    return Response.json({ data: rows[0]?.data ?? null });
  } catch {
    return Response.json({ error: "server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { token?: string; data?: unknown };
    const userId = readToken(body.token);
    if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
    const data = body.data ?? {};
    await db
      .insert(saves)
      .values({ userId, data, updatedAt: new Date() })
      .onConflictDoUpdate({ target: saves.userId, set: { data, updatedAt: new Date() } });
    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "server error" }, { status: 500 });
  }
}
