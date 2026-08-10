// CareLine eval harness.  Run:  npm run eval
//
// For each scenario it: (1) sets up DB state, (2) runs a full simulated call —
// simulated patient ⇄ real agent tool-loop ⇄ real backend, (3) asserts the DB
// end-state, (4) scores deterministic + LLM-judged metrics. Results print as a
// table and are written to eval/results/latest.json for the reviewer to inspect
// and re-run independently.
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { agentRespond } from "./agent";
import { simulatePatient, END } from "./patient";
import { haveLLM, EVAL_MODEL } from "./llm";
import { SCENARIOS, type Scenario } from "./scenarios";
import {
  toolCoverage,
  avgToolLatency,
  falseConfirmation,
  judgeConversation,
  type ConvoJudgement,
} from "./metrics";

interface ScenarioResult {
  id: string;
  title: string;
  axis: string;
  taskSuccess: boolean;
  taskDetail: string;
  toolCoverage: number;
  usedTools: string[];
  turns: number;
  avgToolLatencyMs: number | null;
  falseConfirmation: boolean;
  judge: ConvoJudgement | null;
  transcript: { role: string; content: string }[];
}

async function runScenario(s: Scenario): Promise<ScenarioResult> {
  const ctx = { phone: s.phone, setupData: undefined as Record<string, unknown> | undefined };
  ctx.setupData = (await s.setup?.(ctx)) || undefined;

  const history: { role: "assistant" | "user"; content: string }[] = [];
  const allTools: { name: string; args: any; result: any; latency_ms: number }[] = [];
  const maxTurns = s.maxTurns ?? 8;

  // Patient opens the call.
  let patientLine = await simulatePatient(s.persona, history);
  if (patientLine.includes(END)) patientLine = "Hello, I'd like to book an appointment.";
  history.push({ role: "user", content: patientLine });

  for (let turn = 0; turn < maxTurns; turn++) {
    const { utterance, toolTrace } = await agentRespond(history);
    allTools.push(...toolTrace);
    history.push({ role: "assistant", content: utterance });

    const reply = await simulatePatient(s.persona, history);
    if (reply.includes(END) || reply.trim() === "") break;
    history.push({ role: "user", content: reply });
  }

  const assertion = await s.assert(ctx);
  const judgement = haveLLM()
    ? await judgeConversation(history, s.persona).catch(() => null)
    : null;

  return {
    id: s.id,
    title: s.title,
    axis: s.axis,
    taskSuccess: assertion.passed,
    taskDetail: assertion.detail,
    toolCoverage: toolCoverage(s.expectTools, allTools),
    usedTools: [...new Set(allTools.map((t) => t.name))],
    turns: history.filter((h) => h.role === "user").length,
    avgToolLatencyMs: avgToolLatency(allTools),
    falseConfirmation: falseConfirmation(allTools),
    judge: judgement,
    transcript: history,
  };
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

async function main() {
  const only = process.argv[2]; // optional scenario id filter (comma-separated)
  const ids = only ? new Set(only.split(",").map((s) => s.trim())) : null;
  const scenarios = ids ? SCENARIOS.filter((s) => ids.has(s.id)) : SCENARIOS;

  if (!haveLLM()) {
    console.error(
      "\n⚠  EVAL_LLM_API_KEY not set — the harness needs an LLM to drive the agent + patient.\n" +
        "   Set EVAL_LLM_API_KEY (+ optional EVAL_LLM_BASE_URL / EVAL_LLM_MODEL) and re-run.\n"
    );
    process.exit(1);
  }

  console.log(`\nCareLine eval — model=${EVAL_MODEL}, base=${process.env.CARELINE_BASE_URL ?? "http://localhost:3000"}`);
  console.log(`Running ${scenarios.length} scenario(s)…\n`);

  const results: ScenarioResult[] = [];
  for (const s of scenarios) {
    process.stdout.write(`• ${s.id} … `);
    try {
      const r = await runScenario(s);
      results.push(r);
      console.log(`${r.taskSuccess ? "PASS" : "FAIL"}  (tools ${pct(r.toolCoverage)}, ${r.turns} turns)`);
    } catch (e) {
      console.log(`ERROR ${(e as Error).message}`);
      results.push({
        id: s.id, title: s.title, axis: s.axis, taskSuccess: false,
        taskDetail: `error: ${(e as Error).message}`, toolCoverage: 0, usedTools: [],
        turns: 0, avgToolLatencyMs: null, falseConfirmation: false, judge: null, transcript: [],
      });
    }
  }

  // ── summary ──
  const passed = results.filter((r) => r.taskSuccess).length;
  const avgCov = results.reduce((s, r) => s + r.toolCoverage, 0) / results.length;
  const lats = results.map((r) => r.avgToolLatencyMs).filter((x): x is number => x != null);
  const avgLat = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null;

  console.log("\n──────────── SUMMARY ────────────");
  console.log(`Task success:     ${passed}/${results.length}  (${pct(passed / results.length)})`);
  console.log(`Tool coverage:    ${pct(avgCov)} avg`);
  console.log(`Backend latency:  ${avgLat ?? "n/a"} ms avg per tool call`);
  console.log(`False confirms:   ${results.filter((r) => r.falseConfirmation).length}`);
  if (results.some((r) => r.judge)) {
    const j = (k: keyof ConvoJudgement) =>
      (
        results.filter((r) => r.judge).reduce((s, r) => s + (r.judge as any)[k], 0) /
        results.filter((r) => r.judge).length
      ).toFixed(1);
    console.log(`Judge (1-5):      recovery ${j("recovery")} · naturalness ${j("naturalness")} · grounding ${j("grounding")}`);
  }
  console.log("─────────────────────────────────\n");

  // ── persist ──
  const outDir = join(process.cwd(), "eval", "results");
  mkdirSync(outDir, { recursive: true });
  const payload = {
    run_at: new Date().toISOString(),
    model: EVAL_MODEL,
    base_url: process.env.CARELINE_BASE_URL ?? "http://localhost:3000",
    summary: {
      task_success: `${passed}/${results.length}`,
      tool_coverage_avg: avgCov,
      backend_latency_ms_avg: avgLat,
      false_confirmations: results.filter((r) => r.falseConfirmation).length,
    },
    results,
  };
  writeFileSync(join(outDir, "latest.json"), JSON.stringify(payload, null, 2));
  console.log(`Full results → eval/results/latest.json`);

  // Non-zero exit if any core scenario failed, so CI can gate on it.
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
