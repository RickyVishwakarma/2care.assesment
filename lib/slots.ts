// Slot generation + natural-language date/department resolution.
// Kept dependency-free (no date libs) so it runs the same in seed, endpoints,
// and eval. All times are handled in the clinic's timezone (Asia/Kolkata).

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const CLINIC_TZ = "Asia/Kolkata";
export const IST_OFFSET_MIN = 330; // UTC+5:30, no DST in India

export interface OpdBlock {
  days: string[]; // ["Mon","Wed"]
  start: string; // "09:30"
  end: string; // "13:00"
}

// Build a UTC Date from IST wall-clock parts.
function istToUtc(y: number, m: number, d: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, m, d, hh, mm) - IST_OFFSET_MIN * 60_000);
}

function parseHHMM(s: string): [number, number] {
  const [h, m] = s.split(":").map(Number);
  return [h, m];
}

/**
 * Generate concrete slots for one doctor over the next `days` days from `from`,
 * at `granularityMin` spacing, honouring their OPD blocks. Sundays excluded by
 * data (no OPD block will list Sun).
 */
export function generateSlots(
  opd: OpdBlock[],
  from: Date,
  days: number,
  granularityMin: number
): { starts_at: string; ends_at: string }[] {
  const out: { starts_at: string; ends_at: string }[] = [];
  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    // Work in IST calendar terms.
    const istNow = new Date(from.getTime() + IST_OFFSET_MIN * 60_000);
    const dt = new Date(
      Date.UTC(
        istNow.getUTCFullYear(),
        istNow.getUTCMonth(),
        istNow.getUTCDate() + dayOffset
      )
    );
    const dow = WEEKDAYS[dt.getUTCDay()];
    for (const block of opd) {
      if (!block.days.includes(dow)) continue;
      const [sh, sm] = parseHHMM(block.start);
      const [eh, em] = parseHHMM(block.end);
      const y = dt.getUTCFullYear();
      const mo = dt.getUTCMonth();
      const da = dt.getUTCDate();
      let cursor = istToUtc(y, mo, da, sh, sm);
      const end = istToUtc(y, mo, da, eh, em);
      while (cursor.getTime() + granularityMin * 60_000 <= end.getTime() + 1) {
        const next = new Date(cursor.getTime() + granularityMin * 60_000);
        // Skip slots in the past (relevant for "today").
        if (cursor.getTime() > from.getTime()) {
          out.push({
            starts_at: cursor.toISOString(),
            ends_at: next.toISOString(),
          });
        }
        cursor = next;
      }
    }
  }
  return out;
}

// ── Speakable formatting ──────────────────────────────────────────────────
export function speakSlot(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MIN * 60_000);
  const day = WEEKDAYS[d.getUTCDay()];
  const date = d.getUTCDate();
  const month = [
    "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec",
  ][d.getUTCMonth()];
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const mm = m.toString().padStart(2, "0");
  return `${day} ${date} ${month}, ${h}:${mm} ${ampm}`;
}

// ── Natural-language date hints ───────────────────────────────────────────
// Resolves phrases callers actually say ("tomorrow", "monday", "this week")
// into a [startUtc, endUtc] window the availability query filters on.
export function resolveDateHint(
  hint: string | undefined,
  now: Date
): { from: Date; to: Date } {
  const base = now;
  const istNow = new Date(base.getTime() + IST_OFFSET_MIN * 60_000);
  const y = istNow.getUTCFullYear();
  const mo = istNow.getUTCMonth();
  const da = istNow.getUTCDate();
  const startOfDay = (offset: number) => istToUtc(y, mo, da + offset, 0, 0);

  if (!hint) return { from: base, to: startOfDay(14) };
  const h = hint.toLowerCase().trim();

  if (h.includes("today")) return { from: base, to: startOfDay(1) };
  if (h.includes("tomorrow")) return { from: startOfDay(1), to: startOfDay(2) };
  if (h.includes("week")) return { from: base, to: startOfDay(7) };

  const dayIdx = WEEKDAYS.findIndex((w) => h.includes(w.toLowerCase()) ||
    h.includes(FULL_DAYS[WEEKDAYS.indexOf(w)].toLowerCase()));
  if (dayIdx >= 0) {
    const todayIdx = istNow.getUTCDay();
    let delta = (dayIdx - todayIdx + 7) % 7;
    if (delta === 0) delta = 7; // "monday" said on a monday → next monday
    return { from: startOfDay(delta), to: startOfDay(delta + 1) };
  }
  // Unrecognized hint → next two weeks, let ranking surface the soonest.
  return { from: base, to: startOfDay(14) };
}

const FULL_DAYS = [
  "Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday",
];

// ── Department resolution ─────────────────────────────────────────────────
// Maps a spoken phrase ("my heart hurts", "knee") to a department via name +
// synonyms. Returns the matched department name or null.
export function matchDepartment(
  phrase: string,
  departments: { name: string; synonyms: string[] }[]
): string | null {
  const p = phrase.toLowerCase();
  for (const d of departments) {
    if (p.includes(d.name.toLowerCase())) return d.name;
    for (const s of d.synonyms) {
      if (p.includes(s.toLowerCase())) return d.name;
    }
  }
  return null;
}

// ── Emergency / red-flag detection (healthcare safety guardrail) ──────────
// 2care positions on "safe, reliable" healthcare voice AI. A booking bot must
// NOT quietly schedule an OPD slot for someone describing an emergency.
const RED_FLAGS = [
  "chest pain", "can't breathe", "cannot breathe", "shortness of breath",
  "unconscious", "severe bleeding", "bleeding heavily", "stroke",
  "slurred speech", "face drooping", "suicidal", "overdose", "heart attack",
  "seizure now", "not breathing", "choking",
];
export function isEmergency(phrase: string): boolean {
  const p = phrase.toLowerCase();
  return RED_FLAGS.some((f) => p.includes(f));
}
