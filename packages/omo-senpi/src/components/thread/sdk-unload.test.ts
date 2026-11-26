import { afterEach, describe, expect, test } from "bun:test"

import { assembleOmoSdk } from "../omo-sdk/assembly"
import type { JsonObject } from "./remote/ports"
import { refusal, type RefusalId } from "./refusal-texts"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

// Slice T1b: threads.unload on the root, one `unload_session` with the caller's options on either leg (this device's
// endpoint, another device through its device service). The answer names what the unload dropped; each engine refusal
// is typed by the blocker it names, worded by its control.unload_* template (goldens in control-refusal-texts.test.ts).

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

type Account = Parameters<typeof account>[0]
type Surface = NonNullable<Parameters<typeof surface>[1]>

function world(onB: Account = {}, here: Surface = {}) {
  const a = account(onB)
  const s = surface(a.remote, here)
  const root = assembleOmoSdk(
    {
      agentDir: s.agentDir,
      cwd: process.cwd(),
      uid: 501,
      user: "qa",
      ports: { host: s.host, store: s.store, remote: a.remote },
    },
    {},
  )
  return { a, s, root }
}

const onB = (a: ReturnType<typeof world>["a"], type: string) =>
  a.sent.filter((entry) => entry.via === "session" && entry.rpc?.["type"] === type).map((entry) => entry.rpc)

const rendered = (id: RefusalId, slots: Readonly<Record<string, string>>) => {
  const { code, message, next_action } = refusal(id, slots)
  return { code, message, next_action }
}

describe("threads.unload on the root (slice T1b)", () => {
  test("#given a thread on this device #when the root unloads it #then one unload_session carries the options and the answer names what it dropped", async () => {
    const { s, root } = world(
      {},
      { unload: { reply: { outcome: "unloaded", dropped: { deliveries: ["d-1"], user_messages: ["queued"] } } } },
    )
    const answer = await root.threads.unload({ thread: "dur-local", clear_queue: true, children: "detach" })
    expect(answer).toEqual({
      kind: "ok",
      thread: "dur-local",
      unloaded: true,
      dropped_deliveries: ["d-1"],
      dropped_user_messages: ["queued"],
    })
    expect(s.unloads).toEqual([
      expect.objectContaining({
        type: "unload_session",
        sessionId: "route-local",
        clearQueue: true,
        children: "detach",
      }),
    ])
    expect(s.unloads[0]?.["interrupt"]).toBeUndefined()
  })

  test("#given a busy thread on another device #when the root unloads it with interrupt #then the abort goes first and the answer names the handed-back deliveries and messages", async () => {
    const { a, root } = world({ busy: true, unread: ["d-9"], unloadUserMessages: ["queued"] })
    const answer = await root.threads.unload({ thread: "dur-on-b", interrupt: true })
    expect(answer).toEqual({
      kind: "ok",
      thread: "dur-on-b",
      device: "b",
      unloaded: true,
      dropped_deliveries: ["d-9"],
      dropped_user_messages: ["queued"],
    })
    const order = a.sent.flatMap((entry) => (entry.via === "session" ? [String(entry.rpc?.["type"])] : []))
    expect(order.indexOf("interrupt")).toBeGreaterThanOrEqual(0)
    expect(order.indexOf("interrupt")).toBeLessThan(order.indexOf("unload_session"))
    expect(onB(a, "unload_session")).toEqual([expect.objectContaining({ interrupt: true })])
  })

  test("#given a thread that ended on another device #when the root unloads it #then it answers unloaded false and nothing reaches that engine", async () => {
    const { a, root } = world({ rowState: "ended" })
    expect(await root.threads.unload({ thread: "dur-on-b" })).toEqual({
      kind: "ok",
      thread: "dur-on-b",
      device: "b",
      unloaded: false,
      dropped_deliveries: [],
      dropped_user_messages: [],
    })
    expect(a.sent.filter((entry) => entry.via === "session")).toEqual([])
  })

  test("#given a keyed unload #when it is repeated under the key #then the first answer and one unload_session", async () => {
    const { s, root } = world()
    const first = await root.threads.unload({ thread: "dur-local", idempotency_key: "k-unload" })
    const again = await root.threads.unload({ thread: "dur-local", idempotency_key: "k-unload" })
    expect(first).toMatchObject({ kind: "ok", unloaded: true })
    expect(again).toEqual(first)
    expect(s.unloads.length).toBe(1)
  })

  const ENGINE_REFUSALS: readonly (readonly [string, JsonObject, RefusalId, string, JsonObject])[] = [
    [
      "turn_active",
      { outcome: "refused", reason: "turn_active", detail: "an agent run", pending: { deliveries: ["d-2"] } },
      "control.unload_working",
      "turn_active: an agent run",
      { pending_deliveries: ["d-2"], retry_with: { interrupt: true } },
    ],
    [
      "children_live",
      { outcome: "refused", reason: "children_live", detail: "child tasks still working" },
      "control.unload_children",
      "children_live: child tasks still working",
      { retry_with: { children: "detach" } },
    ],
    [
      "extension_work",
      { outcome: "refused", reason: "extension_work", detail: "work published by monitor" },
      "control.unload_extension_work",
      "extension_work: work published by monitor",
      { retry_with: { force: true } },
    ],
    [
      "attached",
      { outcome: "refused", reason: "attached", detail: "1 other client(s) attached" },
      "control.unload_attached",
      "attached: 1 other client(s) attached",
      { retry_with: { force: true } },
    ],
    [
      "unsupported",
      { outcome: "refused", reason: "unsupported", detail: "the session has no file to reopen it by" },
      "control.unload_refused",
      "unsupported: the session has no file to reopen it by",
      { reason: "unsupported" },
    ],
  ]

  test.each(ENGINE_REFUSALS)(
    "#given this device's engine refuses the unload %s #then the typed refusal its template words",
    async (_reason, reply, id, state, details) => {
      const { root } = world({}, { unload: { reply } })
      const answer = await root.threads.unload({ thread: "dur-local", children: "refuse" })
      expect(answer).toMatchObject({
        kind: "error",
        error: { ...rendered(id, { thread: "dur-local", state }), details },
      })
    },
  )

  test("#given a host shutting down #when it refuses the unload #then host_unavailable from its template", async () => {
    const { root } = world({}, { unload: { reply: { outcome: "refused", reason: "host_draining" } } })
    expect(await root.threads.unload({ thread: "dur-local" })).toMatchObject({
      kind: "error",
      error: rendered("control.unload_host_draining", { thread: "dur-local" }),
    })
  })

  test("#given an engine that does not advertise unload_session #when the root unloads #then unsupported and nothing is sent", async () => {
    const { s, root } = world({}, { unload: { capabilities: [] } })
    expect(await root.threads.unload({ thread: "dur-local" })).toMatchObject({
      kind: "error",
      error: rendered("control.unload_unsupported", { thread: "dur-local" }),
    })
    expect(s.unloads).toEqual([])
  })

  test("#given this device's engine no longer holds the session #when the root unloads #then not_found", async () => {
    const { root } = world({}, { unload: { gone: "unknown_session" } })
    expect(await root.threads.unload({ thread: "dur-local" })).toMatchObject({
      kind: "error",
      error: rendered("control.unload_not_held", { thread: "dur-local", reason: "unknown_session" }),
    })
  })

  test("#given another device whose holder answers unknown_session #when the root unloads #then not_found naming the device, and no unload is sent", async () => {
    const { a, root } = world({ live: [] })
    expect(await root.threads.unload({ thread: "dur-on-b" })).toMatchObject({
      kind: "error",
      error: {
        ...rendered("control.unload_not_held", { thread: "dur-on-b", reason: "unknown_session" }),
        details: { device: "b", reason: "unknown_session" },
      },
    })
    expect(onB(a, "unload_session")).toEqual([])
  })

  test("#given a busy thread on another device #when the root unloads it without interrupt #then its engine's turn_active, naming the device", async () => {
    const { root } = world({ busy: true })
    expect(await root.threads.unload({ thread: "dur-on-b" })).toMatchObject({
      kind: "error",
      error: {
        ...rendered("control.unload_working", { thread: "dur-on-b", state: "turn_active: an agent run" }),
        details: { device: "b", retry_with: { interrupt: true } },
      },
    })
  })

  test("#given a thread on another device listed running #when the root unloads it without interrupt or force #then turn_active before anything is sent", async () => {
    const { a, root } = world({ rowState: "running" })
    expect(await root.threads.unload({ thread: "dur-on-b" })).toMatchObject({
      kind: "error",
      error: {
        ...rendered("control.unload_working", { thread: "dur-on-b", state: "a turn is running" }),
        details: { device: "b", retry_with: { interrupt: true } },
      },
    })
    expect(onB(a, "unload_session")).toEqual([])
    expect(onB(a, "get_protocol_info")).toEqual([])
  })
})
