#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  changedSnapshotPaths,
  classifyObservedChanges,
  digestDirectory,
  OBSERVATION_LIMITS,
  PROTECTED_STATE_FILES,
  protectedSnapshotsUntouched,
  snapshotDirectory,
  snapshotProtectedState,
} from "./isolation-state.mjs"

export { credentialDigest, digestDirectory } from "./isolation-state.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const repoRoot = resolve(packageRoot, "..", "..")
const pluginRoot = join(packageRoot, "plugin")
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const realOmoAgentDir = join(homedir(), ".omo", "agent")
const commentCheckerHeader = "comment-checker found issues in"

// Protected top-level state determines the isolation verdict. Bounded full-tree observations are
// supporting evidence only: concurrent host sessions legitimately update logs, caches, and session
// JSONL, so observed paths are never attributed to QA.

export function createSandbox() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "omo-senpi-qa-")))
  const cwd = join(root, "project")
  const agentDir = join(root, "agent")
  const xdgConfigHome = join(root, "xdg")
  const xdgDataHome = join(root, "xdg-data")
  const xdgCacheHome = join(root, "xdg-cache")
  const homeDir = join(root, "home")
  return { root, cwd, agentDir, xdgConfigHome, xdgDataHome, xdgCacheHome, homeDir, canonicalCwd: cwd }
}

export function seedSandbox({ cwd, agentDir, xdgConfigHome, xdgDataHome, xdgCacheHome, homeDir, canonicalCwd }) {
  mkdirp(cwd)
  mkdirp(agentDir)
  if (homeDir !== undefined) mkdirp(homeDir)
  // The omo config loader reads the user scope from XDG_CONFIG_HOME; without an isolated one every
  // lane inherits the developer's real ~/.config/omo agents and categories and stops being reproducible.
  if (xdgConfigHome !== undefined) mkdirp(xdgConfigHome)
  if (xdgDataHome !== undefined) mkdirp(xdgDataHome)
  if (xdgCacheHome !== undefined) mkdirp(xdgCacheHome)
  const settings = {
    defaultProjectTrust: "ask",
    packages: [pluginRoot],
  }
  writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`)
  writeFileSync(join(agentDir, "trust.json"), `${JSON.stringify({ [canonicalCwd]: true }, null, 2)}\n`)
}

export function resolveCommentCheckerBin() {
  try {
    const require = createRequire(join(repoRoot, "package.json"))
    return require.resolve("@code-yeongyu/comment-checker/cli.js")
  } catch {
    return null
  }
}

function runSelfTest() {
  const sandbox = createSandbox()
  try {
    seedSandbox(sandbox)
    const trust = JSON.parse(readFileSync(join(sandbox.agentDir, "trust.json"), "utf8"))
    if (trust[sandbox.canonicalCwd] !== true) throw new Error("trust.json missing canonical cwd")
    if (sandbox.agentDir === process.env.SENPI_CODING_AGENT_DIR) throw new Error("sandbox reused caller agent dir")
    if (sandbox.xdgConfigHome === process.env.XDG_CONFIG_HOME) throw new Error("sandbox reused caller xdg config home")
    if (!existsSync(sandbox.xdgConfigHome)) throw new Error("sandbox xdg config home missing")
    const before = digestDirectory(join(sandbox.root, "missing"))
    if (before !== "absent") throw new Error("missing directory digest should be absent")
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

function runSenpi(senpiBin, sandbox, prompt, script, extraEnv = {}) {
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(script, null, 2)}\n`)
  return spawnSync(senpiBin, ["-e", mockProviderEntry, "-p", "--provider", "omo-mock", "--model", "mock-1", prompt], {
    cwd: sandbox.cwd,
    env: {
      ...process.env,
      ...extraEnv,
      OMO_CODING_AGENT_DIR: sandbox.agentDir,
      SENPI_CODING_AGENT_DIR: sandbox.agentDir,
      PI_CODING_AGENT_DIR: sandbox.agentDir,
      HOME: sandbox.homeDir,
      USERPROFILE: sandbox.homeDir,
      XDG_CONFIG_HOME: sandbox.xdgConfigHome,
      XDG_DATA_HOME: sandbox.xdgDataHome,
      XDG_CACHE_HOME: sandbox.xdgCacheHome,
      PI_OFFLINE: "1",
      OMO_SENPI_QA: "1",
    },
    encoding: "utf8",
    timeout: 60_000,
  })
}

function main() {
  const providedSenpiCodingAgentDir = process.env.SENPI_CODING_AGENT_DIR ? "IGNORED" : "unset"
  const isolationBefore = {
    senpiProtected: snapshotProtectedState(realSenpiAgentDir),
    omoProtected: snapshotProtectedState(realOmoAgentDir),
    senpiObserved: snapshotDirectory(realSenpiAgentDir),
    omoObserved: snapshotDirectory(realOmoAgentDir),
  }
  const sandbox = createSandbox()
  let commentChecker = "NOT-RUN"
  let ultraworkInjected = false
  let result = "FAIL"
  let reason = undefined

  try {
    seedSandbox(sandbox)

    const senpiBin = process.env.SENPI_BIN?.trim() || "senpi"
    if (senpiBin.includes("/") && !existsSync(senpiBin)) {
      result = "SKIP"
      reason = "senpi-binary-unavailable"
      return printResult({ result, reason, ultraworkInjected, commentChecker, isolationBefore, sandbox, providedSenpiCodingAgentDir })
    }

    const resolvedSenpi = senpiBin.includes("/") ? senpiBin : findOnPath(senpiBin)
    if (resolvedSenpi === null) {
      result = "SKIP"
      reason = "senpi-binary-unavailable"
      return printResult({ result, reason, ultraworkInjected, commentChecker, isolationBefore, sandbox, providedSenpiCodingAgentDir })
    }

    const ultrawork = runSenpi(resolvedSenpi, sandbox, "ulw please respond", {
      steps: [{ type: "text", text: "ultrawork scenario complete" }],
    })
    ultraworkInjected = ultrawork.status === 0 && readSandboxText(sandbox.agentDir).includes("<ultrawork-mode>")

    const checkerBin = resolveCommentCheckerBin()
    if (checkerBin === null) {
      commentChecker = "SKIPPED-no-binary"
    } else {
      const checker = runSenpi(
        resolvedSenpi,
        sandbox,
        "write qa slop",
        {
          steps: [
            {
              type: "tool_call",
              name: "write",
              arguments: {
                path: "qa-slop.ts",
                content: "// this function adds two numbers\nexport function add(a: number, b: number) { return a + b }\n",
              },
            },
            { type: "text", text: "done" },
          ],
        },
        { OMO_COMMENT_CHECKER_BIN: checkerBin },
      )
      commentChecker = checker.status === 0 && readSandboxText(sandbox.agentDir).includes(commentCheckerHeader) ? "PASS" : "FAIL"
    }

    result = ultraworkInjected && (commentChecker === "PASS" || commentChecker === "SKIPPED-no-binary") ? "PASS" : "FAIL"
    return printResult({ result, reason, ultraworkInjected, commentChecker, isolationBefore, sandbox, providedSenpiCodingAgentDir })
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

function printResult({ result, reason, ultraworkInjected, commentChecker, isolationBefore, sandbox, providedSenpiCodingAgentDir }) {
  const senpiProtectedAfter = snapshotProtectedState(realSenpiAgentDir)
  const omoProtectedAfter = snapshotProtectedState(realOmoAgentDir)
  const senpiObservedAfter = snapshotDirectory(realSenpiAgentDir)
  const omoObservedAfter = snapshotDirectory(realOmoAgentDir)
  const realSenpiChangedPaths = changedSnapshotPaths(isolationBefore.senpiProtected.snapshot, senpiProtectedAfter.snapshot)
  const realOmoChangedPaths = changedSnapshotPaths(isolationBefore.omoProtected.snapshot, omoProtectedAfter.snapshot)
  const realSenpiObservedChangedPaths = changedSnapshotPaths(isolationBefore.senpiObserved.snapshot, senpiObservedAfter.snapshot)
  const realOmoObservedChangedPaths = changedSnapshotPaths(isolationBefore.omoObserved.snapshot, omoObservedAfter.snapshot)
  const senpiObserved = classifyObservedChanges(realSenpiObservedChangedPaths)
  const omoObserved = classifyObservedChanges(realOmoObservedChangedPaths)
  const payload = {
    result,
    ...(reason ? { reason } : {}),
    ultraworkInjected,
    commentChecker,
    realSenpiUntouched: protectedSnapshotsUntouched(isolationBefore.senpiProtected, senpiProtectedAfter),
    realSenpiChangedPaths,
    realSenpiProtectedStateComplete: isolationBefore.senpiProtected.complete && senpiProtectedAfter.complete,
    realSenpiProtectedErrors: protectedErrors(isolationBefore.senpiProtected, senpiProtectedAfter),
    realOmoUntouched: protectedSnapshotsUntouched(isolationBefore.omoProtected, omoProtectedAfter),
    realOmoChangedPaths,
    realOmoProtectedStateComplete: isolationBefore.omoProtected.complete && omoProtectedAfter.complete,
    realOmoProtectedErrors: protectedErrors(isolationBefore.omoProtected, omoProtectedAfter),
    realSenpiObservedChangedPaths,
    realSenpiVolatileChangedPaths: senpiObserved.volatile,
    realSenpiProtectedObservedChangedPaths: senpiObserved.protectedState,
    realSenpiOtherObservedChangedPaths: senpiObserved.other,
    realOmoObservedChangedPaths,
    realOmoVolatileChangedPaths: omoObserved.volatile,
    realOmoProtectedObservedChangedPaths: omoObserved.protectedState,
    realOmoOtherObservedChangedPaths: omoObserved.other,
    realSenpiObservationComplete: isolationBefore.senpiObserved.complete && senpiObservedAfter.complete,
    realSenpiObservationTruncated: isolationBefore.senpiObserved.truncated || senpiObservedAfter.truncated,
    realSenpiObservationErrors: [...isolationBefore.senpiObserved.errors, ...senpiObservedAfter.errors],
    realSenpiObservationBytesRead: isolationBefore.senpiObserved.bytesRead + senpiObservedAfter.bytesRead,
    realOmoObservationComplete: isolationBefore.omoObserved.complete && omoObservedAfter.complete,
    realOmoObservationTruncated: isolationBefore.omoObserved.truncated || omoObservedAfter.truncated,
    realOmoObservationErrors: [...isolationBefore.omoObserved.errors, ...omoObservedAfter.errors],
    realOmoObservationBytesRead: isolationBefore.omoObserved.bytesRead + omoObservedAfter.bytesRead,
    protectedStateFiles: PROTECTED_STATE_FILES,
    observationLimits: OBSERVATION_LIMITS,
    realHomesChecked: [realSenpiAgentDir, realOmoAgentDir],
    providedSenpiCodingAgentDir,
    sandboxAgentDir: sandbox.agentDir,
    sandboxCwd: sandbox.cwd,
  }
  console.log(JSON.stringify(payload))
}

function protectedErrors(before, after) {
  return [
    ...before.errors.map((error) => ({ phase: "before", ...error })),
    ...after.errors.map((error) => ({ phase: "after", ...error })),
  ]
}

function collectFiles(root, files) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) collectFiles(path, files)
    else if (entry.isFile()) files.push(path)
  }
}

function readSandboxText(root) {
  if (!existsSync(root)) return ""
  const files = []
  collectFiles(root, files)
  return files
    .filter((file) => file.endsWith(".json") || file.endsWith(".jsonl") || file.endsWith(".log") || file.endsWith(".md"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n")
}

function mkdirp(path) {
  spawnSync("mkdir", ["-p", path])
}

function findOnPath(bin) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    runSelfTest()
    console.log("SELF-TEST OK")
  } else {
    main()
  }
}
