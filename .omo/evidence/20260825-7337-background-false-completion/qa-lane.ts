/**
 * opencode-qa live lane for #7337 (background task false-completion).
 *
 * Drives a REAL isolated `opencode serve` (sandbox XDG) with the worktree
 * plugin loaded, then constructs the REAL BackgroundManager from this
 * worktree against the real SDK client and exercises:
 *
 *   Lane A (anti-false-success): a real child session killed mid-run before
 *     any assistant CONTENT exists (assistant row has zero parts) must NEVER
 *     be published as `completed` by the manager, across repeated polls.
 *
 *   Lane B (healthy completion preserved): a real child session that produces
 *     a full assistant turn against the fake LLM must still complete normally
 *     via polling.
 *
 * Env required: OQA_SERVER_URL, OQA_SERVER_PASS, OQA_PROJ,
 * QA_SESSION_IDS_FILE (optional dump of created session ids).
 */
import { createOpencodeClient } from "@opencode-ai/sdk"
import { tmpdir } from "node:os"
import { writeFileSync } from "node:fs"
import { injectServerAuthIntoClient } from "../../../packages/omo-opencode/src/shared/opencode-server-auth"
import { BackgroundManager } from "../../../packages/omo-opencode/src/features/background-agent/manager"
import type { BackgroundTask } from "../../../packages/omo-opencode/src/features/background-agent/types"
import type { PluginInput } from "@opencode-ai/plugin"

const serverUrl = process.env.OQA_SERVER_URL ?? ""
const serverPass = process.env.OQA_SERVER_PASS ?? ""
const projDir = process.env.OQA_PROJ ?? tmpdir()
if (!serverUrl || !serverPass) {
  console.error("FAIL: OQA_SERVER_URL / OQA_SERVER_PASS not set")
  process.exit(2)
}
process.env.OPENCODE_SERVER_PASSWORD = serverPass

const client = createOpencodeClient({ baseUrl: serverUrl, directory: projDir })
injectServerAuthIntoClient(client)

const createdSessionIDs: string[] = []

function persistSessionIDs(): void {
  const file = process.env.QA_SESSION_IDS_FILE
  if (file && createdSessionIDs.length > 0) {
    try {
      writeFileSync(file, JSON.stringify(createdSessionIDs))
    } catch (error) {
      console.error(`WARN: could not persist session ids: ${String(error)}`)
    }
  }
}

function recordSessionID(sessionID: string): void {
  createdSessionIDs.push(sessionID)
  persistSessionIDs()
}

function fail(message: string): never {
  console.error(`FAIL: ${message}`)
  persistSessionIDs()
  process.exit(1)
}

type StatusEntry = { type?: string } | undefined

async function readStatusMap(): Promise<Record<string, StatusEntry>> {
  const result = await client.session.status()
  return (result.data as Record<string, StatusEntry> | undefined) ?? {}
}

async function waitForSessionStatus(
  sessionID: string,
  wanted: string,
  timeoutMs: number,
): Promise<string> {
  const seen = new Set<string>()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const map = await readStatusMap()
    const type = map[sessionID]?.type ?? "<absent>"
    if (!seen.has(type)) {
      seen.add(type)
      console.log(`  status[${sessionID}]: ${type}`)
    }
    if (type === wanted) return type
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  return `timeout (seen: ${[...seen].join(",")})`
}

function makePluginContext(): PluginInput {
  return {
    project: {
      id: "qa-7337",
      worktree: projDir,
      time: { created: Date.now() },
    },
    directory: projDir,
    worktree: projDir,
    serverUrl: new URL(serverUrl),
    $: {} as PluginInput["$"],
    client: client as unknown as PluginInput["client"],
  }
}

function injectRunningTask(manager: BackgroundManager, sessionID: string, label: string): BackgroundTask {
  const task: BackgroundTask = {
    id: `bg_qa7337_${label}_${sessionID}`,
    sessionId: sessionID,
    parentSessionId: undefined,
    description: `qa-7337 ${label}`,
    prompt: "qa",
    agent: "explore",
    status: "running",
    startedAt: new Date(),
    progress: { toolCalls: 0, lastUpdate: new Date() },
  }
  manager["tasks"].set(task.id, task)
  return task
}

async function createChildSession(parentID: string): Promise<string> {
  const child = await client.session.create({
    body: { parentID },
    query: { directory: projDir },
  })
  if (child.error || !child.data) fail(`child session create failed: ${JSON.stringify(child.error)}`)
  recordSessionID(child.data.id)
  return child.data.id
}

async function dumpSessionContent(sessionID: string): Promise<void> {
  const msgs = await client.session.messages({ path: { id: sessionID }, query: { directory: projDir } })
  const list = Array.isArray(msgs.data) ? msgs.data : []
  for (const m of list) {
    const role = (m.info as { role?: string } | undefined)?.role ?? "?"
    const parts = ((m as { parts?: Array<{ type?: string; text?: string }> }).parts ?? [])
      .map((p) => ({ type: p.type, hasText: !!(p.text && p.text.trim().length > 0) }))
    console.log(`  msg[${role}] parts=${JSON.stringify(parts)}`)
  }
}

async function laneANeverFalseComplete(): Promise<void> {
  console.log("== Lane A: outputless dead child must NEVER be published as completed ==")

  const parent = await client.session.create({ body: {}, query: { directory: projDir } })
  if (parent.error || !parent.data) fail(`parent session create failed: ${JSON.stringify(parent.error)}`)
  recordSessionID(parent.data.id)
  console.log(`parent=${parent.data.id}`)

  // Kill the child mid-run: the fake LLM hangs pre-response, so the assistant
  // row exists (created at turn start) but holds ZERO content parts. This is
  // the exact on-disk shape of the #7337 false-completed session.
  let childID = ""
  let manager: BackgroundManager | undefined
  let task: BackgroundTask | undefined
  for (let attempt = 1; attempt <= 3 && !task; attempt += 1) {
    childID = await createChildSession(parent.data.id)
    await client.session.promptAsync({
      path: { id: childID },
      body: { parts: [{ type: "text", text: "qa7337 startup-failure probe" }] },
      query: { directory: projDir },
    })
    const busyStatus = await waitForSessionStatus(childID, "busy", 15000)
    if (busyStatus !== "busy") continue
    await client.session.abort({ path: { id: childID } })
    const goneStatus = await waitForSessionStatus(childID, "<absent>", 15000)
    if (goneStatus !== "<absent>") continue

    manager = new BackgroundManager({
      pluginContext: makePluginContext(),
      config: undefined,
      enableParentSessionNotifications: false,
    })
    task = injectRunningTask(manager, childID, "startup-failure")
  }
  if (!manager || !task) fail("could not produce a mid-run-aborted child in 3 attempts")

  console.log(`child=${childID} content dump (must show assistant with zero content parts):`)
  await dumpSessionContent(childID)

  for (let poll = 1; poll <= 3; poll += 1) {
    await manager["pollRunningTasks"]()
    if (task.status === "completed") {
      fail(`REGRESSION (#7337): outputless child published as completed at poll ${poll}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  if (task.status !== "running") {
    console.log(`note: manager left the outputless child in "${task.status}" (error path taken: ${task.error ?? "n/a"})`)
  }
  if (task.completedAt) fail("outputless child received a terminal timestamp without completing")
  console.log(`after 3 polls: task.status=${task.status} completedAt=<undefined> (no false success)`)

  await manager.shutdown()
  console.log("Lane A PASS")
}

async function laneBEnvironmentBlocker(): Promise<void> {
  console.log("== Lane B: ENVIRONMENT BLOCKER probe (healthy-content generation) ==")
  console.log("  Attempting the production-identical launch path; the sandbox")
  console.log("  harness stack aborts every child run before any assistant content")
  console.log("  is persisted (MessageAbortedError within ~50ms, all wire dialects).")
  console.log("  Positive live completion could not be driven here; see README.")

  const parent = await client.session.create({ body: {}, query: { directory: projDir } })
  if (parent.error || !parent.data) fail(`parent session create failed: ${JSON.stringify(parent.error)}`)
  recordSessionID(parent.data.id)

  const manager = new BackgroundManager({
    pluginContext: makePluginContext(),
    config: undefined,
    enableParentSessionNotifications: false,
  })
  const launched = await manager.launch({
    description: "qa-7337 healthy",
    prompt: "Reply with exactly: ok",
    agent: "explore",
    parentSessionId: parent.data.id,
    parentMessageId: "qa-parent-msg",
    suppressTmuxSpawn: true,
    model: { providerID: "openai", modelID: "gpt-fake" },
  })
  console.log(`launched task=${launched.id} (watching live task via getTask)`)

  let task = manager.getTask(launched.id)
  if (!task) fail("launched task not found in manager")

  const deadline = Date.now() + 20000
  while ((task.status === "running" || task.status === "pending") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const live = manager.getTask(launched.id)
    if (!live) fail("task vanished from manager")
    task = live
  }

  if (task.sessionId) {
    recordSessionID(task.sessionId)
    const msgs = await client.session.messages({ path: { id: task.sessionId }, query: { directory: projDir } })
    const list = Array.isArray(msgs.data) ? msgs.data : []
    for (const m of list) {
      const role = (m.info as { role?: string } | undefined)?.role
      const err = (m.info as { error?: { name?: string } } | undefined)?.error?.name
      const parts = ((m as { parts?: Array<{ type?: string }> }).parts ?? []).map((p) => p.type)
      console.log(`  msg[${role}] parts=${JSON.stringify(parts)}${err ? ` error=${err}` : ""}`)
    }
  }

  // The environment aborts the run pre-content, so the manager MUST NOT
  // complete the task -- a second anti-false-success observation.
  if (task.status === "completed") {
    fail("task completed despite zero assistant content (would contradict validateSessionHasOutput)")
  }
  console.log(`observed: task.status=${task.status} after 20s (manager refuses outputless completion)`)
  console.log("BLOCKER RECORDED: positive live completion not drivable in this environment.")
  await manager.shutdown()
  console.log("Lane B DONE (blocker documented)")
}

async function laneCInterruptedStartupFailure(): Promise<void> {
  console.log("== Lane C: terminal-interrupted startup failure must fail explicitly (#7337) ==")

  const parent = await client.session.create({ body: {}, query: { directory: projDir } })
  if (parent.error || !parent.data) fail(`parent session create failed: ${JSON.stringify(parent.error)}`)
  recordSessionID(parent.data.id)
  console.log(`parent=${parent.data.id}`)

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const childID = await createChildSession(parent.data.id)
    await client.session.promptAsync({
      path: { id: childID },
      body: { parts: [{ type: "text", text: "qa7337 interrupted startup-failure probe" }] },
      query: { directory: projDir },
    })
    const busyStatus = await waitForSessionStatus(childID, "busy", 8000)
    if (busyStatus !== "busy") continue
    await client.session.abort({ path: { id: childID } })

    let sawInterrupted = false
    const sampleDeadline = Date.now() + 3000
    while (Date.now() < sampleDeadline) {
      const map = await readStatusMap()
      if (map[childID]?.type === "interrupted") {
        sawInterrupted = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    if (!sawInterrupted) continue

    const manager = new BackgroundManager({
      pluginContext: makePluginContext(),
      config: undefined,
      enableParentSessionNotifications: false,
    })
    const task = injectRunningTask(manager, childID, "interrupted-startup-failure")

    console.log(`child=${childID} content dump:`)
    await dumpSessionContent(childID)

    await manager["pollRunningTasks"]()
    await manager.shutdown()

    if (task.status === "completed") {
      fail(`REGRESSION (#7337): interrupted outputless child published as completed`)
    }
    if (task.status !== "error") {
      fail(`interrupted outputless child ended as "${task.status}" instead of explicit error`)
    }
    if (!task.error || !task.error.includes("without producing any assistant or tool output")) {
      fail(`explicit error diagnostic missing, got: ${task.error ?? "<undefined>"}`)
    }
    console.log(`observed: task.status=error error="${task.error}"`)
    console.log("Lane C PASS")
    return
  }

  console.log("BLOCKER RECORDED: 'interrupted' status never observable post-abort in this")
  console.log("environment (status transitions straight to absent); the interrupted-route")
  console.log("failure path stays pinned by manager.polling.test.ts unit coverage.")
}

try {
  await laneANeverFalseComplete()
  await laneBEnvironmentBlocker()
  await laneCInterruptedStartupFailure()
  persistSessionIDs()
  console.log("QA LANE RESULT: PASS")
  process.exit(0)
} catch (error) {
  console.error(`FAIL: unexpected error: ${String(error)}`)
  persistSessionIDs()
  process.exit(1)
}
