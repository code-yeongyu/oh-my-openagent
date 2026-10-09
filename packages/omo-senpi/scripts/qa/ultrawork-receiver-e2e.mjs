#!/usr/bin/env node
// Live proof of the receiver-selected ultrawork directive (omo#8168 / omo#9642 follow-up): the REAL
// senpi binary, an isolated agent dir, the built plugin, and the keyless mock provider under two model
// ids. The GPT-6 Astra id must receive SENPI_ASTRA_ULTRAWORK_DIRECTIVE and every other id the baseline,
// read back from the session JSONL (the only place the hidden custom message is distinguishable).
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createSandbox, digestDirectory, seedSandbox } from "./drive.mjs"
import { isolatedChildEnv } from "./sandbox-child-env.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")
const generatedDirectivePath = resolve(scriptDir, "../../src/components/ultrawork/generated-directive.ts")

const SCENARIOS = [
  { name: "astra-receiver", model: "gpt-6-astra", expect: "astra" },
  { name: "baseline-receiver", model: "mock-1", expect: "baseline" },
]

function loadGeneratedDirectives() {
  const source = readFileSync(generatedDirectivePath, "utf8")
  const read = (name) => {
    const match = source.match(new RegExp(`export const ${name} = (".*") as const`))
    if (match === null) throw new Error(`${name} missing from generated-directive.ts`)
    return JSON.parse(match[1])
  }
  return { baseline: read("SENPI_ULTRAWORK_DIRECTIVE"), astra: read("SENPI_ASTRA_ULTRAWORK_DIRECTIVE") }
}

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
      if (entry?.type === "custom_message" && entry.customType === "omo-ultrawork:directive" && typeof entry.content === "string") {
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

function runScenario(resolvedSenpi, scenario, directives, evidenceDir) {
  const sandbox = createSandbox()
  try {
    seedSandbox(sandbox)
    writeFileSync(
      join(sandbox.cwd, "mock-script.json"),
      `${JSON.stringify({ steps: [{ type: "text", text: `${scenario.name} e2e complete` }] }, null, 2)}\n`,
    )
    const run = spawnSync(
      resolvedSenpi,
      ["-e", mockProviderEntry, "-p", "--provider", "omo-mock", "--model", scenario.model, "ulw say hello"],
      {
        cwd: sandbox.cwd,
        env: { ...isolatedChildEnv(process.env, sandbox.agentDir), SENPI_CODING_AGENT_DIR: sandbox.agentDir, XDG_CONFIG_HOME: sandbox.xdgConfigHome, OMO_SENPI_QA: "1" },
        encoding: "utf8",
        timeout: 90_000,
      },
    )
    const delivered = hiddenDirectives(sandbox.agentDir)
    const failures = []
    if (run.status !== 0) failures.push(`senpi-exit-${run.status}`)
    if (delivered.length !== 1) failures.push(`directive-count-${delivered.length}`)
    const content = delivered[0] ?? ""
    const expected = directives[scenario.expect]
    const other = directives[scenario.expect === "astra" ? "baseline" : "astra"]
    if (content !== expected) failures.push(`directive-mismatch:expected-${scenario.expect}`)
    if (content === other) failures.push(`directive-is-${scenario.expect === "astra" ? "baseline" : "astra"}`)
    if (/omo-ultrawork-astra/.test(content)) failures.push("marker-leaked")
    if (evidenceDir !== undefined) {
      mkdirSync(evidenceDir, { recursive: true })
      writeFileSync(join(evidenceDir, `${scenario.name}.delivered.txt`), content)
      writeFileSync(join(evidenceDir, `${scenario.name}.stdout.txt`), `${run.stdout ?? ""}\n--- stderr ---\n${run.stderr ?? ""}`)
    }
    return {
      name: scenario.name,
      model: scenario.model,
      result: failures.length === 0 ? "PASS" : "FAIL",
      failures,
      deliveredChars: content.length,
      expectedChars: expected.length,
    }
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
  const directives = loadGeneratedDirectives()
  const scenarios = SCENARIOS.map((scenario) => runScenario(resolvedSenpi, scenario, directives, evidenceDir))
  const afterDigest = digestDirectory(realAgentDir)
  const report = {
    result: scenarios.every((scenario) => scenario.result === "PASS") ? "PASS" : "FAIL",
    scenarios,
    baselineChars: directives.baseline.length,
    astraChars: directives.astra.length,
    realSenpiUntouched: beforeDigest === afterDigest,
  }
  if (evidenceDir !== undefined) writeFileSync(join(evidenceDir, "e2e.json"), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
