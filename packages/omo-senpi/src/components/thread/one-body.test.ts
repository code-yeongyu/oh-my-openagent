import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { defaultWorld, PEER, SESSION_ID } from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { assembleOmoSdk } from "../omo-sdk/assembly"
import { createLocalSessions } from "../remote/local-sessions"
import { handleOf } from "../remote/seams"
import * as relaySessions from "../remote/sessions"
import * as localMembers from "../remote/sessions-local-members"
import { clientOn, closeClients, fakeClock, startOwner } from "../remote/testing/fake-service"
import * as createBody from "./control/create"
import * as operations from "./control/operations"
import * as renameBody from "./control/rename"
import * as lazyOps from "./remote/lazy-ops"
import * as sdkCore from "./sdk-core"
import * as sendBook from "./sdk-core/send-book"
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

const trace = { depth: 0, open: [] as string[], reached: [] as string[], outside: [] as string[] }
const reset = () => {
  trace.depth = 0
  trace.open = []
  trace.reached = []
  trace.outside = []
}
function within<T>(name: string, run: () => T): T {
  trace.reached.push(name)
  trace.depth++
  trace.open.push(name)
  const leave = () => {
    trace.depth--
    trace.open.splice(trace.open.lastIndexOf(name), 1)
  }
  let result: T
  try {
    result = run()
  } catch (error) {
    leave()
    throw error
  }
  if (result instanceof Promise) return result.finally(leave) as T
  leave()
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
  // A create's first prompt on the scripted holder never starts a turn, so its start wait is cut short.
  const threads = { firstPromptWaitMs: 1 }
  const root = assembleOmoSdk({ agentDir: s.agentDir, cwd: process.cwd(), uid: 501, user: "qa", ports, threads }, {})
  const sdk = createThreadSdk({ agentDir: s.agentDir, cwd: process.cwd(), uid: 501, user: "qa", ...ports, ...threads })
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
// and the this-device leg (this device's operator endpoint). A member pinned in OWN_LOGIC holds its own logic today
// instead of the thread body for its call; it is reported and not moved (D2), and slice T1r moves it (design lane ruling
// 5). The pin is keyed by member name and only shrinks: the test fails when a member not pinned holds its own logic
// (the list grew), when a pinned member now reaches its body (the entry no longer applies: delete it and lower
// OWN_LOGIC_CEILING), and when the pin holds more entries than the ceiling.
const T1R = "#15056 (slice T1r)"
type OwnLogic = { readonly holds: string; readonly owner: string }
const OWN_LOGIC: Readonly<Record<string, OwnLogic>> = {
  "relay open": {
    holds: "remote/sessions.ts openOnce: its own open_session (createRelaySessionHost), not createThread",
    owner: T1R,
  },
  "relay send": { holds: "remote/sessions.ts deliverTo: its own relay delivery, not sendThread", owner: T1R },
  "relay archive": {
    holds: "remote/sessions.ts archive: control.setArchived + listed, not archiveThread",
    owner: T1R,
  },
  "here send": { holds: "remote/sessions-local-members.ts send: port.prompt with its own steer/queue rules", owner: T1R },
  "here interrupt": {
    holds: "remote/sessions-local-members.ts interrupt: interruptOver on the port, not interruptThread",
    owner: T1R,
  },
  "here setReasoning": { holds: "remote/sessions-local-members.ts setReasoning: port.setThinkingLevel", owner: T1R },
  "here close": { holds: "remote/sessions-local-members.ts close: port.closeSession", owner: T1R },
  "here archive": { holds: "remote/sessions-local-members.ts archive: port.setSessionArchived", owner: T1R },
}
/** The pin's size when it was ruled shrink-only; lower it as entries leave, never raise it. */
const OWN_LOGIC_CEILING = 8

function pinProblems(own: readonly string[], pin: Readonly<Record<string, OwnLogic>>): string[] {
  const pinned = Object.keys(pin)
  return [
    ...own.filter((name) => !pinned.includes(name)).map((name) => `${name}: holds its own logic and is not pinned`),
    ...pinned
      .filter((name) => !own.includes(name))
      .map((name) => `${name}: reaches its thread body now; the entry no longer applies`),
    ...(pinned.length > OWN_LOGIC_CEILING ? [`the pin holds ${pinned.length} entries, above ${OWN_LOGIC_CEILING}`] : []),
    ...pinned.filter((name) => pin[name]?.owner !== T1R).map((name) => `${name}: owner is not ${T1R}`),
  ].toSorted()
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
    expect(pinProblems(own, OWN_LOGIC)).toEqual([])
  })

  test("#given the pin #when a member joins the own-logic list or a pinned one reaches its body #then the pin fails, naming it", () => {
    const own = Object.keys(OWN_LOGIC)
    expect(pinProblems([...own, "relay interrupt"], OWN_LOGIC)).toEqual([
      "relay interrupt: holds its own logic and is not pinned",
    ])
    expect(pinProblems(own.filter((name) => name !== "here close"), OWN_LOGIC)).toEqual([
      "here close: reaches its thread body now; the entry no longer applies",
    ])
    const grown = { ...OWN_LOGIC, "relay interrupt": { holds: "interruptOver", owner: T1R } }
    expect(pinProblems([...own, "relay interrupt"], grown)).toEqual([
      `the pin holds ${OWN_LOGIC_CEILING + 1} entries, above ${OWN_LOGIC_CEILING}`,
    ])
  })
})
// Ruling 5 ii: no keyed surface (the thread_* tools, createThreadSdk, the root, omo thread) reaches the remote module's send
// members (the relay client's send and open, both over sessions.ts deliverTo, and this device's sessions-local-members
// send) except through the one send body (sdk-send sendThread / sendToTarget, the send book), so the receipt book cannot
// be bypassed. Each member is wrapped where its factory builds it, and each call records the bodies open at that moment.
const SEND_BODIES = ["sendThread", "sendToTarget", "throughSendBook"]

describe("keyed surfaces reach the remote send members only through the one body (ruling 5 ii)", () => {
  const calls: { readonly member: string; readonly open: readonly string[] }[] = []
  const directories: string[] = []

  beforeEach(() => {
    calls.length = 0
    const watched =
      <F extends (...args: never[]) => unknown>(member: string, body: F): F =>
      ((...args: Parameters<F>) => {
        calls.push({ member, open: [...trace.open] })
        return body(...args)
      }) as F
    const bodies: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
      [sdkSend, "sendToTarget"],
      [sendBook, "throughSendBook"],
    ]
    for (const [module, name] of bodies) {
      const body = module[name] as (...args: unknown[]) => unknown
      spyOn(module, name as never).mockImplementation(((...args: unknown[]) =>
        within(name, () => body(...args))) as never)
    }
    const relay = relaySessions.sessionMembers
    spyOn(relaySessions, "sessionMembers").mockImplementation((core) => {
      const members = relay(core)
      return { ...members, send: watched("relay send", members.send), open: watched("relay open", members.open) }
    })
    const here = localMembers.localSessionMembers
    spyOn(localMembers, "localSessionMembers").mockImplementation((hostOn) => {
      const members = here(hostOn)
      return { ...members, send: watched("here send", members.send) }
    })
  })
  afterEach(async () => {
    await closeClients()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  const outsideTheBody = () =>
    calls.filter((call) => !call.open.some((body) => SEND_BODIES.includes(body))).map((call) => call.member)

  const KEYED: ReadonlyArray<readonly [string, (h: Holder, thread: string) => Promise<unknown>]> = [
    ["tool thread_send", (h, thread) => h.s.run("thread_send", { thread, message: "hi", idempotency_key: "k-1" })],
    ["tool thread_create", (h) => h.s.run("thread_create", { name: "made", prompt: "hi" })],
    ["facade send", (h, thread) => h.sdk.send({ thread, text: "hi", idempotency_key: "k-1" })],
    ["facade create", (h) => h.sdk.create({ name: "made", prompt: "hi" })],
    ["root send", (h, thread) => h.root.threads.send({ thread, message: "hi", idempotency_key: "k-1" })],
    ["root create", (h) => h.root.threads.create({ name: "made", prompt: "hi" })],
    ["cli send", (h, thread) => cli(h, ["send", thread, "hi"])],
  ]

  test.each(KEYED.flatMap(([name, run]) => ["dur-local", "dur-on-b"].map((thread) => [name, thread, run] as const)))(
    "#given %s to %s #when it runs #then no remote send member is called outside the one send body",
    async (_name, thread, run) => {
      reset()
      await run(holder(), thread)
      expect(outsideTheBody()).toEqual([])
    },
  )

  test("#given a caller that sends through the remote client itself #when it runs #then each member's call is seen outside the body", async () => {
    const owner = await startOwner(defaultWorld())
    const agentDir = mkdtempSync(join(tmpdir(), "one-body-keyed-"))
    directories.push(agentDir)
    const host: ThreadHost = {
      socket: join(agentDir, "rpc.sock"),
      listSessions: async () => [{ sessionId: "rpc-1", durableSessionId: "dur-selected", cwd: "/w", name: "target" }],
      openSession: async () => ({ sessionId: "rpc-2", durableSessionId: "dur-made" }) as never,
      getMessages: async () => [],
      getState: async () => ({ isStreaming: false }),
      prompt: async () => ({ turnId: "1" }),
      interrupt: async () => ({ interrupted: true }) as never,
      setSessionName: async () => undefined,
      setModel: async (_s, provider, id) => ({ provider, id }),
      getAvailableModels: async () => [],
      setThinkingLevel: async () => undefined,
      getAvailableThinkingLevels: async () => [],
    }
    const client = clientOn(owner.stateDir, fakeClock(), undefined, {
      localSessions: async () => createLocalSessions(async () => host),
    })
    reset()
    await client.sessions.send(handleOf(PEER, SESSION_ID), { text: "hi" })
    await client.sessions.send(handleOf("dev-self", "dur-selected"), { text: "hi" })
    await client.sessions.open({ device: PEER, workspace: "/work" })
    // A send to this device passes the relay client's send, which hands it to this device's member.
    expect([...new Set(outsideTheBody())].toSorted()).toEqual(["here send", "relay open", "relay send"])
    // The same call made inside the body is not flagged.
    reset()
    calls.length = 0
    await within("sendToTarget", () => client.sessions.send(handleOf(PEER, SESSION_ID), { text: "again" }))
    expect(calls.map((call) => call.member)).toEqual(["relay send"])
    expect(outsideTheBody()).toEqual([])
  })
})
