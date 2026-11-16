#!/usr/bin/env bun
// The live Windows driver of computer use v3: one scenario against the real engine on the Windows
// backend, each fact read back by an independent PowerShell observer.
//
//   bun script/qa/computer/windows.ts --scenario <name> [--engine <omo-computer-engine.exe>] [--json]
//   bun script/qa/computer/windows.ts --all [--engine <omo-computer-engine.exe>]
//
// A scenario is script/qa/computer/windows/<name>.ts that registers itself (`register()`) with its admission:
// `admit:"os"` (the OS stop listener is the stop path), `admit:"host-relay"` (this driver is the
// host: StopPolicy{allowHostRelayOnly} and a 500 ms heartbeat on its own connection, background
// only) or `admit:"none"` (no listener and no relay; the scenario sends no input). A scenario that
// declares none of the three is refused. Prints one JSON line with "verdict":"PASS" or "FAIL",
// then the cleanup receipts (`procs <n>`, `window CLOSED <title>`). Exit 0 on PASS, 1 on FAIL,
// 2 on a setup error. --all runs every registered scenario: a scenario whose precondition refuses
// on this host prints 'BLOCKED <name> <reason>' and does not run; the last line is
// 'SET windows pass=<n> fail=<n> blocked=<n>'; exit 1 when fail > 0.
import { readdir } from "node:fs/promises"
import { resolve } from "node:path"

import { openEngine } from "./windows/engine.ts"
import { allRegistered, refusal, type Scenario } from "./windows/scenario.ts"
import { runAll } from "./windows/set.ts"

const ROOT = resolve(import.meta.dir, "../../..")
const DEFAULT_ENGINE = resolve(ROOT, "target/x86_64-pc-windows-msvc/release/omo-computer-engine.exe")

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function fail(why: string): never {
  console.log(JSON.stringify({ verdict: "ERROR", why }))
  process.exit(2)
}

/** Imports one scenario file and answers what it registered, refused by the same checks as --all. */
async function importFile(file: string, helpersAllowed: boolean): Promise<readonly Scenario[]> {
  const before = allRegistered().length
  await import(resolve(import.meta.dir, "windows", `${file}.ts`))
  const added = allRegistered().slice(before)
  const why = refusal(file, added, { helpersAllowed })
  if (why !== undefined) fail(why)
  return added
}

async function load(name: string): Promise<Scenario> {
  if (!/^[a-z0-9-]+$/.test(name)) fail(`scenario name ${name} is not a file name`)
  const [scenario] = await importFile(name, false)
  return scenario ?? fail(`${name} registers no scenario`)
}

/** Runs one scenario against a fresh engine: prints its JSON line and receipts, answers PASS. */
async function runScenario(scenario: Scenario): Promise<boolean> {
  const engine = await openEngine(argument("--engine") ?? DEFAULT_ENGINE, scenario.admit)
  let facts: Record<string, unknown> = {}
  let scenarioReceipts: readonly string[] = []
  let verdict: "PASS" | "FAIL" = "FAIL"
  try {
    const outcome = await scenario.run(engine)
    facts = outcome.facts
    scenarioReceipts = outcome.receipts
    verdict = outcome.pass ? "PASS" : "FAIL"
  } catch (error) {
    facts = { error: error instanceof Error ? error.message : String(error) }
  } finally {
    const receipts = await engine.close()
    console.log(JSON.stringify({ scenario: scenario.name, admit: scenario.admit, verdict, ...facts }))
    for (const receipt of [...receipts, ...scenarioReceipts]) console.log(receipt)
  }
  return verdict === "PASS"
}

if (process.argv.includes("--all")) {
  const dir = resolve(import.meta.dir, "windows")
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort()) {
    await importFile(file.slice(0, -".ts".length), true)
  }
  const scenarios = allRegistered()
  const summary = await runAll(
    scenarios,
    async (name) => runScenario(scenarios.find((scenario) => scenario.name === name) ?? fail(`${name} vanished`)),
    (line) => console.log(line),
  )
  process.exit(summary.exitCode)
}

const name = argument("--scenario") ?? fail("--scenario <name> or --all is required")
const scenario = await load(name)
const engine = await openEngine(argument("--engine") ?? DEFAULT_ENGINE, scenario.admit)
let facts: Record<string, unknown> = {}
let scenarioReceipts: readonly string[] = []
let verdict: "PASS" | "FAIL" = "FAIL"
try {
  const outcome = await scenario.run(engine)
  facts = outcome.facts
  scenarioReceipts = outcome.receipts
  verdict = outcome.pass ? "PASS" : "FAIL"
} catch (error) {
  facts = { error: error instanceof Error ? error.message : String(error) }
} finally {
  const receipts = await engine.close()
  console.log(JSON.stringify({ scenario: name, admit: scenario.admit, verdict, ...facts }))
  for (const receipt of [...receipts, ...scenarioReceipts]) console.log(receipt)
}
process.exit(verdict === "PASS" ? 0 : 1)
