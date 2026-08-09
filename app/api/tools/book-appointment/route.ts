import { parseArgs, toolJson, verifySecret } from "@/lib/http";
import { bookAppointment } from "@/lib/service";
import type { AppointmentTypeCode } from "@/lib/types";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  if (!verifySecret(req)) return NextResponse.json({ ok: false, speak: "Unauthorized" }, { status: 401 });
  const t0 = performance.now();
  const args = await parseArgs<{
    slot_id: string;
    phone: string;
    patient_name?: string;
    type?: AppointmentTypeCode;
    reason?: string;
  }>(req);
  const result = await bookAppointment(args);
  return toolJson(result, Math.round(performance.now() - t0));
}
