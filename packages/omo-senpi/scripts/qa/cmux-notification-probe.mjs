#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { basename, delimiter, join, resolve } from "node:path"
import { createSandbox, credentialDigest, digestDirectory, seedSandbox } from "./drive.mjs"

const packageRoot = resolve(import.meta.dirname, "../..")
const mockProviderEntry = join(packageRoot, "scripts/qa/task-e2e-mock-provider.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const real = process.argv.includes("--real")

if (process.platform !== "darwin") {
  console.log(JSON.stringify({ result: "SKIP", reason: "cmux-notify-is-darwin-only", platform: process.platform }))
  process.exit(0)
}

const sandbox = createSandbox()
const logPath = join(sandbox.root, "cmux-args.json")
const fakeCmux = join(sandbox.root, "cmux")
const outDir = process.env.CMUX_PROBE_OUT_DIR?.trim() ? resolve(process.env.CMUX_PROBE_OUT_DIR) : undefined

let exitCode = 1
try {
  const result = runProbe()
  writeEvidenceMaybe(result)
  console.log(JSON.stringify(result))
  exitCode = result.result === "PASS" || result.result === "SKIP" ? 0 : 1
} finally {
  rmSync(sandbox.root, { recursive: true, force: true })
}
process.exit(exitCode)

function runProbe() {
  const beforeCredentialDigest = credentialDigest(realSenpiAgentDir)
  const beforeFullDigest = digestDirectory(realSenpiAgentDir)
  const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  if (senpiBin === null) {
    return {
      result: "SKIP",
      reason: "senpi-binary-unavailable",
      providedAgentDir: process.env.SENPI_CODING_AGENT_DIR ? "IGNORED" : "unset",
    }
  }

  seedSandbox(sandbox)
  seedCmuxExecutable()
  seedProject()

  const executable = real ? resolveRealCmuxExecutable() : fakeCmux
  if (executable === null) {
    return {
      result: "SKIP",
      reason: "real-cmux-binary-unavailable",
      providedAgentDir: process.env.SENPI_CODING_AGENT_DIR ? "IGNORED" : "unset",
      sandboxAgentDir: sandbox.agentDir,
      sandboxCwd: sandbox.cwd,
    }
  }

  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  const env = {
    ...process.env,
    OMO_CMUX_BIN: executable,
    OMO_SENPI_CMUX_NOTIFY: "1",
    CMUX_PROBE_LOG: logPath,
    SENPI_CODING_AGENT_DIR: sandbox.agentDir,
    SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome,
    OMO_SENPI_QA: "1",
    TMUX: "/tmp/cmuxterm-probe.sock,1234,0",
  }
  delete env.CMUX_SOCKET_PATH

  const run = spawnSync(
    senpiBin,
    [
      "-e", mockProviderEntry,
      "-p",
      "--mode", "json",
      "--provider", "omo-mock",
      "--model", "mock-1",
      "--session-dir", sessionDir,
      "spawn a background child task so cmux completion notification fires",
    ],
    {
      cwd: sandbox.cwd,
      env,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  )

  const afterCredentialDigest = credentialDigest(realSenpiAgentDir)
  const afterFullDigest = digestDirectory(realSenpiAgentDir)
  const capturedArgs = readCapturedArgs()
  const notificationCaptured = real ? run.status === 0 : isExpectedFakeNotification(capturedArgs)
  const realSenpiCredentialsUntouched = beforeCredentialDigest === afterCredentialDigest
  return {
    result: run.status === 0 && notificationCaptured && realSenpiCredentialsUntouched ? "PASS" : "FAIL",
    mode: real ? "real-cmux" : "fake-cmux",
    senpiExit: run.status,
    senpiSignal: run.signal ?? null,
    notificationCaptured,
    cmuxExecutable: real ? executable : basename(executable),
    cmuxArgs: capturedArgs,
    tmuxMarker: env.TMUX,
    realSenpiCredentialsUntouched,
    realSenpiDigestUnchanged: beforeFullDigest === afterFullDigest,
    providedAgentDir: process.env.SENPI_CODING_AGENT_DIR ? "IGNORED" : "unset",
    sandboxAgentDir: sandbox.agentDir,
    sandboxCwd: sandbox.cwd,
    sessionDir,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
  }
}

function seedCmuxExecutable() {
  if (real) return
  writeFileSync(
    fakeCmux,
    `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs"\nwriteFileSync(process.env.CMUX_PROBE_LOG, JSON.stringify(process.argv.slice(2)) + "\\n")\n`,
    "utf8",
  )
  chmodSync(fakeCmux, 0o755)
}

function seedProject() {
  const omoDir = join(sandbox.cwd, ".omo")
  mkdirSync(omoDir, { recursive: true })
  writeFileSync(
    join(omoDir, "omo.json"),
    `${JSON.stringify({ categories: { mockcat: { description: "Local cmux probe category.", model: "omo-mock/mock-1" } } }, null, 2)}\n`,
  )
  writeFileSync(
    join(sandbox.cwd, "mock-script.json"),
    `${JSON.stringify({
      parentSteps: [
        {
          type: "tool_call",
          name: "task",
          arguments: {
            category: "mockcat",
            prompt: "complete the cmux notification probe",
            run_in_background: true,
            name: "cmuxprobe",
          },
        },
        { type: "text", text: "parent observed background task completion" },
      ],
      childSteps: [{ type: "text", text: "cmux notification probe child complete" }],
    }, null, 2)}\n`,
  )
}

function resolveRealCmuxExecutable() {
  const configured = process.env.CMUX_BIN?.trim() || process.env.OMO_CMUX_BIN?.trim()
  if (configured !== undefined && configured.length > 0 && existsSync(configured)) return configured
  const known = "/Applications/cmux.app/Contents/Resources/bin/cmux"
  if (existsSync(known)) return known
  return findOnPath("cmux")
}

function readCapturedArgs() {
  if (!existsSync(logPath)) return []
  const parsed = JSON.parse(readFileSync(logPath, "utf8"))
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : []
}

function isExpectedFakeNotification(args) {
  return args[0] === "notify" &&
    args[1] === "--title" &&
    args[2] === "OMO task completed" &&
    args[3] === "--body" &&
    typeof args[4] === "string" &&
    args[4].includes("cmuxprobe") &&
    args[4].includes("completed")
}

function findOnPath(bin) {
  if (bin.includes("/") && existsSync(bin)) return bin
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function writeEvidenceMaybe(result) {
  if (outDir === undefined) return
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "cmux-notification-probe.json"), `${JSON.stringify(redactProbeResult(result), null, 2)}\n`)
  if ("stdout" in result) writeFileSync(join(outDir, "cmux-notification-probe.stdout.json.log"), result.stdout)
  if ("stderr" in result) writeFileSync(join(outDir, "cmux-notification-probe.stderr.log"), result.stderr)
}

function redactProbeResult(result) {
  if (!("stdout" in result)) return result
  const { stdout: _stdout, stderr: _stderr, ...summary } = result
  return summary
}
