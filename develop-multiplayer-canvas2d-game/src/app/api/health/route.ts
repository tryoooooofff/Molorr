import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const database = db;
  let body;
  if (!database) {
    body = JSON.stringify({ ok: true, db: false });
  } else {
    try {
      await database.execute(sql`select 1`);
      body = JSON.stringify({ ok: true, db: true });
    } catch {
      body = JSON.stringify({ ok: false, db: true });
    }
  }
  return new Response(body, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
