import { afterEach, describe, expect, test } from "bun:test"
import type { ThreadToolResult } from "./contracts"
import { createRemoteThreadFixture, ENGINE } from "./thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const rows = (listed: ThreadToolResult) =>
  listed.kind === "ok" && "threads" in listed
    ? listed.threads.map((thread) => [thread.thread, thread.device ?? null, thread.alias ?? null])
    : []

// #13923: an account alias names a session on any device of the account, as a lane name a caller sets, lists and addresses.
describe("an account alias for a session on another device (#13923)", () => {
  test("#given a session on b that holds no alias #when thread_rename sets one #then the registry holds it for b's session by its durable id, and b's session name is not touched", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_rename", { thread: "dur-on-b", alias: "Lane X" })).toMatchObject({
      kind: "ok",
      thread: "dur-on-b",
      device: "b",
      alias: "Lane X",
    })
    expect([...a.aliases]).toEqual([["Lane X", { session_id: "dur-on-b", device: "b" }]])
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "set_session_name")).toEqual([])
  })

  test("#given aliases held by a session here and one on b #when thread_list runs in either scope #then each row carries its alias and the remote row its device", async () => {
    const a = account({
      aliases: new Map([
        ["lane-b", { session_id: "dur-on-b", device: "b" }],
        ["lane-here", { session_id: "dur-local", device: "here" }],
      ]),
    })
    const { run } = surface(a.remote)
    for (const args of [{}, { all_scope: true }]) {
      const listed = await run("thread_list", args)
      expect(rows(listed)).toEqual([
        ["dur-local", null, "lane-here"],
        ["dur-on-b", "b", "lane-b"],
      ])
      expect(listed).not.toHaveProperty("aliases_unavailable")
    }
  })

  test.each([
    ["the registry throws", { failAliasesOf: true }, "host_unavailable"],
    ["the registry refuses", { registryDown: "refused" }, "host_unavailable"],
    ["the registry asks for a sign-in", { registryDown: "signed_out" }, "sign_in"],
    ["the account listing fails too", { failSessionsList: true, registryDown: "refused" }, "host_unavailable"],
  ] as const)(
    "#given %s #when thread_list runs #then the threads are listed without aliases and aliases_unavailable says why, so no caller reads an alias as free",
    async (_case, options, reason) => {
      const a = account({ aliases: new Map([["lane-b", { session_id: "dur-on-b", device: "b" }]]), ...options })
      const { run } = surface(a.remote)
      const listed = await run("thread_list", { all_scope: true })
      expect(listed).toMatchObject({ kind: "ok", aliases_unavailable: reason })
      expect(rows(listed).every(([, , alias]) => alias === null)).toBe(true)
      expect(rows(listed).map(([id]) => id)).toContain("dur-local")
    },
  )

  test.each([
    ["disabled, workspace scope", "disabled", false],
    ["not_configured, workspace scope", "not_configured", false],
    ["signed_out, workspace scope", "signed_out", false],
    ["disabled, all_scope", "disabled", true],
    ["offline, workspace scope", "offline", false],
    ["offline, all_scope", "offline", true],
    ["plan_required (a Free plan: the service answered), workspace scope", "plan_required", false],
  ] as const)(
    "#given the device service is %s #when thread_list runs #then the registry is not asked and aliases_unavailable says not_asked, so no caller reads an alias as free",
    async (_case, plan, allScope) => {
      const a = account({ plan, aliases: new Map([["lane-here", { session_id: "dur-local", device: "here" }]]) })
      const { run } = surface(a.remote)
      const listed = await run("thread_list", allScope ? { all_scope: true } : {})
      expect(listed).toMatchObject({ kind: "ok", aliases_unavailable: "not_asked" })
      expect(rows(listed)).toContainEqual(["dur-local", null, null])
      expect(a.registryCalls).toEqual([])
    },
  )

  test("#given an alias held by b's session #when thread_interrupt and thread_close name the alias #then each command goes to b's session", async () => {
    const a = account({ aliases: new Map([["lane-b", { session_id: "dur-on-b", device: "b" }]]) })
    const { run } = surface(a.remote)
    expect(await run("thread_interrupt", { thread: "lane-b" })).toMatchObject({ kind: "ok", thread: "dur-on-b" })
    expect(await run("thread_close", { thread: "lane-b" })).toMatchObject({
      kind: "ok",
      thread: "dur-on-b",
      device: "b",
      closed: true,
    })
    expect(a.sent.map((entry) => [entry.via, entry.device, entry.session, entry.rpc?.["type"]])).toEqual([
      ["session", "b", "rk-on-b", "interrupt"],
      ["session", "b", "rk-on-b", "unload_session"],
    ])
  })

  test("#given an alias held by b's session #when thread_read waits by the alias and b's run ends #then the wait settles at that turn end on b's watch and the transcript is read from b", async () => {
    const a = account({
      aliases: new Map([["lane-b", { session_id: "dur-on-b", device: "b" }]]),
      engine: { ...ENGINE, streaming: false },
    })
    const { run } = surface(a.remote)
    const reading = run("thread_read", { thread: "lane-b", wait_ms: 60_000 })
    await a.watching
    for (const handlers of [...a.watchers]) {
      handlers.record({ type: "agent_start", turnId: "5" })
      handlers.status?.({ from: "idle", to: "running", derived: true, cause: "agent_start" })
      handlers.record({ type: "agent_settled", turnId: "5" })
      handlers.status?.({ from: "running", to: "idle", derived: true, cause: "agent_settled" })
    }
    expect(await reading).toMatchObject({
      kind: "ok",
      thread: "dur-on-b",
      device: "b",
      wait: { outcome: "settled", status: "idle", turn_id: "5" },
    })
    expect(a.sent.filter((entry) => entry.via === "watch").map((entry) => [entry.device, entry.session])).toEqual([
      ["b", "rk-on-b"],
    ])
  })
})
