import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { gatewayDatabasePath } from "../gateway/paths"
import { GATEWAY_MIGRATIONS } from "../gateway/schema"
import { createGatewayStore, type GatewayStore } from "../gateway/store"
import type { SessionCallableOp, StoreExtensionRegistration } from "../gateway/store-extensions"
import { createThreadTools, type ThreadHost, type ThreadHostSession } from "../tools"
import { buildExtensionTools, registerExtensionTools } from "./extension-tools"
import type { AnyTool } from "./internals"
import { UNKNOWN_CALLER } from "./ports"

const directories: string[] = []
const stores: GatewayStore[] = []
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const fixtureModule = new URL("../gateway/testing/session-callable-extension.mjs", import.meta.url)
const migrations = [[
  "CREATE TABLE gw_opens (id INTEGER PRIMARY KEY, args TEXT NOT NULL)",
  "CREATE TABLE gw_requests (id TEXT PRIMARY KEY, status TEXT NOT NULL)",
  "CREATE TABLE gw_items (binding_id TEXT PRIMARY KEY, status TEXT NOT NULL)",
]]
const openDeclaration: SessionCallableOp = {
  op: "openThread",
  toolName: "open",
  description: "Open a chat thread for a session.",
  parameters: { type: "object", additionalProperties: false, required: ["target_session_durable_id"], properties: { target_session_durable_id: { type: "string" } } },
  targetArg: "target_session_durable_id",
}
const registration = (moduleUrl: string, sessionCallable: readonly SessionCallableOp[] = [openDeclaration]): StoreExtensionRegistration => ({
  name: "gw",
  moduleUrl,
  migrations,
  wakeDir: "thread-open",
  sessionCallable,
})

function tempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  directories.push(directory)
  return directory
}

function storeAt(agentDir: string): GatewayStore {
  const store = createGatewayStore({ agentDir })
  stores.push(store)
  return store
}

function hostWith(sessions: ThreadHostSession[]): ThreadHost {
  const unused = async () => { throw new Error("not used by these tests") }
  return {
    socket: "/tmp/extension-tools-test.sock",
    listSessions: async () => sessions,
    openSession: async () => sessions[sessions.length - 1],
    getMessages: async () => [],
    getState: async () => ({ isStreaming: false }),
    prompt: unused, interrupt: unused, setSessionName: unused, setModel: unused,
    getAvailableModels: async () => [], setThinkingLevel: unused, getAvailableThinkingLevels: async () => [],
  } as ThreadHost
}

const caller = { sessionId: "route-caller", durableSessionId: "dur-caller", cwd: process.cwd(), name: "caller", status: "open" as const }
const ectxFor = (runtimeId: string) => ({ sessionManager: { getSessionId: () => runtimeId } })
const resultOf = (output: { details: { result: unknown } }) => output.details.result as { kind: string; code?: string; value?: { received?: Record<string, unknown> } }

async function surface(sessions: ThreadHostSession[], moduleUrl = fixtureModule.href, sessionCallable?: readonly SessionCallableOp[]) {
  const agentDir = tempDir("extension-tools-")
  const store = storeAt(agentDir)
  expect(await store.registerStoreExtension(registration(moduleUrl, sessionCallable))).toMatchObject({ kind: "ok" })
  const host = hostWith(sessions)
  const options = { host, store, stateDirectory: tempDir("extension-tools-state-"), callerSessionId: () => UNKNOWN_CALLER, callerWorkspaceRoot: () => process.cwd() }
  const tools = await buildExtensionTools(options)
  return { agentDir, store, host, tools, options }
}

/** A session's tool registry as senpi keeps it (one tool per name), with `session_start` fired by the test. */
function sessionStartHost(preRegistered: Readonly<Record<string, Record<string, unknown>>>) {
  const tools = new Map(Object.entries(preRegistered))
  const handlers: (() => void)[] = []
  let waiting: { readonly name: string; readonly done: () => void } | undefined
  return {
    tools,
    registerTool(tool: Record<string, unknown>) {
      tools.set(String(tool.name), tool)
      const awaited = waiting
      if (awaited !== undefined && awaited.name === tool.name) awaited.done()
    },
    getAllTools: () => [...tools.keys()].map((name) => ({ name })),
    on(event: string, handler: () => void) { if (event === "session_start") handlers.push(handler) },
    /** Fires session_start and resolves once `until` is registered (the registration pass is one synchronous loop). */
    start(until: string): Promise<void> {
      const done = new Promise<void>((resolve) => { waiting = { name: until, done: resolve } })
      for (const handler of handlers) handler()
      return done
    },
  }
}

function insertDescriptor(agentDir: string, name: string, toolName: string): void {
  const descriptor = { moduleUrl: fixtureModule.href, migrations: [], sessionCallable: [{ op: "openThread", toolName, description: "planted", parameters: { type: "object", additionalProperties: false, properties: {} } }] }
  const db = new Database(gatewayDatabasePath(agentDir))
  try { db.query("INSERT INTO extension_registrations (name, descriptor_json, updated_at) VALUES (?, ?, 0)").run(name, JSON.stringify(descriptor)) } finally { db.close() }
}

test("#given a persisted declaration with a tool op and an internal op #when a session builds its tools #then the tool op exists under ext_<extension>_<toolName> and the internal op gets no tool", async () => {
  const internal: SessionCallableOp = { op: "workItemStatus", internal: true, parameters: { type: "object", additionalProperties: false, properties: { status: { type: "string" } } } }
  const { tools, store } = await surface([caller], fixtureModule.href, [openDeclaration, internal])
  expect(tools.map((tool) => tool.name)).toEqual(["ext_gw_open"])
  expect((await store.sessionCallableOps()).map((op) => op.op)).toEqual(["openThread"])
})

test("#given declarations named bash and task, one composing a name the session already has, two rows composing the same name, and an extension with no declarations #when the session starts #then core tools stay intact, namespaced tools register, and each collision is skipped and logged once", async () => {
  const workItem: SessionCallableOp = { op: "workItemStatus", toolName: "bash", description: "Report status.", parameters: { type: "object", additionalProperties: false, properties: { status: { type: "string" } } } }
  const { agentDir, store, options } = await surface([caller], fixtureModule.href, [openDeclaration, workItem])
  expect(await store.registerStoreExtension({ name: "rules", moduleUrl: fixtureModule.href, migrations: [] })).toMatchObject({ kind: "ok" })
  insertDescriptor(agentDir, "evil", "task")
  insertDescriptor(agentDir, "ab", "cc_dd")
  insertDescriptor(agentDir, "ab_cc", "dd")
  const core = { bash: { name: "bash" }, task: { name: "task" }, ext_gw_open: { name: "ext_gw_open", owner: "another component" } }
  const host = sessionStartHost(core)
  const logs: string[] = []
  registerExtensionTools(host, options, (line) => logs.push(line))
  await host.start("ext_gw_bash")
  expect(host.tools.get("bash")).toBe(core.bash)
  expect(host.tools.get("task")).toBe(core.task)
  expect(host.tools.get("ext_gw_open")).toBe(core.ext_gw_open)
  expect([...host.tools.keys()].sort()).toEqual(["bash", "ext_evil_task", "ext_gw_bash", "ext_gw_open", "task"])
  expect(logs.filter((line) => line.includes("ext_gw_open"))).toHaveLength(1)
  expect(logs.filter((line) => line.includes("ext_ab_cc_dd"))).toHaveLength(1)
  const firstPass = logs.length
  await host.start("ext_gw_bash")
  expect(logs).toHaveLength(firstPass)
  expect(host.tools.get("bash")).toBe(core.bash)
}, 10_000)

test("#given the production shape (the engine's getSessionId() is the caller's durable id) #when the tool runs #then the op receives that durable id", async () => {
  const { tools } = await surface([caller])
  const output = await tools[0].execute("call-1", { target_session_durable_id: "dur-child" }, undefined, undefined, ectxFor("dur-caller") as never)
  expect(resultOf(output)).toMatchObject({ kind: "ok", value: { received: { caller_session_durable_id: "dur-caller" } } })
})

const onHost = (socket: string, sessions: ThreadHostSession[]) => ({ socket, list_sessions: { sessions } })
const onOtherHost = { sessionId: "rpc-1", durableSessionId: "dur-other", cwd: process.cwd(), name: "other", status: "open" as const }
const onThirdHost = { sessionId: "rpc-1", durableSessionId: "dur-third", cwd: process.cwd(), name: "third", status: "open" as const }

test.each([
  ["the caller's own host is unreachable and one other host lists a live rpc-1", [{ socket: "/tmp/caller-host.sock", error: new Error("unreachable") }, onHost("/tmp/other-host.sock", [onOtherHost])]],
  ["two hosts each list a live rpc-1 with a different durable id", [onHost("/tmp/other-host.sock", [onOtherHost]), onHost("/tmp/third-host.sock", [onThirdHost])]],
])("#given %s #when the engine names the caller by the routing id rpc-1 #then it resolves to no session and the tool answers caller_context_missing", async (_label, hosts) => {
  const { store, tools } = await surface([caller])
  const view = { sessions: hosts.flatMap((host) => ("list_sessions" in host ? host.list_sessions.sessions : [])), hosts, disk: [] }
  const routed = await buildExtensionTools({ host: { ...hostWith([]), listView: async () => view }, store, stateDirectory: tempDir("extension-tools-routing-"), callerSessionId: () => UNKNOWN_CALLER, callerWorkspaceRoot: () => process.cwd() })
  expect(tools.map((tool) => tool.name)).toEqual(routed.map((tool) => tool.name))
  const output = await routed[0].execute("call-1", { target_session_durable_id: "dur-child" }, undefined, undefined, ectxFor("rpc-1") as never)
  expect(resultOf(output)).toMatchObject({ kind: "refused", code: "caller_context_missing" })
})

// A thread that carries the UNKNOWN_CALLER placeholder as its durable id: only the guard, never a missing entry, refuses it.
const placeholder = { sessionId: "route-placeholder", durableSessionId: UNKNOWN_CALLER, cwd: process.cwd(), name: "placeholder", status: "open" as const }

test.each([
  ["no execution context (the component's UNKNOWN_CALLER fallback)", undefined],
  ["a runtime id no address book entry knows", ectxFor("route-stranger")],
])("#given %s #when the tool runs #then it answers caller_context_missing and the op never runs", async (_label, ectx) => {
  const { tools } = await surface([caller, placeholder])
  const output = await tools[0].execute("call-1", { target_session_durable_id: "dur-child" }, undefined, undefined, ectx as never)
  expect(resultOf(output)).toMatchObject({ code: "caller_context_missing" })
})

test("#given a declaration whose module records every import #when a fresh process's session starts #then its tools register and nothing is imported; only the first call imports the module", async () => {
  const dir = tempDir("extension-tools-spy-")
  const spy = join(dir, "spy-extension.mjs")
  const imports = join(dir, "imports.log")
  writeFileSync(spy, `import { appendFileSync } from "node:fs"\nappendFileSync(${JSON.stringify(imports)}, "import\\n")\n${await Bun.file(fixtureModule).text()}`)
  const importCount = () => readFileSync(imports, "utf8").split("\n").filter(Boolean).length
  const { agentDir, options } = await surface([caller], `file://${spy}`)
  expect(importCount()).toBe(1)
  const host = sessionStartHost({})
  registerExtensionTools(host, { ...options, store: storeAt(agentDir) }, () => undefined)
  await host.start("ext_gw_open")
  expect(importCount()).toBe(1)
  const registered = host.tools.get("ext_gw_open")
  if (registered === undefined) throw new Error("ext_gw_open was not registered at session_start")
  const tool = registered as unknown as AnyTool
  expect(resultOf(await tool.execute("call-1", { target_session_durable_id: "dur-child" }, undefined, undefined, ectxFor("dur-caller") as never))).toMatchObject({ kind: "ok" })
  expect(importCount()).toBe(2)
}, 10_000)

test("#given args that try to name the caller #when the tool runs #then it is refused before validation and the op never runs", async () => {
  const { tools } = await surface([caller])
  const output = await tools[0].execute("call-1", { target_session_durable_id: "dur-child", caller_session_durable_id: "dur-lead" }, undefined, undefined, ectxFor("dur-caller") as never)
  expect(resultOf(output)).toMatchObject({ code: "invalid_arguments" })
})

test("#given a declaration whose module was deleted #when a session builds its tools #then building succeeds without importing it, and only the call fails extension_import_failed", async () => {
  const dir = tempDir("extension-tools-gone-")
  const gone = join(dir, "gone.mjs")
  writeFileSync(gone, await Bun.file(fixtureModule).text())
  const { tools } = await surface([caller], `file://${gone}`)
  rmSync(gone)
  expect(tools.map((tool) => tool.name)).toEqual(["ext_gw_open"])
  const output = await tools[0].execute("call-1", { target_session_durable_id: "dur-child" }, undefined, undefined, ectxFor("dur-caller") as never)
  expect(resultOf(output)).toMatchObject({ code: "extension_import_failed" })
})

test("#given the caller creates a child with thread_create #when it opens a thread for that child #then caller_created_target is stamped; for a peer it did not create, it is omitted", async () => {
  const child = { sessionId: "route-child", durableSessionId: "dur-child", cwd: process.cwd(), name: "child", status: "open" as const }
  const peer = { sessionId: "route-peer", durableSessionId: "dur-peer", cwd: process.cwd(), name: "peer", status: "open" as const }
  const sessions: ThreadHostSession[] = [caller, peer]
  const { store, host, tools } = await surface(sessions)
  const threadTools = createThreadTools({ host, store, stateDirectory: tempDir("extension-tools-create-"), callerSessionId: () => UNKNOWN_CALLER, callerWorkspaceRoot: () => process.cwd() })
  sessions.push(child)
  const create = threadTools.find((tool) => tool.name === "thread_create")!
  expect(resultOf(await create.execute("call-c", { name: "new-child" }, undefined, undefined, ectxFor("dur-caller") as never))).toMatchObject({ kind: "ok" })
  const own = resultOf(await tools[0].execute("call-1", { target_session_durable_id: "dur-child" }, undefined, undefined, ectxFor("dur-caller") as never))
  expect(own.value?.received).toMatchObject({ caller_created_target: true })
  const other = resultOf(await tools[0].execute("call-2", { target_session_durable_id: "dur-peer" }, undefined, undefined, ectxFor("dur-caller") as never))
  expect(Object.hasOwn(other.value?.received ?? {}, "caller_created_target")).toBe(false)
})

test("#given a store at the previous schema version with data #when it opens #then it migrates to the new tables and keeps every existing row", async () => {
  const agentDir = tempDir("extension-tools-migrate-")
  const path = gatewayDatabasePath(agentDir)
  const previous = GATEWAY_MIGRATIONS.length - 1
  {
    const seed = storeAt(agentDir)
    await seed.identity()
    await seed.dispose()
    stores.splice(stores.indexOf(seed), 1)
  }
  const db = new Database(path)
  try {
    db.exec("DROP TABLE IF EXISTS thread_creations; DROP TABLE IF EXISTS extension_registrations;")
    db.exec("DELETE FROM extension_objects WHERE name IN ('thread_creations', 'extension_registrations')")
    db.exec(`PRAGMA user_version = ${previous}`)
    db.query("INSERT INTO gateway_meta (key, value) VALUES ('fixture-keep', 'kept')").run()
  } finally { db.close() }
  const reopened = storeAt(agentDir)
  await reopened.identity()
  const check = new Database(path, { readonly: true })
  try {
    expect(check.query("SELECT value FROM gateway_meta WHERE key = 'fixture-keep'").get()).toEqual({ value: "kept" })
    const tables = check.query("SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('thread_creations', 'extension_registrations') ORDER BY name").all()
    expect(tables).toEqual([{ name: "extension_registrations" }, { name: "thread_creations" }])
    // v10 reserves both as core objects again, so no extension can register a name that prefixes them.
    const reserved = check.query("SELECT name, owner FROM extension_objects WHERE type = 'table' AND name IN ('thread_creations', 'extension_registrations') ORDER BY name").all()
    expect(reserved).toEqual([{ name: "extension_registrations", owner: null }, { name: "thread_creations", owner: null }])
  } finally { check.close() }
})
