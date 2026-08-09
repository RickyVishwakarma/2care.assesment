import { parseArgs, toolJson, verifySecret } from "@/lib/http";
import { checkAvailability } from "@/lib/service";
import type { AppointmentTypeCode } from "@/lib/types";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  if (!verifySecret(req)) return NextResponse.json({ ok: false, speak: "Unauthorized" }, { status: 401 });
  const t0 = performance.now();
  const args = await parseArgs<{
    department?: string;
    doctor?: string;
    symptom?: string;
    date_hint?: string;
    type?: AppointmentTypeCode;
  }>(req);
  const result = await checkAvailability(args);
  return toolJson(result, Math.round(performance.now() - t0));
}
