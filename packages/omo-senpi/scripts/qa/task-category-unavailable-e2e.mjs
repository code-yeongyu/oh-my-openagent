#!/usr/bin/env node
// Live RPC probe for the dead-chain category warning (plan todo 6). Drives a sandboxed senpi in
// --mode rpc against the lane-private omo-mock provider (registry = omo-mock only, so every builtin
// category chain is dead), spawns the quick category TWICE via scripted task tool calls, and proves:
//   happy:    exactly ONE {method:"notify",notifyType:"info"} frame on the RPC stdout stream AND
//             exactly ONE senpi-task.category-unavailable custom message in the session JSONL;
//   negative: task.warnings.unavailable_categories=false -> neither frame nor message.
// Isolation: real ~/.senpi/agent credential files must stay byte-identical; the sandbox is removed.
import { spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createHash } from "node:crypto"

import { createSandbox, credentialDigest, seedSandbox } from "./drive.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "task-category-unavailable-mock-provider.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const realOmoDir = join(homedir(), ".omo")

const WARNING_TEXT = 'Category "quick" has no usable model: none of its fallback-chain providers are connected'
const CUSTOM_TYPE = "senpi-task.category-unavailable"

// Fingerprint only the omo config layer (~/.omo/omo.jsonc + omo.json) - the files a config
// migration or category write could touch. Runtime state under ~/.omo can be multi-GiB.
function digestOmoConfigLayer() {
  const hash = createHash("sha256")
  for (const name of ["omo.jsonc", "omo.json"]) {
    const path = join(realOmoDir, name)
    hash.update(name)
    hash.update("\0")
    hash.update(existsSync(path) ? readFileSync(path) : Buffer.from("absent"))
    hash.update("\0")
  }
  return hash.digest("hex")
}

function findOnPath(bin) {
  if (bin.includes("/")) return existsSync(bin) ? bin : null
  for (const pathEntry of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(pathEntry || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function parseArgs(argv) {
  const output = { evidenceDir: undefined, selfTest: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--self-test") {
      output.selfTest = true
      continue
    }
    if (arg === "--evidence-dir") {
      const value = argv[index + 1]
      if (value === undefined) throw new Error("--evidence-dir requires a path")
      output.evidenceDir = isAbsolute(value) ? value : resolve(process.cwd(), value)
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return output
}

function scenarioScript() {
  return {
    models: ["mock-parent"],
    parentSteps: [
      {
        type: "tool_call",
        name: "task",
        arguments: { category: "quick", prompt: "first dead-chain spawn", run_in_background: true },
      },
      {
        type: "tool_call",
        name: "task",
        arguments: { category: "quick", prompt: "second dead-chain spawn", run_in_background: true },
      },
      { type: "text", text: "category-unavailable probe complete" },
    ],
    childSteps: [{ type: "text", text: "unreachable: dead-chain spawns never start a child" }],
  }
}

function seedScenario(omoConfig) {
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  // Sandbox HOME: the omo config user layer resolves at $HOME/.omo (omo-config-core paths.ts), so
  // an inherited real HOME leaks the developer's real categories into category resolution and lets
  // startup migrations write there. A sandbox HOME makes the probe hermetic.
  const home = join(sandbox.root, "home")
  mkdirSync(home, { recursive: true })
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  const omoDir = join(sandbox.cwd, ".omo")
  mkdirSync(omoDir, { recursive: true })
  writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify(omoConfig, null, 2)}\n`)
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(scenarioScript(), null, 2)}\n`)
  return { sandbox: { ...sandbox, home }, sessionDir }
}

function jsonLines(text) {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return undefined
      }
    })
    .filter((line) => line !== undefined)
}

function count(text, needle) {
  return text.split(needle).length - 1
}

function readSessionTranscript(sessionDir) {
  const files = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path)
    }
  }
  walk(sessionDir)
  return files.map((path) => readFileSync(path, "utf8")).join("\n")
}

// Drive one RPC session: subscribe to stdout FIRST, then send the prompt command, then wait for the
// prompt response frame (bounded) so no notify/custom-message frame can race past the collector.
function driveRpc(senpiBin, scenario) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      senpiBin,
      [
        "-e",
        mockProviderEntry,
        "--mode",
        "rpc",
        "--provider",
        "omo-mock",
        "--model",
        "mock-parent",
        "--session-dir",
        scenario.sessionDir,
      ],
      {
        cwd: scenario.sandbox.cwd,
        env: {
          ...process.env,
          // HOME must be sandboxed: senpi resolves its settings/tips paths from HOME even when the
          // agent-dir env is set, and the omo user config layer lives at $HOME/.omo. Every agent-dir
          // env spelling is set: the omo brand prefix wins first (OMO_CODING_AGENT_DIR leaks the
          // developer's real agent dir when the probe runs inside an omo session), then the legacy
          // SENPI_/PI_ spellings the unbranded binary reads.
          HOME: scenario.sandbox.home,
          USERPROFILE: scenario.sandbox.home,
          OMO_CODING_AGENT_DIR: scenario.sandbox.agentDir,
          SENPI_CODING_AGENT_DIR: scenario.sandbox.agentDir,
          PI_CODING_AGENT_DIR: scenario.sandbox.agentDir,
          OMO_CODING_AGENT_SESSION_DIR: scenario.sessionDir,
          SENPI_CODING_AGENT_SESSION_DIR: scenario.sessionDir,
          XDG_CONFIG_HOME: scenario.sandbox.xdgConfigHome,
          OMO_SENPI_QA: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    )
    let stdout = ""
    let stderr = ""
    let responded = false
    const finish = (reason) => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      resolvePromise({ stdout, stderr, responded, reason })
    }
    const deadline = setTimeout(() => finish("timeout"), 90_000)
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
      if (responded) return
      const frames = jsonLines(stdout)
      if (frames.some((frame) => frame.type === "response" && frame.command === "prompt")) {
        responded = true
        // Grace window for trailing notify/custom-message frames, then shut the RPC session down.
        setTimeout(() => {
          child.stdin.end()
          setTimeout(() => finish("completed"), 2_000)
        }, 1_000)
      }
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.on("exit", () => {
      clearTimeout(deadline)
      finish(responded ? "completed" : "exit-before-response")
    })
    child.on("error", (error) => {
      clearTimeout(deadline)
      stderr += String(error)
      finish("spawn-error")
    })
    child.stdin.write(`${JSON.stringify({ id: "probe-1", type: "prompt", message: "spawn the quick task twice and stop" })}\n`)
  })
}

function assertScenario(run, sessionTranscript, expectWarning) {
  const frames = jsonLines(run.stdout)
  const notifyFrames = frames.filter(
    (frame) =>
      frame.method === "notify" &&
      frame.notifyType === "info" &&
      typeof frame.message === "string" &&
      frame.message.includes(WARNING_TEXT),
  )
  const customCount = count(sessionTranscript, CUSTOM_TYPE)
  const checks = {
    prompt_responded: run.responded,
    notify_warning_frame_count: expectWarning ? notifyFrames.length === 1 : notifyFrames.length === 0,
    custom_message_count: expectWarning ? customCount === 1 : customCount === 0,
  }
  if (expectWarning) {
    checks.custom_message_reason = count(sessionTranscript, '"reason":"no_chain_rung_available"') === 1
    checks.custom_message_chain_details =
      sessionTranscript.includes('"attempted_chain"') && sessionTranscript.includes('"missing_providers"')
  }
  return {
    result: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
    checks,
    notifyFrameCount: notifyFrames.length,
    customCount,
    stdout: run.stdout,
    stderr: run.stderr,
    sessionTranscript,
  }
}

function writeEvidence(evidenceDir, label, result) {
  if (evidenceDir === undefined) return
  const dir = join(evidenceDir, label)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "stdout.jsonl"), result.stdout)
  writeFileSync(join(dir, "stderr.txt"), result.stderr)
  writeFileSync(join(dir, "session.jsonl"), result.sessionTranscript)
  writeFileSync(
    join(dir, "summary.json"),
    `${JSON.stringify(
      {
        result: result.result,
        checks: result.checks,
        notifyFrameCount: result.notifyFrameCount,
        customCount: result.customCount,
      },
      null,
      2,
    )}\n`,
  )
}

function selfTest() {
  const script = scenarioScript()
  if (script.parentSteps.filter((step) => step.type === "tool_call").length !== 2) {
    throw new Error("probe must spawn the dead-chain category exactly twice")
  }
  if (count(`x ${CUSTOM_TYPE} y`, CUSTOM_TYPE) !== 1) throw new Error("counter failed")
  console.log("SELF-TEST OK")
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.selfTest) {
    selfTest()
    return
  }
  const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  if (senpiBin === null) {
    console.log(JSON.stringify({ result: "SKIP", reason: "senpi-binary-unavailable" }))
    process.exitCode = 1
    return
  }

  // Hard isolation gate: the sandbox must never alias the real dirs, and the real agent-dir
  // credential files plus the real ~/.omo config layer must stay byte-identical across the probe.
  // (~/.omo holds multi-GiB runtime state, so only the config files the plugin could write are
  // fingerprinted, not the whole tree.)
  const beforeCredentials = credentialDigest(realSenpiAgentDir)
  const beforeOmoConfig = digestOmoConfigLayer()
  const realSettingsPath = join(realSenpiAgentDir, "settings.json")
  const beforeSettingsMtime = existsSync(realSettingsPath) ? statSync(realSettingsPath).mtimeMs : undefined
  const scenarios = [
    { label: "happy", omoConfig: {}, expectWarning: true },
    {
      label: "suppressed",
      omoConfig: { task: { warnings: { unavailable_categories: false } } },
      expectWarning: false,
    },
  ]
  const reports = []
  for (const scenario of scenarios) {
    const seeded = seedScenario(scenario.omoConfig)
    if (resolve(seeded.sandbox.agentDir) === resolve(realSenpiAgentDir)) {
      throw new Error("sandbox agent dir aliases the real ~/.senpi/agent")
    }
    if (resolve(seeded.sandbox.home) === resolve(homedir())) {
      throw new Error("sandbox home aliases the real HOME")
    }
    let result
    try {
      const run = await driveRpc(senpiBin, seeded)
      const sessionTranscript = readSessionTranscript(seeded.sessionDir)
      result = assertScenario(run, sessionTranscript, scenario.expectWarning)
    } finally {
      // The SIGKILLed RPC child can leave a grandchild flushing late writes into the sandbox;
      // without retries rmSync races them and dies ENOTEMPTY on macOS.
      rmSync(seeded.sandbox.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    }
    if (existsSync(seeded.sandbox.root)) result.result = "FAIL"
    reports.push({ label: scenario.label, result })
    writeEvidence(args.evidenceDir, scenario.label, result)
  }
  const afterCredentials = credentialDigest(realSenpiAgentDir)
  const afterOmoConfig = digestOmoConfigLayer()
  const afterSettingsMtime = existsSync(realSettingsPath) ? statSync(realSettingsPath).mtimeMs : undefined
  const isolation = {
    credentialDigestUnchanged: beforeCredentials === afterCredentials,
    realOmoConfigUnchanged: beforeOmoConfig === afterOmoConfig,
    realSettingsMtimeUnchanged: beforeSettingsMtime === afterSettingsMtime,
  }
  const allPass = reports.every((report) => report.result.result === "PASS")
    && isolation.credentialDigestUnchanged
    && isolation.realOmoConfigUnchanged
    && isolation.realSettingsMtimeUnchanged
  console.log(
    JSON.stringify(
      {
        result: allPass ? "PASS" : "FAIL",
        scenarios: reports.map((report) => ({
          label: report.label,
          result: report.result.result,
          checks: report.result.checks,
          notifyFrameCount: report.result.notifyFrameCount,
          customCount: report.result.customCount,
        })),
        isolation,
      },
      null,
      2,
    ),
  )
  if (!allPass) process.exitCode = 1
}

await main()
