#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { basename, delimiter, join, resolve } from "node:path"
import { createSandbox, credentialDigest, digestDirectory, seedSandbox } from "./drive.mjs"
import { changedRealPaths, snapshotDir } from "./task-e2e-analysis.mjs"

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
  const beforeSnapshot = snapshotDir(realSenpiAgentDir)
  const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  if (senpiBin === null) {
    return {
      result: "SKIP",
      reason: "senpi-binary-unavailable",
      providedAgentDir: process.env.SENPI_CODING_AGENT_DIR ? "IGNORED" : "unset",
    }
  }

  seedSandbox(sandbox)
  const realCmuxExecutable = real ? resolveRealCmuxExecutable() : null
  if (real && realCmuxExecutable === null) {
    return {
      result: "SKIP",
      reason: "real-cmux-binary-unavailable",
      providedAgentDir: process.env.SENPI_CODING_AGENT_DIR ? "IGNORED" : "unset",
      sandboxAgentDir: sandbox.agentDir,
      sandboxCwd: sandbox.cwd,
    }
  }
  seedCmuxExecutable(realCmuxExecutable)
  seedProject()
  const executable = fakeCmux

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
  const allRealSenpiChangedPaths = changedRealPaths(beforeSnapshot, snapshotDir(realSenpiAgentDir))
  const capturedInvocation = readCapturedInvocation()
  const capturedArgs = capturedInvocation.args
  const cmuxExit = capturedInvocation.status
  const notificationCaptured = isExpectedNotification(capturedArgs) && cmuxExit === 0
  const realSenpiCredentialsUntouched = beforeCredentialDigest === afterCredentialDigest
  const realSenpiDigestUnchanged = beforeFullDigest === afterFullDigest
  const { qaAttributedPaths, concurrentSessionPaths } = classifyProbeRealSenpiChanges(allRealSenpiChangedPaths, sandbox, capturedArgs)
  const realSenpiUntouched = qaAttributedPaths.length === 0
  return {
    result: run.status === 0 && notificationCaptured && realSenpiUntouched ? "PASS" : "FAIL",
    mode: real ? "real-cmux" : "fake-cmux",
    senpiExit: run.status,
    senpiSignal: run.signal ?? null,
    notificationCaptured,
    cmuxExecutable: real ? realCmuxExecutable : basename(executable),
    cmuxProbeExecutable: basename(executable),
    cmuxExit,
    cmuxArgs: capturedArgs,
    tmuxMarker: env.TMUX,
    realSenpiCredentialsUntouched,
    realSenpiDigestUnchanged,
    realSenpiUntouched,
    realSenpiChangedPaths: qaAttributedPaths,
    concurrentRealSenpiChangedPaths: concurrentSessionPaths,
    allRealSenpiChangedPaths,
    providedAgentDir: process.env.SENPI_CODING_AGENT_DIR ? "IGNORED" : "unset",
    sandboxAgentDir: sandbox.agentDir,
    sandboxCwd: sandbox.cwd,
    sessionDir,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
  }
}

function seedCmuxExecutable(realExecutable) {
  const source = realExecutable === null ? `#!/usr/bin/env node
import { writeFileSync } from "node:fs"
const args = process.argv.slice(2)
writeFileSync(process.env.CMUX_PROBE_LOG, JSON.stringify({ args, status: 0, signal: null, error: null }) + "\\n")
` : `#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
const args = process.argv.slice(2)
const run = spawnSync(${JSON.stringify(realExecutable)}, args, { encoding: "utf8" })
writeFileSync(process.env.CMUX_PROBE_LOG, JSON.stringify({
  args,
  status: run.status,
  signal: run.signal ?? null,
  error: run.error instanceof Error ? run.error.message : null
}) + "\\n")
process.exit(run.status ?? 1)
`
  writeFileSync(fakeCmux, source, "utf8")
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

function readCapturedInvocation() {
  if (!existsSync(logPath)) return { args: [], status: null }
  const parsed = JSON.parse(readFileSync(logPath, "utf8"))
  if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
    return { args: parsed, status: 0 }
  }
  if (parsed !== null && typeof parsed === "object" && Array.isArray(parsed.args)) {
    return {
      args: parsed.args.every((item) => typeof item === "string") ? parsed.args : [],
      status: typeof parsed.status === "number" ? parsed.status : null,
    }
  }
  return { args: [], status: null }
}

function isExpectedNotification(args) {
  return args[0] === "notify" &&
    args[1] === "--title" &&
    args[2] === "OMO task finished" &&
    args[3] === "--body" &&
    typeof args[4] === "string" &&
    args[4].includes("cmuxprobe") &&
    args[4].includes("completed")
}

function classifyProbeRealSenpiChanges(changedPaths, sandbox, cmuxArgs) {
  const taskIds = String(cmuxArgs.join("\n")).match(/st_[A-Za-z0-9]+/g) ?? []
  const tokens = [
    basename(sandbox.root),
    sessionPathToken(sandbox.cwd),
    sessionPathToken(sandbox.canonicalCwd),
    ...taskIds,
  ].filter((token) => token.length > 0)
  const qaAttributedPaths = []
  const concurrentSessionPaths = []
  for (const path of changedPaths) {
    const independentSession = path.startsWith("sessions/") && !tokens.some((token) => path.includes(token))
    if (independentSession) concurrentSessionPaths.push(path)
    else qaAttributedPaths.push(path)
  }
  return { qaAttributedPaths, concurrentSessionPaths }
}

function sessionPathToken(path) {
  return `-${path.replaceAll("/", "-")}-`
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
