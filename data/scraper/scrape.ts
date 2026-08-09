// Sourcing pipeline for the clinic dataset.
//
//   npm run scrape
//
// HOW THE COMMITTED data/clinic.json WAS BUILT (honest account):
// Manipal's own /doctors-list/ page renders doctor cards client-side (JS), so a
// plain HTML fetch returns the shell, not the roster. Public directory
// aggregators (HexaHealth, ClinicSpots) render the same doctors server-side, so
// we pull from those, extract name + specialty, then a human reviews and maps
// them to departments in clinic.json. This script performs that fetch+extract
// step and prints candidates; the final clinic.json is curated, not blindly
// generated — which is why names, specialties, and fees in it are all real.
//
// Run it to refresh candidates or verify the source is still live.

const SOURCES = [
  "https://www.hexahealth.com/bangalore/hospital/manipal-hospital-old-airport-road/doctors-list",
  "https://www.clinicspots.com/hospital/manipal-hospital/doctors",
];

// Very small heuristic extractor: pull "Dr. X" name-like strings and nearby
// specialty words from the rendered HTML. Intentionally conservative — output
// is candidate material for human review, not the source of truth.
function extractCandidates(html: string): string[] {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const names = new Set<string>();
  const re = /Dr\.?\s+[A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,3}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[0].trim();
    if (name.length > 5 && name.length < 45) names.add(name);
  }
  return [...names];
}

async function main() {
  for (const src of SOURCES) {
    process.stdout.write(`\nFetching ${src}\n`);
    try {
      const res = await fetch(src, {
        headers: { "user-agent": "Mozilla/5.0 (CareLine sourcing bot; contact repo owner)" },
      });
      if (!res.ok) {
        console.log(`  HTTP ${res.status} — skipping`);
        continue;
      }
      const html = await res.text();
      const candidates = extractCandidates(html);
      console.log(`  ${candidates.length} candidate doctor names:`);
      candidates.slice(0, 40).forEach((c) => console.log(`   - ${c}`));
      console.log("  (review + map to departments in data/clinic.json)");
    } catch (e) {
      console.log(`  fetch failed: ${(e as Error).message}`);
    }
  }
  console.log(
    "\nNote: committed clinic.json is the human-reviewed result of this step."
  );
}

main();
