import { db } from "@/db";
import { playerData } from "@/db/schema";
import { readToken } from "@/lib/auth";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/storage?token=xxx&key=game_settings
 * Returns the value for a given storage key, or all data if no key specified.
 */
export async function GET(req: Request) {
  const database = db;
  if (!database) {
    return Response.json({ error: "Cloud storage is disabled on this deployment." }, { status: 503 });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const key = url.searchParams.get("key");

  const userId = readToken(token);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const rows = await database.select().from(playerData).where(eq(playerData.userId, userId)).limit(1);
    const data = (rows[0]?.data ?? {}) as Record<string, unknown>;
    if (key) {
      return Response.json({ data: data[key] ?? null });
    }
    return Response.json({ data });
  } catch {
    return Response.json({ error: "server error" }, { status: 500 });
  }
}

/**
 * POST /api/storage
 * Body: { token: string, key: string, value: any }
 * Sets a single key's value, or replaces all data if no key is provided.
 */
export async function POST(req: Request) {
  const database = db;
  if (!database) {
    return Response.json({ error: "Cloud storage is disabled on this deployment." }, { status: 503 });
  }

  try {
    const body = (await req.json()) as {
      token?: string;
      key?: string;
      value?: unknown;
      data?: Record<string, unknown>;
    };

    const userId = readToken(body.token);
    if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

    if (body.key !== undefined) {
      // Update a single key
      const existing = await database.select().from(playerData).where(eq(playerData.userId, userId)).limit(1);
      const currentData = (existing[0]?.data ?? {}) as Record<string, unknown>;
      currentData[body.key] = body.value;

      await database
        .insert(playerData)
        .values({ userId, data: currentData, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: playerData.userId,
          set: { data: currentData, updatedAt: new Date() },
        });
    } else if (body.data) {
      // Replace all data
      await database
        .insert(playerData)
        .values({ userId, data: body.data, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: playerData.userId,
          set: { data: body.data, updatedAt: new Date() },
        });
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "server error" }, { status: 500 });
  }
}