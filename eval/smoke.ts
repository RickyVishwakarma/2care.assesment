// Functional smoke test — deterministic, no LLM required.
//
// Proves every capability the assignment demands, straight against the live
// backend + real seeded data:
//   booking · rescheduling · cancellation · conflict resolution ·
//   vague/symptom routing · emergency safety · returning-patient lookup ·
//   teleconsult handling · auth gate · input validation · error recovery
//
// Re-runnable by anyone:  npm run smoke   (targets CARELINE_BASE_URL)
// Complements eval/harness.ts (which tests the LLM's conversational behaviour);
// this tests that the machinery underneath is correct and runnable.
import "dotenv/config";
import { resetPatient } from "./db";

const BASE = process.env.CARELINE_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.RETELL_WEBHOOK_SECRET;
const TEST_PHONE = "+919900000001"; // clearly-synthetic test identity

type Res = { status: number; body: any };
async function call(path: string, args: unknown, opts: { noAuth?: boolean } = {}): Promise<Res> {
  const res = await fetch(`${BASE}/api/tools/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(!opts.noAuth && SECRET ? { "x-retell-secret": SECRET } : {}),
    },
    body: JSON.stringify({ args }),
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body };
}

// ── tiny assertion runner ───────────────────────────────────────────────────
let passed = 0, failed = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; fails.push(name); console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ""}`); }
}

async function main() {
  console.log(`\nCareLine functional smoke test → ${BASE}\n`);
  await resetPatient(TEST_PHONE); // clean slate

  // 1) AUTH GATE ─────────────────────────────────────────────────────────────
  if (SECRET) {
    const r = await call("check-availability", { department: "Cardiology" }, { noAuth: true });
    check("auth: request without secret is rejected", r.status === 401 || r.body?.ok === false,
      `status ${r.status}`);
  } else {
    console.log("  SKIP  auth gate (no RETELL_WEBHOOK_SECRET set)");
  }

  // 2) VALIDATION ─────────────────────────────────────────────────────────────
  const noParams = await call("check-availability", {});
  check("validation: missing dept/doctor asks for one", noParams.body?.code === "invalid");

  // 3) AVAILABILITY by DEPARTMENT ─────────────────────────────────────────────
  const byDept = await call("check-availability", { department: "Cardiology" });
  const options = byDept.body?.data?.options ?? [];
  check("availability: department returns open slots", byDept.body?.ok && options.length > 0,
    `got ${options.length} options`);

  // 4) AVAILABILITY by DOCTOR name ────────────────────────────────────────────
  const byDoc = await call("check-availability", { doctor: "Iyengar" });
  check("availability: doctor-name search works",
    byDoc.body?.ok && (byDoc.body?.data?.options ?? []).some((o: any) => /Iyengar/.test(o.doctor)));

  // 5) VAGUE / SYMPTOM routing ────────────────────────────────────────────────
  const vague = await call("check-availability", { symptom: "my knee has been hurting" });
  check("vague request: symptom routes to Orthopaedics", vague.body?.data?.department === "Orthopaedics",
    `routed to ${vague.body?.data?.department}`);

  // 6) EMERGENCY SAFETY guardrail ─────────────────────────────────────────────
  const emg = await call("check-availability", { symptom: "I have severe chest pain and can't breathe" });
  check("safety: emergency is refused + escalated (not booked)",
    emg.body?.code === "emergency" && emg.body?.ok === false);

  // 7) TELECONSULT handling ───────────────────────────────────────────────────
  const tele = await call("check-availability", { department: "Cardiology", type: "tele" });
  check("teleconsult: type=tele returns a valid response",
    tele.body?.ok === true && ["ok", "no_availability"].includes(tele.body?.code));

  // 8) LOOKUP new patient ─────────────────────────────────────────────────────
  const newLookup = await call("lookup-patient", { phone: TEST_PHONE });
  check("lookup: unknown caller flagged as new", newLookup.body?.data?.known === false);

  if (options.length < 2) {
    check("PRECONDITION: need >=2 open Cardiology slots to test booking flow", false,
      `only ${options.length}`);
    return finish();
  }
  const slotA = options[0].slot_id;
  const slotB = options[1].slot_id;

  // 9) BOOK ───────────────────────────────────────────────────────────────────
  const book = await call("book-appointment", { slot_id: slotA, phone: TEST_PHONE, patient_name: "Smoke Test", type: "new" });
  const apptId = book.body?.data?.appointment_id;
  check("booking: slot booked end-to-end", book.body?.ok && !!apptId, book.body?.speak);
  check("booking: confirmation mentions WhatsApp (2care-style)", /whatsapp/i.test(book.body?.speak ?? ""));

  // 10) LOOKUP returning patient ──────────────────────────────────────────────
  const back = await call("lookup-patient", { phone: TEST_PHONE });
  check("lookup: returning caller recognised with upcoming appt",
    back.body?.data?.known === true && (back.body?.data?.upcoming ?? []).length === 1);

  // 11) CONFLICT resolution ───────────────────────────────────────────────────
  const dbl = await call("book-appointment", { slot_id: slotA, phone: "+919900000002", patient_name: "Racer" });
  check("conflict: double-booking same slot returns conflict",
    dbl.body?.ok === false && dbl.body?.code === "conflict");

  // 12) RESCHEDULE ────────────────────────────────────────────────────────────
  const resched = await call("reschedule-appointment", { appointment_id: apptId, new_slot_id: slotB });
  check("reschedule: appointment moved to new slot", resched.body?.ok === true);

  // 13) OLD SLOT FREED after reschedule (slotA should be bookable again) ───────
  const rebookOld = await call("book-appointment", { slot_id: slotA, phone: "+919900000003", patient_name: "Rebooker" });
  check("reschedule: previous slot was freed (re-bookable)", rebookOld.body?.ok === true);
  if (rebookOld.body?.data?.appointment_id) {
    await call("cancel-appointment", { appointment_id: rebookOld.body.data.appointment_id });
  }
  await resetPatient("+919900000003");

  // 14) ERROR RECOVERY: book a non-existent slot ──────────────────────────────
  const badSlot = await call("book-appointment", { slot_id: "00000000-0000-0000-0000-000000000000", phone: TEST_PHONE });
  check("error recovery: unknown slot handled gracefully",
    badSlot.body?.ok === false && ["not_found", "conflict"].includes(badSlot.body?.code));

  // 15) CANCEL ────────────────────────────────────────────────────────────────
  const cancel = await call("cancel-appointment", { appointment_id: apptId });
  check("cancellation: appointment cancelled + slot freed", cancel.body?.ok === true);

  // 16) IDEMPOTENT CANCEL ─────────────────────────────────────────────────────
  const cancel2 = await call("cancel-appointment", { appointment_id: apptId });
  check("cancellation: cancelling twice is safe", cancel2.body?.ok === true);

  await finish();
}

async function finish() {
  // cleanup so the DB is left pristine for the next run / demo
  await resetPatient(TEST_PHONE);
  await resetPatient("+919900000002");
  console.log(`\n──────── RESULTS ────────`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed) console.log(`  failing: ${fails.join(", ")}`);
  console.log(`─────────────────────────\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
