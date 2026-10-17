import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { DORI_STORE_EXTENSION } from "../../ulw-loop/sdk/dori-gate"
import { gatewayDatabasePath } from "../gateway/paths"
import { createGatewayStore, type GatewayStore } from "../gateway/store"
import type { SessionCallableOp } from "../gateway/store-extensions"
import type { ThreadHost, ThreadHostSession } from "../tools"
import { openDoriReplay, type DoriReplay } from "./dori-replay"
import { buildExtensionTools } from "./extension-tools"
import { UNKNOWN_CALLER, type ThreadToolSurfaceOptions } from "./ports"

const directories: string[] = []
const stores: GatewayStore[] = []
const replays: DoriReplay[] = []
afterEach(async () => {
  for (const replay of replays.splice(0)) replay.close()
  await Promise.all(stores.splice(0).map((store) => store.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const fixture = new URL("../gateway/testing/dori-layer2-extension.mjs", import.meta.url)
const empty = { type: "object", additionalProperties: false, properties: { note: { type: "string" } } }
const ops: SessionCallableOp[] = [
  { op: "replyMark", toolName: "reply_mark", description: "Mark a reply debt.", parameters: empty },
  { op: "sendPost", toolName: "send_post", description: "Post to a room.", parameters: empty },
]
const caller: ThreadHostSession = { sessionId: "route-caller", durableSessionId: "dur-caller", cwd: process.cwd(), name: "caller", status: "open" }
const branch = [{ type: "message", id: "u1", message: { role: "user" } }, { type: "message", id: "a1", message: { role: "assistant" } }]
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
  const journal = join(agentDir, "toolkit-replay.sqlite")
  const base: ThreadToolSurfaceOptions = { host: host(), store, stateDirectory: tempDir("extension-tools-dori-state-"), callerSessionId: () => UNKNOWN_CALLER, callerWorkspaceRoot: () => process.cwd() }
  const freshProcess = async (): Promise<ThreadToolSurfaceOptions> => {
    const replay = await openDoriReplay({ path: journal })
    replays.push(replay)
    return { ...base, doriReplay: async () => replay }
  }
  return { agentDir, base, freshProcess, journal }
}

async function call(options: ThreadToolSurfaceOptions, name: string) {
  const tool = (await buildExtensionTools(options)).find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error(`no tool ${name}`)
  const output = await tool.execute("call-1", { note: "n" }, undefined, undefined, ectx as never) as { details: { result: Record<string, unknown> } }
  return output.details.result
}

function dispatchCount(agentDir: string): number {
  const db = new Database(gatewayDatabasePath(agentDir), { readonly: true })
  try {
    const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%dori_calls'").all() as { name: string }[]
    const table = tables[0]?.name
    return table === undefined ? 0 : Number((db.query(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n)
  } finally {
    db.close()
  }
}

test("#given the dori toolkit is on #when a fresh process replays the same turn's reply.mark #then the recorded result returns and the host dispatched once", async () => {
  const { agentDir, freshProcess } = await setup()
  const first = await call(await freshProcess(), "ext_dori_reply_mark")
  expect(first).toMatchObject({ kind: "ok", value: { op: "reply.mark", dispatch_number: 1, caller: "dur-caller" } })
  const replayed = await call(await freshProcess(), "ext_dori_reply_mark")
  expect(replayed).toEqual(first)
  expect(dispatchCount(agentDir)).toBe(1)
})

test("#given the turn recorded reply.mark at index 0 #when a replay calls send.post there #then it stops with the divergence and nothing dispatches", async () => {
  const { agentDir, freshProcess } = await setup()
  await call(await freshProcess(), "ext_dori_reply_mark")
  expect(await call(await freshProcess(), "ext_dori_send_post")).toMatchObject({ kind: "replay_stopped", code: "toolkit_replay_divergence", recorded_op: "reply.mark", attempted_op: "send.post", key: '["turn","dur-caller:a1",0]' })
  expect(dispatchCount(agentDir)).toBe(1)
})

test("#given the dori toolkit is off #when the same op is called twice #then no replay journal applies and each call dispatches", async () => {
  const { agentDir, base } = await setup()
  await call(base, "ext_dori_reply_mark")
  await call(base, "ext_dori_reply_mark")
  expect(dispatchCount(agentDir)).toBe(2)
})

test("#given the toolkit is on #when another extension declares namespace-shaped tools #then they are not journaled", async () => {
  const ping: SessionCallableOp = { op: "ping", toolName: "reply_mark", description: "Shaped like a layer-2 tool.", parameters: empty }
  const { freshProcess, journal } = await setup("other", [ping])
  const options = await freshProcess()
  expect(await call(options, "ext_other_reply_mark")).toEqual({ kind: "ok", value: { pinged: true } })
  expect(await call(options, "ext_other_reply_mark")).toEqual({ kind: "ok", value: { pinged: true } })
  const db = new Database(journal, { readonly: true })
  try {
    expect((db.query("SELECT count(*) AS n FROM toolkit_replay").get() as { n: number }).n).toBe(0)
  } finally {
    db.close()
  }
})
