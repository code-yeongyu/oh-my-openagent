import { afterEach, describe, expect, test } from "bun:test"
import type { ThreadToolResult } from "../contracts"
import { B_ROW, createRemoteThreadFixture, ENGINE } from "../thread-remote-fixture"
import type { AliasHolder, RemoteCommandOutcome, RemoteSessionRow } from "./ports"

// omo#13037, the sender half (amendment A4 and section 5): a send, a reply or a hand-off reaches a session on another
// device that is not running. The resolve finds it as an `ended` row (A4.3), the relay transport sends it the same
// admit_external_message record with no lane probe (5.4, A4.5), and the receiving side's answers are mapped once (5.1).

const GONE = "0195f0c2-1a2b-7c3d-8e4f-00000000a001"
const OTHER = "0195f0c2-1a2b-7c3d-8e4f-00000000a002"
const C_ROW: RemoteSessionRow = { ...B_ROW, device: "c", session_id: "rk-c-live", durable_id: OTHER, title: "on c" }

type Fixture = ReturnType<typeof createRemoteThreadFixture>
type Account = ReturnType<Fixture["account"]>

const queuedEnvelope = (data: Record<string, unknown>): RemoteCommandOutcome => ({
  kind: "ok",
  response: { type: "response", success: true, data },
})

describe("#13037 the sender half reaches a session on another device that is not running", () => {
  const fixture = createRemoteThreadFixture()
  afterEach(fixture.cleanup)
  // Both device-service gates open on this device (they ship null): the sender half is on.
  const account = (options: Parameters<Fixture["account"]>[0] = {}) =>
    fixture.account({ wakeFeature: true, ...options })

  const wakes = (account: Account) => account.sent.filter((entry) => entry.via === "wake")
  const nothingSent = (account: Account) => expect(account.sent).toEqual([])

  describe("A4.3.1 a reply to a sender that is not running", () => {
    test("#given b attested the delivery and b lists no row for the sender #when the run replies by id #then one probe of b finds it ended and the record goes down the wake path to b, with no lane probe", async () => {
      const a = account({ rows: [B_ROW], ended: { b: { [GONE]: "rk-gone" } } })
      const { run } = fixture.surface(a.remote, {
        callerReplyTargets: () => [GONE],
        callerReplySenders: () => [{ session_id: GONE, device: "b" }],
      })
      expect(await run("thread_send", { thread: GONE, message: "reply" })).toMatchObject({
        kind: "ok",
        thread_id: GONE,
        device: "b",
        delivery: { kind: "queued", waiting_on: { kind: "wake", device: "b" } },
      })
      expect(a.lookups).toEqual([{ device: "b", durable_id: GONE }])
      expect(a.sent.map((entry) => [entry.via, entry.device, entry.session, entry.rpc?.["type"]])).toEqual([
        ["wake", "b", GONE, "admit_external_message"],
      ])
      expect(wakes(a)[0]?.rpc).toMatchObject({ sessionId: GONE, deliverAs: "followUp" })
    })

    test("#given the sender stated a name and is not running on b #when the run replies by that name #then it reaches the same ended row on b", async () => {
      const a = account({ rows: [B_ROW], ended: { b: { [GONE]: "rk-gone" } } })
      const { run } = fixture.surface(a.remote, {
        callerReplySenders: () => [{ session_id: GONE, name: "planner", device: "b" }],
      })
      expect(await run("thread_send", { thread: "planner", message: "reply" })).toMatchObject({
        kind: "ok",
        thread_id: GONE,
        device: "b",
      })
      expect(wakes(a).map((entry) => entry.session)).toEqual([GONE])
    })

    test("#given b holds no such session #when the run replies #then it is not_found naming b and nothing is sent", async () => {
      const a = account({ rows: [B_ROW] })
      const { run } = fixture.surface(a.remote, {
        callerReplyTargets: () => [GONE],
        callerReplySenders: () => [{ session_id: GONE, device: "b" }],
      })
      expect(await run("thread_send", { thread: GONE, message: "reply" })).toMatchObject({
        kind: "error",
        error: { code: "not_found", details: { device: "b" } },
      })
      nothingSent(a)
    })

    test("#given a reply to a sender on another device #when it is resolved #then it reads no account-wide listing and no local endpoint, only that device", async () => {
      const a = account({ rows: [B_ROW], ended: { b: { [GONE]: "rk-gone" } } })
      const { run, listings } = fixture.surface(a.remote, {
        callerReplyTargets: () => [GONE],
        callerReplySenders: () => [{ session_id: GONE, device: "b" }],
      })
      await run("thread_send", { thread: GONE, message: "reply" })
      expect({ local: listings(), account: a.listings }).toEqual({ local: 0, account: { all: 0, device: 1 } })
    })
  })

  describe("A4.3.2 an alias whose holder is not running", () => {
    const aliases = () => new Map<string, AliasHolder>([["bee", { session_id: GONE, device: "c" }]])

    test("#given the alias names a session c holds but runs nowhere #when it is sent to #then the holder's probe answers an ended row and the record goes down the wake path to c", async () => {
      const a = account({ rows: [B_ROW], aliases: aliases(), ended: { c: { [GONE]: GONE } } })
      const { run } = fixture.surface(a.remote)
      expect(await run("thread_send", { thread: "bee", message: "hi" })).toMatchObject({
        kind: "ok",
        thread_id: GONE,
        device: "c",
      })
      expect(wakes(a).map((entry) => [entry.device, entry.session])).toEqual([["c", GONE]])
    })

    test("#given such an alias #when thread_read, thread_interrupt and thread_create name it #then no engine command and no open is sent", async () => {
      const a = account({ rows: [B_ROW], aliases: aliases(), ended: { c: { [GONE]: GONE } } })
      const { run } = fixture.surface(a.remote)
      for (const [tool, args] of [
        ["thread_read", { thread: "bee" }],
        ["thread_interrupt", { thread: "bee" }],
        ["thread_create", { thread: "bee" }],
      ] as const) {
        const result = await run(tool, args)
        expect({ tool, kind: result.kind }).toEqual({ tool, kind: "error" })
      }
      expect(a.sent.filter((entry) => entry.via !== "read")).toEqual([])
    })
  })

  // A7.2.6: "online device" in these rows reads "online device that lists the feature"; the sender's own service answers
  // the empty page for any other device, which lookup-answers.test.ts pins as "answered, none".
  describe("A4.3.3 a bare session id that no listing holds", () => {
    test("#given exactly one other device holds it #when it is sent to #then one single-probe query per online device that lists the feature finds it and the record goes to that device", async () => {
      const a = account({ rows: [B_ROW, C_ROW], ended: { c: { [GONE]: "rk-c-gone" } } })
      const { run } = fixture.surface(a.remote)
      expect(await run("thread_send", { thread: GONE, message: "hi" })).toMatchObject({
        kind: "ok",
        thread_id: GONE,
        device: "c",
      })
      expect(a.lookups.map((entry) => entry.device).sort()).toEqual(["b", "c"])
      expect(wakes(a).map((entry) => entry.device)).toEqual(["c"])
    })

    test("#given no device holds it and every device answered #then it is not_found and nothing is sent", async () => {
      const a = account({ rows: [B_ROW, C_ROW] })
      const { run } = fixture.surface(a.remote)
      expect(await run("thread_send", { thread: GONE, message: "hi" })).toMatchObject({
        kind: "error",
        error: { code: "not_found" },
      })
      nothingSent(a)
    })

    test("#given two devices hold it #then it is ambiguous_target naming both devices and nothing is sent", async () => {
      const a = account({ rows: [B_ROW, C_ROW], ended: { b: { [GONE]: "rk-b" }, c: { [GONE]: "rk-c" } } })
      const { run } = fixture.surface(a.remote)
      const result = await run("thread_send", { thread: GONE, message: "hi" })
      expect(result).toMatchObject({ kind: "error", error: { code: "ambiguous_target" } })
      const candidates =
        (result as { error: { details?: { candidates?: readonly { device?: string }[] } } }).error.details
          ?.candidates ?? []
      expect(candidates.map((candidate) => candidate.device).sort()).toEqual(["b", "c"])
      nothingSent(a)
    })

    test("#given no device holds it and one online device that lists the feature did not answer #then it is host_unavailable naming that device", async () => {
      const a = account({ rows: [B_ROW, C_ROW], silent: ["c"] })
      const { run } = fixture.surface(a.remote)
      expect(await run("thread_send", { thread: GONE, message: "hi" })).toMatchObject({
        kind: "error",
        error: { code: "host_unavailable", details: { devices: ["c"] } },
      })
      nothingSent(a)
    })

    // Found over silent, by choice: a device that does not answer within the bound (or hangs past the client's cap) must
    // not block a send another device can take. The silent device is asked once and not again; this is not ambiguous.
    test("#given one device holds it and another did not answer #then the row is used and the silent device is asked once", async () => {
      const a = account({ rows: [B_ROW, C_ROW], silent: ["b"], ended: { c: { [GONE]: "rk-c-gone" } } })
      const { run } = fixture.surface(a.remote)
      expect(await run("thread_send", { thread: GONE, message: "hi" })).toMatchObject({ kind: "ok", device: "c" })
      expect(a.lookups.map((entry) => entry.device).sort()).toEqual(["b", "c"])
      expect(wakes(a).map((entry) => entry.device)).toEqual(["c"])
    })

    test("#given a device that is offline #then it is not asked", async () => {
      const a = account({ rows: [C_ROW], online: false, ended: { c: { [GONE]: "rk-c-gone" } } })
      const { run } = fixture.surface(a.remote)
      await run("thread_send", { thread: GONE, message: "hi" })
      expect(a.lookups.map((entry) => entry.device)).toEqual(["c"])
    })

    test("#given a session the listing holds #then it is resolved with no lookup", async () => {
      const a = account({ rows: [B_ROW] })
      const { run } = fixture.surface(a.remote)
      await run("thread_send", { thread: "dur-on-b", message: "hi" })
      expect(a.lookups).toEqual([])
    })

    test("#given this device's service makes no single probe #then no lookup is made and the answer is today's not_found", async () => {
      const a = account({ rows: [B_ROW, C_ROW], noLookup: true, ended: { c: { [GONE]: "rk-c-gone" } } })
      const { run } = fixture.surface(a.remote)
      expect(await run("thread_send", { thread: GONE, message: "hi" })).toMatchObject({
        kind: "error",
        error: { code: "not_found" },
      })
      expect({ lookups: a.lookups, sent: a.sent }).toEqual({ lookups: [], sent: [] })
    })

    test("#given the lookup runs #then it sends at most one query per online device that lists the feature", async () => {
      const a = account({ rows: [B_ROW, C_ROW, { ...C_ROW, session_id: "rk-c-2", durable_id: "dur-c-2" }] })
      const { run } = fixture.surface(a.remote)
      await run("thread_send", { thread: GONE, message: "hi" })
      const perDevice = new Map<string, number>()
      for (const entry of a.lookups) perDevice.set(entry.device, (perDevice.get(entry.device) ?? 0) + 1)
      expect([...perDevice.values()].every((count) => count === 1)).toBe(true)
    })

    test("A4.4: #given that id #when thread_read and thread_interrupt name it #then neither runs the lookup", async () => {
      const a = account({ rows: [B_ROW, C_ROW], ended: { c: { [GONE]: "rk-c-gone" } } })
      const { run } = fixture.surface(a.remote)
      await run("thread_read", { thread: GONE })
      await run("thread_interrupt", { thread: GONE })
      expect(a.lookups).toEqual([])
    })
  })

  // #13238 review: one rule for every probe that may build an `ended` row - only while this device's service can carry
  // the wake. With the single probe on and the wake off, a probe-built row would go down the live path instead.
  describe("lookup on with wake off: no probe builds an ended row", () => {
    test("#given a reply to a sender on b that b no longer lists #when the run replies by id #then it is not_found naming b, with no probe and nothing sent", async () => {
      const a = account({ rows: [B_ROW], ended: { b: { [GONE]: "rk-gone" } }, noWake: true })
      const { run } = fixture.surface(a.remote, {
        callerReplyTargets: () => [GONE],
        callerReplySenders: () => [{ session_id: GONE, device: "b" }],
      })
      expect(await run("thread_send", { thread: GONE, message: "reply" })).toMatchObject({
        kind: "error",
        error: { code: "not_found", details: { device: "b" } },
      })
      expect({ lookups: a.lookups, sent: a.sent }).toEqual({ lookups: [], sent: [] })
    })

    test("#given a session id no listing holds and c holds it ended #when it is sent to #then the answer is today's not_found, with no probe and nothing sent", async () => {
      const a = account({ rows: [B_ROW, C_ROW], ended: { c: { [GONE]: "rk-c-gone" } }, noWake: true })
      const { run } = fixture.surface(a.remote)
      expect(await run("thread_send", { thread: GONE, message: "hi" })).toMatchObject({
        kind: "error",
        error: { code: "not_found" },
      })
      expect({ lookups: a.lookups, sent: a.sent }).toEqual({ lookups: [], sent: [] })
    })
  })

  describe("5.4 the relay transport for an ended row", () => {
    const endedOnC = (extra: Parameters<Fixture["account"]>[0] = {}) =>
      account({ rows: [B_ROW, C_ROW], ended: { c: { [GONE]: "rk-c-gone" } }, ...extra })

    test("#given an ended row #when it is sent to with the default mode #then no get_state is sent and the record is a follow-up", async () => {
      const a = endedOnC()
      const { run } = fixture.surface(a.remote)
      expect(await run("thread_send", { thread: GONE, message: "hi" })).toMatchObject({
        kind: "ok",
        effective_mode: "follow_up",
      })
      expect(a.sent.some((entry) => entry.rpc?.["type"] === "get_state")).toBe(false)
    })

    test("#given an ended row #when it is steered #then it is turn_conflict and nothing is sent", async () => {
      const a = endedOnC()
      const { run } = fixture.surface(a.remote)
      expect(
        await run("thread_send", { thread: GONE, message: "hi", delivery: "steer", expected_turn_id: "3" }),
      ).toMatchObject({ kind: "error", error: { code: "turn_conflict" } })
      expect(a.sent).toEqual([])
    })

    test("#given this device's service cannot carry the wake #when an ended row is sent to #then no wake is sent", async () => {
      const a = account({
        rows: [B_ROW, { ...C_ROW, session_id: "rk-ended", durable_id: GONE, state: "ended" }],
        noWake: true,
      })
      const { run } = fixture.surface(a.remote)
      await run("thread_send", { thread: GONE, message: "hi" })
      expect(wakes(a)).toEqual([])
    })
  })

  describe("5.1 the answers, mapped once", () => {
    const answered = async (wakeOutcome: RemoteCommandOutcome): Promise<ThreadToolResult> => {
      const a = account({ rows: [B_ROW, C_ROW], ended: { c: { [GONE]: "rk-c-gone" } }, wakeOutcome })
      const { run } = fixture.surface(a.remote)
      return await run("thread_send", { thread: GONE, message: "hi" })
    }

    test.each(["wake", "hold", "approval"])(
      "#given the receiver queued it waiting on %s #then the result is queued with that wait on the receiving device",
      async (kind) => {
        expect(
          await answered(
            queuedEnvelope({ kind: "queued", stored_command_id: "s-1", deduplicated: false, waiting_on: { kind } }),
          ),
        ).toMatchObject({ kind: "ok", delivery: { kind: "queued", waiting_on: { kind, device: "c" } } })
      },
    )

    test("#given the receiver answered an existing row #then the result is deduplicated", async () => {
      expect(
        await answered(
          queuedEnvelope({
            kind: "queued",
            stored_command_id: "s-1",
            deduplicated: true,
            waiting_on: { kind: "wake" },
          }),
        ),
      ).toMatchObject({ kind: "ok", deduplicated: true })
    })

    test.each([
      ["session_gone", "not_found", { reason: "session_gone" }],
      ["ambiguous_session", "ambiguous_target", {}],
      ["not_wakeable", "not_resumable", {}],
      ["sender_not_admitted", "not_resumable", {}],
      ["sender_not_allowed", "unsupported", {}],
      ["chain_count_limit", "unsupported", { reason: "chain_count_limit" }],
      ["queue_full", "queue_full", {}],
      ["wake_limit_reached", "overloaded", { reason: "wake_limit_reached" }],
    ] as const)("#given the receiver refused it with %s #then the tool answers %s", async (reason, code, details) => {
      expect(await answered(queuedEnvelope({ kind: "refused", reason }))).toMatchObject({
        kind: "error",
        error: { code, details: { device: "c", ...details } },
      })
    })

    test("#given the receiver refused it overloaded #then the tool answers overloaded with retry_after_ms", async () => {
      expect(
        await answered(queuedEnvelope({ kind: "refused", reason: "overloaded", retry_after_ms: 4_000 })),
      ).toMatchObject({ kind: "error", error: { code: "overloaded", details: { retry_after_ms: 4_000 } } })
    })

    test.each([
      ["wake_unavailable", "host_unavailable"],
      ["session_gone", "not_found"],
      ["ambiguous_session", "ambiguous_target"],
      ["overloaded", "overloaded"],
    ] as const)("#given the receiving service itself answered %s #then the tool answers %s", async (detail, code) => {
      expect(await answered({ kind: "refused", reason: "engine_capability_missing", detail })).toMatchObject({
        kind: "error",
        error: { code, details: { device: "c", reason: detail } },
      })
    })

    test("#given the receiving service refused the grant #then the tool answers scope_denied", async () => {
      expect(await answered({ kind: "refused", reason: "capability_missing", detail: "not_carried" })).toMatchObject({
        kind: "error",
        error: { code: "scope_denied" },
      })
    })

    test("#given the receiving device lacks the wake feature #then the tool answers unsupported (wake_unsupported)", async () => {
      expect(await answered({ kind: "refused", reason: "unsupported" })).toMatchObject({
        kind: "error",
        error: { code: "unsupported", details: { device: "c", reason: "wake_unsupported" } },
      })
    })

    test("#given the reply was lost #then the tool answers uncertain with the delivery id and the pending wake", async () => {
      const result = await answered({ kind: "uncertain", reason: "request_gone" })
      expect(result).toMatchObject({
        kind: "error",
        error: { code: "idempotency_uncertain", details: { device: "c", reason: "request_gone", pending_wake: true } },
      })
      expect(typeof (result as { error: { details?: { delivery_id?: unknown } } }).error.details?.delivery_id).toBe(
        "string",
      )
    })
  })

  describe("A2.6 the hold on the live path", () => {
    test("#given a live session on b that reads paused #when a follow-up is queued #then the result waits on a hold on b", async () => {
      const a = account({
        rows: [B_ROW],
        engine: { ...ENGINE, streaming: true, pending: 1 },
        liveState: { paused: true, holds: [{ kind: "stop" }] },
      })
      const { run } = fixture.surface(a.remote)
      expect(await run("thread_send", { thread: "dur-on-b", message: "hi", delivery: "follow_up" })).toMatchObject({
        kind: "ok",
        delivery: { kind: "queued", waiting_on: { kind: "hold", device: "b" } },
      })
    })
  })

  describe("E: round trips", () => {
    const count = (a: Account) => ({ listings: a.listings, lookups: a.lookups.length, commands: a.sent.length })
    const replyFrom = (sender: string) => ({
      callerReplyTargets: () => [sender],
      callerReplySenders: () => [{ session_id: sender, device: "b" }],
    })
    type Case = {
      readonly rows: readonly RemoteSessionRow[]
      readonly options?: Parameters<Fixture["account"]>[0]
      readonly surface?: Parameters<Fixture["surface"]>[1]
      readonly thread: string
    }
    const cases: Readonly<Record<string, readonly [Case, ReturnType<typeof count>]>> = {
      "reply, not running": [
        { rows: [B_ROW], options: { ended: { b: { [GONE]: "rk-gone" } } }, surface: replyFrom(GONE), thread: GONE },
        { listings: { all: 0, device: 1 }, lookups: 1, commands: 1 },
      ],
      "reply, live": [
        { rows: [B_ROW], surface: replyFrom("dur-on-b"), thread: "dur-on-b" },
        { listings: { all: 0, device: 1 }, lookups: 0, commands: 2 },
      ],
      "alias, not running": [
        {
          rows: [B_ROW],
          options: { aliases: new Map([["bee", { session_id: GONE, device: "c" }]]), ended: { c: { [GONE]: GONE } } },
          thread: "bee",
        },
        { listings: { all: 1, device: 0 }, lookups: 0, commands: 1 },
      ],
      "alias, live": [
        {
          rows: [B_ROW],
          options: { aliases: new Map([["bee", { session_id: "dur-on-b", device: "b" }]]) },
          thread: "bee",
        },
        { listings: { all: 1, device: 0 }, lookups: 0, commands: 2 },
      ],
      "bare id, not running, held": [
        { rows: [B_ROW, C_ROW], options: { ended: { c: { [GONE]: "rk-c-gone" } } }, thread: GONE },
        { listings: { all: 1, device: 0 }, lookups: 2, commands: 1 },
      ],
      "bare id, held nowhere": [
        { rows: [B_ROW, C_ROW], thread: GONE },
        { listings: { all: 1, device: 0 }, lookups: 2, commands: 0 },
      ],
      "bare id, live": [
        { rows: [B_ROW, C_ROW], options: { live: [B_ROW.session_id, C_ROW.session_id] }, thread: OTHER },
        { listings: { all: 1, device: 0 }, lookups: 0, commands: 2 },
      ],
    }

    test.each(Object.keys(cases))(
      "#given a send by %s #then its listings, lookups and relay commands are counted",
      async (name) => {
        const [given, expected] = cases[name] ?? []
        if (given === undefined || expected === undefined) throw new Error(`no case ${name}`)
        const a = account({ rows: given.rows, ...given.options })
        await fixture.surface(a.remote, given.surface).run("thread_send", { thread: given.thread, message: "hi" })
        expect(count(a)).toEqual(expected)
      },
    )
  })
  describe("review: with the gates null, a send to an unlisted id answers as before the lookup existed", () => {
    // Today's answer comes from an account whose sessions port has no lookup at all; the text is compared, not only the code.
    const today = async (rows: readonly RemoteSessionRow[], extra: Parameters<Fixture["account"]>[0] = {}) => {
      const before = fixture.account({ rows, ...extra, withoutLookup: true })
      const result = await fixture.surface(before.remote).run("thread_send", { thread: GONE, message: "hi" })
      return { result, reads: before.deviceReads }
    }
    const messageOf = (result: ThreadToolResult) => (result as { error?: { code?: string; message?: string } }).error

    test("#given no other device online #then the not_found text is today's and no device is read for a lookup", async () => {
      const a = fixture.account({ rows: [B_ROW], online: false })
      const result = await fixture.surface(a.remote).run("thread_send", { thread: GONE, message: "hi" })
      const baseline = await today([B_ROW], { online: false })
      expect(messageOf(result)).toEqual(messageOf(baseline.result))
      // The lookup reads no device of its own: the reads are exactly the ones the send made before the lookup existed.
      expect(a.deviceReads).toEqual(baseline.reads)
    })

    test.each([
      ["the gates null", false],
      ["the gates set", true],
    ] as const)(
      "#given %s and the device list failing #then it is today's not_found, not internal_error",
      async (_case, wakeFeature) => {
        const a = fixture.account({ rows: [B_ROW, C_ROW], devicesFail: true, wakeFeature })
        const result = await fixture.surface(a.remote).run("thread_send", { thread: GONE, message: "hi" })
        expect(messageOf(result)).toEqual(messageOf((await today([B_ROW, C_ROW], { devicesFail: true })).result))
        expect(messageOf(result)?.code).toBe("not_found")
      },
    )
  })

  describe("review: a receiving side's refusal reason is shown only when it is a machine code", () => {
    const refusalOf = async (reason: string) => {
      const a = account({
        rows: [B_ROW, C_ROW],
        ended: { c: { [GONE]: "rk-c-gone" } },
        wakeOutcome: queuedEnvelope({ kind: "refused", reason }),
      })
      const result = await fixture.surface(a.remote).run("thread_send", { thread: GONE, message: "hi" })
      return (result as { error: { code: string; message: string; details?: { reason?: string } } }).error
    }

    test.each([
      "session_gone",
      "ambiguous_session",
      "not_wakeable",
      "sender_not_admitted",
      "queue_full",
      "overloaded",
      "wake_limit_reached",
      "wake_unavailable",
      "wake_unsupported",
    ])("#given the known code %s #then its reason is the code itself", async (code) => {
      expect((await refusalOf(code)).details?.reason).toBe(code)
    })

    test.each(["some_new_code", "v2.busy-now"])(
      "#given an unknown code of the machine shape %s #then it is shown verbatim",
      async (code) => {
        const error = await refusalOf(code)
        expect(error.code).toBe("unsupported")
        expect(error.details?.reason).toBe(code)
        expect(error.message.includes(code)).toBe(true)
      },
    )

    test.each([
      ["a joiner after a run of marks", `a${"\u0300\u0301\u0302\u0303\u0304\u0305\u200D".repeat(40)}`],
      ["a joiner between two invisibles", "a\u034F\u200D\uFE0Fb"],
      ["a bidi override", "\u202Eesrever"],
      ["tag characters", "\u{E0041}\u{E0042}\u{E007F}"],
      ["a combining grapheme joiner", "busy\u034F"],
      ["a variation selector", "busy\uFE0F"],
      ["Hindi prose", "नहीं, यह सत्र बंद है"],
      ["Arabic prose", "الجلسة مغلقة"],
      ["Korean prose", "세션을 깨울 수 없습니다"],
      ["an emoji", "\u{1F600}"],
      ["a string with a space", "turn active"],
      ["an upper-case word", "Busy"],
      ["an empty string", ""],
      ["65 characters", "a".repeat(65)],
      ["a string with a newline", "busy\nnow"],
      ["a code with a trailing newline", "busy\n"],
    ] as const)("#given %s #then the reason is the constant and the text is not shown", async (_label, reason) => {
      const error = await refusalOf(reason)
      expect(error.details?.reason).toBe("unrecognised")
      expect(error.message).toBe("Device c refused the message (unrecognised reason).")
    })

    // #13277 review: the device service's own refusal of the wake (not the consumer's envelope) goes through outcomeFailure,
    // and its reason can be the other device's free-form response.error. The same allowlist applies there.
    const serviceRefusalOf = async (reason: string) => {
      const a = account({
        rows: [B_ROW, C_ROW],
        ended: { c: { [GONE]: "rk-c-gone" } },
        wakeOutcome: { kind: "refused", reason },
      })
      const result = await fixture.surface(a.remote).run("thread_send", { thread: GONE, message: "hi" })
      if (result.kind !== "error") throw new Error(JSON.stringify(result))
      return result.error
    }

    test("#given the device service refuses the wake with free-form text #then the reason is the constant and the text is shown nowhere", async () => {
      const raw = "Error: ENOENT /home/someone/private/session.jsonl"
      const error = await serviceRefusalOf(raw)
      expect(error.details?.reason).toBe("unrecognised")
      expect(JSON.stringify(error).includes(raw)).toBe(false)
    })

    test("unchanged: #given the device service refuses the wake with a machine code #then that code keeps its own mapping", async () => {
      const error = await serviceRefusalOf("host_detached")
      expect([error.code, error.details?.reason]).toEqual(["host_unavailable", "host_detached"])
    })
  })
})
