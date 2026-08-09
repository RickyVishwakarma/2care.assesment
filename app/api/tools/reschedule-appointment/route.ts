import { parseArgs, toolJson, verifySecret } from "@/lib/http";
import { rescheduleAppointment } from "@/lib/service";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  if (!verifySecret(req)) return NextResponse.json({ ok: false, speak: "Unauthorized" }, { status: 401 });
  const t0 = performance.now();
  const args = await parseArgs<{ appointment_id: string; new_slot_id: string }>(req);
  const result = await rescheduleAppointment(args);
  return toolJson(result, Math.round(performance.now() - t0));
}
