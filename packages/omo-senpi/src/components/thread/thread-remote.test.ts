import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { COMMAND_UNCERTAIN_REASONS } from "../../../../device-service-core/src/local-api/vocabulary"
import type { ThreadToolResult } from "./contracts"
import { gatewayDatabasePath } from "./gateway/paths"
import { type ThreadHostSession } from "./tools"
import { B_ROW, comparable, createRemoteThreadFixture } from "./thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

describe("thread_set_model on another device", () => {
  test("#given a thread on b #when thread_set_model names it #then the model is matched against b's own list and set_model goes to b's session, with nothing changed on this device", async () => {
    const a = account()
    const { run } = surface(a.remote)
    const result = await run("thread_set_model", { thread: "dur-on-b", model: "opus" })
    expect(result).toEqual({
      kind: "ok",
      thread_id: "dur-on-b",
      model: { provider: "anthropic", id: "claude-opus" },
      device: "b",
    })
    expect(a.sent.map((entry) => [entry.via, entry.device, entry.session, entry.rpc])).toEqual([
      ["session", "b", "rk-on-b", { type: "get_available_models", sessionId: "rk-on-b" }],
      [
        "session",
        "b",
        "rk-on-b",
        { type: "set_model", sessionId: "rk-on-b", provider: "anthropic", modelId: "claude-opus" },
      ],
    ])
  })

  test("#given b refuses the command #when thread_set_model targets b's thread #then the refusal is typed and set_model is never sent", async () => {
    const a = account({ refuse: "capability_missing" })
    const { run } = surface(a.remote)
    const result = await run("thread_set_model", { thread: "dur-on-b", model: "opus" })
    expect(result).toMatchObject({ kind: "error", error: { code: "scope_denied" } })
    expect(a.sent.map((entry) => entry.rpc?.["type"])).toEqual(["get_available_models"])
  })
})

describe("SC-R8: from this device on another (create, list, open, status, prompt, abort, fork)", () => {
  test("#given no session on device b #when thread_create names device b #then one attach-less open_session goes to b's engine endpoint and the thread is b's", async () => {
    const a = account()
    const { run, openSession } = surface(a.remote)
    const result = await run("thread_create", { device: "studio", name: "fresh" })
    expect(result).toMatchObject({ kind: "ok", thread: { thread_id: "dur-new-on-b", device: "b", name: "fresh" } })
    expect(a.sent.map((entry) => [entry.via, entry.device, entry.rpc?.["type"]])).toEqual([
      ["endpoint", "b", "open_session"],
      ["session", "b", "set_session_name"],
    ])
    expect(openSession).not.toHaveBeenCalled()
  })

  test("#given a thread on b #when thread_list runs with all_scope #then b's thread is listed with its device, and the default scope lists only this device's threads", async () => {
    const a = account()
    const { run } = surface(a.remote)
    const all = await run("thread_list", { all_scope: true })
    expect(
      all.kind === "ok" && "threads" in all && all.threads.map((thread) => [thread.thread_id, thread.device ?? "here"]),
    ).toEqual([
      ["dur-local", "here"],
      ["dur-on-b", "b"],
    ])
    const scoped = await run("thread_list", {})
    expect(scoped.kind === "ok" && "threads" in scoped && scoped.threads.map((thread) => thread.thread_id)).toEqual([
      "dur-local",
    ])
  })

  test("#given an ended thread on b #when thread_create names it by id #then b opens that session file; no device is passed or needed", async () => {
    const a = account({ rowState: "ended" })
    const { run } = surface(a.remote)
    expect(await run("thread_create", { thread: "dur-on-b" })).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-on-b", device: "b" },
      deduplicated: false,
    })
    expect(a.sent).toEqual([
      {
        via: "endpoint",
        device: "b",
        rpc: { type: "open_session", retain_on_disconnect: true, sessionPath: B_ROW.path },
      },
    ])
  })

  test("#given a thread on b #when thread_create forks it #then the fork is opened on b from that source", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_create", { fork_from: "dur-on-b" })).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-new-on-b", device: "b" },
    })
    expect(a.sent[0]).toEqual({
      via: "endpoint",
      device: "b",
      rpc: { type: "open_session", retain_on_disconnect: true, forkFrom: "dur-on-b" },
    })
  })

  test("#given b's engine answers open_session with its real envelope (ids under data) #when thread_create creates and forks on b #then each succeeds with the durable id, falling back to data.sessionId when no durable id is named", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_create", { device: "studio" })).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-new-on-b", device: "b" },
    })
    expect(await run("thread_create", { fork_from: "dur-on-b" })).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-new-on-b", device: "b" },
    })
    const bare = account({ openData: { sessionId: "bmV3LXNlc3Npb24tMDAwMQ" } })
    expect(await surface(bare.remote).run("thread_create", { device: "studio" })).toMatchObject({
      kind: "ok",
      thread: { thread_id: "bmV3LXNlc3Npb24tMDAwMQ", device: "b" },
    })
  })
})

describe("A3: an existing thread is named by id or alias only; a device only to create", () => {
  test("#given an id and a device #when thread_create runs #then it is invalid_arguments and nothing is sent", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_create", { thread: "dur-on-b", device: "b" })).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments" },
    })
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
    const a = account({
      aliases: new Map([
        ["release-train", { session_id: "dur-on-b", device: "b" }],
        ["local peer", { session_id: "dur-on-b", device: "b" }],
      ]),
    })
    const { run } = surface(a.remote)
    expect(await run("thread_send", { thread: "release-train", message: "go" })).toMatchObject({
      kind: "ok",
      thread_id: "dur-on-b",
      device: "b",
    })
    expect(await run("thread_send", { thread: "dur-local", message: "here" })).toMatchObject({
      kind: "ok",
      thread_id: "dur-local",
    })
    expect(await run("thread_send", { thread: "local peer", message: "alias first" })).toMatchObject({
      kind: "ok",
      thread_id: "dur-on-b",
      device: "b",
    })
  })

  test("#given an alias held by another thread #when thread_create sets it #then alias_taken names the holder and nothing is created", async () => {
    const a = account({ aliases: new Map([["taken", { session_id: "dur-on-b", device: "b" }]]) })
    const { run, openSession } = surface(a.remote)
    expect(await run("thread_create", { alias: "taken" })).toMatchObject({
      kind: "error",
      error: { code: "alias_taken", details: { holder: { session_id: "dur-on-b", device: "b" } } },
    })
    expect(openSession).not.toHaveBeenCalled()
  })

  test("#given a free alias #when thread_create sets it and thread_rename moves it #then the alias resolves to the new thread, the old alias is freed, and a duplicate rename is alias_taken", async () => {
    const a = account({ aliases: new Map([["other", { session_id: "dur-on-b", device: "b" }]]) })
    const { run } = surface(a.remote)
    expect(await run("thread_create", { alias: "mine" })).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-created-here", alias: "mine" },
    })
    expect(await run("thread_rename", { thread: "mine", alias: "renamed" })).toMatchObject({
      kind: "ok",
      alias: "renamed",
    })
    expect([...a.aliases.keys()].sort()).toEqual(["other", "renamed"])
    expect(await run("thread_rename", { thread: "renamed", alias: "other" })).toMatchObject({
      kind: "error",
      error: { code: "alias_taken", details: { holder: { session_id: "dur-on-b" } } },
    })
    expect(await run("thread_rename", { thread: "renamed" })).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments" },
    })
    expect(a.sent).toEqual([])
  })

  test("#given b's thread_read is refused because the command never reached b's engine #when it runs #then it is host_unavailable with a plain retry, not an update-omo answer", async () => {
    const a = account({ refuse: "closed" })
    const { run } = surface(a.remote)
    expect(await run("thread_read", { thread: "dur-on-b" })).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable", details: { device: "b", reason: "closed" } },
    })
  })

  // Every reason the device service can end a read-only record uncertain with, from its own vocabulary (not a copy).
  test.each(COMMAND_UNCERTAIN_REASONS.map((reason) => [reason]))(
    "#given b's thread_read ends with the relay's %s #when it runs #then the answer is a typed retry, or for an oversized transcript a typed refusal, never update-omo",
    async (reason) => {
      const a = account({ refuse: reason })
      const { run } = surface(a.remote)
      const read = await run("thread_read", { thread: "dur-on-b" })
      expect(read).toMatchObject({
        kind: "error",
        error: {
          code: reason === "record_too_large" ? "unsupported" : "host_unavailable",
          details: { device: "b", reason },
        },
      })
      if (read.kind === "error") expect(read.error.next_action).not.toContain("Update omo")
    },
  )

  test("#given device b is offline #when a tool names b's thread #then it answers device_offline and nothing is queued or sent", async () => {
    const a = account({ online: false })
    const { run, store } = surface(a.remote)
    expect(await run("thread_send", { thread: "dur-on-b", message: "x" })).toMatchObject({
      kind: "error",
      error: { code: "device_offline", details: { device: "b" } },
    })
    expect(a.sent).toEqual([])
    expect(await store.list()).toEqual([])
  })
})

describe("#12833: a name reaches a thread on another device by its title", () => {
  const titled = (device: string, session_id: string, title: string, state = "idle") => ({
    ...B_ROW,
    device,
    session_id,
    durable_id: session_id,
    title,
    state,
  })

  test("#given b lists live and ended sessions #when their names are addressed #then the live session receives the send and the ended session resolves without a live owner", async () => {
    const a = account({
      rows: [
        titled("b", "dur-on-b", "Release Train"),
        titled("here", "dur-local", "local peer"),
        titled("b", "dur-old-on-b", "stale", "ended"),
      ],
    })
    const { run } = surface(a.remote)
    expect(await run("thread_send", { thread: "release  train", message: "go" })).toMatchObject({
      kind: "ok",
      thread_id: "dur-on-b",
      device: "b",
    })
    expect(
      a.sent
        .filter((entry) => entry.rpc?.["type"] === "admit_external_message")
        .map((entry) => [entry.device, entry.session]),
    ).toEqual([["b", "dur-on-b"]])
    expect(await run("thread_send", { thread: "local peer", message: "here" })).toMatchObject({
      kind: "ok",
      thread_id: "dur-local",
    })
    expect(await run("thread_close", { thread: "stale" })).toMatchObject({
      kind: "ok",
      thread_id: "dur-old-on-b",
      closed: false,
    })
  })

  test("#given two devices each hold a session with the name #when a tool names it #then it is ambiguous_target listing both with their devices, and nothing is sent", async () => {
    const a = account({ rows: [titled("b", "dur-on-b", "worker"), titled("c", "dur-on-c", "Worker")] })
    const { run } = surface(a.remote)
    const result = await run("thread_send", { thread: "worker", message: "x" })
    expect(result).toMatchObject({ kind: "error", error: { code: "ambiguous_target" } })
    const candidates =
      result.kind === "error"
        ? (result.error.details?.["candidates"] as readonly { id: string; device?: string }[])
        : []
    expect(candidates.map((candidate) => [candidate.id, candidate.device]).sort()).toEqual([
      ["dur-on-b", "b"],
      ["dur-on-c", "c"],
    ])
    expect(a.sent).toEqual([])
  })

  test.each([["refused" as const], ["throws" as const]])(
    "#given the alias registry is down (%s) #when a tool names a local thread, a remote title or nothing #then each resolves exactly as without a registry; only an explicit alias claim is refused typed",
    async (registryDown) => {
      const a = account({
        registryDown,
        rows: [titled("b", "dur-on-b", "release train"), titled("here", "dur-local", "local peer")],
      })
      const { run, openSession } = surface(a.remote)
      expect(await run("thread_send", { thread: "local peer", message: "here" })).toMatchObject({
        kind: "ok",
        thread_id: "dur-local",
      })
      expect(await run("thread_send", { thread: "release train", message: "there" })).toMatchObject({
        kind: "ok",
        thread_id: "dur-on-b",
        device: "b",
      })
      expect(await run("thread_send", { thread: "nobody", message: "x" })).toMatchObject({
        kind: "error",
        error: { code: "not_found" },
      })
      expect(await run("thread_create", { alias: "mine" })).toMatchObject({
        kind: "error",
        error: { code: "host_unavailable" },
      })
      expect(openSession).not.toHaveBeenCalled()
    },
  )

  test("#given aliases claimed on b for a terminal-held and an rpc-host session (held by durable id; b's listing keys each by a relay key and names only its project) #when a tool names each alias from this device #then each reaches its listing row on b through b's connector key, never a false not_found or device_offline", async () => {
    // A listing row's path is the session's project directory, never its session file: the durable id is not in the row.
    const terminalRow = { ...titled("b", "sJMySZH_wlx9qQ25AU60qQ", "worker b tui"), path: "/home/b" }
    const hostRow = { ...titled("b", "JkMGhxKatogMmrmtCW-oFA", "worker b rpc"), path: "/home/b" }
    const a = account({
      rows: [terminalRow, hostRow],
      relayKeys: new Map([
        ["dur-tui-on-b", "sJMySZH_wlx9qQ25AU60qQ"],
        ["dur-rpc-on-b", "JkMGhxKatogMmrmtCW-oFA"],
      ]),
      aliases: new Map([
        ["tui-b", { session_id: "dur-tui-on-b", device: "b" }],
        ["rpc-b", { session_id: "dur-rpc-on-b", device: "b" }],
      ]),
      live: ["sJMySZH_wlx9qQ25AU60qQ", "JkMGhxKatogMmrmtCW-oFA"],
    })
    const { run } = surface(a.remote)
    expect(await run("thread_send", { thread: "tui-b", message: "go" })).toMatchObject({
      kind: "ok",
      thread_id: "sJMySZH_wlx9qQ25AU60qQ",
      device: "b",
    })
    expect(await run("thread_send", { thread: "rpc-b", message: "go" })).toMatchObject({
      kind: "ok",
      thread_id: "JkMGhxKatogMmrmtCW-oFA",
      device: "b",
    })
    expect(
      a.sent
        .filter((entry) => entry.rpc?.["type"] === "admit_external_message")
        .map((entry) => [entry.device, entry.session]),
    ).toEqual([
      ["b", "sJMySZH_wlx9qQ25AU60qQ"],
      ["b", "JkMGhxKatogMmrmtCW-oFA"],
    ])
  })

  test("#given an alias held by a thread on this device outside the caller's workspace #when thread_read and thread_send name the alias #then both reach it without all_scope, while its raw id alone stays scope_denied as before", async () => {
    const far: ThreadHostSession = {
      sessionId: "route-far",
      durableSessionId: "dur-far",
      cwd: "/thread-remote-far-workspace",
      name: "far lane",
      status: "open",
    }
    const near: ThreadHostSession = {
      sessionId: "route-local",
      durableSessionId: "dur-local",
      cwd: process.cwd(),
      name: "local peer",
      status: "open",
    }
    const a = account({ aliases: new Map([["my-far", { session_id: "dur-far", device: "here" }]]) })
    const { run } = surface(a.remote, { sessions: [near, far] })
    expect(await run("thread_read", { thread: "my-far" })).toMatchObject({ kind: "ok", thread_id: "dur-far" })
    expect(await run("thread_send", { thread: "my-far", message: "hi" })).toMatchObject({
      kind: "ok",
      thread_id: "dur-far",
    })
    expect(await run("thread_read", { thread: "dur-far" })).toMatchObject({
      kind: "error",
      error: { code: "scope_denied" },
    })
  })

  test("#given an alias whose holder b no longer lists #when a tool names it #then it is not_found naming the device while b is online, and device_offline only when b is offline", async () => {
    const gone = new Map([["stale-b", { session_id: "dur-gone", device: "b" }]])
    const online = account({ rows: [titled("b", "dur-on-b", "other")], aliases: gone })
    expect(await surface(online.remote).run("thread_send", { thread: "stale-b", message: "x" })).toMatchObject({
      kind: "error",
      error: { code: "not_found", details: { device: "b", thread_id: "dur-gone" } },
    })
    const offline = account({ rows: [titled("b", "dur-on-b", "other")], aliases: gone, online: false })
    expect(await surface(offline.remote).run("thread_send", { thread: "stale-b", message: "x" })).toMatchObject({
      kind: "error",
      error: { code: "device_offline", details: { device: "b" } },
    })
    expect([...online.sent, ...offline.sent]).toEqual([])
  })

  test("#given remote sessions are off on this device #when thread_list runs in the workspace scope #then the alias registry is never asked", async () => {
    const a = account({ plan: "disabled" })
    const { run } = surface(a.remote)
    expect(await run("thread_list", {})).toMatchObject({ kind: "ok" })
    expect(a.registryCalls).toEqual([])
  })

  test("#given a name held here and on many other devices #when a tool names it #then the candidate list is bounded and still names this device and others", async () => {
    const a = account({
      rows: Array.from({ length: 12 }, (_, index) => titled(`d${index}`, `dur-on-d${index}`, "local peer")),
    })
    const { run } = surface(a.remote)
    const result = await run("thread_send", { thread: "local peer", message: "x" })
    const candidates =
      result.kind === "error"
        ? (result.error.details?.["candidates"] as readonly { id: string; device?: string }[])
        : []
    expect(result).toMatchObject({ kind: "error", error: { code: "ambiguous_target" } })
    expect(candidates.length).toBe(10)
    expect(candidates.some((candidate) => candidate.device === "here")).toBe(true)
    expect(candidates.some((candidate) => candidate.device !== "here")).toBe(true)
  })

  test("#given a thread on this device and one on b share the name #when a tool names it #then it is ambiguous_target naming both devices, never a silent pick of either", async () => {
    const a = account({ rows: [titled("b", "dur-on-b", "local peer")] })
    const { run } = surface(a.remote)
    const result = await run("thread_send", { thread: "local peer", message: "x" })
    expect(result).toMatchObject({ kind: "error", error: { code: "ambiguous_target" } })
    const candidates =
      result.kind === "error"
        ? (result.error.details?.["candidates"] as readonly { id: string; device?: string }[])
        : []
    expect(candidates.map((candidate) => [candidate.id, candidate.device]).sort()).toEqual([
      ["dur-local", "here"],
      ["dur-on-b", "b"],
    ])
    expect(a.sent).toEqual([])
  })
})

describe("the device service is not connected, or the alias registry is not there yet", () => {
  test("#given remote sessions turned off on this device #when a tool addresses a thread #then local names work and misses stay not_found while an explicit device operation reports unavailability", async () => {
    const a = account({ plan: "disabled" })
    const { run } = surface(a.remote)
    expect(await run("thread_send", { thread: "local peer", message: "local" })).toMatchObject({
      kind: "ok",
      thread_id: "dur-local",
    })
    expect(await run("thread_send", { thread: "dur-on-b", message: "remote" })).toMatchObject({
      kind: "error",
      error: { code: "not_found" },
    })
    expect(await run("thread_create", { device: "b" })).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable", details: { state: "disabled" } },
    })
    expect(a.sent).toEqual([])
  })

  test("#given no alias registry #when thread_create sets an alias #then the thread is created here with the alias as its local name (#13104); opening an existing thread with an alias stays host_unavailable", async () => {
    const a = account({ noRegistry: true })
    const { run, openSession } = surface(a.remote)
    expect(await run("thread_create", { alias: "x" })).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-created-here" },
      alias_scope: "local",
      alias_unavailable: "no_registry",
    })
    expect(openSession.mock.calls[0]?.[0]).toMatchObject({ name: "x" })
    expect(await run("thread_create", { thread: "local peer", alias: "y" })).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable" },
    })
  })
})

describe("A5: the relay is paid only", () => {
  test("#given a Free account #when a tool needs another device #then it is relay_requires_paid_plan, nothing is sent or queued, and this device's threads work as before", async () => {
    const a = account({ plan: "plan_required" })
    const { run, openSession, store } = surface(a.remote)
    expect(await run("thread_create", { device: "b" })).toMatchObject({
      kind: "error",
      error: { code: "relay_requires_paid_plan" },
    })
    expect(await run("thread_send", { thread: "dur-on-b", message: "x" })).toMatchObject({
      kind: "error",
      error: { code: "relay_requires_paid_plan" },
    })
    expect(await run("thread_list", { all_scope: true })).toMatchObject({
      kind: "ok",
      remote_unavailable: "relay_requires_paid_plan",
    })
    expect(a.sent).toEqual([])
    expect(await store.list()).toEqual([])
    expect(await run("thread_create", {})).toMatchObject({ kind: "ok", thread: { thread_id: "dur-created-here" } })
    expect(openSession).toHaveBeenCalledTimes(1)
  })
})

describe("remote == local: the same call answers the same on b as on this device", () => {
  test.each([
    ["thread_read, a byte budget smaller than the transcript", "thread_read", { max_bytes: 800 }],
    ["thread_read, the whole transcript", "thread_read", {}],
    ["thread_interrupt on an idle thread with a made-up turn id", "thread_interrupt", { turn_id: "bogus" }],
    ["thread_rename to a blank name", "thread_rename", { name: "   " }],
    ["thread_rename to another visible thread's name", "thread_rename", { name: "Other Peer" }],
    ["thread_set_reasoning to a level the model runs", "thread_set_reasoning", { level: "high" }],
    [
      "thread_set_reasoning to a level the model cannot run (the supported list comes from the target's engine)",
      "thread_set_reasoning",
      { level: "xhigh" },
    ],
    ["thread_interrupt on an idle thread", "thread_interrupt", {}],
  ] as const)(
    "#given %s #when it runs on this device and on b #then both answers are the same",
    async (_label, tool, args) => {
      const a = account({
        rows: [B_ROW, { ...B_ROW, session_id: "rk-other", durable_id: "dur-other-on-b", title: "other peer" }],
      })
      const other: ThreadHostSession = {
        sessionId: "route-other",
        durableSessionId: "dur-other",
        cwd: process.cwd(),
        name: "other peer",
        status: "open",
      }
      const local: ThreadHostSession = {
        sessionId: "route-local",
        durableSessionId: "dur-local",
        cwd: process.cwd(),
        name: "local peer",
        status: "open",
      }
      const { run } = surface(a.remote, { sessions: [local, other] })
      const here = await run(tool, { thread: "dur-local", ...args })
      const there = await run(tool, { thread: "dur-on-b", ...args })
      expect(comparable(there)).toEqual(comparable(here))
    },
  )

  // The one close ladder on both legs: the same code for the same engine answer, with the thread named (and its device on b).
  test.each([
    ["a live thread", {}, {}, { kind: "ok", closed: true }],
    [
      "a thread that is no longer live (its session file here; an ended session on b)",
      { rowState: "ended", live: [] },
      { local: false },
      { kind: "ok", closed: false },
    ],
    [
      "a thread with no session file yet that another client still holds",
      { unwritten: true, otherHolders: 1 },
      { closeOutcome: "held_elsewhere" as const },
      { kind: "error", code: "foreign_live_owner" },
    ],
    [
      "a thread held by an interactive terminal",
      { terminal: true },
      { terminal: true },
      { kind: "error", code: "unsupported" },
    ],
  ] as const)(
    "#given %s #when thread_close runs on this device and on b #then both answer the same code",
    async (_label, accountOptions, surfaceOptions, expected) => {
      const a = account({ ...accountOptions })
      const here: ThreadHostSession = {
        sessionId: "route-local",
        durableSessionId: "dur-local",
        cwd: process.cwd(),
        name: "local peer",
        status: "open",
        ...("terminal" in surfaceOptions ? { endpoint_kind: "tui" as const } : {}),
      }
      const { run } = surface(a.remote, {
        ...("local" in surfaceOptions ? { sessions: [], diskSessions: ["dur-local"] } : { sessions: [here] }),
        ...("closeOutcome" in surfaceOptions ? { closeOutcome: surfaceOptions.closeOutcome } : {}),
      })
      const shape = (result: ThreadToolResult) =>
        result.kind === "error"
          ? { kind: "error", code: result.error.code }
          : { kind: "ok", closed: (result as { closed?: boolean }).closed }
      const local = await run("thread_close", { thread: "dur-local" })
      const remote = await run("thread_close", { thread: "dur-on-b" })
      expect([shape(local), shape(remote)]).toEqual([expected, expected])
      expect(
        (remote as { device?: string; error?: { details?: { device?: string } } }).device ??
          (remote as { error?: { details?: { device?: string } } }).error?.details?.device,
      ).toBe("b")
    },
  )

  test("#given a truncated read on both #when each follows its next_cursor #then the second pages match too", async () => {
    const a = account()
    const { run } = surface(a.remote)
    const first = {
      here: await run("thread_read", { thread: "dur-local", max_bytes: 800 }),
      there: await run("thread_read", { thread: "dur-on-b", max_bytes: 800 }),
    }
    expect(first.here).toMatchObject({ kind: "ok", truncated: true })
    const cursor = (result: ThreadToolResult) => (result as { next_cursor?: string }).next_cursor
    const next = {
      here: await run("thread_read", { thread: "dur-local", cursor: cursor(first.here), max_bytes: 800 }),
      there: await run("thread_read", { thread: "dur-on-b", cursor: cursor(first.there), max_bytes: 800 }),
    }
    expect(comparable(next.there)).toEqual(comparable(next.here))
  })

  test("#given a refused rename that also names a new alias #when it runs on either leg #then the alias did not move", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_rename", { thread: "dur-local", name: "  ", alias: "kept-free-1" })).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments" },
    })
    expect(await run("thread_rename", { thread: "dur-on-b", name: "  ", alias: "kept-free-2" })).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments" },
    })
    expect([...a.aliases.keys()]).toEqual([])
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "set_session_name")).toEqual([])
  })

  test("#given a name a thread on the target device holds #when thread_create makes it here and on b #then both are name_conflict with one shape and nothing is opened", async () => {
    const a = account()
    const { run, openSession } = surface(a.remote)
    const here = await run("thread_create", { name: "local peer" })
    const there = await run("thread_create", { device: "studio", name: "on b" })
    expect(Object.keys(comparable(there) as object)).toEqual(Object.keys(comparable(here) as object))
    expect(here).toMatchObject({ kind: "error", error: { code: "name_conflict" } })
    expect(there).toMatchObject({ kind: "error", error: { code: "name_conflict" } })
    expect(openSession).not.toHaveBeenCalled()
    expect(a.sent).toEqual([])
  })

  test("#given skills on a create on b #when it opens #then the same initial-skills context a local create sends reaches b", async () => {
    const a = account()
    const { run } = surface(a.remote)
    await run("thread_create", { device: "studio", skills: ["programming"] })
    expect(a.sent.find((entry) => entry.rpc?.["type"] === "open_session")?.rpc?.["context"]).toEqual({
      initial_skills: JSON.stringify(["programming"]),
    })
  })

  test("#given a fork source on this device #when thread_create forks it naming device b, and forks it by its alias #then the first is invalid_arguments with nothing opened, the second forks the resolved id here", async () => {
    const a = account({ aliases: new Map([["mine", { session_id: "dur-local", device: "here" }]]) })
    const { run, openSession } = surface(a.remote)
    expect(await run("thread_create", { fork_from: "dur-local", device: "studio" })).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments" },
    })
    expect(a.sent).toEqual([])
    expect(openSession).not.toHaveBeenCalled()
    await run("thread_create", { fork_from: "mine" })
    expect(openSession).toHaveBeenCalledTimes(1)
    expect((openSession.mock.calls[0] as unknown as [{ forkFrom?: string }])[0].forkFrom).toBe("dur-local")
  })

  test("#given thread_create opens b's thread and names an alias #when it runs #then the alias is held by that thread", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_create", { thread: "dur-on-b", alias: "bee" })).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-on-b", alias: "bee" },
    })
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
    ["the account session list fails", { failSessionsList: true }],
    ["the alias registry fails", { failAliasesOf: true }],
  ] as const)(
    "#given %s #when thread_list runs with all_scope #then this device's threads are still listed",
    async (_label, options) => {
      const a = account(options)
      const { run } = surface(a.remote)
      const listed = await run("thread_list", { all_scope: true })
      expect(listed).toMatchObject({ kind: "ok" })
      if (listed.kind !== "ok" || !("threads" in listed))
        throw new Error(`thread_list failed: ${JSON.stringify(listed)}`)
      expect(listed.threads.map((thread) => thread.thread_id)).toContain("dur-local")
    },
  )

  test("#given no remote surface and a thread with no live owner #when thread_rename gives it a blank name #then it is not_resumable, as before the remote tools", async () => {
    const { run } = surface(undefined, { diskSessions: ["dur-disk"] })
    expect(await run("thread_rename", { thread: "dur-disk", name: "   " })).toMatchObject({
      kind: "error",
      error: { code: "not_resumable" },
    })
  })

  test("#given device b is offline #when thread_rename renames b's thread and moves its alias #then it is device_offline, the alias did not move, and nothing is sent", async () => {
    const a = account({ online: false, aliases: new Map([["bee", { session_id: "dur-on-b", device: "b" }]]) })
    const { run } = surface(a.remote)
    expect(await run("thread_rename", { thread: "dur-on-b", name: "renamed", alias: "wasp" })).toMatchObject({
      kind: "error",
      error: { code: "device_offline", details: { device: "b" } },
    })
    expect([...a.aliases.keys()]).toEqual(["bee"])
    expect(a.sent).toEqual([])
  })

  test("#given the alias registry fails while thread_create claims an alias #when the thread was already created on b #then the error names the created thread, so it is not lost", async () => {
    const a = account({ failClaim: true })
    const { run } = surface(a.remote)
    expect(await run("thread_create", { device: "studio", alias: "bee" })).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable", details: { thread_id: "dur-new-on-b" } },
    })
  })

  test("#given two local threads share a name and an alias spelled the same is held by b's thread #when a tool names it #then the alias wins over the ambiguous local name", async () => {
    const a = account({ aliases: new Map([["twin", { session_id: "dur-on-b", device: "b" }]]) })
    const twins: ThreadHostSession[] = [
      { sessionId: "r1", durableSessionId: "dur-t1", cwd: process.cwd(), name: "twin", status: "open" },
      { sessionId: "r2", durableSessionId: "dur-t2", cwd: process.cwd(), name: "twin", status: "open" },
    ]
    const { run } = surface(a.remote, { sessions: twins })
    expect(await run("thread_read", { thread: "twin" })).toMatchObject({
      kind: "ok",
      thread_id: "dur-on-b",
      device: "b",
    })
  })
})

describe("K8 / R8.c: a chain carries its count across devices; no count or cost limit by default", () => {
  /**
   * For each hop, the caller runs on a delivery it received at that hop (0: a user-started turn, no cause), as the
   * gateway drain leaves it: an applied row addressed to the caller. Each time, it sends to b. Returns each answer.
   */
  async function sendFromHops(remote: Parameters<typeof surface>[0], hops: readonly number[]) {
    let cause: string | undefined
    const { run, store, agentDir } = surface(remote, { callerCause: () => cause })
    await store.deliveryView("none") // the store worker creates the schema on its first call
    const db = new Database(gatewayDatabasePath(agentDir))
    const answers: ThreadToolResult[] = []
    try {
      for (const [index, hop] of hops.entries()) {
        cause = hop === 0 ? undefined : `received-at-hop-${hop}`
        if (cause !== undefined) {
          db.run(
            "INSERT INTO deliveries (delivery_id, target_durable_id, seq, sender, envelope, body, bytes, mode_requested, state, root_id, hop, created_at, updated_at, expires_at) VALUES (?, 'dur-caller', ?, 'session:dur-peer', '{\"provenance\":{\"workspace\":\"Example\",\"project\":\"project\"}}', 'body', 4, 'auto', 'applied', 'root-chain', ?, 1, 1, 9999999999999)",
            [cause, index + 1, hop],
          )
        }
        answers.push(
          await run("thread_send", {
            thread: "dur-on-b",
            message: `to b from hop ${hop}`,
            idempotency_key: `to-b-${index}`,
          }),
        )
      }
    } finally {
      db.close()
    }
    return answers
  }

  const prompts = (sent: readonly { readonly rpc?: Readonly<Record<string, unknown>> }[]) =>
    sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message").map((entry) => entry.rpc ?? {})

  test("#given a caller at every hop of a chain past 12 #when it sends to b #then b's record carries the caller's hop + 1, nothing is refused and no cost field is sent", async () => {
    const a = account()
    const callerHops = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    const answers = await sendFromHops(a.remote, callerHops)
    expect(answers.map((answer) => answer.kind)).toEqual(callerHops.map(() => "ok"))
    const sent = prompts(a.sent)
    expect(sent.map((record) => record["chainCount"])).toEqual(callerHops.map((hop) => hop + 1))
    expect(sent.flatMap((record) => Object.keys(record).filter((key) => /cost/i.test(key)))).toEqual([])
  })

  test("#given b's user set a chain count limit of 3 #when the chain reaches b at hops 1 to 4 #then hops 1-3 start there and hop 4 is refused as data naming chain_count_limit and device b", async () => {
    const a = account({ chainCountLimit: 3 })
    const answers = await sendFromHops(a.remote, [0, 1, 2, 3])
    expect(answers.slice(0, 3).map((answer) => answer.kind)).toEqual(["ok", "ok", "ok"])
    expect(answers[3]).toMatchObject({
      kind: "error",
      error: { details: { device: "b", reason: "chain_count_limit" } },
    })
    expect(prompts(a.sent).map((record) => record["chainCount"])).toEqual([1, 2, 3, 4])
  })
})
