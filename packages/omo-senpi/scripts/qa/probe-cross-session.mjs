#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { toSpawnTarget } from "../../src/components/ulw-loop/omo-command.ts"

const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = join(dirname(scriptPath), "../../../..")
const toolkitExecutable = process.platform === "win32" ? "omo-agent-toolkit.cmd" : "omo-agent-toolkit"
const toolkitBin = join(repoRoot, "packages/omo-senpi/plugin/runtime/agent-toolkit", toolkitExecutable)
// Senpi never puts a session id on the extension host's process.env, so the host-with-no-session-identity
// scenario is the one that actually models production. It must never continue an unscoped run.
const NO_SESSION = "--no-session"

if (process.argv[2] === "--extension-child") {
  const sessionId = process.argv[3]
  if (!sessionId) throw new Error("extension child requires a session id")
  const result = await runExtensionChild(sessionId === NO_SESSION ? null : sessionId)
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exit(0)
}

const sharedCwd = mkdtempSync(join(tmpdir(), "omo-senpi-cross-session-"))
let result
try {
  runToolkit(
    ["ulw-loop", "create-goals", "--brief", "- Session A owns this active run", "--json"],
    sharedCwd,
    "session-A",
    0,
  )

  const sessionA = runChild(sharedCwd, "session-A")
  const sessionB = runChild(sharedCwd, "session-B")
  const paths = {
    ownerPlan: existsSync(join(sharedCwd, ".omo/ulw-loop/session-A/goals.json")),
    unrelatedPlan: existsSync(join(sharedCwd, ".omo/ulw-loop/session-B/goals.json")),
    sharedRootPlan: existsSync(join(sharedCwd, ".omo/ulw-loop/goals.json")),
  }

  assert(sessionA.messageCount === 1, `session A continuation count was ${sessionA.messageCount}, expected 1`)
  assert(sessionB.messageCount === 0, `session B continuation count was ${sessionB.messageCount}, expected 0`)
  assert(paths.ownerPlan, "session A scoped plan is missing")
  assert(!paths.unrelatedPlan, "session B unexpectedly owns a plan")
  assert(!paths.sharedRootPlan, "cwd-global root plan was created")

  result = { sessionA, sessionB, paths, noSessionHost: runNoSessionScenario() }
} finally {
  rmSync(sharedCwd, { recursive: true, force: true })
}

assert(!existsSync(sharedCwd), "shared QA cwd was not removed")
process.stdout.write(
  `${JSON.stringify({
    verdict: "PASS",
    ...result,
    cleanup: { removedSharedCwd: true },
  })}\n`,
)

// Legacy/unscoped runs live at `.omo/ulw-loop/goals.json` and are visible to every session sharing the
// cwd. A host that cannot name its own session must report inactive rather than adopt that run.
function runNoSessionScenario() {
  const cwd = mkdtempSync(join(tmpdir(), "omo-senpi-no-session-"))
  try {
    runToolkit(
      ["ulw-loop", "create-goals", "--brief", "- An unscoped legacy run nobody owns", "--json"],
      cwd,
      null,
      0,
    )
    const unscopedPlan = existsSync(join(cwd, ".omo/ulw-loop/goals.json"))
    assert(unscopedPlan, "the unscoped legacy plan fixture was not created")

    const child = runChild(cwd, NO_SESSION)
    assert(
      child.messageCount === 0,
      `host without session identity continued ${child.messageCount} times, expected 0`,
    )
    return { sessionId: null, messageCount: child.messageCount, unscopedPlan }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

async function runExtensionChild(sessionId) {
  const [{ FakeExtensionAPI }, { createUlwLoopComponent }] = await Promise.all([
    import(
      pathToFileURL(join(repoRoot, "packages/omo-senpi/test-support/fake-extension-api.ts")).href
    ),
    import(
      pathToFileURL(join(repoRoot, "packages/omo-senpi/src/components/ulw-loop/index.ts")).href
    ),
  ])
  const pi = new FakeExtensionAPI()
  await createUlwLoopComponent({
    resolveOmoBin: () => toolkitBin,
  }).register(pi, {
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    config: { getFlag: () => false },
  })

  await pi.dispatch(
    "agent_end",
    { type: "agent_end" },
    {
      cwd: process.cwd(),
      // A host with no session identity exposes no session id at all, exactly like the real extension host.
      ...(sessionId === null ? {} : { sessionManager: { getSessionId: () => sessionId } }),
    },
  )

  return {
    sessionId,
    messageCount: pi.messages.length,
    customTypes: pi.messages.map((entry) => entry.message.customType),
  }
}

function runChild(cwd, sessionId) {
  const child = spawnSync(process.execPath, [scriptPath, "--extension-child", sessionId], {
    cwd,
    env: sessionEnv(sessionId === NO_SESSION ? null : sessionId),
    encoding: "utf8",
    timeout: 30_000,
  })
  if (child.status !== 0) {
    throw new Error(`extension child ${sessionId} failed: ${child.stderr || child.stdout}`)
  }
  return JSON.parse(child.stdout)
}

function runToolkit(args, cwd, sessionId, expectedStatus) {
  const target = toSpawnTarget(toolkitBin, args)
  const child = spawnSync(target.command, [...target.args], {
    cwd,
    env: sessionEnv(sessionId),
    encoding: "utf8",
    timeout: 30_000,
  })
  if (child.status !== expectedStatus) {
    throw new Error(`toolkit exited ${child.status}: ${child.stderr || child.stdout}`)
  }
  return child.stdout
}

// `sessionId === null` reproduces the real extension host: no session variable of any kind in the env.
function sessionEnv(sessionId) {
  const env = { ...process.env }
  delete env.OMO_ULW_LOOP_SESSION_ID
  delete env.CODEX_SESSION_ID
  delete env.CODEX_THREAD_ID
  delete env.PI_SESSION_ID
  if (sessionId !== null) env.PI_SESSION_ID = sessionId
  return env
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
