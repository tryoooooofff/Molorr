import { db } from "@/db";
import { saves, users } from "@/db/schema";
import { makeToken, verifyPassword } from "@/lib/auth";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const database = db;
  if (!database) {
    return Response.json({ error: "Cloud accounts are disabled on this deployment." }, { status: 503 });
  }

  try {
    const body = (await req.json()) as { username?: string; password?: string };
    const username = (body.username || "").trim().slice(0, 16);
    const password = body.password || "";
    const found = await database.select().from(users).where(eq(users.username, username)).limit(1);
    const user = found[0];
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return Response.json({ error: "Wrong name or password." }, { status: 401 });
    }
    const save = await database.select().from(saves).where(eq(saves.userId, user.id)).limit(1);
    return Response.json({ token: makeToken(user.id), username, data: save[0]?.data ?? null });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "Server error." }, { status: 500 });
  }
}
