#!/usr/bin/env bun
/**
 * Live macOS computer-use QA: real Senpi RPC + packaged OmO extension + real desktop engine.
 * Run inside an unlocked Aqua session with Accessibility and Screen Recording granted to the
 * responsible launcher. The driver owns and terminates TextEdit between scenarios.
 *
 * SENPI_BIN=/path/to/senpi bun script/qa/desktop/macos.ts --all --json
 * --self-test checks isolation and launch wiring only: it never touches the console or TCC.
 */
import { accessSync, constants, existsSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import { selfTestBinary, selfTestSandbox } from "./macos/agent"
import { quitTextEdit, workDir } from "./macos/fixtures"
import {
  backgroundClickKeepsFocus, backgroundTypeMultiwindowRefused,
  backgroundTypeSoleWindow, foregroundRestores,
} from "./macos/scenarios-input"
import {
  canary, capabilitiesTruth, killswitchRealHid, preflight, screenshotBudget,
} from "./macos/scenarios-safety"
import { isScenarioName, SCENARIOS, type RunOptions, type ScenarioName, type ScenarioResult } from "./macos/scenario"
import { tccDiagnostic } from "./macos/tcc"

process.on("exit", () => rmSync(workDir, { recursive: true, force: true }))

function assertNever(value: never): never { throw new TypeError(`unhandled scenario ${String(value)}`) }
function runScenario(name: ScenarioName, options: RunOptions): Promise<ScenarioResult> {
  switch (name) {
    case "preflight": return preflight(options)
    case "background-click-keeps-focus": return backgroundClickKeepsFocus(options)
    case "background-type-sole-window": return backgroundTypeSoleWindow(options)
    case "background-type-multiwindow-refused": return backgroundTypeMultiwindowRefused(options)
    case "foreground-restores": return foregroundRestores(options)
    case "killswitch-real-hid": return killswitchRealHid(options)
    case "tcc-diagnostic": return tccDiagnostic(options)
    case "screenshot-budget": return screenshotBudget(options)
    case "capabilities-truth": return capabilitiesTruth(options)
    case "canary": return canary(options, "session")
    case "canary-off": return canary(options, "off")
    default: return assertNever(name)
  }
}

async function judged(name: ScenarioName, options: RunOptions): Promise<ScenarioResult> {
  try { return await runScenario(name, options) } catch (error) {
    if (!(error instanceof Error)) throw error
    return { scenario: name, pass: false, facts: { error: error.message } }
  }
}

const { values } = parseArgs({
  options: {
    all: { type: "boolean", default: false },
    scenario: { type: "string", multiple: true, default: [] },
    sabotage: { type: "string" },
    "kvm-shots": { type: "string" },
    "senpi-bin": { type: "string" },
    engine: { type: "string" },
    json: { type: "boolean", default: false },
    "self-test": { type: "boolean", default: false },
  },
})
if (values["self-test"]) {
  const wiring = selfTestSandbox()
  const bin = values["senpi-bin"] ?? process.env.SENPI_BIN ?? Bun.which("senpi")
  if (bin === null || bin === undefined) throw new Error("self-test requires a real Senpi binary")
  const binary = await selfTestBinary(resolve(bin))
  const facts = { wiring, binary }
  console.log(JSON.stringify({ verdict: "PASS", mode: "nonlive", console: "not tested", facts }))
} else {
  const unknown = values.scenario.filter((name) => !isScenarioName(name))
  if (unknown.length > 0) throw new Error(`unknown scenario ${unknown.join(", ")}; known: ${SCENARIOS.join(", ")}`)
  if (values.sabotage !== undefined && values.sabotage !== "force-foreground")
    throw new Error(`unknown sabotage ${values.sabotage}`)
  if (process.platform !== "darwin") throw new Error("live computer QA requires macOS")
  const bin = values["senpi-bin"] ?? process.env.SENPI_BIN
  if (bin === undefined || !existsSync(bin)) throw new Error("set --senpi-bin or SENPI_BIN to the real Senpi binary")
  accessSync(bin, constants.X_OK)
  const options: RunOptions = {
    senpiBin: resolve(bin), enginePath: values.engine === undefined ? undefined : resolve(values.engine),
    forceForeground: values.sabotage === "force-foreground",
    jetkvm: process.env.JETKVM, kvmShots: values["kvm-shots"],
  }
  const report = (result: ScenarioResult) =>
    console.log(values.json ? JSON.stringify(result) : `${result.pass ? "PASS" : "FAIL"} ${result.scenario}`)
  const gate = await judged("preflight", options)
  report(gate)
  let passed = gate.pass
  if (gate.pass) {
    const requested = values.all ? SCENARIOS.slice(1) : values.scenario.filter(isScenarioName)
    for (const name of requested.filter((candidate) => candidate !== "preflight")) {
      const result = await judged(name, options)
      report(result)
      passed &&= result.pass
    }
  }
  await quitTextEdit()
  console.error(`macOS QA fixture directory: ${workDir}`)
  process.exitCode = passed ? 0 : 1
}
