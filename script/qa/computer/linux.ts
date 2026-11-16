#!/usr/bin/env bun
// The Linux live driver: one scenario against a session the driver itself started.
//
//   bun script/qa/computer/linux.ts --session xvfb --scenario xft-dpi-scale --json
//   bun script/qa/computer/linux.ts --session xvfb --all
//
// --all runs every registered scenario and ends with ONE line 'SET linux/<session> pass=<n>
// fail=<n> blocked=<n>': a scenario the session cannot admit (or a session that did not start)
// counts blocked with its reason printed, never pass; exit 1 when any scenario failed, 3 when
// nothing passed and nothing failed (an all-blocked set proves nothing), else 0.
//
// Every session (xvfb, xvfb-nobus, none, xorg) is one file under sessions/ and every
// scenario declares how its session is admitted; a scenario that declares no admission is
// refused, and the driver never connects to a display it did not start. One JSON line per
// scenario, then the cleanup receipts (`procs 0`, `dir REMOVED <path>`); exit 0 iff every
// scenario passed.
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { engineBinary } from "./linux/lib/engine-bin.ts"
import { Engine } from "./linux/lib/engine.ts"
import { Processes } from "./linux/lib/procs.ts"
import { failed, isAdmit, verdict, type Scenario, type SessionName, type Stage } from "./linux/lib/scenario.ts"
import { admission, setExitCode, setLine, type Outcome } from "./linux/lib/set.ts"
import { noDisplay } from "./linux/scenarios/no-display.ts"
import { occluderOracle } from "./linux/scenarios/occluder-oracle.ts"
import { xftDpiScale } from "./linux/scenarios/xft-dpi-scale.ts"
import { start as startNone } from "./linux/sessions/none.ts"
import { start as startXorg } from "./linux/sessions/xorg.ts"
import { start as startXvfbNoBus } from "./linux/sessions/xvfb-nobus.ts"
import { start as startXvfb } from "./linux/sessions/xvfb.ts"

type SessionModule = { start(procs: Processes, runDir: string): Promise<Stage> }

// sway, weston, gnome and kde are owed by rows 52, 53 (DEFERRED-LEGS).
const SESSIONS: Partial<Record<SessionName, SessionModule>> = {
  none: { start: startNone },
  xvfb: { start: startXvfb },
  "xvfb-nobus": { start: startXvfbNoBus },
  xorg: { start: startXorg },
}

const SCENARIOS: Record<string, Scenario> = {
  "xft-dpi-scale": xftDpiScale,
  "occluder-oracle": occluderOracle,
  "no-display": noDisplay,
}

const { values } = parseArgs({
  options: {
    session: { type: "string" },
    scenario: { type: "string", multiple: true, default: [] },
    json: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    engine: { type: "string" },
    workdir: { type: "string" },
  },
})

function usage(message: string): never {
  process.stderr.write(`qa-computer-linux: ${message}\n`)
  process.exit(2)
}

const sessionName = values.session ?? usage("pass --session <name>")
const session = SESSIONS[sessionName as SessionName] ?? usage(`session ${sessionName} is not built yet`)
if (values.all && values.scenario.length > 0) usage("--all runs every scenario; drop --scenario")
const names = values.scenario.length > 0 ? values.scenario : Object.keys(SCENARIOS)
const unknown = names.filter((name) => SCENARIOS[name] === undefined)
if (unknown.length > 0) usage(`unknown scenario(s): ${unknown.join(", ")}`)

const binary = engineBinary(values.engine)
const runRoot = values.workdir ?? tmpdir()
const runId = `r47-${Date.now().toString(36)}-${process.pid}`
const runDir = mkdtempSync(join(runRoot, "omo-computer-qa-"))
const procs = new Processes(runId, process.env)
const outcomes: Outcome[] = []

function report(outcome: Outcome): void {
  if (outcome.kind === "blocked") {
    process.stdout.write(`BLOCKED ${outcome.scenario} ${outcome.reason}\n`)
    return
  }
  const last = outcome.result
  process.stdout.write(`${values.json ? JSON.stringify(last) : `${last.scenario} ${last.session} ${last.verdict}`}\n`)
}

async function startSession(): Promise<{ stage: Stage | undefined; startFailure: string | undefined }> {
  if (!values.all) return { stage: await session.start(procs, runDir), startFailure: undefined }
  try {
    return { stage: await session.start(procs, runDir), startFailure: undefined }
  } catch (error) {
    return { stage: undefined, startFailure: error instanceof Error ? error.message : String(error) }
  }
}

try {
  const { stage, startFailure } = await startSession()
  for (const name of names) {
    const scenario = SCENARIOS[name] ?? usage(`unknown scenario ${name}`)
    if (!isAdmit(scenario.admit)) usage(`scenario ${name} declares no admission`)
    if (scenario.name !== name) usage(`scenario ${name} is registered as ${scenario.name}`)
    const refused = admission(scenario, stage?.session ?? (sessionName as SessionName), startFailure)
    if (stage === undefined || refused !== undefined) {
      const reason = refused ?? `session ${sessionName} gave no stage`
      const outcome: Outcome = values.all
        ? { kind: "blocked", scenario: name, reason }
        : { kind: "ran", result: failed(name, stage?.session ?? (sessionName as SessionName), new Error(reason)) }
      outcomes.push(outcome)
      report(outcome)
      continue
    }
    // OMO_COMPUTER_RUNTIME_DIR is a fake-backend seam: the engine refuses it with a real
    // backend, so a live session passes only the stage's own environment.
    const engine = new Engine(binary, { ...stage.env, OMO_COMPUTER_BACKEND: "x11" })
    let outcome: Outcome
    try {
      outcome = { kind: "ran", result: verdict(name, stage.session, await scenario.run({ procs, stage, engine })) }
    } catch (error) {
      outcome = { kind: "ran", result: failed(name, stage.session, error) }
    } finally {
      await engine.close()
    }
    outcomes.push(outcome)
    report(outcome)
  }
} finally {
  for (const receipt of await procs.stopAll()) {
    if (!values.json) process.stdout.write(`${receipt}\n`)
  }
  if (!values.json) process.stdout.write(`procs ${procs.marked().length}\n`)
  rmSync(runDir, { recursive: true, force: true })
  process.stdout.write(`dir REMOVED ${runDir}\n`)
}

if (values.all) {
  process.stdout.write(`${setLine(sessionName as SessionName, outcomes)}\n`)
  process.exit(setExitCode(outcomes))
}
process.exit(outcomes.every((outcome) => outcome.kind === "ran" && outcome.result.verdict === "PASS") ? 0 : 1)
