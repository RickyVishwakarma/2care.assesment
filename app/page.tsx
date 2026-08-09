"use client";

import { useCallback, useRef, useState } from "react";
import { RetellWebClient } from "retell-client-js-sdk";

type CallState = "idle" | "connecting" | "live" | "ended";

export default function Home() {
  const [state, setState] = useState<CallState>("idle");
  const [status, setStatus] = useState("");
  const clientRef = useRef<RetellWebClient | null>(null);

  const endCall = useCallback(() => {
    clientRef.current?.stopCall();
    setState("ended");
    setStatus("Call ended.");
  }, []);

  const startCall = useCallback(async () => {
    try {
      setState("connecting");
      setStatus("Connecting you to the receptionist…");
      const res = await fetch("/api/web-call", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start call");

      const client = new RetellWebClient();
      clientRef.current = client;
      client.on("call_started", () => {
        setState("live");
        setStatus("Connected — go ahead and speak.");
      });
      client.on("call_ended", () => {
        setState("ended");
        setStatus("Call ended.");
      });
      client.on("error", (e: unknown) => {
        setStatus(`Error: ${String(e)}`);
        setState("ended");
      });
      await client.startCall({ accessToken: data.access_token });
    } catch (e) {
      setStatus((e as Error).message);
      setState("idle");
    }
  }, []);

  const live = state === "live" || state === "connecting";

  return (
    <main className="wrap">
      <span className="badge">CareLine · Voice Receptionist</span>
      <h1>Call Manipal Hospital, Old Airport Road</h1>
      <p className="sub">
        A voice AI receptionist. Ask to <strong>book</strong>, <strong>reschedule</strong>,
        or <strong>cancel</strong> an appointment — just talk, like you would on a phone call.
      </p>

      <div className="panel">
        <button
          className={`call-btn ${live ? "live" : ""}`}
          onClick={live ? endCall : startCall}
          disabled={state === "connecting"}
        >
          {state === "connecting"
            ? "Connecting…"
            : live
            ? "End call"
            : "📞 Call the receptionist"}
        </button>
        <div className="status">{status}</div>

        <div className="grid">
          <div className="card">
            <h3>Try: booking</h3>
            <p>"I need to see a cardiologist this week."</p>
          </div>
          <div className="card">
            <h3>Try: vague</h3>
            <p>"My knee's been hurting, who should I see?"</p>
          </div>
          <div className="card">
            <h3>Try: reschedule</h3>
            <p>"Can you move my appointment to Friday?"</p>
          </div>
          <div className="card">
            <h3>Try: change of mind</h3>
            <p>"Actually, make it the afternoon instead."</p>
          </div>
        </div>
      </div>

      <p className="hint">
        Backend is live: tool calls hit real endpoints against a Postgres database
        seeded with <strong>real Manipal doctors and departments</strong>. Grant
        microphone access when prompted. Requires <code>RETELL_AGENT_ID</code> configured.
      </p>
    </main>
  );
}
