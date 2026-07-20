#!/usr/bin/env node
// Live QA driver: boots the REAL pi coding agent CLI in RPC mode inside an
// isolated PI_CODING_AGENT_DIR sandbox, loads the vendored pi-goal extension
// plus a scripted mock provider (no network), and proves the goal tools and
// continuation wiring work end to end on the real harness. Two scenarios:
//   complete: turn 1 creates the goal, the extension queues a hidden
//             continuation prompt, and the continuation turn marks it complete.
//   blocked:  turn 1 creates the goal, and the continuation turn marks it
//             blocked via update_goal (codex-aligned status).
// Runs both by default; pass --scenario <complete|blocked> to run one.
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")
const goalExtensionEntry = join(packageRoot, "src", "index.ts")
const realPiAgentDir = join(homedir(), ".pi", "agent")
const RUN_TIMEOUT_MILLISECONDS = 120_000
const CONTINUATION_MARKER = "Continue working toward the active thread goal."
// Present only in the codex-aligned continuation prompt, so its delivery proves
// the new prompt content actually reached the real session (not the old prompt).
const CODEX_CONTINUATION_MARKER = "Blocked audit:"

const SCENARIOS = {
  complete: {
    objective: "QA: prove pi-goal works on the real pi harness",
    tokenBudget: 50_000,
    steps: [
      {
        type: "tool_call",
        name: "create_goal",
        arguments: { objective: "QA: prove pi-goal works on the real pi harness", token_budget: 50_000 },
      },
      { type: "text", text: "goal created, ending this turn" },
      { type: "tool_call", name: "update_goal", arguments: { status: "complete" } },
      { type: "text", text: "goal completed, all done" },
    ],
    terminalStatus: "complete",
  },
  blocked: {
    objective: "QA: prove the blocked round-trip on the real pi harness",
    tokenBudget: undefined,
    steps: [
      {
        type: "tool_call",
        name: "create_goal",
        arguments: { objective: "QA: prove the blocked round-trip on the real pi harness" },
      },
      { type: "text", text: "goal created, ending this turn" },
      { type: "tool_call", name: "update_goal", arguments: { status: "blocked" } },
      { type: "text", text: "goal blocked, stopping" },
    ],
    terminalStatus: "blocked",
  },
}

export function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "pi-goal-qa-"))
  const cwd = join(root, "project")
  const agentDir = join(root, "agent")
  mkdirSync(cwd, { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  return { root, cwd, agentDir }
}

export function digestDirectory(root) {
  if (!existsSync(root)) return "absent"
  const files = []
  collectFiles(root, files)
  const hash = createHash("sha256")
  for (const file of files.sort()) {
    hash.update(file.slice(root.length + 1))
    hash.update("\0")
    hash.update(createHash("sha256").update(readFileSync(file)).digest("hex"))
    hash.update("\0")
  }
  return hash.digest("hex")
}

function collectFiles(root, out) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) collectFiles(path, out)
    else if (entry.isFile()) out.push(path)
  }
}

export function readSandboxText(root) {
  const files = []
  collectFiles(root, files)
  let text = ""
  for (const file of files.sort()) {
    try {
      text += readFileSync(file, "utf8")
    } catch {
      // @allow binary or unreadable files are irrelevant to the assertions
    }
  }
  return text
}

export function findGoalStoreFiles(root) {
  const files = []
  collectFiles(root, files)
  return files.filter((file) => file.includes(join("extensions", "pi-goal")) && file.endsWith(".json"))
}

export function resolvePiBin() {
  let dir = packageRoot
  while (true) {
    const candidate = join(dir, "node_modules", "@mariozechner", "pi-coding-agent")
    if (existsSync(join(candidate, "package.json"))) {
      const manifest = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8"))
      return join(candidate, manifest.bin.pi)
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function readGoalFromSandbox(root) {
  const goalFiles = findGoalStoreFiles(root)
  if (goalFiles.length === 0) return { file: undefined, goal: undefined }
  return { file: goalFiles[0], goal: JSON.parse(readFileSync(goalFiles[0], "utf8")).goal }
}

function runRpcScenario(piBin, sandbox, scenario, scenarioReport) {
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({ steps: scenario.steps }, null, 2)}\n`)

  const child = spawn(
    process.execPath,
    [piBin, "--mode", "rpc", "--offline", "-e", mockProviderEntry, "-e", goalExtensionEntry, "--provider", "omo-mock", "--model", "mock-1"],
    {
      cwd: sandbox.cwd,
      env: { ...process.env, PI_CODING_AGENT_DIR: sandbox.agentDir },
      stdio: ["pipe", "pipe", "pipe"],
    },
  )
  scenarioReport.childPid = child.pid

  return new Promise((resolveScenario) => {
    let stdoutBuffer = ""
    let stderrTail = ""
    let agentEndCount = 0
    let settled = false
    const timeout = setTimeout(() => finish("timeout"), RUN_TIMEOUT_MILLISECONDS)

    function finish(reason) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      scenarioReport.rpcFinishReason = reason
      scenarioReport.agentEndCount = agentEndCount
      scenarioReport.stderrTail = stderrTail.split("\n").slice(-8).join("\n")
      child.kill("SIGTERM")
      const killTimeout = setTimeout(() => child.kill("SIGKILL"), 5_000)
      child.once("exit", () => {
        clearTimeout(killTimeout)
        resolveScenario()
      })
      if (child.exitCode !== null) {
        clearTimeout(killTimeout)
        resolveScenario()
      }
    }

    child.on("error", () => finish("spawn-error"))
    child.on("exit", () => finish("child-exited"))
    child.stderr.on("data", (chunk) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-4_000)
    })
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk
      let newlineIndex = stdoutBuffer.indexOf("\n")
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex)
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
        handleLine(line)
        newlineIndex = stdoutBuffer.indexOf("\n")
      }
    })

    function handleLine(line) {
      if (line.trim() === "") return
      let event
      try {
        event = JSON.parse(line)
      } catch {
        return
      }
      if (event.type === "agent_end") {
        agentEndCount += 1
        const { goal } = readGoalFromSandbox(sandbox.root)
        if (goal?.status === scenario.terminalStatus) finish(`goal-${scenario.terminalStatus}`)
        else if (agentEndCount >= 4) finish("terminal-status-never-reached")
      }
    }

    child.stdin.write(`${JSON.stringify({ type: "prompt", message: "please create the QA goal" })}\n`)
  })
}

async function runScenario(piBin, name) {
  const scenario = SCENARIOS[name]
  const sandbox = createSandbox()
  const scenarioReport = {
    scenario: name,
    result: "FAIL",
    reason: undefined,
    goalStoreFile: undefined,
    goalAfterRun: undefined,
    continuationObserved: false,
    codexContinuationMarkerObserved: false,
    terminalStatusObserved: false,
    sandboxRoot: sandbox.root,
  }
  try {
    await runRpcScenario(piBin, sandbox, scenario, scenarioReport)
    const { file, goal } = readGoalFromSandbox(sandbox.root)
    scenarioReport.goalStoreFile = file
    scenarioReport.goalAfterRun = goal
    const sandboxText = readSandboxText(sandbox.root)
    scenarioReport.continuationObserved = sandboxText.includes(CONTINUATION_MARKER)
    scenarioReport.codexContinuationMarkerObserved = sandboxText.includes(CODEX_CONTINUATION_MARKER)
    scenarioReport.terminalStatusObserved = goal?.status === scenario.terminalStatus

    const shapeCorrect = goal?.objective === scenario.objective && goal?.tokenBudget === scenario.tokenBudget
    if (
      shapeCorrect &&
      scenarioReport.continuationObserved &&
      scenarioReport.codexContinuationMarkerObserved &&
      scenarioReport.terminalStatusObserved
    ) {
      scenarioReport.result = "PASS"
    } else {
      scenarioReport.reason = "assertions-not-satisfied"
    }
  } finally {
    if (scenarioReport.result === "PASS") rmSync(sandbox.root, { recursive: true, force: true })
  }
  return scenarioReport
}

function runSelfTest() {
  const sandbox = createSandbox()
  try {
    if (!existsSync(mockProviderEntry)) throw new Error("mock provider entry missing")
    if (!existsSync(goalExtensionEntry)) throw new Error("goal extension entry missing")
    if (sandbox.agentDir === realPiAgentDir) throw new Error("sandbox reused the real pi agent dir")
    if (digestDirectory(join(sandbox.root, "missing")) !== "absent") throw new Error("missing dir digest should be absent")
    writeFileSync(join(sandbox.cwd, "probe.json"), "{}")
    if (findGoalStoreFiles(sandbox.root).length !== 0) throw new Error("goal store matcher over-matches")
    if (resolvePiBin() === null) throw new Error("pi binary could not be resolved from the workspace")
    if (SCENARIOS.blocked.terminalStatus !== "blocked") throw new Error("blocked scenario misconfigured")
    console.log(JSON.stringify({ result: "PASS", mode: "self-test" }))
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

function selectedScenarioNames() {
  const flagIndex = process.argv.indexOf("--scenario")
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
    const name = process.argv[flagIndex + 1]
    if (!SCENARIOS[name]) throw new Error(`unknown scenario: ${name}`)
    return [name]
  }
  return Object.keys(SCENARIOS)
}

async function main() {
  if (process.argv.includes("--self-test")) return runSelfTest()

  const beforeDigest = digestDirectory(realPiAgentDir)
  const report = {
    result: "FAIL",
    piBin: undefined,
    realAgentDirUntouched: undefined,
    scenarios: [],
  }

  try {
    const piBin = resolvePiBin()
    if (piBin === null || !existsSync(piBin)) {
      report.result = "SKIP"
      report.reason = "pi-binary-unavailable"
      return
    }
    report.piBin = piBin

    for (const name of selectedScenarioNames()) {
      report.scenarios.push(await runScenario(piBin, name))
    }
    report.result = report.scenarios.every((scenarioReport) => scenarioReport.result === "PASS") ? "PASS" : "FAIL"
  } finally {
    report.realAgentDirUntouched = digestDirectory(realPiAgentDir) === beforeDigest
    if (report.result === "PASS" && !report.realAgentDirUntouched) {
      report.result = "FAIL"
      report.reason = "real-pi-agent-dir-mutated"
    }
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = report.result === "PASS" || report.result === "SKIP" ? 0 : 1
  }
}

await main()
