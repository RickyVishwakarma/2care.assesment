import { parseArgs, toolJson, verifySecret } from "@/lib/http";
import { lookupPatient } from "@/lib/service";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  if (!verifySecret(req)) return NextResponse.json({ ok: false, speak: "Unauthorized" }, { status: 401 });
  const t0 = performance.now();
  const { phone } = await parseArgs<{ phone: string }>(req);
  const result = await lookupPatient(phone);
  return toolJson(result, Math.round(performance.now() - t0));
}
