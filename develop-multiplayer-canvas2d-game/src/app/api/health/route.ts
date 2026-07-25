import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const database = db;
  if (!database) return Response.json({ ok: true, db: false });

  try {
    await database.execute(sql`select 1`);
    return Response.json({ ok: true, db: true });
  } catch {
    return Response.json({ ok: false, db: true }, { status: 500 });
  }
}
