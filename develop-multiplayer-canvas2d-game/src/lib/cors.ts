export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function corsResponse(body: string, status = 200) {
  return new Response(body, { status, headers: CORS_HEADERS });
}

export function corsJson(data: unknown, status = 200) {
  return corsResponse(JSON.stringify(data), status);
}