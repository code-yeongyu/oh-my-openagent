#!/usr/bin/env bun
/**
 * Run the cross-surface thread-tool QA scenarios in sequence and exit non-zero if any of them fails.
 * The scripts are run one at a time on purpose: each one owns its ports, sockets and pty terminals,
 * and running them concurrently would make resource allocation the thing under test.
 *
 * Two suites:
 * - `gateway` (todo 16): real pty OmO TUIs, shard hosts and the `omo` CLI on the RELEASED engine
 *   (`lib/gateway.mjs`; `THREAD_QA_SENPI_VERSION`, default 2026.9.29-5). Needs only bun, node and the
 *   network for the first kit install.
 * - `legacy` (task 13/14): the thread components driven from source against a senpi SOURCE checkout
 *   (`THREAD_QA_SENPI_ROOT`) and a desktop checkout (`THREAD_QA_DESKTOP_ROOT`), via `lib/harness.mjs`.
 *   A legacy scenario whose checkouts are unset, absent, not installed or not built is reported
 *   `SKIP` with the missing path, never silently dropped.
 *
 * Usage: bun packages/omo-senpi/scripts/qa/thread-tools/run-all.mjs [--suite gateway|legacy|all]
 *        [--out-dir <dir>] [--with-mutant] [--keep-kit]
 *   --with-mutant  also run `loop-guard.mjs --mutant` (cycle check disabled) and require it to FAIL
 *   --keep-kit     keep the released-engine kit dir (default: removed after the gateway suite)
 * Lines starting `DEFECT` are product defects a scenario detected; they are counted in the summary.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const omoRoot = resolve(here, "..", "..", "..", "..", "..")
// The legacy checkouts have no portable default location; the legacy suite is SKIPPED until both are set.
const senpiRoot = process.env.THREAD_QA_SENPI_ROOT
const desktopRoot = process.env.THREAD_QA_DESKTOP_ROOT
const kitDir = process.env.THREAD_QA_KIT_DIR ?? "/tmp/qa-thread-tools-kit"

const gateway = [
  ["tui-to-tui", "tui-to-tui.mjs"],
  ["host-to-tui", "host-to-tui.mjs"],
  ["repeated-wake", "repeated-wake.mjs"],
  ["offline-queue", "offline-queue.mjs"],
  ["stopped-target", "stopped-target.mjs"],
  ["sender-death", "sender-death.mjs"],
  ["held-then-exit", "held-then-exit.mjs"],
  ["receiver-crash", "receiver-crash.mjs"],
  ["loop-guard", "loop-guard.mjs"],
  ["lost-ack", "lost-ack.mjs"],
  ["adopt", "adopt.mjs"],
  ["draft-preservation", "draft-preservation.mjs"],
  ["binding-author", "binding-author.mjs"],
  ["report-origin", "report-origin.mjs"],
  ["report-origin-steer", "report-origin-steer.mjs"],
]

const legacy = [
  ["cli-surface", "cli-surface.mjs"],
  ["desktop-client", "desktop-client.mjs"],
  ["terminal-to-ui", "terminal-to-ui.mjs"],
  ["desktop-to-cli", "desktop-to-cli.mjs"],
  ["plugin-surface", "plugin-surface.mjs"],
  ["session-control", "session-control-qa.mjs"],
]

function option(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const suite = option("--suite") ?? "all"
const outDir = option("--out-dir")
if (outDir !== undefined) mkdirSync(outDir, { recursive: true })

/**
 * What a legacy scenario needs on disk before it can run at all. A checkout that exists but was
 * never installed or built would otherwise fail every scenario at import time, so each unmet
 * precondition is named with the step that satisfies it.
 */
function legacyMissing() {
  const unset = [
    ["THREAD_QA_SENPI_ROOT", senpiRoot, "a senpi source checkout"],
    ["THREAD_QA_DESKTOP_ROOT", desktopRoot, "a desktop checkout"],
  ].filter(([, value]) => value === undefined)
  if (unset.length > 0) return unset.map(([name, , what]) => `${name} (unset: the path of ${what})`)
  const needed = [
    [join(senpiRoot, "packages", "coding-agent", "scripts", "qa-app-server", "lib", "env.mjs"), "senpi source checkout"],
    [join(senpiRoot, "node_modules"), "senpi checkout not installed: bun install"],
    ...["ai", "agent", "tui"].map((pkg) => [join(senpiRoot, "packages", pkg, "dist", "index.js"), "senpi checkout not built: bun run build"]),
    [desktopRoot, "desktop checkout"],
    [join(omoRoot, "node_modules"), "omo checkout not installed: bun install"],
  ]
  const missing = needed.filter(([path]) => !existsSync(path)).map(([path, why]) => `${path} (${why})`)
  // Checked on disk rather than through `require.resolve`: bun resolves a missing package from its
  // global install cache, so resolution succeeds even for a checkout that was never installed.
  const desktopEffect = [join(desktopRoot, "node_modules", "effect"), join(desktopRoot, "apps", "server", "node_modules", "effect")]
  if (existsSync(desktopRoot) && !desktopEffect.some((path) => existsSync(join(path, "package.json")))) {
    missing.push(`${join(desktopRoot, "node_modules")} (desktop checkout not installed: bun install)`)
  }
  return missing
}

const results = []
function runOne(name, file, extraArgs = []) {
  process.stdout.write(`\n===== ${name} =====\n`)
  const args = [process.execPath, join(here, file), ...extraArgs]
  const outFile = outDir === undefined ? undefined : join(outDir, `${name}.txt`)
  if (outFile !== undefined) args.push("--out", outFile, "--evidence-dir", join(outDir, name))
  const child = Bun.spawnSync(args, { stdout: "inherit", stderr: "inherit" })
  let text = ""
  if (outFile !== undefined) {
    try {
      text = readFileSync(outFile, "utf8")
    } catch {
      // No out file (scenario crashed before writing).
    }
  }
  const count = (pattern) => (text.match(pattern) ?? []).length
  const result = { name, code: child.exitCode, skipped: count(/^SKIP /gm), defects: count(/^DEFECT /gm), receipt: /PASS \S+\/cleanup-no-leftovers/.test(text) }
  results.push(result)
  process.stdout.write(`----- ${name} exit=${result.code} skipped=${result.skipped} defects=${result.defects} -----\n`)
  return result
}

if (suite === "gateway" || suite === "all") {
  for (const [name, file] of gateway) runOne(name, file)
  if (process.argv.includes("--with-mutant")) {
    const mutant = runOne("loop-guard-mutant", "loop-guard.mjs", ["--mutant"])
    // The mutant must FAIL: that is what proves loop-guard can fail. A green mutant is the failure.
    mutant.code = mutant.code === 0 ? 1 : 0
    mutant.expectedFailure = true
  }
  if (!process.argv.includes("--keep-kit")) rmSync(kitDir, { recursive: true, force: true })
}
if (suite === "legacy" || suite === "all") {
  const missing = legacyMissing()
  for (const [name, file] of legacy) {
    if (missing.length > 0) {
      results.push({ name, code: 0, skipped: 1, defects: 0, skippedScenario: true })
      process.stdout.write(`SKIP ${name} legacy preconditions missing: ${missing.join(", ")}\n`)
      continue
    }
    runOne(name, file)
  }
}

process.stdout.write("\n===== summary =====\n")
for (const result of results) {
  const status = result.skippedScenario ? "SKIP" : result.code === 0 ? "PASS" : "FAIL"
  process.stdout.write(`${status} ${result.name} exit=${result.code} skipped=${result.skipped} defects=${result.defects}${result.expectedFailure ? " (mutant: failing is the pass)" : ""}\n`)
}
const failed = results.filter((result) => result.code !== 0)
const skippedScenarios = results.filter((result) => result.skippedScenario).length
const defects = results.reduce((sum, result) => sum + result.defects, 0)
process.stdout.write(`${failed.length === 0 ? "PASS" : "FAIL"} run-all failed_scenarios=${failed.length} skipped_scenarios=${skippedScenarios} skipped_checks=${results.reduce((sum, result) => sum + result.skipped, 0)} product_defects=${defects}\n`)
process.exit(failed.length === 0 ? 0 : 1)
