import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ThreadToolName, ThreadToolResult } from "./contracts"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import type { AliasHolder, AliasRegistry, JsonObject, RemoteCommandOutcome, RemoteDevice, RemoteSessionRow, RemoteThreadSurface } from "./remote/ports"
import type { ThreadTranscriptEntry } from "./reader"
import { createThreadTools, UNKNOWN_CALLER, type ThreadHost, type ThreadHostSession } from "./tools"

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

// One engine for both legs: what this device's host answers and what device b's engine answers are the same data,
// so a remote result can be compared with the local result of the same call.
type Engine = { readonly messages: readonly ThreadTranscriptEntry[]; readonly interrupt: JsonObject; readonly streaming: boolean; readonly pending: number }
const ENGINE: Engine = { messages: Array.from({ length: 30 }, (_, index) => ({ role: index % 2 === 0 ? "user" : "assistant", content: `message ${index} ${"x".repeat(60)}` })), interrupt: { interrupted: false }, streaming: false, pending: 0 }

function account(options: { plan?: string; online?: boolean; refuse?: string; aliases?: Map<string, AliasHolder>; noRegistry?: boolean; engine?: Engine; failSessionsList?: boolean; failAliasesOf?: boolean; failClaim?: boolean } = {}) {
  const engine = options.engine ?? ENGINE
  const sent: Sent[] = []
  const hops: number[] = []
  const aliases = options.aliases ?? new Map<string, AliasHolder>()
  const answer = (rpc: JsonObject): RemoteCommandOutcome => {
    if (options.refuse !== undefined) return { kind: "refused", reason: options.refuse }
    if (rpc["type"] === "open_session") return { kind: "ok", response: { sessionId: "rpc-9", state: { durableSessionId: rpc["sessionPath"] === undefined ? "dur-new-on-b" : "dur-on-b" } } }
    if (rpc["type"] === "get_state") return { kind: "ok", response: { isStreaming: engine.streaming, pendingMessageCount: engine.pending } }
    if (rpc["type"] === "get_messages") return { kind: "ok", response: { messages: [...engine.messages] } }
    if (rpc["type"] === "interrupt") return { kind: "ok", response: engine.interrupt }
    if (rpc["type"] === "prompt") return { kind: "ok", response: { turnId: "turn-b" } }
    return { kind: "ok", response: {} }
  }
  const devices: RemoteDevice[] = [{ device: "here", label: "this mac", online: true }, { device: "b", label: "studio", online: options.online ?? true }]
  const registry: AliasRegistry = {
    claim: async ({ alias, holder }) => {
      if (options.failClaim === true) throw new Error("alias registry failed")
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
    aliasesOf: async (ids) => options.failAliasesOf === true ? Promise.reject(new Error("alias registry failed")) : ({ kind: "ok", value: new Map([...aliases].filter(([, holder]) => ids.includes(holder.session_id)).map(([alias, holder]) => [holder.session_id, alias])) }),
  }
  const remote: RemoteThreadSurface = {
    sessions: {
      status: async () => ({ state: options.plan ?? "connected" }),
      thisDevice: async () => "here",
      devices: async () => devices,
      sessions: async () => { if (options.failSessionsList === true) throw new Error("account list failed"); return [B_ROW] },
      endpointCommand: async (device, rpc) => { sent.push({ via: "endpoint", device, rpc }); return answer(rpc) },
      sessionCommand: async (device, session, rpc) => { sent.push({ via: "session", device, session, rpc }); return answer(rpc) },
      read: async (device, session) => { sent.push({ via: "read", device, session }); return { kind: "ok", response: { entries: [{ role: "user", content: "hi b" }, { role: "assistant", content: "hello from b" }] } } },
    },
    ...(options.noRegistry === true ? {} : { aliases: registry }),
    chain: { stamp: (record, hop) => { hops.push(hop); return { ...record, chain_count: hop } } },
  }
  return { remote, sent, hops, aliases }
}

function surface(remote: RemoteThreadSurface | undefined, extra: { callerCause?: () => string | undefined; sessions?: ThreadHostSession[]; engine?: Engine; caller?: string; diskSessions?: readonly string[] } = {}) {
  const engine = extra.engine ?? ENGINE
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
    getMessages: async () => [...engine.messages],
    getState: async () => ({ isStreaming: false }),
    prompt: async () => ({ turnId: "turn-local" }),
    interrupt: async () => engine.interrupt,
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
  // Session files with no live owner: the address book lists them from disk, and no host holds them.
  const disk = (extra.diskSessions ?? []).map((id) => ({ durable_id: id, name: null, cwd: process.cwd(), created_at: "2026-11-01T00:00:00Z", updated_at: null, session_path: join(agentDir, `${id}.jsonl`), source_host: null }))
  const caller = extra.caller ?? "dur-caller"
  const tools = createThreadTools({ host, store, stateDirectory: join(agentDir, "state"), diskSessions: () => disk, callerSessionId: () => caller, callerWorkspaceRoot: () => process.cwd(), remote, ...(extra.callerCause === undefined ? {} : { callerCause: extra.callerCause }) })
  const run = async (name: ThreadToolName, args: unknown): Promise<ThreadToolResult> => {
    const tool = tools.find((candidate) => candidate.name === name)
    if (tool === undefined) throw new Error(`${name} is not registered`)
    return (await tool.execute(`call-${Math.random()}`, args, undefined, undefined, { sessionManager: { getSessionId: () => caller } } as never)).details.result as ThreadToolResult
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

  test("#given a running thread on b #when thread_read, thread_send and thread_interrupt name it #then messages, state, prompt and interrupt reach b's session", async () => {
    const a = account({ engine: { ...ENGINE, messages: [{ role: "user", content: "hi b" }, { role: "assistant", content: "hello from b" }], interrupt: { turnId: "turn-b", interrupted: true } } })
    const { run } = surface(a.remote)
    expect(await run("thread_read", { thread: "dur-on-b" })).toMatchObject({ kind: "ok", device: "b", items: [{ role: "user", content: JSON.stringify("hi b") }, { role: "assistant", content: JSON.stringify("hello from b") }] })
    expect(await run("thread_send", { thread: "dur-on-b", message: "do the thing" })).toMatchObject({ kind: "ok", thread_id: "dur-on-b", device: "b", delivery: { kind: "started", turn_id: "turn-b" } })
    expect(await run("thread_interrupt", { thread: "dur-on-b" })).toMatchObject({ kind: "ok", thread_id: "dur-on-b", turn_id: "turn-b", interrupted: true })
    expect(a.sent.map((entry) => [entry.via, entry.rpc?.["type"]])).toEqual([["session", "get_messages"], ["session", "get_state"], ["session", "prompt"], ["session", "interrupt"]])
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

describe("the device service is not connected, or the alias registry is not there yet", () => {
  test("#given remote sessions turned off on this device #when a tool names this device's thread by name and another device's by id #then both answer exactly as without a remote surface: the local one works and the other is not_found", async () => {
    const a = account({ plan: "disabled" })
    const { run } = surface(a.remote)
    expect(await run("thread_send", { thread: "local peer", message: "local" })).toMatchObject({ kind: "ok", thread_id: "dur-local" })
    expect(await run("thread_send", { thread: "dur-on-b", message: "remote" })).toMatchObject({ kind: "error", error: { code: "not_found" } })
    expect(await run("thread_create", { device: "b" })).toMatchObject({ kind: "error", error: { code: "host_unavailable", details: { state: "disabled" } } })
    expect(a.sent).toEqual([])
  })

  test("#given no alias registry #when thread_create sets an alias #then it is host_unavailable and nothing is created; a create without an alias works", async () => {
    const a = account({ noRegistry: true })
    const { run, openSession } = surface(a.remote)
    expect(await run("thread_create", { alias: "x" })).toMatchObject({ kind: "error", error: { code: "host_unavailable" } })
    expect(openSession).not.toHaveBeenCalled()
    expect(await run("thread_create", {})).toMatchObject({ kind: "ok", thread: { thread_id: "dur-created-here" } })
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

// Q 11-04: a remote call answers exactly like the same call on this device. Each row runs one call on this
// device's thread and on b's, and compares the answers with only the identity fields (thread id, link, device) removed.
const comparable = (result: ThreadToolResult): unknown => {
  const { thread_id: _id, link: _link, device: _device, ...rest } = result as Record<string, unknown>
  return rest
}

describe("remote == local: the same call answers the same on b as on this device", () => {
  test.each([
    ["thread_read, a byte budget smaller than the transcript", "thread_read", { max_bytes: 800 }],
    ["thread_read, the whole transcript", "thread_read", {}],
    ["thread_interrupt on an idle thread with a made-up turn id", "thread_interrupt", { turn_id: "bogus" }],
    ["thread_rename to a blank name", "thread_rename", { name: "   " }],
    ["thread_rename to another visible thread's name", "thread_rename", { name: "Other Peer" }],
  ] as const)("#given %s #when it runs on this device and on b #then both answers are the same", async (_label, tool, args) => {
    const a = account()
    const other: ThreadHostSession = { sessionId: "route-other", durableSessionId: "dur-other", cwd: process.cwd(), name: "other peer", status: "open" }
    const local: ThreadHostSession = { sessionId: "route-local", durableSessionId: "dur-local", cwd: process.cwd(), name: "local peer", status: "open" }
    const { run } = surface(a.remote, { sessions: [local, other] })
    const here = await run(tool, { thread: "dur-local", ...args })
    const there = await run(tool, { thread: "dur-on-b", ...args })
    expect(comparable(there)).toEqual(comparable(here))
  })

  test("#given a truncated read on both #when each follows its next_cursor #then the second pages match too", async () => {
    const a = account()
    const { run } = surface(a.remote)
    const first = { here: await run("thread_read", { thread: "dur-local", max_bytes: 800 }), there: await run("thread_read", { thread: "dur-on-b", max_bytes: 800 }) }
    expect(first.here).toMatchObject({ kind: "ok", truncated: true })
    const cursor = (result: ThreadToolResult) => (result as { next_cursor?: string }).next_cursor
    const next = { here: await run("thread_read", { thread: "dur-local", cursor: cursor(first.here), max_bytes: 800 }), there: await run("thread_read", { thread: "dur-on-b", cursor: cursor(first.there), max_bytes: 800 }) }
    expect(comparable(next.there)).toEqual(comparable(next.here))
  })

  test("#given a refused rename that also names a new alias #when it runs on either leg #then the alias did not move", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_rename", { thread: "dur-local", name: "  ", alias: "kept-free-1" })).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect(await run("thread_rename", { thread: "dur-on-b", name: "  ", alias: "kept-free-2" })).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect([...a.aliases.keys()]).toEqual([])
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "set_session_name")).toEqual([])
  })

  test("#given a name another visible thread holds #when thread_create makes it here and on b #then both are name_conflict and nothing is opened", async () => {
    const a = account()
    const { run, openSession } = surface(a.remote)
    const here = await run("thread_create", { name: "local peer" })
    const there = await run("thread_create", { device: "studio", name: "local peer" })
    expect(comparable(there)).toEqual(comparable(here))
    expect(here).toMatchObject({ kind: "error", error: { code: "name_conflict" } })
    expect(openSession).not.toHaveBeenCalled()
    expect(a.sent).toEqual([])
  })

  test("#given skills on a create on b #when it opens #then the same initial-skills context a local create sends reaches b", async () => {
    const a = account()
    const { run } = surface(a.remote)
    await run("thread_create", { device: "studio", skills: ["programming"] })
    expect(a.sent.find((entry) => entry.rpc?.["type"] === "open_session")?.rpc?.["context"]).toEqual({ initial_skills: JSON.stringify(["programming"]) })
  })

  test("#given a send to b #when the same idempotency_key is used twice #then b gets one prompt and the retry replays the first answer as deduplicated", async () => {
    const a = account()
    const { run } = surface(a.remote)
    const first = await run("thread_send", { thread: "dur-on-b", message: "once", idempotency_key: "k1" })
    const again = await run("thread_send", { thread: "dur-on-b", message: "once", idempotency_key: "k1" })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "prompt")).toHaveLength(1)
    expect(first).toMatchObject({ kind: "ok", deduplicated: false })
    expect(again).toMatchObject({ kind: "ok", deduplicated: true, delivery: (first as { delivery: unknown }).delivery })
  })

  test("#given b is busy with 3 pending messages #when a message is sent #then it is queued at the position b reports and no gateway sequence is invented", async () => {
    const a = account({ engine: { ...ENGINE, streaming: true, pending: 3 } })
    const { run } = surface(a.remote)
    const sent = await run("thread_send", { thread: "dur-on-b", message: "later" })
    expect(sent).toMatchObject({ kind: "ok", delivery: { kind: "queued", queue_position: 3 } })
    expect("message_seq" in sent).toBe(false)
  })

  test("#given a fork source on this device #when thread_create forks it naming device b, and forks it by its alias #then the first is invalid_arguments with nothing opened, the second forks the resolved id here", async () => {
    const a = account({ aliases: new Map([["mine", { session_id: "dur-local", device: "here" }]]) })
    const { run, openSession } = surface(a.remote)
    expect(await run("thread_create", { fork_from: "dur-local", device: "studio" })).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect(a.sent).toEqual([])
    expect(openSession).not.toHaveBeenCalled()
    await run("thread_create", { fork_from: "mine" })
    expect(openSession).toHaveBeenCalledTimes(1)
    expect((openSession.mock.calls[0] as unknown as [{ forkFrom?: string }])[0].forkFrom).toBe("dur-local")
  })

  test("#given thread_create opens b's thread and names an alias #when it runs #then the alias is held by that thread", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_create", { thread: "dur-on-b", alias: "bee" })).toMatchObject({ kind: "ok", thread: { thread_id: "dur-on-b", alias: "bee" } })
    expect(a.aliases.get("bee")).toEqual({ session_id: "dur-on-b", device: "b" })
  })

  test("#given the account list fails after the service said connected #when a tool names a thread on this device by its name #then it answers exactly as with no remote surface", async () => {
    const a = account({ failSessionsList: true })
    const { run } = surface(a.remote)
    const withRemote = await run("thread_read", { thread: "local peer" })
    const without = await surface(undefined).run("thread_read", { thread: "local peer" })
    expect(comparable(withRemote)).toEqual(comparable(without))
    expect(withRemote).toMatchObject({ kind: "ok" })
  })
})

describe("remote == local, round 2: send modes, handoff, list and alias order", () => {
  test.each([
    ["a steer with no expected_turn_id", { delivery: "steer" }],
    ["a steer with a malformed expected_turn_id", { delivery: "steer", expected_turn_id: "abc" }],
  ] as const)("#given %s #when it is sent here and to b #then both refuse the same way at send time and b gets nothing", async (_label, args) => {
    const a = account()
    const { run } = surface(a.remote)
    const here = await run("thread_send", { thread: "dur-local", message: "x", ...args })
    const there = await run("thread_send", { thread: "dur-on-b", message: "x", ...args })
    expect(comparable(there)).toEqual(comparable(here))
    expect(here).toMatchObject({ kind: "error" })
    expect(a.sent).toEqual([])
  })

  test("#given b is idle #when a steer with an expected turn reaches it #then it is not_steerable, as a steer into an idle session is, and no prompt is sent", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_send", { thread: "dur-on-b", message: "x", delivery: "steer", expected_turn_id: "3" })).toMatchObject({ kind: "error", error: { code: "not_steerable" } })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "prompt")).toEqual([])
  })

  test("#given b is mid-turn #when a steer with a well-formed expected turn reaches it #then it is refused turn_conflict because b's engine cannot confirm the turn yet, and no prompt is sent", async () => {
    const a = account({ engine: { ...ENGINE, streaming: true, pending: 0 } })
    const { run } = surface(a.remote)
    expect(await run("thread_send", { thread: "dur-on-b", message: "x", delivery: "steer", expected_turn_id: "3" })).toMatchObject({ kind: "error", error: { code: "turn_conflict", details: { device: "b", reason: "remote_turn_not_verifiable" } } })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "prompt")).toEqual([])
  })

  test("#given a follow_up to b while it runs #when it is sent #then it is queued behind b's own pending count", async () => {
    const a = account({ engine: { ...ENGINE, streaming: true, pending: 2 } })
    const { run } = surface(a.remote)
    expect(await run("thread_send", { thread: "dur-on-b", message: "x", delivery: "follow_up" })).toMatchObject({ kind: "ok", delivery: { kind: "queued", queue_position: 2 } })
    expect(a.sent.find((entry) => entry.rpc?.["type"] === "prompt")?.rpc?.["streamingBehavior"]).toBe("followUp")
  })

  test("#given b's thread #when thread_handoff names it by id #then the message reaches b and the receipt names the thread, its device and how it was resolved", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_handoff", { thread: "dur-on-b", message: "take this" })).toMatchObject({ kind: "ok", resolved_by: "exact_name", thread: { thread_id: "dur-on-b", device: "b" }, delivery: { kind: "started" } })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "prompt").map((entry) => entry.rpc?.["message"])).toEqual(["take this"])
  })

  test.each([
    ["the account session list fails", { failSessionsList: true }],
    ["the alias registry fails", { failAliasesOf: true }],
  ] as const)("#given %s #when thread_list runs with all_scope #then this device's threads are still listed", async (_label, options) => {
    const a = account(options)
    const { run } = surface(a.remote)
    const listed = await run("thread_list", { all_scope: true })
    expect(listed).toMatchObject({ kind: "ok" })
    if (listed.kind !== "ok" || !("threads" in listed)) throw new Error(`thread_list failed: ${JSON.stringify(listed)}`)
    expect(listed.threads.map((thread) => thread.thread_id)).toContain("dur-local")
  })

  test("#given a caller with no durable id #when it sends here and to b #then both refuse the same way at send time and b gets nothing", async () => {
    const a = account()
    const { run } = surface(a.remote, { caller: UNKNOWN_CALLER })
    const here = await run("thread_send", { thread: "dur-local", message: "x", idempotency_key: "k-here" })
    const there = await run("thread_send", { thread: "dur-on-b", message: "x", idempotency_key: "k-there" })
    expect(here).toMatchObject({ kind: "error", error: { code: "caller_context_missing" } })
    expect(comparable(there)).toEqual(comparable(here))
    // A refusal before any store write leaves no receipt, so a retry under the same key with other args refuses the same way.
    const hereAgain = await run("thread_send", { thread: "dur-local", message: "y", idempotency_key: "k-here" })
    const thereAgain = await run("thread_send", { thread: "dur-on-b", message: "y", idempotency_key: "k-there" })
    expect(hereAgain).toMatchObject({ kind: "error", error: { code: "caller_context_missing" } })
    expect(comparable(thereAgain)).toEqual(comparable(hereAgain))
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "prompt")).toEqual([])
  })

  test("#given no remote surface and a thread with no live owner #when thread_rename gives it a blank name #then it is not_resumable, as before the remote tools", async () => {
    const { run } = surface(undefined, { diskSessions: ["dur-disk"] })
    expect(await run("thread_rename", { thread: "dur-disk", name: "   " })).toMatchObject({ kind: "error", error: { code: "not_resumable" } })
  })

  test("#given device b is offline #when thread_rename renames b's thread and moves its alias #then it is device_offline, the alias did not move, and nothing is sent", async () => {
    const a = account({ online: false, aliases: new Map([["bee", { session_id: "dur-on-b", device: "b" }]]) })
    const { run } = surface(a.remote)
    expect(await run("thread_rename", { thread: "dur-on-b", name: "renamed", alias: "wasp" })).toMatchObject({ kind: "error", error: { code: "device_offline", details: { device: "b" } } })
    expect([...a.aliases.keys()]).toEqual(["bee"])
    expect(a.sent).toEqual([])
  })

  test("#given the alias registry fails while thread_create claims an alias #when the thread was already created on b #then the error names the created thread, so it is not lost", async () => {
    const a = account({ failClaim: true })
    const { run } = surface(a.remote)
    expect(await run("thread_create", { device: "studio", alias: "bee" })).toMatchObject({ kind: "error", error: { code: "host_unavailable", details: { thread_id: "dur-new-on-b" } } })
  })

  test("#given two local threads share a name and an alias spelled the same is held by b's thread #when a tool names it #then the alias wins over the ambiguous local name", async () => {
    const a = account({ aliases: new Map([["twin", { session_id: "dur-on-b", device: "b" }]]) })
    const twins: ThreadHostSession[] = [{ sessionId: "r1", durableSessionId: "dur-t1", cwd: process.cwd(), name: "twin", status: "open" }, { sessionId: "r2", durableSessionId: "dur-t2", cwd: process.cwd(), name: "twin", status: "open" }]
    const { run } = surface(a.remote, { sessions: twins })
    expect(await run("thread_read", { thread: "twin" })).toMatchObject({ kind: "ok", thread_id: "dur-on-b", device: "b" })
  })
})
