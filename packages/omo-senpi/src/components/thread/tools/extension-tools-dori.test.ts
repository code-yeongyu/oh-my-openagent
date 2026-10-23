import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { DORI_STORE_EXTENSION } from "../../ulw-loop/sdk/dori-gate"
import { gatewayDatabasePath } from "../gateway/paths"
import { createGatewayStore, type GatewayStore } from "../gateway/store"
import type { SessionCallableOp, StoreExtensionResult } from "../gateway/store-extensions"
import type { ThreadHost, ThreadHostSession } from "../tools"
import { buildExtensionTools } from "./extension-tools"
import { UNKNOWN_CALLER, type ThreadToolSurfaceOptions } from "./ports"

const directories: string[] = []
const stores: GatewayStore[] = []
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const fixture = new URL("../gateway/testing/dori-layer2-extension.mjs", import.meta.url)
const parameters = { type: "object", additionalProperties: false, properties: { note: { type: "string" }, replay_key: { type: "string" }, turn_id: { type: "string" } } }
const ops: SessionCallableOp[] = [
  { op: "replyMark", toolName: "reply_mark", description: "Mark a reply debt.", parameters },
  { op: "sendPost", toolName: "send_post", description: "Post to a room.", parameters },
]
const caller: ThreadHostSession = { sessionId: "route-caller", durableSessionId: "dur-caller", cwd: process.cwd(), name: "caller", status: "open" }
const recent = new Date().toISOString()
const branch: unknown[] = [
  { type: "message", id: "u1", timestamp: recent, message: { role: "user" } },
  { type: "message", id: "a1", timestamp: recent, message: { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "ext_dori_reply_mark" }, { type: "toolCall", id: "cell-a", name: "eval" }] } },
]
const ectx = { sessionManager: { getSessionId: () => "dur-caller", getBranch: () => branch } }

function tempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  directories.push(directory)
  return directory
}

function host(): ThreadHost {
  const unused = async () => { throw new Error("not used") }
  return {
    socket: "/tmp/extension-tools-dori.sock",
    listSessions: async () => [caller],
    openSession: async () => caller,
    getMessages: async () => [],
    getState: async () => ({ isStreaming: false }),
    prompt: unused, interrupt: unused, setSessionName: unused, setModel: unused,
    getAvailableModels: async () => [], setThinkingLevel: unused, getAvailableThinkingLevels: async () => [],
  } as ThreadHost
}

async function setup(extension = DORI_STORE_EXTENSION, sessionCallable: readonly SessionCallableOp[] = ops) {
  const agentDir = tempDir("extension-tools-dori-")
  const store = createGatewayStore({ agentDir })
  stores.push(store)
  const migrations = extension === DORI_STORE_EXTENSION ? [["CREATE TABLE dori_calls (id INTEGER PRIMARY KEY, op TEXT NOT NULL, args TEXT NOT NULL)"]] : []
  expect(await store.registerStoreExtension({ name: extension, moduleUrl: fixture.href, migrations, sessionCallable })).toMatchObject({ kind: "ok" })
  const base: ThreadToolSurfaceOptions = { host: host(), store, stateDirectory: tempDir("extension-tools-dori-state-"), callerSessionId: () => UNKNOWN_CALLER, callerWorkspaceRoot: () => process.cwd() }
  const on = (): ThreadToolSurfaceOptions => ({ ...base, doriToolkit: true })
  return { agentDir, base, on }
}

async function call(options: ThreadToolSurfaceOptions, name: string, args: Record<string, unknown> = { note: "n" }, toolCallId = "call-1") {
  const tool = (await buildExtensionTools(options)).find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error(`no tool ${name}`)
  const output = await tool.execute(toolCallId, args, undefined, undefined, ectx as never) as { details: { result: Record<string, unknown> } }
  return output.details.result
}

function storeRows(agentDir: string): { op: string; args: string }[] {
  const db = new Database(gatewayDatabasePath(agentDir))
  try {
    const table = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%dori_calls'").get() as { name: string } | null
    return table === null ? [] : db.query(`SELECT op, args FROM "${table.name}" ORDER BY id`).all() as { op: string; args: string }[]
  } finally {
    db.close()
  }
}

function receiptKeys(agentDir: string): { key: string; op: string; differsTo?: string }[] {
  const db = new Database(gatewayDatabasePath(agentDir))
  try {
    return db.query("SELECT replay_key AS key, op FROM toolkit_replay_receipts ORDER BY replay_key").all() as { key: string; op: string }[]
  } finally {
    db.close()
  }
}

test("#given the dori toolkit is on #when a fresh process replays the same turn's reply.mark #then the recorded result returns and the host dispatched once", async () => {
  const { agentDir, on } = await setup()
  const first = await call(on(), "ext_dori_reply_mark")
  expect(first).toMatchObject({ kind: "ok", value: { op: "reply.mark", dispatch_number: 1, caller: "dur-caller" } })
  expect(await call(on(), "ext_dori_reply_mark")).toEqual(first)
  expect(storeRows(agentDir)).toHaveLength(1)
})

test("#given the turn recorded reply.mark at index 0 #when a replay calls send.post there #then it stops with the op divergence and nothing dispatches", async () => {
  const { agentDir, on } = await setup()
  await call(on(), "ext_dori_reply_mark")
  expect(await call(on(), "ext_dori_send_post")).toMatchObject({ kind: "replay_stopped", code: "toolkit_replay_divergence", differs: ["op"], recorded_op: "reply.mark", attempted_op: "send.post", key: '["turn","dur-caller:a1/call-1",0]' })
  expect(storeRows(agentDir)).toHaveLength(1)
})

test("#given a recorded call #when a replay sends the same op with different arguments #then it stops with the arguments divergence and nothing dispatches", async () => {
  const { agentDir, on } = await setup()
  await call(on(), "ext_dori_reply_mark", { note: "hello" })
  expect(await call(on(), "ext_dori_reply_mark", { note: "DIFFERENT" })).toMatchObject({ kind: "replay_stopped", code: "toolkit_replay_divergence", differs: ["args"] })
  expect(storeRows(agentDir)).toHaveLength(1)
})

test("#given a recorded call #when its turn is replayed after the seven-day window #then it stops as expired and nothing dispatches again", async () => {
  const { agentDir, on } = await setup()
  await call(on(), "ext_dori_reply_mark")
  const assistant = branch[1] as { timestamp: string }
  assistant.timestamp = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
  try {
    expect(await call(on(), "ext_dori_reply_mark")).toMatchObject({ kind: "replay_stopped", code: "toolkit_replay_expired" })
  } finally {
    assistant.timestamp = recent
  }
  expect(storeRows(agentDir)).toHaveLength(1)
})

test("#given a kernel cell that outlived its turn #when its call replays after the session moved on #then it keeps its original turn and returns the recorded result", async () => {
  const { agentDir, on } = await setup()
  const carried = { note: "n", omo_toolkit_replay: { cell: "cell-a", index: 0 } }
  const first = await call(on(), "ext_dori_reply_mark", carried, "kernel-generated")
  branch.push({ type: "message", id: "a2", timestamp: recent, message: { role: "assistant", content: [{ type: "toolCall", id: "cell-b", name: "eval" }] } })
  try {
    expect(await call(on(), "ext_dori_reply_mark", carried, "kernel-generated")).toEqual(first)
  } finally {
    branch.pop()
  }
  expect(storeRows(agentDir)).toHaveLength(1)
  expect(JSON.parse(storeRows(agentDir)[0]?.args ?? "{}")).toEqual({ note: "n", caller_session_durable_id: "dur-caller" })
})

test("#given key-shaped arguments or a carried turn the engine did not issue #when called #then the arguments never pick the journal key and a foreign turn is refused before dispatch", async () => {
  const { agentDir, on } = await setup()
  const options = on()
  expect(await call(options, "ext_dori_reply_mark", { note: "n", replay_key: '["turn","evil",0]', turn_id: "evil" })).toMatchObject({ kind: "ok" })
  expect(receiptKeys(agentDir).map((row) => row.key)).toEqual(['["turn","dur-caller:a1/call-1",0]'])
  expect(await call(options, "ext_dori_send_post", { note: "n", omo_toolkit_replay: { cell: "cell-of-another-session", index: 0 } }, "kernel-generated")).toMatchObject({ kind: "replay_stopped", code: "toolkit_replay_turn_unknown" })
  expect(storeRows(agentDir)).toHaveLength(1)
})

test("#given a committed call whose response was lost #when the same call is retried #then the recorded result returns and the effect ran once", async () => {
  const { agentDir, on } = await setup()
  const committing = on()
  const realAwait = committing.store.extensionSessionAwait.bind(committing.store) as (name: string, op: string, args: unknown, caller: Parameters<GatewayStore["extensionSessionAwait"]>[3]) => Promise<StoreExtensionResult<unknown>>
  let loseResponse = true
  ;(committing.store as { extensionSessionAwait: unknown }).extensionSessionAwait = async (name: string, op: string, args: unknown, caller: Parameters<GatewayStore["extensionSessionAwait"]>[3]) => {
    const reply = await realAwait(name, op, args, caller)
    if (!loseResponse) return reply
    loseResponse = false
    throw new Error("response lost after commit")
  }
  let lost: unknown
  await call(committing, "ext_dori_reply_mark").then(() => undefined, (error: unknown) => { lost = error })
  expect(lost).toBeInstanceOf(Error)
  expect((lost as Error).message).toBe("response lost after commit")
  expect(storeRows(agentDir)).toHaveLength(1)
  expect(await call(on(), "ext_dori_reply_mark")).toMatchObject({ kind: "ok", value: { op: "reply.mark", dispatch_number: 1 } })
  expect(storeRows(agentDir)).toHaveLength(1)
})

test("#given the toolkit on and off #when the layer-2 tools are built #then only on does the tool exist and its schema accept the SDK's replay context", async () => {
  const { base, on } = await setup()
  const propertiesOf = async (options: ThreadToolSurfaceOptions) => ((await buildExtensionTools(options)).find((tool) => tool.name === "ext_dori_reply_mark")?.parameters as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
  expect(Object.keys(await propertiesOf(on()))).toEqual(["note", "replay_key", "turn_id", "omo_toolkit_replay"])
  expect(await propertiesOf(base)).toEqual({})
})

test("#given the dori toolkit is off #when a session builds its tools #then the dori extension's layer-2 ops are not callable at all", async () => {
  const { agentDir, base } = await setup()
  expect((await buildExtensionTools(base)).map((tool) => tool.name)).toEqual([])
  const second = await buildExtensionTools(base)
  expect(second.map((tool) => tool.name)).toEqual([])
  expect(storeRows(agentDir)).toHaveLength(0)
})

test("#given the toolkit is on #when another extension declares namespace-shaped tools #then they take no replay receipts", async () => {
  const ping: SessionCallableOp = { op: "ping", toolName: "reply_mark", description: "Shaped like a layer-2 tool.", parameters: { type: "object", additionalProperties: false, properties: { note: { type: "string" } } } }
  const { agentDir, on } = await setup("other", [ping])
  const options = on()
  expect(await call(options, "ext_other_reply_mark")).toEqual({ kind: "ok", value: { pinged: true } })
  expect(await call(options, "ext_other_reply_mark")).toEqual({ kind: "ok", value: { pinged: true } })
  expect(receiptKeys(agentDir)).toEqual([])
})
