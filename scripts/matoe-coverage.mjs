/** Offline compatibility coverage using real deterministic extraction/verification. */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const root = resolve(option('--root', fileURLToPath(new URL('..', import.meta.url))));
const fixtures = resolve(option('--fixtures', 'benchmark/fixtures'));
const pkg = async name => import(pathToFileURL(resolve(root, 'packages', name, 'dist/index.js')).href);
const { PlainTextAdapter } = await pkg('adapters');
const { ActionExtractor, DeterministicProvider } = await pkg('extractor');
const { verifyManifest } = await pkg('verifier');
const { prepareMatoeManifest } = await pkg('consumer');
const rows = [];
const reasons = {};
const unsupported = manifest => [...new Set(manifest.actions.flatMap(action => [
  ...(action.actor.role !== undefined ? ['actor.role'] : []),
  ...(action.temporal?.timezone !== undefined ? ['timezone'] : []),
  ...((action.conditions?.length ?? 0) > 0 ? ['conditions'] : []),
  ...(action.notes !== undefined ? ['notes'] : []),
  ...(action.evidence.length > 1 ? ['multiple-evidence'] : []),
  ...(action.temporal && (action.temporal.type !== 'exact' || action.temporal.precision !== 'day') ? ['rich-temporal'] : []),
  ...((manifest.receipt?.verification?.issues?.length ?? 0) > 0 ? ['verification-issues'] : []),
]))];
for (const lang of readdirSync(fixtures, { withFileTypes: true }).filter(item => item.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
  const dir = resolve(fixtures, lang.name);
  for (const item of readdirSync(dir, { withFileTypes: true }).filter(item => item.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
    const path = resolve(dir, item.name);
    const text = readFileSync(resolve(path, 'input.txt'), 'utf8');
    const id = JSON.parse(readFileSync(resolve(path, 'meta.json'), 'utf8')).id;
    const doc = await new PlainTextAdapter().toCanonical({ kind: 'text', id, text });
    const candidate = await new ActionExtractor(new DeterministicProvider(doc)).extract(doc);
    const { manifest, flags } = verifyManifest(candidate, doc);
    try {
      const bundle = prepareMatoeManifest(manifest, text);
      rows.push({ id, accepted: true, actions: manifest.actions.length, verification_passed: flags.passed, feature_flags: unsupported(manifest), wire_kinds: bundle.manifest.actions.map(action => action.kind) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      reasons[reason] = (reasons[reason] ?? 0) + 1;
      rows.push({ id, accepted: false, actions: manifest.actions.length, verification_passed: flags.passed, feature_flags: unsupported(manifest), reason });
    }
  }
}
const text = '2026年10月15日までに参加票を提出してください。';
const doc = await new PlainTextAdapter().toCanonical({ kind: 'text', id: 'duplicate-probe', text });
const candidate = await new ActionExtractor(new DeterministicProvider(doc)).extract(doc);
candidate.actions[0].evidence.push(globalThis.structuredClone(candidate.actions[0].evidence[0]));
const { manifest } = verifyManifest(candidate, doc);
let duplicateProbe;
try {
  const bundle = prepareMatoeManifest(manifest, text);
  duplicateProbe = { accepted: true, original_evidence: manifest.actions[0].evidence.length, wire_evidence: bundle.manifest.actions[0].evidence.length, audit_evidence: bundle.audit.originalManifest.actions[0].evidence.length };
} catch { duplicateProbe = { accepted: false }; }
process.stdout.write(JSON.stringify({ fixture_count: rows.length, accepted: rows.filter(row => row.accepted).length, refused: rows.filter(row => !row.accepted).length, refusal_reasons: reasons, duplicate_evidence_probe: duplicateProbe, rows }, null, 2) + '\n');
