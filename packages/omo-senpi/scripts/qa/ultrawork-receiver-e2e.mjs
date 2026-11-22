#!/usr/bin/env node
// Live proof of the receiver-selected ultrawork directive (omo#8168 / omo#9642 / omo#14441): the REAL
// senpi binary, an isolated agent dir, the built plugin, and the keyless mock provider under one model
// id per kind of receiver. Every GPT id (Astra, its -fast and -ultrafast tiers, Sol, the GPT-5 family)
// must receive the GPT directive and every other id the default one, read back from the session JSONL
// (the only place the hidden custom message is distinguishable). A last scenario arms a session on a
// non-GPT model and continues it on a GPT one: the request the GPT model receives must then carry the
// GPT directive in place of the default the transcript holds.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { readDirectives } from "../../plugin/scripts/embed-directive.mjs"
import { createSandbox, digestDirectory, seedSandbox } from "./drive.mjs"
import { isolatedChildEnv } from "./sandbox-child-env.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")

const SCENARIOS = [
  { model: "gpt-6.2-astra", expect: "gpt" },
  { model: "gpt-6.2-astra-ultrafast", expect: "gpt" },
  { model: "gpt-6.2-sol", expect: "gpt" },
  { model: "gpt-6-astra", expect: "gpt" },
  { model: "gpt-5.6-sol", expect: "gpt" },
  { model: "claude-fable-5-2", expect: "default" },
  { model: "mock-1", expect: "default" },
]
const SWITCH = { from: "claude-fable-5-2", to: "gpt-6.2-astra-ultrafast" }

const sha256 = (text) => createHash("sha256").update(text).digest("hex")

function collectFiles(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(path, out)
    else out.push(path)
  }
}

function hiddenDirectives(agentDir) {
  const sessionsDir = join(agentDir, "sessions")
  if (!existsSync(sessionsDir)) return []
  const files = []
  collectFiles(sessionsDir, files)
  const found = []
  for (const file of files.filter((path) => path.endsWith(".jsonl"))) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim() === "") continue
      let entry
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      if (
        entry?.type === "custom_message" &&
        entry.customType === "omo-ultrawork:directive" &&
        typeof entry.content === "string"
      ) {
        found.push(entry.content)
      }
    }
  }
  return found
}

function findOnPath(bin) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function runSenpi(resolvedSenpi, sandbox, args) {
  return spawnSync(resolvedSenpi, ["-e", mockProviderEntry, "-p", "--provider", "omo-mock", ...args], {
    cwd: sandbox.cwd,
    env: {
      ...isolatedChildEnv(process.env, sandbox.agentDir),
      SENPI_CODING_AGENT_DIR: sandbox.agentDir,
      XDG_CONFIG_HOME: sandbox.xdgConfigHome,
      OMO_SENPI_QA: "1",
    },
    encoding: "utf8",
    timeout: 90_000,
  })
}

function writeRunOutput(evidenceDir, name, run) {
  if (evidenceDir === undefined) return
  mkdirSync(evidenceDir, { recursive: true })
  writeFileSync(join(evidenceDir, `${name}.stdout.txt`), `${run.stdout ?? ""}\n--- stderr ---\n${run.stderr ?? ""}`)
}

function runScenario(resolvedSenpi, scenario, directives, evidenceDir) {
  const sandbox = createSandbox()
  try {
    seedSandbox(sandbox)
    writeFileSync(
      join(sandbox.cwd, "mock-script.json"),
      `${JSON.stringify({ steps: [{ type: "text", text: `${scenario.model} e2e complete` }] }, null, 2)}\n`,
    )
    const run = runSenpi(resolvedSenpi, sandbox, ["--model", scenario.model, "ulw say hello"])
    const delivered = hiddenDirectives(sandbox.agentDir)
    const failures = []
    if (run.status !== 0) failures.push(`senpi-exit-${run.status}`)
    if (delivered.length !== 1) failures.push(`directive-count-${delivered.length}`)
    const content = delivered[0] ?? ""
    if (content !== directives[scenario.expect]) failures.push(`directive-mismatch:expected-${scenario.expect}`)
    for (const [name, directive] of Object.entries(directives)) {
      if (name !== scenario.expect && content === directive) failures.push(`directive-is-${name}`)
    }
    writeRunOutput(evidenceDir, scenario.model, run)
    if (evidenceDir !== undefined) writeFileSync(join(evidenceDir, `${scenario.model}.delivered.txt`), content)
    return {
      model: scenario.model,
      expect: scenario.expect,
      result: failures.length === 0 ? "PASS" : "FAIL",
      failures,
      deliveredSha256: sha256(content),
    }
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

/** Every string anywhere in a recorded request, so a directive is found whatever shape carries it. */
function stringLeaves(value, out = []) {
  if (typeof value === "string") out.push(value)
  else if (Array.isArray(value)) for (const item of value) stringLeaves(item, out)
  else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) stringLeaves(item, out)
  return out
}

function runSwitchScenario(resolvedSenpi, directives, evidenceDir) {
  const sandbox = createSandbox()
  try {
    seedSandbox(sandbox)
    writeFileSync(join(sandbox.cwd, "mock-record-context"), "")
    writeFileSync(
      join(sandbox.cwd, "mock-script.json"),
      `${JSON.stringify({ steps: [{ type: "text", text: "switch e2e reply" }] }, null, 2)}\n`,
    )
    const armed = runSenpi(resolvedSenpi, sandbox, ["--model", SWITCH.from, "ulw say hello"])
    const continued = runSenpi(resolvedSenpi, sandbox, ["--model", SWITCH.to, "--continue", "say it again"])
    const recordPath = join(sandbox.cwd, "mock-context.jsonl")
    const requests = existsSync(recordPath)
      ? readFileSync(recordPath, "utf8")
          .split("\n")
          .filter((line) => line.trim() !== "")
          .map((line) => JSON.parse(line))
      : []
    const carried = requests.map((request) => {
      const text = stringLeaves(request.messages).join("\n")
      return {
        model: request.model,
        default: text.includes(directives.default.trimEnd()),
        gpt: text.includes(directives.gpt.trimEnd()),
      }
    })
    const failures = []
    if (armed.status !== 0) failures.push(`armed-exit-${armed.status}`)
    if (continued.status !== 0) failures.push(`continued-exit-${continued.status}`)
    if (carried.length !== 2) failures.push(`request-count-${carried.length}`)
    const [first, second] = carried
    if (first?.model !== SWITCH.from || first?.default !== true || first?.gpt !== false) failures.push("armed-request")
    if (second?.model !== SWITCH.to || second?.gpt !== true || second?.default !== false) {
      failures.push("continued-request")
    }
    writeRunOutput(evidenceDir, "switch-armed", armed)
    writeRunOutput(evidenceDir, "switch-continued", continued)
    return { ...SWITCH, result: failures.length === 0 ? "PASS" : "FAIL", failures, requests: carried }
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

function main() {
  const evidenceIndex = process.argv.indexOf("--evidence-dir")
  const evidenceDir = evidenceIndex >= 0 ? process.argv[evidenceIndex + 1] : undefined
  const realAgentDir = join(process.env.HOME ?? "", ".senpi", "agent")
  const beforeDigest = digestDirectory(realAgentDir)
  const senpiBin = process.env.SENPI_BIN?.trim() || "senpi"
  const resolvedSenpi = senpiBin.includes("/") ? (existsSync(senpiBin) ? senpiBin : null) : findOnPath(senpiBin)
  if (resolvedSenpi === null) {
    console.log(JSON.stringify({ result: "SKIP", reason: "senpi-binary-unavailable" }))
    return
  }
  // The same derivation embed-directive.mjs --check holds generated-directive.ts to.
  const directives = readDirectives()
  const scenarios = SCENARIOS.map((scenario) => runScenario(resolvedSenpi, scenario, directives, evidenceDir))
  const receiverSwitch = runSwitchScenario(resolvedSenpi, directives, evidenceDir)
  const afterDigest = digestDirectory(realAgentDir)
  const report = {
    result: [...scenarios, receiverSwitch].every((scenario) => scenario.result === "PASS") ? "PASS" : "FAIL",
    scenarios,
    receiverSwitch,
    directiveSha256: Object.fromEntries(Object.entries(directives).map(([name, text]) => [name, sha256(text)])),
    realSenpiUntouched: beforeDigest === afterDigest,
  }
  if (evidenceDir !== undefined) {
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(join(evidenceDir, "e2e.json"), `${JSON.stringify(report, null, 2)}\n`)
  }
  console.log(JSON.stringify(report))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
