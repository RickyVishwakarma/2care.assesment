// Creates a Retell web call and returns its access token to the browser, so the
// deployed site is a one-click "call the agent" demo — no phone number needed.
// The RETELL_API_KEY and agent id stay server-side.
import { NextResponse } from "next/server";

export async function POST() {
  const apiKey = process.env.RETELL_API_KEY;
  const agentId = process.env.RETELL_AGENT_ID;
  if (!apiKey || !agentId) {
    return NextResponse.json(
      { error: "Set RETELL_API_KEY and RETELL_AGENT_ID to enable web calls." },
      { status: 500 }
    );
  }

  const res = await fetch("https://api.retellai.com/v2/create-web-call", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ agent_id: agentId }),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `Retell error: ${text}` }, { status: 502 });
  }

  const data = await res.json();
  return NextResponse.json({ access_token: data.access_token, call_id: data.call_id });
}
