import { db } from "@/db";
import { saves, users } from "@/db/schema";
import { hashPassword, makeToken } from "@/lib/auth";
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
    if (username.length < 3 || password.length < 3) {
      return Response.json({ error: "Username and password need 3+ characters." }, { status: 400 });
    }
    const existing = await database.select().from(users).where(eq(users.username, username)).limit(1);
    if (existing.length > 0) {
      return Response.json({ error: "That flower name is taken." }, { status: 409 });
    }
    const inserted = await database
      .insert(users)
      .values({ username, passwordHash: hashPassword(password) })
      .returning({ id: users.id });
    const id = inserted[0].id;
    await database.insert(saves).values({ userId: id, data: {} }).onConflictDoNothing();
    return Response.json({ token: makeToken(id), username });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "Server error." }, { status: 500 });
  }
}
