#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { resolveAdapter } from "@actionmanifest/adapters";
import {
  ActionManifestError,
  validateActionManifest,
  type CanonicalDocument,
} from "@actionmanifest/core";
import {
  ActionExtractor,
  DeterministicProvider,
  OpenAICompatibleProvider,
  type LlmProvider,
} from "@actionmanifest/extractor";
import { exportIcs, exportJson, formatSummary } from "@actionmanifest/exporters";
import { verificationPassed, verifyManifest } from "@actionmanifest/verifier";
import { defaultFixtureRoot, formatBenchmark, runBenchmark } from "./benchmark.js";

function providerFromFlags(name: string | undefined, doc: CanonicalDocument): LlmProvider {
  const id = (name ?? process.env.ACTIONMAN_PROVIDER ?? "deterministic").toLowerCase();
  if (id === "openai" || id === "openai-compatible") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new ActionManifestError(
        "MISSING_API_KEY",
        "OPENAI_API_KEY is required for --provider openai. No silent fallback to another provider.",
      );
    }
    return new OpenAICompatibleProvider({
      apiKey,
      baseUrl: process.env.OPENAI_BASE_URL,
      model: process.env.ACTIONMAN_MODEL ?? "gpt-4o-mini",
      timeoutMs: Number(process.env.ACTIONMAN_TIMEOUT_MS ?? 30_000),
      maxRetries: Number(process.env.ACTIONMAN_MAX_RETRIES ?? 0),
    });
  }
  return new DeterministicProvider(doc);
}

const program = new Command();
program.name("actionman").description("Turn documents into actions you can verify.").version("0.1.0");

program
  .command("extract")
  .argument("<file>", "plain-text document path")
  .option("--json", "write JSON to stdout")
  .option("--ics <file>", "write iCalendar (VEVENT/VTODO) to a file")
  .option("--out <file>", "write JSON manifest to a file")
  .option("--provider <name>", "deterministic | openai", "deterministic")
  .option("--skip-verify", "do not run the deterministic verifier")
  .action(async (file: string, opts: { json?: boolean; ics?: string; out?: string; provider?: string; skipVerify?: boolean }) => {
    try {
      const adapter = resolveAdapter({ kind: "path", path: resolve(file) });
      const doc = await adapter.toCanonical({ kind: "path", path: resolve(file) });
      const provider = providerFromFlags(opts.provider, doc);
      const extractor = new ActionExtractor(provider);
      let manifest = await extractor.extract(doc);
      if (!opts.skipVerify) {
        manifest = verifyManifest(manifest, doc).manifest;
      }
      if (opts.out) await writeFile(opts.out, exportJson(manifest), "utf8");
      if (opts.ics) await writeFile(opts.ics, exportIcs(manifest), "utf8");
      if (opts.json) {
        process.stdout.write(exportJson(manifest));
      } else {
        process.stdout.write(formatSummary(manifest) + "\n");
      }
      const flags = manifest.receipt?.verification;
      if (flags && !verificationPassed(flags)) {
        process.exitCode = 2;
      }
    } catch (e) {
      fail(e);
    }
  });

program
  .command("validate")
  .argument("<manifest>", "manifest JSON path")
  .option("--doc <file>", "source document for evidence checks")
  .action(async (manifestPath: string, opts: { doc?: string }) => {
    try {
      const raw = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
      const manifest = validateActionManifest(raw);
      if (opts.doc) {
        const adapter = resolveAdapter({ kind: "path", path: resolve(opts.doc) });
        const doc = await adapter.toCanonical({ kind: "path", path: resolve(opts.doc) });
        const { flags } = verifyManifest(manifest, doc);
        const ok = verificationPassed(flags);
        process.stdout.write(JSON.stringify({ ok, flags }, null, 2) + "\n");
        if (!ok) process.exitCode = 2;
      } else {
        process.stdout.write("schema: PASS\n");
      }
    } catch (e) {
      fail(e);
    }
  });

program
  .command("benchmark")
  .option("--fixtures <dir>", "fixture root")
  .option("--smoke", "run a small subset (CI)")
  .option("--json", "machine-readable summary")
  .action(async (opts: { fixtures?: string; smoke?: boolean; json?: boolean }) => {
    try {
      const root = opts.fixtures ?? (await defaultFixtureRoot());
      const result = await runBenchmark(root, Boolean(opts.smoke));
      if (opts.json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      else process.stdout.write(formatBenchmark(result) + "\n");
      if (result.summary.goldenPass !== 1) process.exitCode = 2;
    } catch (e) {
      fail(e);
    }
  });

function fail(e: unknown): never {
  if (e instanceof ActionManifestError) {
    console.error(`${e.code}: ${e.message}`);
  } else if (e instanceof Error) {
    console.error(e.message);
  } else {
    console.error(String(e));
  }
  process.exit(1);
}

program.parseAsync(process.argv);
