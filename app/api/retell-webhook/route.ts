// Retell call-lifecycle webhook. Fires on call_started / call_ended /
// call_analyzed. We persist the transcript + tool trace here — AFTER the call —
// so nothing on this path ever slows down a live turn (ARCHITECTURE §5).
//
// Auth note: unlike the tool endpoints (which we gate with our own
// x-retell-secret header), the webhook is called by Retell's servers, which
// sign the payload with an X-Retell-Signature (HMAC of the raw body using the
// API key). So we verify THAT here, via the official SDK — not our shared secret.
import { db } from "@/lib/db";
import Retell from "retell-sdk";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-retell-signature") ?? "";
  const apiKey = process.env.RETELL_API_KEY;

  if (apiKey) {
    const valid = Retell.verify(raw, apiKey, signature);
    if (!valid) return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: any = {};
  try {
    body = JSON.parse(raw);
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
