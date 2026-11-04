import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ThreadToolName, ThreadToolResult } from "./contracts"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import type { AliasHolder, AliasRegistry, JsonObject, RemoteCommandOutcome, RemoteDevice, RemoteSessionRow, RemoteThreadSurface } from "./remote/ports"
import { createThreadTools, type ThreadHost, type ThreadHostSession } from "./tools"

// Cross-device thread tools (brain/hand plan r6: O8, SC-R8, R8.c, A3, A5) over a fake account: device "here" is this
// machine, device "b" is another signed-in device. The fakes record every relay call so each case can assert
// both what the tool answered and what it sent (or that it sent nothing).

const directories: string[] = []
const stores: GatewayStore[] = []
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const B_ROW: RemoteSessionRow = { device: "b", session_id: "dur-on-b", title: "on b", project: "/work/b", path: "/home/b/.omo/agent/sessions/dur-on-b.jsonl", state: "idle", updated_ms: 1_700_000_000_000 }

type Sent = { readonly via: "endpoint" | "session" | "read"; readonly device: string; readonly session?: string; readonly rpc?: JsonObject }

function account(options: { plan?: string; online?: boolean; refuse?: string; aliases?: Map<string, AliasHolder> } = {}) {
  const sent: Sent[] = []
  const hops: number[] = []
  const aliases = options.aliases ?? new Map<string, AliasHolder>()
  const answer = (rpc: JsonObject): RemoteCommandOutcome => {
    if (options.refuse !== undefined) return { kind: "refused", reason: options.refuse }
    if (rpc["type"] === "open_session") return { kind: "ok", response: { sessionId: "rpc-9", state: { durableSessionId: rpc["sessionPath"] === undefined ? "dur-new-on-b" : "dur-on-b" } } }
    if (rpc["type"] === "get_state") return { kind: "ok", response: { isStreaming: false } }
    if (rpc["type"] === "prompt") return { kind: "ok", response: { turnId: "turn-b" } }
    return { kind: "ok", response: {} }
  }
  const devices: RemoteDevice[] = [{ device: "here", label: "this mac", online: true }, { device: "b", label: "studio", online: options.online ?? true }]
  const registry: AliasRegistry = {
    claim: async ({ alias, holder }) => {
      const held = aliases.get(alias)
      if (held !== undefined && held.session_id !== holder.session_id) return { kind: "error", error: { code: "alias_taken", message: `alias ${alias} is taken`, details: { holder: held } } }
      aliases.set(alias, holder)
      return { kind: "ok", value: { alias, holder } }
    },
    rename: async ({ session_id, from, to }) => {
      const held = aliases.get(to)
      if (held !== undefined && held.session_id !== session_id) return { kind: "error", error: { code: "alias_taken", message: `alias ${to} is taken`, details: { holder: held } } }
      const holder = aliases.get(from)
      if (holder === undefined) return { kind: "error", error: { code: "alias_not_found", message: "no such alias" } }
      aliases.delete(from)
      aliases.set(to, holder)
      return { kind: "ok", value: { alias: to, holder } }
    },
    release: async ({ alias }) => ({ kind: "ok", value: { released: aliases.delete(alias) } }),
    resolve: async (alias) => {
      const held = aliases.get(alias)
      return held === undefined ? { kind: "error", error: { code: "alias_not_found", message: "no such alias" } } : { kind: "ok", value: held }
    },
    aliasesOf: async (ids) => ({ kind: "ok", value: new Map([...aliases].filter(([, holder]) => ids.includes(holder.session_id)).map(([alias, holder]) => [holder.session_id, alias])) }),
  }
  const remote: RemoteThreadSurface = {
    sessions: {
      status: async () => ({ state: options.plan ?? "connected" }),
      thisDevice: async () => "here",
      devices: async () => devices,
      sessions: async () => [B_ROW],
      endpointCommand: async (device, rpc) => { sent.push({ via: "endpoint", device, rpc }); return answer(rpc) },
      sessionCommand: async (device, session, rpc) => { sent.push({ via: "session", device, session, rpc }); return answer(rpc) },
      read: async (device, session) => { sent.push({ via: "read", device, session }); return { kind: "ok", response: { entries: [{ role: "user", content: "hi b" }, { role: "assistant", content: "hello from b" }] } } },
    },
    aliases: registry,
    chain: { stamp: (record, hop) => { hops.push(hop); return { ...record, chain_count: hop } } },
  }
  return { remote, sent, hops, aliases }
}

function surface(remote: RemoteThreadSurface | undefined, extra: { callerCause?: () => string | undefined; sessions?: ThreadHostSession[] } = {}) {
  const local: ThreadHostSession = { sessionId: "route-local", durableSessionId: "dur-local", cwd: process.cwd(), name: "local peer", status: "open" }
  const sessions = extra.sessions ?? [local]
  const openSession = mock(async () => {
    const created: ThreadHostSession = { sessionId: "route-created", durableSessionId: "dur-created-here", cwd: process.cwd(), name: null, status: "open" }
    sessions.push(created)
    return created
  })
  const host: ThreadHost = {
    socket: "/tmp/thread-remote-test.sock",
    listSessions: async () => sessions,
    openSession,
    getMessages: async () => [{ role: "user", content: "local" }],
    getState: async () => ({ isStreaming: false }),
    prompt: async () => ({ turnId: "turn-local" }),
    interrupt: async () => ({ interrupted: true }),
    setSessionName: async () => {},
    setModel: async (_s, provider, id) => ({ provider, id }),
    getAvailableModels: async () => [],
    setThinkingLevel: async () => {},
    getAvailableThinkingLevels: async () => [],
  }
  const agentDir = mkdtempSync(join(tmpdir(), "thread-remote-"))
  directories.push(agentDir)
  const store = createGatewayStore({ agentDir })
  stores.push(store)
  const tools = createThreadTools({ host, store, stateDirectory: join(agentDir, "state"), callerSessionId: () => "dur-caller", callerWorkspaceRoot: () => process.cwd(), remote, ...(extra.callerCause === undefined ? {} : { callerCause: extra.callerCause }) })
  const run = async (name: ThreadToolName, args: unknown): Promise<ThreadToolResult> => {
    const tool = tools.find((candidate) => candidate.name === name)
    if (tool === undefined) throw new Error(`${name} is not registered`)
    return (await tool.execute(`call-${Math.random()}`, args, undefined, undefined, { sessionManager: { getSessionId: () => "dur-caller" } } as never)).details.result as ThreadToolResult
  }
  return { run, openSession, store }
}

describe("SC-R8: from this device on another (create, list, open, status, prompt, abort, fork)", () => {
  test("#given no session on device b #when thread_create names device b #then one attach-less open_session goes to b's engine endpoint and the thread is b's", async () => {
    const a = account()
    const { run, openSession } = surface(a.remote)
    const result = await run("thread_create", { device: "studio", name: "fresh" })
    expect(result).toMatchObject({ kind: "ok", thread: { thread_id: "dur-new-on-b", device: "b", name: "fresh" } })
    expect(a.sent.map((entry) => [entry.via, entry.device, entry.rpc?.["type"]])).toEqual([["endpoint", "b", "open_session"], ["session", "b", "set_session_name"]])
    expect(openSession).not.toHaveBeenCalled()
  })

  test("#given a thread on b #when thread_list runs with all_scope #then b's thread is listed with its device, and the default scope lists only this device's threads", async () => {
    const a = account()
    const { run } = surface(a.remote)
    const all = await run("thread_list", { all_scope: true })
    expect(all.kind === "ok" && "threads" in all && all.threads.map((thread) => [thread.thread_id, thread.device ?? "here"])).toEqual([["dur-local", "here"], ["dur-on-b", "b"]])
    const scoped = await run("thread_list", {})
    expect(scoped.kind === "ok" && "threads" in scoped && scoped.threads.map((thread) => thread.thread_id)).toEqual(["dur-local"])
  })

  test("#given a thread on b #when thread_create names it by id #then b opens that session file; no device is passed or needed", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_create", { thread: "dur-on-b" })).toMatchObject({ kind: "ok", thread: { thread_id: "dur-on-b", device: "b" } })
    expect(a.sent).toEqual([{ via: "endpoint", device: "b", rpc: { type: "open_session", retain_on_disconnect: true, sessionPath: B_ROW.path } }])
  })

  test("#given a thread on b #when thread_read, thread_send and thread_interrupt name it #then status, prompt and abort reach b's session", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_read", { thread: "dur-on-b" })).toMatchObject({ kind: "ok", device: "b", items: [{ role: "user", content: "hi b" }, { role: "assistant", content: "hello from b" }] })
    expect(await run("thread_send", { thread: "dur-on-b", message: "do the thing" })).toMatchObject({ kind: "ok", thread_id: "dur-on-b", device: "b", delivery: { kind: "started", turn_id: "turn-b" } })
    expect(await run("thread_interrupt", { thread: "dur-on-b" })).toMatchObject({ kind: "ok", thread_id: "dur-on-b", interrupted: true })
    expect(a.sent.map((entry) => [entry.via, entry.rpc?.["type"] ?? "read"])).toEqual([["read", "read"], ["session", "get_state"], ["session", "prompt"], ["session", "abort"]])
  })

  test("#given a thread on b #when thread_create forks it #then the fork is opened on b from that source", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_create", { fork_from: "dur-on-b" })).toMatchObject({ kind: "ok", thread: { thread_id: "dur-new-on-b", device: "b" } })
    expect(a.sent[0]).toEqual({ via: "endpoint", device: "b", rpc: { type: "open_session", retain_on_disconnect: true, forkFrom: "dur-on-b" } })
  })

  test.each([
    ["capability_missing", "scope_denied"],
    ["host_detached", "host_unavailable"],
  ])("#given b refuses with %s #when a command reaches it #then the tool answers %s, as data, with the device named", async (reason, code) => {
    const a = account({ refuse: reason })
    const { run } = surface(a.remote)
    expect(await run("thread_send", { thread: "dur-on-b", message: "x" })).toMatchObject({ kind: "error", error: { code, details: { device: "b", reason } } })
  })
})

describe("K8 / R8.c: a chain carries its count across devices; no count or cost limit by default", () => {
  test("#given a caller with no cause and then one running on a hop-1 delivery #when it sends to b #then the wire gets hop 1 and then hop 2, with no cost field", async () => {
    const a = account()
    let cause: string | undefined
    const { run } = surface(a.remote, { callerCause: () => cause })
    await run("thread_send", { thread: "dur-on-b", message: "start of a chain" })
    const local = await run("thread_send", { thread: "dur-local", message: "a hop-1 delivery" })
    if (local.kind !== "ok" || !("delivery_id" in local) || local.delivery_id === undefined) throw new Error(`local send failed: ${JSON.stringify(local)}`)
    cause = local.delivery_id
    await run("thread_send", { thread: "dur-on-b", message: "continues the chain" })
    expect(a.hops).toEqual([1, 2])
    const prompts = a.sent.filter((entry) => entry.rpc?.["type"] === "prompt").map((entry) => entry.rpc ?? {})
    expect(prompts.map((record) => [record["chain_count"], Object.keys(record).some((key) => /cost/i.test(key))])).toEqual([[1, false], [2, false]])
  })
})

describe("A3: an existing thread is named by id or alias only; a device only to create", () => {
  test("#given an id and a device #when thread_create runs #then it is invalid_arguments and nothing is sent", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_create", { thread: "dur-on-b", device: "b" })).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect(a.sent).toEqual([])
  })

  test("#given no id and no device #when thread_create runs #then the thread is created on this device exactly as before", async () => {
    const a = account()
    const { run, openSession } = surface(a.remote)
    expect(await run("thread_create", {})).toMatchObject({ kind: "ok", thread: { thread_id: "dur-created-here" } })
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(a.sent).toEqual([])
  })

  test("#given an alias held by b's thread #when a tool names the alias #then it reaches b's session; an exact id still wins over an alias spelled like a local name", async () => {
    const a = account({ aliases: new Map([["release-train", { session_id: "dur-on-b", device: "b" }], ["local peer", { session_id: "dur-on-b", device: "b" }]]) })
    const { run } = surface(a.remote)
    expect(await run("thread_send", { thread: "release-train", message: "go" })).toMatchObject({ kind: "ok", thread_id: "dur-on-b", device: "b" })
    expect(await run("thread_send", { thread: "dur-local", message: "here" })).toMatchObject({ kind: "ok", thread_id: "dur-local" })
    expect(await run("thread_send", { thread: "local peer", message: "alias first" })).toMatchObject({ kind: "ok", thread_id: "dur-on-b", device: "b" })
  })

  test("#given an alias held by another thread #when thread_create sets it #then alias_taken names the holder and nothing is created", async () => {
    const a = account({ aliases: new Map([["taken", { session_id: "dur-on-b", device: "b" }]]) })
    const { run, openSession } = surface(a.remote)
    expect(await run("thread_create", { alias: "taken" })).toMatchObject({ kind: "error", error: { code: "alias_taken", details: { holder: { session_id: "dur-on-b", device: "b" } } } })
    expect(openSession).not.toHaveBeenCalled()
  })

  test("#given a free alias #when thread_create sets it and thread_rename moves it #then the alias resolves to the new thread, the old alias is freed, and a duplicate rename is alias_taken", async () => {
    const a = account({ aliases: new Map([["other", { session_id: "dur-on-b", device: "b" }]]) })
    const { run } = surface(a.remote)
    expect(await run("thread_create", { alias: "mine" })).toMatchObject({ kind: "ok", thread: { thread_id: "dur-created-here", alias: "mine" } })
    expect(await run("thread_rename", { thread: "mine", alias: "renamed" })).toMatchObject({ kind: "ok", alias: "renamed" })
    expect([...a.aliases.keys()].sort()).toEqual(["other", "renamed"])
    expect(await run("thread_rename", { thread: "renamed", alias: "other" })).toMatchObject({ kind: "error", error: { code: "alias_taken", details: { holder: { session_id: "dur-on-b" } } } })
    expect(await run("thread_rename", { thread: "renamed" })).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect(a.sent).toEqual([])
  })

  test("#given device b is offline #when a tool names b's thread #then it answers device_offline and nothing is queued or sent", async () => {
    const a = account({ online: false })
    const { run, store } = surface(a.remote)
    expect(await run("thread_send", { thread: "dur-on-b", message: "x" })).toMatchObject({ kind: "error", error: { code: "device_offline", details: { device: "b" } } })
    expect(a.sent).toEqual([])
    expect(await store.list()).toEqual([])
  })
})

describe("A5: the relay is paid only", () => {
  test("#given a Free account #when a tool needs another device #then it is relay_requires_paid_plan, nothing is sent or queued, and this device's threads work as before", async () => {
    const a = account({ plan: "plan_required" })
    const { run, openSession, store } = surface(a.remote)
    expect(await run("thread_create", { device: "b" })).toMatchObject({ kind: "error", error: { code: "relay_requires_paid_plan" } })
    expect(await run("thread_send", { thread: "dur-on-b", message: "x" })).toMatchObject({ kind: "error", error: { code: "relay_requires_paid_plan" } })
    expect(await run("thread_list", { all_scope: true })).toMatchObject({ kind: "ok", remote_unavailable: "relay_requires_paid_plan" })
    expect(a.sent).toEqual([])
    expect(await store.list()).toEqual([])
    expect(await run("thread_create", {})).toMatchObject({ kind: "ok", thread: { thread_id: "dur-created-here" } })
    expect(openSession).toHaveBeenCalledTimes(1)
  })
})
