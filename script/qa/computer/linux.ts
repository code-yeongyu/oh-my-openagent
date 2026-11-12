#!/usr/bin/env bun
// The Linux live driver: one scenario against a session the driver itself started.
//
//   bun script/qa/computer/linux.ts --session xvfb --scenario xft-dpi-scale --json
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
import {
  failed,
  isAdmit,
  verdict,
  type Result,
  type Scenario,
  type SessionName,
  type Stage,
} from "./linux/lib/scenario.ts"
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
const names = values.scenario.length > 0 ? values.scenario : Object.keys(SCENARIOS)
const unknown = names.filter((name) => SCENARIOS[name] === undefined)
if (unknown.length > 0) usage(`unknown scenario(s): ${unknown.join(", ")}`)

const binary = engineBinary(values.engine)
const runRoot = values.workdir ?? tmpdir()
const runId = `r47-${Date.now().toString(36)}-${process.pid}`
const runDir = mkdtempSync(join(runRoot, "omo-computer-qa-"))
const procs = new Processes(runId, process.env)
const results: Result[] = []

try {
  const stage = await session.start(procs, runDir)
  for (const name of names) {
    const scenario = SCENARIOS[name] ?? usage(`unknown scenario ${name}`)
    if (!isAdmit(scenario.admit)) usage(`scenario ${name} declares no admission`)
    if (scenario.name !== name) usage(`scenario ${name} is registered as ${scenario.name}`)
    if (!scenario.sessions.includes(stage.session)) {
      results.push(failed(name, stage.session, new Error(`scenario ${name} does not run under ${stage.session}`)))
      continue
    }
    // OMO_COMPUTER_RUNTIME_DIR is a fake-backend seam: the engine refuses it with a real
    // backend, so a live session passes only the stage's own environment.
    const engine = new Engine(binary, { ...stage.env, OMO_COMPUTER_BACKEND: "x11" })
    try {
      results.push(verdict(name, stage.session, await scenario.run({ procs, stage, engine })))
    } catch (error) {
      results.push(failed(name, stage.session, error))
    } finally {
      await engine.close()
    }
    const last = results[results.length - 1] ?? usage(`scenario ${name} produced no result`)
    process.stdout.write(`${values.json ? JSON.stringify(last) : `${last.scenario} ${last.session} ${last.verdict}`}\n`)
  }
} finally {
  for (const receipt of await procs.stopAll()) {
    if (!values.json) process.stdout.write(`${receipt}\n`)
  }
  if (!values.json) process.stdout.write(`procs ${procs.marked().length}\n`)
  rmSync(runDir, { recursive: true, force: true })
  process.stdout.write(`dir REMOVED ${runDir}\n`)
}

process.exit(results.every((result) => result.verdict === "PASS") ? 0 : 1)
