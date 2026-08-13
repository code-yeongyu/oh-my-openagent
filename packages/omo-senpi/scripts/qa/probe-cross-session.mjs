#!/usr/bin/env node
// Real-surface proof for issue #6828: two independent Senpi processes in ONE shared cwd.
// Session A holds an active incomplete ulw-loop run; session B finishes an unrelated task.
// The fixed adapter must scope ulw-loop state by session: B must never see or continue A's
// run, A's scoped state must stay intact, and the on-disk state must live under
// .omo/ulw-loop/senpi-<id>/ (never the shared .omo/ulw-loop/ root).
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createSandbox, digestDirectory, seedSandbox } from "./drive.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const pluginRoot = join(packageRoot, "plugin")
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const stagedToolkit = join(pluginRoot, "runtime", "agent-toolkit", "omo-agent-toolkit")
const CONTINUATION_PHRASE = "Continue the active omo-agent-toolkit ulw-loop run"
const INJECTION_MARKER = "omo-senpi:ulw-loop-continuation"

function digestFile(path) {
  if (!existsSync(path)) return "absent"
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function listScopedStateDirs(cwd) {
  const ulwRoot = join(cwd, ".omo", "ulw-loop")
  if (!existsSync(ulwRoot)) return []
  return readdirSync(ulwRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function runSenpi(senpiBin, sandbox, prompt, script) {
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(script, null, 2)}\n`)
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  return spawnSync(
    senpiBin,
    ["-e", mockProviderEntry, "-p", "--session-dir", sessionDir, "--provider", "omo-mock", "--model", "mock-1", prompt],
    {
      cwd: sandbox.cwd,
      env: {
        ...process.env,
        PATH: `${dirname(stagedToolkit)}:${process.env.PATH ?? ""}`,
        OMO_AGENT_TOOLKIT_BIN: stagedToolkit,
        SENPI_CODING_AGENT_DIR: sandbox.agentDir,
        XDG_CONFIG_HOME: sandbox.xdgConfigHome,
        OMO_SENPI_QA: "1",
      },
      encoding: "utf8",
      timeout: 90_000,
    },
  )
}

function selfTest() {
  const sandbox = createSandbox()
  try {
    seedSandbox(sandbox)
    if (!existsSync(stagedToolkit)) throw new Error(`staged toolkit missing at ${stagedToolkit}`)
    if (sandbox.agentDir === process.env.SENPI_CODING_AGENT_DIR) throw new Error("sandbox reused caller agent dir")
    const dirs = listScopedStateDirs(sandbox.cwd)
    if (dirs.length !== 0) throw new Error("fresh sandbox must have no scoped state dirs")
    if (digestFile(join(sandbox.cwd, "nope.json")) !== "absent") throw new Error("digestFile absent contract broken")
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

function main() {
  const beforeDigest = digestDirectory(realSenpiAgentDir)
  const sandbox = createSandbox()
  const result = {
    result: "FAIL",
    aContinuationObserved: false,
    bContinuationObserved: false,
    aScopedStateDir: null,
    aStateDigestBefore: "absent",
    aStateDigestAfter: "absent",
    rootUnscopedGoals: false,
    bTranscriptSnippet: null,
    aTranscriptSnippet: null,
    sessionDirDump: null,
    realSenpiUntouched: false,
    reason: undefined,
  }

  try {
    seedSandbox(sandbox)

    const senpiBin = process.env.SENPI_BIN?.trim() || "senpi"
    const resolvedSenpi = senpiBin.includes("/") ? (existsSync(senpiBin) ? senpiBin : null) : findOnPath(senpiBin)
    if (resolvedSenpi === null) {
      result.reason = "senpi-binary-unavailable"
      return print(result, beforeDigest)
    }
    if (!existsSync(stagedToolkit)) {
      result.reason = "staged-toolkit-missing"
      return print(result, beforeDigest)
    }

    // Session A: start an incomplete ulw-loop run through the REAL bash tool (the model's
    // spawned shell must inherit the extension process env, i.e. OMO_ULW_LOOP_SESSION_ID).
    const runA = runSenpi(resolvedSenpi, sandbox, "start a ulw-loop run", {
      steps: [
        {
          type: "tool_call",
          name: "bash",
          arguments: {
            command:
              "omo-agent-toolkit ulw-loop create-goals --brief 'cross-session isolation proof' --json && omo-agent-toolkit ulw-loop status --json",
          },
        },
        { type: "text", text: "run created, leaving it incomplete" },
      ],
    })
    const transcriptA = `${runA.stdout}\n${runA.stderr}`
    result.aTranscriptSnippet = transcriptA.slice(0, 700)

    const scopedDirs = listScopedStateDirs(sandbox.cwd)
    result.aScopedStateDir = scopedDirs[0] ?? null
    // The print-mode transcript does not render hidden followUp messages; the session record does.
    // A's own agent_end must have delivered the continuation into A's session JSONL.
    result.aContinuationObserved = sessionHasContinuation(sandbox, result.aScopedStateDir)
    const ulwRoot = join(sandbox.cwd, ".omo", "ulw-loop")
    result.rootUnscopedGoals = existsSync(join(ulwRoot, "goals.json"))
    if (result.aScopedStateDir !== null) {
      const stateDir = join(ulwRoot, result.aScopedStateDir)
      result.aStateDigestBefore = digestFile(join(stateDir, "goals.json")) + digestFile(join(stateDir, "ledger.jsonl"))
    }

    if (result.aScopedStateDir === null || result.rootUnscopedGoals) {
      result.reason = "state-not-session-scoped"
      return print(result, beforeDigest)
    }

    // Session B: an unrelated task in the SAME cwd. The fixed adapter must not inject A's
    // continuation into B's turn.
    const runB = runSenpi(resolvedSenpi, sandbox, "do an unrelated task", {
      steps: [{ type: "text", text: "unrelated task complete" }],
    })
    const transcriptB = `${runB.stdout}\n${runB.stderr}`
    result.bTranscriptSnippet = transcriptB.slice(0, 400)
    result.bContinuationObserved = sessionHasContinuation(
      sandbox,
      result.aScopedStateDir === null ? "definitely-no-such-session" : otherSessionPrefix(sandbox, result.aScopedStateDir),
    )

    if (result.aScopedStateDir !== null) {
      const stateDir = join(ulwRoot, result.aScopedStateDir)
      result.aStateDigestAfter = digestFile(join(stateDir, "goals.json")) + digestFile(join(stateDir, "ledger.jsonl"))
    }

    result.result =
      result.aContinuationObserved &&
      !result.bContinuationObserved &&
      result.aScopedStateDir !== null &&
      !result.rootUnscopedGoals &&
      result.aStateDigestBefore === result.aStateDigestAfter
        ? "PASS"
        : "FAIL"
    result.sessionDirDump = sessionDirDump(sandbox)
    return print(result, beforeDigest)
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

function otherSessionPrefix(sandbox, ownScopeId) {
  const sessionDir = join(sandbox.root, "sessions")
  if (!existsSync(sessionDir)) return "definitely-no-such-session"
  const ownPrefix = ownScopeId.slice("senpi-".length)
  for (const file of readdirSync(sessionDir)) {
    if (!file.endsWith(".jsonl")) continue
    if (!file.includes(ownPrefix)) return file.split("_").at(-1)?.replace(".jsonl", "") ?? "definitely-no-such-session"
  }
  return "definitely-no-such-session"
}

function sessionHasContinuation(sandbox, scopeId) {
  const sessionDir = join(sandbox.root, "sessions")
  if (!existsSync(sessionDir)) return false
  const expectedPrefix = scopeId.slice("senpi-".length)
  for (const file of readdirSync(sessionDir)) {
    if (!file.endsWith(".jsonl")) continue
    if (expectedPrefix !== null && !file.includes(expectedPrefix)) continue
    const content = readFileSync(join(sessionDir, file), "utf8")
    if (content.includes(INJECTION_MARKER) || content.includes(CONTINUATION_PHRASE)) return true
  }
  return false
}

function sessionDirDump(sandbox) {
  const sessionDir = join(sandbox.root, "sessions")
  if (!existsSync(sessionDir)) return "no-session-dir"
  const out = []
  for (const file of readdirSync(sessionDir)) {
    if (!file.endsWith(".jsonl") && !file.endsWith(".json")) continue
    const content = readFileSync(join(sessionDir, file), "utf8")
    const hasContinuation = content.includes("omo-senpi:ulw-continuation") || content.includes("Continue the active omo-agent-toolkit ulw-loop run")
    const hasSteering = content.includes("omo-senpi-ulw-loop")
    out.push({ file, bytes: content.length, hasContinuation, hasSteering })
  }
  return out
}

function print(result, beforeDigest) {
  const afterDigest = digestDirectory(realSenpiAgentDir)
  console.log(
    JSON.stringify({
      ...result,
      realSenpiUntouched: result.reason === "senpi-binary-unavailable" ? true : beforeDigest === afterDigest,
      sandboxAgentDir: result.sandboxAgentDir,
    }),
  )
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
    selfTest()
    console.log("SELF-TEST OK")
  } else {
    main()
  }
}
