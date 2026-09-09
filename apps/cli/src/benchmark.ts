import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PlainTextAdapter } from "@actionmanifest/adapters";
import type { Action, ActionManifest, CanonicalDocument } from "@actionmanifest/core";
import { extractDeterministically } from "@actionmanifest/extractor";
import { verifyManifest, verificationPassed } from "@actionmanifest/verifier";

export interface FixtureMeta {
  id: string;
  language: "ja" | "en";
  category: string;
  tags?: string[];
  golden?: boolean;
}

export interface Fixture {
  dir: string;
  meta: FixtureMeta;
  input: string;
  expected: { actions: Action[] };
}

export interface ActionMatch {
  expected: Action;
  extracted?: Action;
}

export interface FixtureScore {
  id: string;
  language: string;
  category: string;
  golden: boolean;
  expectedCount: number;
  extractedCount: number;
  matched: number;
  recall: number;
  precision: number;
  deadlineAccuracy: number;
  actorAccuracy: number;
  modalityAccuracy: number;
  evidenceMatch: number;
  hallucinationRate: number;
  ambiguityPreservation: number;
  verificationPass: boolean;
  goldenPass?: boolean;
  notes: string[];
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[\s、,，。．./]+/)
      .flatMap((w) => w.split(/(?=[票書届願金費])/))
      .filter((w) => w.length >= 2),
  );
}

function overlap(a: string, b: string): number {
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 || B.size === 0) return 0;
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n / Math.max(A.size, B.size);
}

function similar(a: Action, b: Action): number {
  let s = a.kind === b.kind ? 0.5 : 0;
  s += 0.5 * overlap(`${a.title} ${a.object ?? ""}`, `${b.title} ${b.object ?? ""}`);
  return s;
}

function matchActions(expected: Action[], extracted: Action[]): ActionMatch[] {
  const used = new Set<number>();
  const matches: ActionMatch[] = [];
  for (const exp of expected) {
    let best = -1;
    let bestScore = 0.35;
    extracted.forEach((got, i) => {
      if (used.has(i)) return;
      const sc = similar(exp, got);
      if (sc > bestScore) {
        bestScore = sc;
        best = i;
      }
    });
    if (best >= 0) {
      used.add(best);
      matches.push({ expected: exp, extracted: extracted[best] });
    } else {
      matches.push({ expected: exp });
    }
  }
  return matches;
}

export async function loadFixtures(root: string): Promise<Fixture[]> {
  const fixtures: Fixture[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    const hasInput = entries.some((e) => e.isFile() && e.name === "input.txt");
    if (hasInput) {
      const input = await readFile(join(dir, "input.txt"), "utf8");
      const expected = JSON.parse(await readFile(join(dir, "expected.json"), "utf8")) as {
        actions: Action[];
      };
      const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as FixtureMeta;
      fixtures.push({ dir, meta, input, expected });
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) await walk(join(dir, e.name));
    }
  }

  await walk(root);
  fixtures.sort((a, b) => a.meta.id.localeCompare(b.meta.id));
  return fixtures;
}

function scoreFixture(fix: Fixture, extracted: Action[], doc: CanonicalDocument, verified: boolean): FixtureScore {
  const matches = matchActions(fix.expected.actions, extracted);
  const matched = matches.filter((m) => m.extracted).length;
  const recall = fix.expected.actions.length ? matched / fix.expected.actions.length : 1;
  const precision = extracted.length ? matched / extracted.length : 1;

  const deadlinePairs = matches.filter((m) => m.expected.temporal?.date);
  const deadlineOk = deadlinePairs.filter((m) => m.extracted?.temporal?.date === m.expected.temporal?.date).length;
  const deadlineAccuracy = deadlinePairs.length ? deadlineOk / deadlinePairs.length : 1;

  const actorPairs = matches.filter((m) => m.extracted);
  const actorOk = actorPairs.filter((m) => m.extracted!.actor.certainty === m.expected.actor.certainty || m.expected.actor.certainty === "unknown").length;
  const actorAccuracy = actorPairs.length ? actorOk / actorPairs.length : 1;

  const modalityOk = actorPairs.filter((m) => m.extracted!.modality === m.expected.modality).length;
  const modalityAccuracy = actorPairs.length ? modalityOk / actorPairs.length : 1;

  const evidenceOk = extracted.filter((a) =>
    a.evidence.every((e) => doc.text && (doc.text.includes(e.text.replace(/[。．]$/, "")) || doc.text.includes(e.text))),
  ).length;
  const evidenceMatch = extracted.length ? evidenceOk / extracted.length : 1;

  const hallucinated = extracted.filter((a) => {
    const t = a.temporal;
    if (t?.date && t.type === "approximate") return true;
    const raw = a.evidence.map((e) => e.text).join("");
    if (t?.date && /頃|上旬|中旬|下旬|around /i.test(raw) && !/\d{1,2}日/.test(raw)) return true;
    const inSource = a.evidence.every(
      (e) => doc.text && (doc.text.includes(e.text.replace(/[。．]$/, "")) || doc.text.includes(e.text)),
    );
    if (!inSource) return true;
    return false;
  }).length;
  const unmatchedRequired = extracted.filter((a) => {
    const wasMatched = matches.some((m) => m.extracted === a);
    if (wasMatched) return false;
    return a.modality === "required" && (a.kind === "submit" || a.kind === "pay" || a.kind === "sign");
  }).length;
  const hallucinationRate =
    extracted.length === 0 ? 0 : (hallucinated + unmatchedRequired) / Math.max(extracted.length, 1);

  const approxExpected = fix.expected.actions.filter(
    (a) => a.temporal && (a.temporal.type === "approximate" || a.temporal.type === "conditional" || a.temporal.type === "relative"),
  );
  const approxPreserved = approxExpected.filter((exp) => {
    const m = matches.find((x) => x.expected === exp)?.extracted;
    if (!m?.temporal) return false;
    if (exp.temporal?.type === "approximate") return m.temporal.type === "approximate" && !m.temporal.date;
    return m.temporal.type === exp.temporal?.type || Boolean(m.temporal.alternatives?.length) || Boolean(m.conditions?.length);
  }).length;
  const ambiguityPreservation = approxExpected.length ? approxPreserved / approxExpected.length : 1;

  const notes: string[] = [];
  if (fix.meta.golden) {
    const submit = extracted.find((a) => a.kind === "submit");
    const blanket =
      submit &&
      submit.modality === "required" &&
      !(submit.conditions ?? []).some((c) => /希望|再提出|提出した方|wish|already/i.test(c));
    if (blanket) notes.push("GOLDEN FAIL: blanket submit without eligibility/exemption");
    const event = extracted.find((a) => a.kind === "event");
    if (!event?.temporal?.date?.includes("2026-10-15")) notes.push("GOLDEN: missing event date 2026-10-15");
    if (!submit?.temporal?.date?.includes("2026-10-05") && !submit?.temporal?.end?.includes("2026-10-05")) {
      notes.push("GOLDEN: missing submit deadline 2026-10-05");
    }
    const rain = event?.temporal?.alternatives?.some((t) => t.date === "2026-10-22") || extracted.some((a) => a.temporal?.date === "2026-10-22");
    if (!rain) notes.push("GOLDEN: missing rain alternative 2026-10-22");
    const exemption = submit?.conditions?.some((c) => /再提出|提出した方/.test(c)) || submit?.evidence.some((e) => /再提出する必要はありません/.test(e.text));
    if (!exemption) notes.push("GOLDEN: missing already-submitted exemption");
  }

  const goldenPass = fix.meta.golden ? notes.filter((n) => n.startsWith("GOLDEN")).length === 0 : undefined;

  return {
    id: fix.meta.id,
    language: fix.meta.language,
    category: fix.meta.category,
    golden: Boolean(fix.meta.golden),
    expectedCount: fix.expected.actions.length,
    extractedCount: extracted.length,
    matched,
    recall,
    precision,
    deadlineAccuracy,
    actorAccuracy,
    modalityAccuracy,
    evidenceMatch,
    hallucinationRate,
    ambiguityPreservation,
    verificationPass: verified,
    goldenPass,
    notes,
  };
}

export function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export async function defaultFixtureRoot(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), "benchmark/fixtures"),
    join(here, "../../../benchmark/fixtures"),
    join(here, "../../../../benchmark/fixtures"),
  ];
  for (const c of candidates) {
    try {
      await readdir(c);
      return c;
    } catch {
      /* try next */
    }
  }
  return join(process.cwd(), "benchmark/fixtures");
}

export async function runBenchmark(root: string, smoke = false): Promise<{
  scores: FixtureScore[];
  summary: Record<string, number | string>;
}> {
  let fixtures = await loadFixtures(root);
  if (smoke) {
    fixtures = fixtures.filter((f) => f.meta.golden).concat(fixtures.filter((f) => !f.meta.golden)).slice(0, 5);
  }
  const adapter = new PlainTextAdapter();
  const scores: FixtureScore[] = [];

  for (const fix of fixtures) {
    const doc = await adapter.toCanonical({ kind: "text", id: fix.meta.id, text: fix.input });
    const extracted = extractDeterministically(doc);
    const candidate: ActionManifest = {
      schema_version: "0.1.0",
      source: { id: doc.id, hash: doc.sourceHash },
      actions: extracted,
    };
    const { flags } = verifyManifest(candidate, doc);
    scores.push(scoreFixture(fix, extracted, doc, verificationPassed(flags)));
  }

  const jp = scores.filter((s) => s.language === "ja");
  const en = scores.filter((s) => s.language === "en");
  const summary = {
    fixtures: scores.length,
    jp: jp.length,
    en: en.length,
    actionRecall: mean(scores.map((s) => s.recall)),
    actionPrecision: mean(scores.map((s) => s.precision)),
    deadlineAccuracy: mean(scores.map((s) => s.deadlineAccuracy)),
    actorAccuracy: mean(scores.map((s) => s.actorAccuracy)),
    modalityAccuracy: mean(scores.map((s) => s.modalityAccuracy)),
    evidenceMatch: mean(scores.map((s) => s.evidenceMatch)),
    hallucinationRate: mean(scores.map((s) => s.hallucinationRate)),
    ambiguityPreservation: mean(scores.map((s) => s.ambiguityPreservation)),
    verificationPassRate: mean(scores.map((s) => (s.verificationPass ? 1 : 0))),
    goldenPass: scores.filter((s) => s.golden).every((s) => s.goldenPass) ? 1 : 0,
  };

  return { scores, summary };
}

export function formatBenchmark(result: Awaited<ReturnType<typeof runBenchmark>>): string {
  const { scores, summary } = result;
  const pct = (n: number) => `${(Number(n) * 100).toFixed(1)}%`;
  const lines = [
    "Action Manifest benchmark",
    `fixtures: ${summary.fixtures} (JP ${summary.jp} / EN ${summary.en})`,
    `Action Recall:      ${pct(Number(summary.actionRecall))}`,
    `Action Precision:   ${pct(Number(summary.actionPrecision))}`,
    `Deadline Accuracy:  ${pct(Number(summary.deadlineAccuracy))}`,
    `Actor Accuracy:     ${pct(Number(summary.actorAccuracy))}`,
    `Modality Accuracy:  ${pct(Number(summary.modalityAccuracy))}`,
    `Evidence Match:     ${pct(Number(summary.evidenceMatch))}`,
    `Hallucination Rate: ${pct(Number(summary.hallucinationRate))}  ← lower is better`,
    `Ambiguity Preserve: ${pct(Number(summary.ambiguityPreservation))}  ← higher is better`,
    `Verifier pass rate: ${pct(Number(summary.verificationPassRate))}`,
    `Golden fixture:     ${summary.goldenPass === 1 ? "PASS" : "FAIL"}`,
    "",
  ];
  for (const s of scores) {
    const mark = s.golden ? (s.goldenPass ? "GOLDEN PASS" : "GOLDEN FAIL") : "";
    lines.push(
      `- ${s.id} [${s.language}/${s.category}] R=${pct(s.recall)} P=${pct(s.precision)} H=${pct(s.hallucinationRate)} A=${pct(s.ambiguityPreservation)} ${mark}`.trim(),
    );
    for (const n of s.notes) lines.push(`    ${n}`);
  }
  return lines.join("\n");
}
