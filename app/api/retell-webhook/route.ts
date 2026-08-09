// Retell call-lifecycle webhook. Fires on call_started / call_ended /
// call_analyzed. We persist the transcript + tool trace here — AFTER the call —
// so nothing on this path ever slows down a live turn (ARCHITECTURE §5).
import { db } from "@/lib/db";
import { verifySecret } from "@/lib/http";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  if (!verifySecret(req)) return NextResponse.json({ ok: false }, { status: 401 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const event = body.event ?? body.type;
  const call = body.call ?? body.data ?? {};
  const callId = call.call_id ?? call.id;
  if (!callId) return NextResponse.json({ ok: true }); // nothing to record

  if (event === "call_ended" || event === "call_analyzed") {
    await db.from("call_logs").upsert(
      {
        call_id: callId,
        from_number: call.from_number ?? null,
        transcript: call.transcript_object ?? call.transcript ?? null,
        tool_trace: call.tool_calls ?? call.function_calls ?? null,
        outcome: call.call_analysis?.custom_analysis_data?.outcome ?? null,
        started_at: call.start_timestamp ? new Date(call.start_timestamp).toISOString() : null,
        ended_at: call.end_timestamp ? new Date(call.end_timestamp).toISOString() : null,
      },
      { onConflict: "call_id" }
    );
  }

  return NextResponse.json({ ok: true });
}
