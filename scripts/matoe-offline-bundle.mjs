/** Local-only transfer artifact: actual compiled code, no npm/network/upload. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(process.argv[2] ?? '/tmp/actionmanifest-matoe-v02.tar.gz');
if (existsSync(output)) throw new Error('Refusing to overwrite an existing artifact');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Build/check/commit first: bundle requires a clean checkout');
const head = git('rev-parse', 'HEAD');
const baseline = '607791a';
const publishedBase = '18c159c0bbb238b410c003cc8e60e7a8e013309f';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const work = mkdtempSync(join(tmpdir(), 'am-matoe-bundle-'));
const packages = [];
const seen = new Set();
const internal = name => join(repo, name === '@actionmanifest/cli' ? 'apps/cli' : `packages/${name.slice('@actionmanifest/'.length)}`);

function locateDependency(name, from) {
  if (name.startsWith('@actionmanifest/')) return internal(name);
  const require = createRequire(join(from, 'package.json'));
  try { return dirname(require.resolve(`${name}/package.json`)); }
  catch {
    let dir = dirname(require.resolve(name));
    while (dir !== dirname(dir)) {
      const path = join(dir, 'package.json');
      if (existsSync(path) && JSON.parse(readFileSync(path, 'utf8')).name === name) return dir;
      dir = dirname(dir);
    }
    throw new Error(`Cannot resolve installed dependency: ${name}`);
  }
}

function addPackage(name, from) {
  if (seen.has(name)) return;
  seen.add(name);
  const source = realpathSync(from);
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  if (manifest.name !== name) throw new Error('Installed dependency identity mismatch');
  const dest = join(work, 'node_modules', name);
  mkdirSync(dest, { recursive: true });
  if (name.startsWith('@actionmanifest/')) {
    if (!existsSync(join(source, 'dist/index.js'))) throw new Error('Build artifacts are missing');
    cpSync(join(source, 'dist'), join(dest, 'dist'), { recursive: true });
    cpSync(join(source, 'package.json'), join(dest, 'package.json'));
    for (const file of ['LICENSE', 'NOTICE']) cpSync(join(repo, file), join(dest, file));
    if (name === '@actionmanifest/schema') cpSync(join(source, 'schemas'), join(dest, 'schemas'), { recursive: true });
  } else {
    // Installed third-party bytes, excluding their nested dependency symlinks.
    cpSync(source, dest, { recursive: true, dereference: true,
      filter: path => !relative(source, path).split(sep).includes('node_modules') });
  }
  packages.push({ name, version: manifest.version, license: manifest.license ?? 'see package license files', internal: name.startsWith('@actionmanifest/') });
  for (const dependency of Object.keys(manifest.dependencies ?? {})) addPackage(dependency, locateDependency(dependency, source));
}

try {
  addPackage('@actionmanifest/cli', internal('@actionmanifest/cli'));
  mkdirSync(join(work, 'source'));
  const scoped = ['AGENTS.md', 'LICENSE', 'NOTICE', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json',
    'docs/MATOE-SERVER-V02.md', 'docs/MATOE-COMPATIBILITY.md', 'docs/MATOE-DESIGN-HANDOFF.md',
    'scripts/matoe-offline-bundle.mjs', 'integration/reference-consumer/test/matoe-v02.test.ts'];
  for (const pkg of packages.filter(item => item.internal)) {
    const dir = relative(repo, internal(pkg.name));
    scoped.push(`${dir}/src`, `${dir}/package.json`, `${dir}/tsconfig.json`);
    if (pkg.name === '@actionmanifest/schema') scoped.push(`${dir}/schemas`);
    if (pkg.name === '@actionmanifest/consumer') scoped.push(`${dir}/fixtures/matoe-v02`);
  }
  const sourceTar = join(work, 'source.tar');
  execFileSync('git', ['archive', '--format=tar', '--output', sourceTar, head, ...scoped], { cwd: repo });
  execFileSync('tar', ['-xf', sourceTar, '-C', join(work, 'source')]);
  rmSync(sourceTar);
  cpSync(join(repo, 'packages/consumer/fixtures/matoe-v02'), join(work, 'fixtures'), { recursive: true });
  cpSync(join(repo, 'docs/MATOE-SERVER-V02.md'), join(work, 'CONTRACT.md'));
  writeFileSync(join(work, 'verify-bundle.mjs'), `import { readFileSync, lstatSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, 'MANIFEST.json'), 'utf8'));
for (const [name, hash] of Object.entries(manifest.files)) {
 const file = resolve(root, name);
 if (!file.startsWith(root + sep) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('Unsafe artifact path');
 if (createHash('sha256').update(readFileSync(file)).digest('hex') !== hash) throw new Error('Artifact hash mismatch');
}
function walk(dir) { for (const name of readdirSync(dir)) {
 const file = resolve(dir, name); const stat = lstatSync(file);
 if (stat.isSymbolicLink()) throw new Error('Symlink is not allowed');
 if (stat.isDirectory()) walk(file);
 else if (relative(root, file) !== 'MANIFEST.json' && !Object.hasOwn(manifest.files, relative(root, file))) throw new Error('Unlisted artifact file');
} }
walk(root);
console.log('VERIFY PASS', manifest.commit, Object.keys(manifest.files).length);
`);
  writeFileSync(join(work, 'smoke.mjs'), `import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { prepareMatoeV02Manifest, classifyManifest } from '@actionmanifest/consumer';
const read = name => readFileSync(new URL('fixtures/' + name, import.meta.url), 'utf8');
const request = JSON.parse(read('request.json'));
const cli = fileURLToPath(new URL('node_modules/@actionmanifest/cli/dist/index.js', import.meta.url));
const run = spawnSync(process.execPath, [cli, 'analyze-matoe', '--stdin-json'], { input: JSON.stringify(request), encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', ACTIONMAN_PROVIDER: 'openai', OPENAI_API_KEY: '', OPENAI_BASE_URL: 'http://127.0.0.1:1/must-not-call' } });
strictEqual(run.status, 0); strictEqual(run.stderr, '');
const wire = JSON.parse(run.stdout);
wire.receipt.extraction.created_at = '2026-10-03T00:00:00.000Z';
wire.receipt.verification.checked_at = '2026-10-03T00:00:00.000Z';
deepStrictEqual(wire, JSON.parse(read('golden.json')));
const mixed = prepareMatoeV02Manifest(JSON.parse(read('mixed.json')), request.ocrText, request.sourceId);
deepStrictEqual(classifyManifest(mixed).counts, { ready: 3, blocked: 1, review_required: 0 });
for (const name of ['negative-hash', 'negative-version', 'negative-approved', 'negative-summary']) {
 let rejected = false;
 try { prepareMatoeV02Manifest(JSON.parse(read(name + '.json')), request.ocrText, request.sourceId); } catch { rejected = true; }
 strictEqual(rejected, true);
}
console.log('SMOKE PASS: actual offline CLI golden; mixed blocked; 4 negatives');
`);
  writeFileSync(join(work, 'README.md'), `# ActionManifest → Matoe offline handoff\n\nCommit: ${head}\nPublished base: ${publishedBase}\nPrevious local checkpoint: ${baseline}\n\nNode 24.19.0 used for validation; Node >=20 runtime required. Node is not included.\nNo installation or network access required. Unpack into a NEW directory after checking the archive SHA.\n\nRun from that directory:\n\n\`\`\`sh\nnode verify-bundle.mjs\nnode smoke.mjs\nnode node_modules/@actionmanifest/cli/dist/index.js analyze-matoe --stdin-json < fixtures/request.json\n\`\`\`\n\nPoint the explicit Python route at the absolute CLI path above and pass only sourceId/ocrText on stdin. Keep legacy /v1/analysis unchanged; no automatic fallback. Full wire/error/review contract: CONTRACT.md. Failed mixed Actions are BLOCKED, never automatically adopted.\n\nThis is actual compiled workspace code plus its installed runtime dependency closure, not a mock or an npm release. Package version labels are unchanged; commit + hashes identify this unpublished build. Source is included under source/. Other CLI benchmark/conformance assets and native OCR adapters are not included.\n\nNo .git, environment/config credentials, real documents or user records are included. Fixtures are authored synthetic notices. Only the specifically authorized private Library transfer is allowed; this script performs no upload/push/publication.\n`);
  const hashes = {};
  const forbiddenName = /^(?:\.git|\.env(?:\..*)?|\.npmrc|\.aws|\.codex|auth\.json)$/;
  const credentialValue = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9_-]{20,})/;
  function inspect(dir) {
    for (const name of readdirSync(dir).sort()) {
      if (forbiddenName.test(name)) throw new Error('Forbidden configuration/secret path in artifact');
      const path = join(dir, name); const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('Artifact contains a symlink');
      if (stat.isDirectory()) inspect(path);
      else {
        const bytes = readFileSync(path);
        if (credentialValue.test(bytes.toString('utf8'))) throw new Error('Credential-shaped value in artifact; inspect locally');
        hashes[relative(work, path)] = digest(bytes);
      }
    }
  }
  inspect(work);
  writeFileSync(join(work, 'MANIFEST.json'), JSON.stringify({ format: 'actionmanifest-matoe-offline/1', commit: head, published_base: publishedBase, previous_local_checkpoint: git('rev-parse', baseline), node_tested: process.version, packages, files: hashes, exclusions: ['Node executable', '.git', 'environment/credential files', 'real documents/PII', 'native OCR', 'benchmark/conformance assets'], secret_scan: 'allowlisted scope + forbidden paths + credential-shaped value scan passed' }, null, 2) + '\n');
  execFileSync(process.execPath, [join(work, 'verify-bundle.mjs')], { stdio: 'pipe' });
  execFileSync(process.execPath, [join(work, 'smoke.mjs')], { cwd: work, stdio: 'pipe' });
  execFileSync('tar', ['-czf', output, '-C', work, '.']);
  const bytes = readFileSync(output);
  process.stdout.write(JSON.stringify({ artifact: output, sha256: digest(bytes), bytes: bytes.length, commit: head, files: Object.keys(hashes).length, packages: packages.map(pkg => `${pkg.name}@${pkg.version}`), secret_scan: 'PASS', verify: 'PASS', smoke: 'PASS' }, null, 2) + '\n');
} finally { rmSync(work, { recursive: true, force: true }); }
