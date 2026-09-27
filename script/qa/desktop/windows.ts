// Windows live QA driver for senpi-desktop-engine, run by .github/workflows/desktop-windows-qa.yml
// on windows-latest (an interactive desktop).
//
//   bun script/qa/desktop/windows.ts --all --json [--engine <exe>] [--out <file.jsonl>]
//   bun script/qa/desktop/windows.ts --scenario <name> [--sabotage invalid-chord]
//
// One JSONL line per scenario `{scenario, pass, reason?, facts, observer: {before, after}}`, every
// desktop fact read by an independent PowerShell observer; teardown receipts are the last lines.
// Exits 0 iff every scenario passed and the teardown left no process or temp dir behind.
import { appendFileSync, existsSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

import { QaWorkspace } from "./windows/fixtures"
import { SABOTAGE_MODES, type Sabotage, type Scenario, type ScenarioOutcome } from "./windows/scenario-kit"
import {
  backgroundPostMessageNotepad,
  backgroundPostMessageWpf,
  foregroundTypeRestoresFront,
} from "./windows/scenarios-delivery"
import { elevatedWindowRefused, hotkeyLatches } from "./windows/scenarios-guard"
import { capturePrimary, uiaSnapshotNotepad } from "./windows/scenarios-read"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const DEFAULT_ENGINE = join(REPO_ROOT, "target", "x86_64-pc-windows-msvc", "release", "senpi-desktop-engine.exe")

const SCENARIOS: readonly Scenario[] = [
  capturePrimary,
  foregroundTypeRestoresFront,
  backgroundPostMessageNotepad,
  backgroundPostMessageWpf,
  elevatedWindowRefused,
  uiaSnapshotNotepad,
  hotkeyLatches,
]

const USAGE = `usage: windows.ts (--all | --scenario <name>...) [--json] [--engine <exe>] [--out <file>] [--sabotage <mode>]
scenarios: ${SCENARIOS.map((scenario) => scenario.name).join(", ")}
sabotage modes: ${SABOTAGE_MODES.join(", ")} (flips hotkey-latches to pass:false)`

function fail(message: string): never {
  console.error(`${message}\n${USAGE}`)
  process.exit(2)
}

function parseSabotage(value: string | undefined): Sabotage | undefined {
  if (value === undefined) return undefined
  return SABOTAGE_MODES.find((candidate) => candidate === value) ?? fail(`unknown --sabotage mode '${value}'`)
}

const { values } = parseArgs({
  options: {
    all: { type: "boolean", default: false },
    scenario: { type: "string", multiple: true, default: [] },
    json: { type: "boolean", default: false },
    engine: { type: "string", default: DEFAULT_ENGINE },
    out: { type: "string" },
    sabotage: { type: "string" },
    help: { type: "boolean", default: false },
  },
})

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}
const sabotage = parseSabotage(values.sabotage)
const unknown = values.scenario.filter((name) => !SCENARIOS.some((scenario) => scenario.name === name))
if (unknown.length > 0) fail(`unknown scenario(s): ${unknown.join(", ")}`)
const selected = values.all ? SCENARIOS : SCENARIOS.filter((scenario) => values.scenario.includes(scenario.name))
if (selected.length === 0) fail("select --all or at least one --scenario")
if (process.platform !== "win32") {
  fail(`the Windows desktop QA driver runs on win32 only (this host: ${process.platform})`)
}
const binary = resolve(values.engine)
if (!existsSync(binary)) fail(`engine binary not found: ${binary}`)

const out = values.out === undefined ? undefined : resolve(values.out)
if (out !== undefined) writeFileSync(out, "")

function emit(line: Record<string, unknown>, human: string): void {
  const json = JSON.stringify(line)
  if (out !== undefined) appendFileSync(out, `${json}\n`)
  console.log(values.json ? json : human)
}

function driverError(error: unknown): ScenarioOutcome {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  return { pass: false, reason: "driver-error", facts: { error: message }, observer: { before: null, after: null } }
}

const workspace = new QaWorkspace()
let passed = true
try {
  for (const scenario of selected) {
    const outcome = await scenario.run({ binary, workspace, sabotage }).catch(driverError)
    passed &&= outcome.pass
    const verdict = outcome.pass ? "PASS" : `FAIL (${outcome.reason ?? "unknown"})`
    emit(
      { scenario: scenario.name, ...(sabotage === undefined ? {} : { sabotage }), ...outcome },
      `${verdict} ${scenario.name}`,
    )
  }
} finally {
  const receipts = workspace.teardown()
  for (const receipt of receipts) emit({ teardown: receipt }, `teardown: ${receipt}`)
  const clean = receipts.includes("procs 0") && receipts.some((receipt) => receipt.startsWith("dir REMOVED"))
  process.exitCode = passed && clean ? 0 : 1
}
