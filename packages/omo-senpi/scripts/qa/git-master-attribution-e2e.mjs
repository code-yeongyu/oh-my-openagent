#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox, credentialDigest, seedSandbox } from "./drive.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")
const realAgentDirs = [join(homedir(), ".senpi", "agent"), join(homedir(), ".omo", "agent")]
// The shipped contract (omo#7832) is that NO GitHub-resolvable co-author identity is ever
// injected, so this driver looks for any Co-authored-by trailer rather than one known address:
// pinning a single string would pass again the moment a different identity was introduced.
const CO_AUTHOR_MARKER = "Co-authored-by:"
const FOOTER_MARKER = "Ultraworked with"
const SKILL_BODY_MARKER = "GIT MASTER LIVE QA BODY"

function findOnPath(bin) {
  if (bin.includes("/")) return existsSync(bin) ? bin : null
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function parseJsonLines(stdout) {
  const events = []
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("{")) continue
    try {
      events.push(JSON.parse(trimmed))
    } catch {
      continue
    }
  }
  return events
}

export function readToolEventsPayload(events) {
  const readEvents = events.filter(
    (event) => event?.type === "tool_execution_end" && event.toolName === "read",
  )
  return { count: readEvents.length, payload: JSON.stringify(readEvents) }
}

function seedScenario(sandbox, gitMasterConfig) {
  seedSandbox(sandbox)
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  const omoDir = join(sandbox.cwd, ".omo")
  mkdirSync(omoDir, { recursive: true })
  const omoConfig = gitMasterConfig === undefined ? {} : { git_master: gitMasterConfig }
  writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify(omoConfig, null, 2)}\n`)
  const skillDir = join(sandbox.agentDir, "skills", "git-master")
  mkdirSync(skillDir, { recursive: true })
  const skillPath = join(skillDir, "SKILL.md")
  writeFileSync(
    skillPath,
    `---\nname: git-master\ndescription: Isolated live QA git-master skill\n---\n${SKILL_BODY_MARKER}\n`,
  )
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({
    steps: [
      { type: "tool_call", name: "read", arguments: { path: skillPath } },
      { type: "text", text: "git-master attribution QA complete" },
    ],
  }, null, 2)}\n`)
  return sessionDir
}

function runScenario(senpiBin, gitMasterConfig) {
  const sandbox = createSandbox()
  try {
    const sessionDir = seedScenario(sandbox, gitMasterConfig)
    // An omo-hosted shell exports OMO_CODING_AGENT_DIR, which outranks SENPI_CODING_AGENT_DIR in
    // resolveAgentHome and would silently re-point the sandbox at the real agent dir.
    const cleanEnv = { ...process.env }
    delete cleanEnv.OMO_CODING_AGENT_DIR
    delete cleanEnv.PI_CODING_AGENT_DIR
    const run = spawnSync(
      senpiBin,
      ["-e", mockProviderEntry, "-p", "--mode", "json", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", sessionDir, "read the git-master skill"],
      {
        cwd: sandbox.cwd,
        env: {
          ...cleanEnv,
          SENPI_CODING_AGENT_DIR: sandbox.agentDir,
          XDG_CONFIG_HOME: sandbox.xdgConfigHome,
          SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
          OMO_SENPI_QA: "1",
        },
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 64 * 1024 * 1024,
      },
    )
    const stdout = run.stdout ?? ""
    const { count, payload } = readToolEventsPayload(parseJsonLines(stdout))
    return {
      exitStatus: run.status,
      readEventCount: count,
      bodyPresent: payload.includes(SKILL_BODY_MARKER),
      trailerPresent: payload.includes(CO_AUTHOR_MARKER),
      footerPresent: payload.includes(FOOTER_MARKER),
      sandboxAgentDir: sandbox.agentDir,
      stdout,
      stderr: run.stderr ?? "",
    }
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

function selfTest() {
  const events = parseJsonLines(
    `noise\n{"type":"tool_execution_end","toolName":"read","result":{"content":[{"type":"text","text":"${FOOTER_MARKER} [omo]"}]}}\n{"type":"other"}\n`,
  )
  const { count, payload } = readToolEventsPayload(events)
  if (count !== 1) throw new Error("read event filter failed")
  if (!payload.includes(FOOTER_MARKER)) throw new Error("payload serialization failed")
  console.log("SELF-TEST OK")
}

function writeEvidence(outDir, payload, scenarios) {
  if (outDir === undefined) return
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "verdict.json"), `${JSON.stringify(payload, null, 2)}\n`)
  for (const [label, scenario] of Object.entries(scenarios)) {
    writeFileSync(join(outDir, `${label}-stdout.json.log`), scenario.stdout)
    writeFileSync(join(outDir, `${label}-stderr.log`), scenario.stderr)
  }
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest()
  const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  if (senpiBin === null) {
    console.log(JSON.stringify({ result: "SKIP", reason: "senpi-binary-unavailable" }))
    return
  }
  const outDir = process.env.GIT_MASTER_ATTRIBUTION_E2E_OUT_DIR?.trim()
  const snapshots = realAgentDirs.map((dir) => ({ dir, before: credentialDigest(dir) }))
  // Default install: nothing is injected. Opt-in: the body footer only, never a trailer.
  const defaultOff = runScenario(senpiBin, undefined)
  const optedIn = runScenario(senpiBin, { commit_footer: true })
  const changedRealDirs = snapshots
    .filter(({ dir, before }) => before !== credentialDigest(dir))
    .map(({ dir }) => dir)
  const checks = {
    default_process_exit: defaultOff.exitStatus === 0 ? "PASS" : "FAIL",
    default_read_event: defaultOff.readEventCount >= 1 && defaultOff.bodyPresent ? "PASS" : "FAIL",
    default_footer_absent: defaultOff.footerPresent ? "FAIL" : "PASS",
    default_trailer_absent: defaultOff.trailerPresent ? "FAIL" : "PASS",
    opt_in_process_exit: optedIn.exitStatus === 0 ? "PASS" : "FAIL",
    opt_in_read_event: optedIn.readEventCount >= 1 && optedIn.bodyPresent ? "PASS" : "FAIL",
    opt_in_footer_injected: optedIn.footerPresent ? "PASS" : "FAIL",
    opt_in_trailer_absent: optedIn.trailerPresent ? "FAIL" : "PASS",
    real_agent_dirs_untouched: changedRealDirs.length === 0 ? "PASS" : "FAIL",
  }
  const result = Object.values(checks).every((value) => value === "PASS") ? "PASS" : "FAIL"
  const payload = {
    result,
    checks,
    realAgentDirsUntouched: changedRealDirs.length === 0,
    changedRealDirs,
    sandboxAgentDirs: { default: defaultOff.sandboxAgentDir, optIn: optedIn.sandboxAgentDir },
  }
  writeEvidence(outDir ? resolve(outDir) : undefined, payload, { default: defaultOff, "opt-in": optedIn })
  console.log(JSON.stringify(payload))
  process.exitCode = result === "PASS" ? 0 : 1
}

main()
