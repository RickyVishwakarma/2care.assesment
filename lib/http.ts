// Small helpers shared by every tool route.
import { NextResponse } from "next/server";
import type { ToolResult } from "./types";

// Retell posts custom-function calls as { call, name, args }. Some setups post
// the args at the top level. Accept both so the endpoints are robust to config.
export async function parseArgs<T = Record<string, unknown>>(req: Request): Promise<T> {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return {} as T;
  }
  if (body && typeof body === "object" && "args" in body && body.args) {
    return body.args as T;
  }
  return body as T;
}

// Optional shared-secret check. Retell can send a custom header; we compare it
// to RETELL_WEBHOOK_SECRET when that env is set. No-ops in local/dev if unset.
export function verifySecret(req: Request): boolean {
  const expected = process.env.RETELL_WEBHOOK_SECRET;
  if (!expected) return true;
  const got = req.headers.get("x-retell-secret") ?? req.headers.get("x-webhook-secret");
  return got === expected;
}

export function toolJson(result: ToolResult, latencyMs?: number) {
  // `speak` is surfaced at top level so the agent can read it directly.
  return NextResponse.json({ ...result, latency_ms: latencyMs });
}
