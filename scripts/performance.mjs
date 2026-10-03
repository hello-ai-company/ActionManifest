/** Offline, synthetic, warmed latency/retained-memory probe. No external providers. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const root = resolve(option('--root', fileURLToPath(new URL('..', import.meta.url))));
const samples = Number(option('--samples', '21'));
if (!Number.isInteger(samples) || samples < 5 || samples > 101) throw new Error('--samples must be 5..101');
const cases = { short: { actions: 1, padding: 0 }, notice: { actions: 32, padding: 0 }, many: { actions: 128, padding: 0 }, long: { actions: 64, padding: 45000 } };
const digest = value => createHash('sha256').update(value).digest('hex');
const fingerprint = value => digest(JSON.stringify(value, (key, val) => ['checked_at', 'created_at'].includes(key) ? '<timestamp>' : val));
const worker = args.includes('--worker');

if (!worker) {
  const results = [];
  for (const name of Object.keys(cases)) {
    for (const stage of ['verify', 'matoe', 'pipeline']) {
      results.push(JSON.parse(execFileSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--worker', '--root', root, '--case', name, '--stage', stage, '--samples', String(samples)], { encoding: 'utf8' })));
    }
  }
  process.stdout.write(JSON.stringify({ probe_version: 2, node: process.version, platform: process.platform, cpu: cpus()[0]?.model, samples, warmup: 5, root, results }, null, 2) + '\n');
} else {
  if (!globalThis.gc) throw new Error('worker requires --expose-gc');
  const name = option('--case');
  const stage = option('--stage');
  const config = cases[name];
  if (!config || !['verify', 'matoe', 'pipeline'].includes(stage)) throw new Error('unknown case/stage');
  const pkg = async name => import(pathToFileURL(resolve(root, 'packages', name, 'dist/index.js')).href);
  const { PlainTextAdapter } = await pkg('adapters');
  const { ActionExtractor, DeterministicProvider } = await pkg('extractor');
  const { verifyManifest } = await pkg('verifier');
  const { prepareMatoeManifest } = await pkg('consumer');
  const { sha256Hex } = await pkg('core');
  const rows = Array.from({ length: config.actions }, (_, i) => `2026年10月15日までに参加票${i + 1}を提出してください。`);
  const text = rows.join('\n') + '\n' + '資料の補足。'.repeat(Math.floor(config.padding / 6));
  const adapter = new PlainTextAdapter();
  const doc = await adapter.toCanonical({ kind: 'text', id: `perf-${name}`, text });
  const manifest = {
    schema_version: '0.2.0', source: { id: doc.id, hash: sha256Hex(text) },
    actions: rows.map((quote, i) => ({ id: `act_${i}`, kind: 'submit', title: `参加票${i + 1}を提出する`, modality: 'required', actor: { certainty: 'unknown' }, temporal: { type: 'exact', precision: 'day', date: '2026-10-15', raw_text: '2026年10月15日まで' }, evidence: [{ source_id: doc.id, page: 1, text: quote }], inference: 'explicit', status: 'proposed' })),
    receipt: { extraction: { provider: 'deterministic', model: 'performance-synthetic', extractor_version: '0.1.0', schema_version: '0.2.0', created_at: '2026-10-02T00:00:00Z' } },
  };
  const verified = verifyManifest(manifest, doc).manifest;
  const run = async () => {
    if (stage === 'verify') return verifyManifest(manifest, doc);
    if (stage === 'matoe') return prepareMatoeManifest(verified, text);
    const document = await adapter.toCanonical({ kind: 'text', id: doc.id, text });
    const extracted = await new ActionExtractor(new DeterministicProvider(document)).extract(document);
    return verifyManifest(extracted, document);
  };
  for (let i = 0; i < 5; i++) await run();
  globalThis.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const times = [];
  let output;
  for (let i = 0; i < samples; i++) {
    globalThis.gc(); // excluded from the elapsed operation; identical conditions
    const start = performance.now();
    output = await run();
    times.push(performance.now() - start);
  }
  globalThis.gc();
  const heapAfter = process.memoryUsage().heapUsed;
  times.sort((a, b) => a - b);
  process.stdout.write(JSON.stringify({ case: name, stage, actions: config.actions, source_scalars: Array.from(text).length, source_bytes: Buffer.byteLength(text), input_fingerprint: fingerprint({ manifest, doc }), output_fingerprint: fingerprint(output), median_ms: times[Math.floor(times.length / 2)], p95_ms: times[Math.ceil(times.length * .95) - 1], heap_before_gc_bytes: heapBefore, heap_after_gc_bytes: heapAfter, post_gc_heap_delta_bytes: heapAfter - heapBefore, process_peak_rss_kib: process.resourceUsage().maxRSS, samples }) + '\n');
}
