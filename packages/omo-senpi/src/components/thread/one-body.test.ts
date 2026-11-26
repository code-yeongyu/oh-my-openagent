import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { defaultWorld, PEER, SESSION_ID } from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { assembleOmoSdk } from "../omo-sdk/assembly"
import { createLocalSessions } from "../remote/local-sessions"
import { handleOf } from "../remote/seams"
import { clientOn, closeClients, fakeClock, startOwner } from "../remote/testing/fake-service"
import * as createBody from "./control/create"
import * as operations from "./control/operations"
import * as renameBody from "./control/rename"
import * as lazyOps from "./remote/lazy-ops"
import * as sdkCore from "./sdk-core"
import * as sdkSend from "./sdk-send"
import { createThreadSdk } from "./sdk"
import { createRemoteThreadFixture } from "./thread-remote-fixture"
import * as archiveBody from "./tools/archive-ops"
import type { ThreadHost } from "./tools/ports"
import * as readOps from "./tools/read-ops"

// D2 of omo#14943 T1b: one body per call in the thread core, and every surface that has the call calls that body. Each
// body is spied so it marks when it runs, and the scripted holder's acting methods record whether a body was running when
// they were called. A surface passes a call when the call's body ran and the holder was never acted on outside a body; a
// surface that holds its own read or control logic fails one of the two (the negative controls show both).

type Call =
  | "list"
  | "read"
  | "readAfterWait"
  | "receipt"
  | "locate"
  | "messages"
  | "send"
  | "create"
  | "interrupt"
  | "close"
  | "unload"
  | "rename"
  | "setModel"
  | "setReasoning"
  | "archive"

const BODY: Readonly<Record<Call, string>> = {
  list: "listThreads",
  read: "readThread",
  readAfterWait: "readThread",
  receipt: "readReceipt",
  locate: "core.locate",
  messages: "core.messages",
  send: "sendThread",
  create: "createThread",
  interrupt: "interruptThread",
  close: "closeThread",
  unload: "unloadThread",
  rename: "renameThread",
  setModel: "setModelOn",
  setReasoning: "setThinkingLevelOn",
  archive: "archiveThread",
}

const SPIED: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
  [readOps, "listThreads"],
  [readOps, "readThread"],
  [lazyOps, "readReceipt"],
  [sdkSend, "sendThread"],
  [createBody, "createThread"],
  [operations, "interruptThread"],
  [operations, "closeThread"],
  [operations, "unloadThread"],
  [operations, "setModelOn"],
  [operations, "setThinkingLevelOn"],
  [renameBody, "renameThread"],
  [archiveBody, "archiveThread"],
]

/** The holder methods that read a session's content or act on it; listing and state reads build a view and are free. */
const ACTS = [
  "getMessages",
  "prompt",
  "interrupt",
  "setSessionName",
  "setModel",
  "setThinkingLevel",
  "setSessionArchived",
  "closeSession",
  "unloadSession",
  "openSession",
] as const
const ACTING_RECORDS = new Set([
  "get_messages",
  "prompt",
  "interrupt",
  "set_session_name",
  "set_model",
  "set_thinking_level",
  "set_session_archived",
  "close_session",
  "unload_session",
  "open_session",
])

const trace = { depth: 0, reached: [] as string[], outside: [] as string[] }
const reset = () => {
  trace.depth = 0
  trace.reached = []
  trace.outside = []
}
function within<T>(name: string, run: () => T): T {
  trace.reached.push(name)
  trace.depth++
  let result: T
  try {
    result = run()
  } catch (error) {
    trace.depth--
    throw error
  }
  if (result instanceof Promise) return result.finally(() => trace.depth--) as T
  trace.depth--
  return result
}
const acted = (what: string) => {
  if (trace.depth === 0) trace.outside.push(what)
}

// Bun restores spies after each test, so each test spies the bodies afresh.
beforeEach(() => {
  for (const [module, name] of SPIED) {
    const body = module[name] as (...args: unknown[]) => unknown
    spyOn(module, name as never).mockImplementation(((...args: unknown[]) =>
      within(name, () => body(...args))) as never)
  }
  // The core's own members (createThreadCore): the root, the facade and the CLI reach a call through the core.
  const create = sdkCore.createThreadCore
  spyOn(sdkCore, "createThreadCore").mockImplementation((options) => {
    const core = create(options)
    const wrap = (name: "locate" | "messages") => {
      const member = core[name] as (...args: unknown[]) => unknown
      return (...args: unknown[]) => within(`core.${name}`, () => member(...args))
    }
    return { ...core, locate: wrap("locate"), messages: wrap("messages") } as typeof core
  })
})
afterEach(() => mock.restore())

/** Records every acting call on a holder, and whether a body was running at the time. */
function watchHolder(host: ThreadHost, label: string): void {
  for (const name of ACTS) {
    const method = host[name] as ((...args: unknown[]) => unknown) | undefined
    if (method === undefined) continue
    Object.assign(host, {
      [name]: (...args: unknown[]) => {
        acted(`${label}.${name}`)
        return method.apply(host, args)
      },
    })
  }
}

const { account, surface, cleanup } = createRemoteThreadFixture()

function holder() {
  const a = account()
  const s = surface(a.remote)
  watchHolder(s.host, "host")
  const enqueue = s.store.enqueue.bind(s.store)
  Object.assign(s.store, {
    enqueue: (...args: Parameters<typeof enqueue>) => {
      acted("store.enqueue")
      return enqueue(...args)
    },
  })
  const sessionCommand = a.remote.sessions.sessionCommand.bind(a.remote.sessions)
  Object.assign(a.remote.sessions, {
    sessionCommand: (...args: Parameters<typeof sessionCommand>) => {
      const type = String(args[2]["type"])
      if (ACTING_RECORDS.has(type)) acted(`relay.${type}`)
      return sessionCommand(...args)
    },
  })
  const ports = { host: s.host, store: s.store, remote: a.remote }
  const root = assembleOmoSdk({ agentDir: s.agentDir, cwd: process.cwd(), uid: 501, user: "qa", ports }, {})
  const sdk = createThreadSdk({ agentDir: s.agentDir, cwd: process.cwd(), uid: 501, user: "qa", ...ports })
  return { a, s, root, sdk, ports }
}
type Holder = ReturnType<typeof holder>

// `omo thread` loads the plugin's SDK; here it loads this source's facade over the same holder.
const CLI = join(import.meta.dir, "../../../../omo-native/bin/lib/thread.js")
async function cli(h: Holder, args: readonly string[]): Promise<void> {
  const { runThreadCommand } = (await import(CLI)) as {
    readonly runThreadCommand: (args: readonly string[], options: Record<string, unknown>) => Promise<number>
  }
  const sink = { write: () => true }
  await runThreadCommand([...args, "--json"], {
    stdout: sink,
    stderr: sink,
    platform: "linux",
    pluginRoot: join(h.s.agentDir, "no-plugin"),
    agentDir: h.s.agentDir,
    env: {},
    cwd: process.cwd(),
    identity: { uid: 501, user: "qa" },
    importThreadClient: async () => ({}),
    importSdk: async () => ({
      createThreadSdk: (options: Parameters<typeof createThreadSdk>[0]) => createThreadSdk({ ...options, ...h.ports }),
    }),
  })
}

const T = "dur-local"
type Row = readonly [surface: string, call: Call, run: (h: Holder) => Promise<unknown>]

const ROWS: readonly Row[] = [
  ["tool", "list", (h) => h.s.run("thread_list", {})],
  ["tool", "read", (h) => h.s.run("thread_read", { thread: T })],
  ["tool", "readAfterWait", (h) => h.s.run("thread_read", { thread: T, wait_ms: 1 })],
  ["tool", "receipt", (h) => h.s.run("thread_read", { thread: T, delivery_id: "dlv-x" })],
  ["tool", "send", (h) => h.s.run("thread_send", { thread: T, message: "hi" })],
  ["tool", "create", (h) => h.s.run("thread_create", { name: "made" })],
  ["tool", "interrupt", (h) => h.s.run("thread_interrupt", { thread: T })],
  ["tool", "close", (h) => h.s.run("thread_close", { thread: T })],
  ["tool", "rename", (h) => h.s.run("thread_rename", { thread: T, name: "renamed" })],
  ["tool", "setModel", (h) => h.s.run("thread_set_model", { thread: T, model: "anthropic/claude" })],
  ["tool", "setReasoning", (h) => h.s.run("thread_set_reasoning", { thread: T, level: "low" })],
  ["tool", "archive", (h) => h.s.run("thread_archive", { thread: T })],
  ["facade", "list", (h) => h.sdk.list({})],
  ["facade", "read", (h) => h.sdk.read({ thread: T })],
  ["facade", "locate", (h) => h.sdk.locate({ thread: T })],
  ["facade", "send", (h) => h.sdk.send({ thread: T, text: "hi" })],
  ["facade", "create", (h) => h.sdk.create({ name: "made" })],
  ["facade", "interrupt", (h) => h.sdk.interrupt({ thread: T })],
  ["facade", "close", (h) => h.sdk.close({ thread: T })],
  ["facade", "rename", (h) => h.sdk.rename({ thread: T, name: "renamed" })],
  ["facade", "setModel", (h) => h.sdk.set_model({ thread: T, model: "anthropic/claude" })],
  ["root", "list", (h) => h.root.threads.list({})],
  ["root", "read", (h) => h.root.threads.read({ thread: T })],
  ["root", "receipt", (h) => h.root.threads.receipt({ thread: T, delivery_id: "dlv-x" })],
  ["root", "locate", (h) => h.root.threads.locate({ thread: T })],
  ["root", "messages", (h) => h.root.threads.messages({ thread: T })],
  ["root", "send", (h) => h.root.threads.send({ thread: T, message: "hi" })],
  ["root", "create", (h) => h.root.threads.create({ name: "made" })],
  ["root", "interrupt", (h) => h.root.threads.interrupt({ thread: T })],
  ["root", "close", (h) => h.root.threads.close({ thread: T })],
  ["root", "unload", (h) => h.root.threads.unload({ thread: T })],
  ["root", "rename", (h) => h.root.threads.rename({ thread: T, name: "renamed" })],
  ["root", "setModel", (h) => h.root.threads.setModel({ thread: T, model: "anthropic/claude" })],
  ["root", "setReasoning", (h) => h.root.threads.setReasoning({ thread: T, level: "low" })],
  ["root", "archive", (h) => h.root.threads.archive({ thread: T })],
  ["cli", "list", (h) => cli(h, ["list"])],
  ["cli", "read", (h) => cli(h, ["read", T])],
  ["cli", "send", (h) => cli(h, ["send", T, "hi"])],
  ["cli", "close", (h) => cli(h, ["close", T])],
]

async function verdict(call: Call, run: () => Promise<unknown>) {
  reset()
  await run()
  return { body: trace.reached.includes(BODY[call]), outside: [...trace.outside] }
}

afterEach(cleanup)

describe("one body per call (#14951 D2)", () => {
  test.each(ROWS.map(([where, call, run]) => [`${where} ${call}`, call, run] as const))(
    "#given one scripted holder #when %s runs #then the core's body for it runs and nothing acts on the holder outside it",
    async (_name, call, run) => {
      expect(await verdict(call, () => run(holder()))).toEqual({ body: true, outside: [] })
    },
  )

  test("#given the holder is watched #when a body acts on it #then the act is seen, inside the body", async () => {
    const h = holder()
    reset()
    await h.s.run("thread_interrupt", { thread: T })
    expect(trace.reached).toContain("interruptThread")
    expect(trace.outside).toEqual([])
    reset()
    await h.s.host.interrupt("route-local", { type: "interrupt" } as never)
    expect(trace.outside).toEqual(["host.interrupt"])
  })

  test("#given a surface that calls the holder itself instead of the body #when the guard judges it #then it fails both ways", async () => {
    const h = holder()
    const ownInterrupt = async () => await h.s.host.interrupt("route-local", { type: "interrupt" } as never)
    expect(await verdict("interrupt", ownInterrupt)).toEqual({ body: false, outside: ["host.interrupt"] })
    // A surface that runs the body but reads the holder on its own first is caught too.
    const ownRead = async () => {
      await h.s.host.getMessages("route-local")
      return await h.s.run("thread_read", { thread: T })
    }
    expect(await verdict("read", ownRead)).toEqual({ body: true, outside: ["host.getMessages"] })
  })
})

// The remote module's session members (components/remote): the relay leg (another device, through the device service)
// and the this-device leg (this device's operator endpoint). A member listed in OWN_LOGIC holds its own logic today
// instead of the thread body for its call; the list is the finding, reported and not moved (D2), and this test fails when
// a member leaves it or a new one joins it.
const OWN_LOGIC: Readonly<Record<string, string>> = {
  "relay open":
    "remote/sessions.ts:595 openOnce: its own open_session (createRelaySessionHost, :618), not createThread",
  "relay send": "remote/sessions.ts:457 deliverTo: its own relay delivery, not sendThread",
  "relay archive": "remote/sessions.ts:796 archive: control.setArchived + listed, not archiveThread",
  "here send": "remote/sessions-local-members.ts:158 send: port.prompt with its own steer/queue rules",
  "here interrupt": "remote/sessions-local-members.ts:92 interrupt: interruptOver on the port, not interruptThread",
  "here setReasoning": "remote/sessions-local-members.ts:98 setReasoning: port.setThinkingLevel",
  "here close": "remote/sessions-local-members.ts:71 close: port.closeSession",
  "here archive": "remote/sessions-local-members.ts:113 archive: port.setSessionArchived",
}

describe("the remote module's session members (#14951 D2)", () => {
  const directories: string[] = []
  afterEach(async () => {
    await closeClients()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  async function legs() {
    const base = defaultWorld()
    const live = base.sessions[0]
    if (live === undefined) throw new Error("the conformance world holds a live session")
    const reply = {
      isStreaming: false,
      currentTurnId: "7",
      pendingMessageCount: 0,
      disposition: "started",
      turnId: "7",
      interrupted: true,
      outcome: "unloaded",
      provider: "anthropic",
      id: "claude",
    }
    const owner = await startOwner({ ...base, sessions: [{ ...live, delegated: { data: reply, frames: [] } }] })
    const relay = clientOn(owner.stateDir, fakeClock())
    const agentDir = mkdtempSync(join(tmpdir(), "one-body-"))
    directories.push(agentDir)
    const resolved = async () => ({ isStreaming: false })
    const host: ThreadHost = {
      socket: join(agentDir, "rpc.sock"),
      listSessions: async () => [{ sessionId: "rpc-1", durableSessionId: "dur-selected", cwd: "/w", name: "target" }],
      openSession: async () => ({ sessionId: "rpc-2", durableSessionId: "dur-made" }) as never,
      getMessages: async () => [],
      getState: resolved as never,
      prompt: async () => ({ turnId: "1" }),
      interrupt: async () => ({ interrupted: true }) as never,
      setSessionName: async () => undefined,
      setModel: async (_s, provider, id) => ({ provider, id }),
      getAvailableModels: async () => [],
      setThinkingLevel: async () => undefined,
      getAvailableThinkingLevels: async () => ["low", "high"],
      setSessionArchived: async () => undefined,
      closeSession: async () => ({ outcome: "closed", dropped_deliveries: [] }),
    }
    watchHolder(host, "here")
    const here = clientOn(owner.stateDir, fakeClock(), undefined, {
      localSessions: async () => createLocalSessions(async () => host),
    })
    return { relay, here }
  }

  test("#given each member on each leg #when it runs #then it reaches its thread body unless OWN_LOGIC names it", async () => {
    const { relay, here } = await legs()
    const LIVE = handleOf(PEER, SESSION_ID)
    const SELF = handleOf("dev-self", "dur-selected")
    const members: ReadonlyArray<readonly [string, Call, () => Promise<unknown>]> = [
      ["relay open", "create", () => relay.sessions.open({ device: PEER, workspace: "/work" })],
      ["relay send", "send", () => relay.sessions.send(LIVE, { text: "hi" })],
      ["relay interrupt", "interrupt", () => relay.sessions.interrupt(LIVE)],
      ["relay setModel", "setModel", () => relay.sessions.setModel(LIVE, "anthropic/claude")],
      ["relay setReasoning", "setReasoning", () => relay.sessions.setReasoning(LIVE, "high")],
      ["relay archive", "archive", () => relay.sessions.archive(LIVE, true)],
      ["relay close", "close", () => relay.sessions.close(LIVE)],
      ["here send", "send", () => here.sessions.send(SELF, { text: "hi" })],
      ["here interrupt", "interrupt", () => here.sessions.interrupt(SELF)],
      ["here setReasoning", "setReasoning", () => here.sessions.setReasoning(SELF, "high")],
      ["here archive", "archive", () => here.sessions.archive(SELF, true)],
      ["here close", "close", () => here.sessions.close(SELF)],
    ]
    const own: string[] = []
    for (const [name, call, run] of members) {
      const judged = await verdict(call, run)
      if (!judged.body || judged.outside.length > 0) own.push(name)
    }
    expect(own.sort()).toEqual(Object.keys(OWN_LOGIC).sort())
  })
})
