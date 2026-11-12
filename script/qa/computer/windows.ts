#!/usr/bin/env bun
// The live Windows driver of computer use v3: one scenario against the real engine on the Windows
// backend, each fact read back by an independent PowerShell observer.
//
//   bun script/qa/computer/windows.ts --scenario <name> [--engine <omo-computer-engine.exe>] [--json]
//
// A scenario is script/qa/computer/windows/<name>.ts exporting `scenario` with its admission:
// `admit:"os"` (the OS stop listener is the stop path), `admit:"host-relay"` (this driver is the
// host: StopPolicy{allowHostRelayOnly} and a 500 ms heartbeat on its own connection, background
// only) or `admit:"none"` (no listener and no relay; the scenario sends no input). A scenario that
// declares none of the three is refused. Prints one JSON line with "verdict":"PASS" or "FAIL",
// then the cleanup receipts (`procs <n>`, `window CLOSED <title>`). Exit 0 on PASS, 1 on FAIL,
// 2 on a setup error.
import { resolve } from "node:path"

import { openEngine } from "./windows/engine.ts"
import { ADMISSIONS, type Admission, lastRegistered, type Scenario } from "./windows/scenario.ts"

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

async function load(name: string): Promise<Scenario> {
  if (!/^[a-z0-9-]+$/.test(name)) fail(`scenario name ${name} is not a file name`)
  await import(resolve(import.meta.dir, "windows", `${name}.ts`))
  const scenario = lastRegistered()
  if (scenario === undefined) fail(`${name} registers no scenario`)
  if (scenario.name !== name) fail(`${name} registered the scenario ${scenario.name}`)
  if (!ADMISSIONS.includes(scenario.admit as Admission)) fail(`${name} declares no admission (os, host-relay or none)`)
  return scenario
}

const name = argument("--scenario") ?? fail("--scenario <name> is required")
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
