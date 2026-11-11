import { afterEach, describe, expect, test } from "bun:test"
import type { RemoteSessionRow } from "./remote/ports"
import type { ThreadHostSession } from "./tools"
import { B_ROW, createRemoteThreadFixture } from "./thread-remote-fixture"

/**
 * #13006: one message interface, two transports behind it. Every assertion below runs once per leg through the same
 * tool surface, so a rule that reads the transport (a resolver that finds only this device's names, a reply allowance
 * one leg cannot satisfy, a result key or a refusal code only one leg answers) fails this file instead of reaching a
 * user. The legs: a thread this device holds (`local`) and one on account device b (`remote`). The reply allowance's
 * own origin independence is pinned at its owner, `peer-reply.test.ts`; the steer refusals at `thread-remote-send.test.ts`.
 */
type Leg = "local" | "remote"
const LEGS: readonly Leg[] = ["local", "remote"]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const approved = (address: string) => [
  { permission: "thread_send", patterns: [address], always: [address], autoApproveAsk: true as const },
]
/** Known to exist on one leg only: a gateway row's sequence and endpoint kind here, the device there (contracts/results.ts). */
const LEG_ONLY_KEYS: ReadonlySet<string> = new Set(["thread_id", "link", "message_seq", "endpoint", "device"])
const sharedKeys = (result: object) =>
  Object.keys(result)
    .filter((key) => !LEG_ONLY_KEYS.has(key))
    .sort()

const LOCAL: ThreadHostSession = {
  sessionId: "route-local",
  durableSessionId: "dur-local",
  cwd: process.cwd(),
  name: "local peer",
  status: "open",
}
const TWINS: readonly (ThreadHostSession & { readonly durableSessionId: string })[] = [
  { sessionId: "route-twin-1", durableSessionId: "dur-twin-1", cwd: process.cwd(), name: "twin", status: "open" },
  { sessionId: "route-twin-2", durableSessionId: "dur-twin-2", cwd: process.cwd(), name: "twin", status: "open" },
]
const B_TWINS: readonly (RemoteSessionRow & { readonly durable_id: string })[] = [
  { ...B_ROW, session_id: "rk-twin-1", durable_id: "dur-b-twin-1", title: "twin" },
  { ...B_ROW, session_id: "rk-twin-2", durable_id: "dur-b-twin-2", title: "twin" },
]

/** The thread each leg addresses, and the thread on the OTHER leg, which carries a different identity. */
const TARGET: Readonly<
  Record<
    Leg,
    { readonly id: string; readonly name: string; readonly other: { readonly id: string; readonly name: string } }
  >
> = {
  local: { id: "dur-local", name: "local peer", other: { id: "dur-on-b", name: "on b" } },
  remote: { id: "dur-on-b", name: "on b", other: { id: "dur-local", name: "local peer" } },
}

describe("#13006: a send answers the same shape and the same refusals whichever leg carries it", () => {
  const fixture = createRemoteThreadFixture()
  afterEach(fixture.cleanup)

  /**
   * One account holding the local thread and b's, the sending surface woken (or not) by a delivery from `sender`;
   * `twinsOn` adds two threads named "twin" to that leg.
   */
  function legs(
    options: { readonly sender?: { readonly session_id: string; readonly name?: string }; readonly twinsOn?: Leg } = {},
  ) {
    const { sender, twinsOn } = options
    const rows = twinsOn === "remote" ? [B_ROW, ...B_TWINS] : [B_ROW]
    const a = fixture.account({ rows, live: rows.map((row) => row.session_id) })
    const extra =
      sender === undefined ? {} : { callerReplyTargets: () => [sender.session_id], callerReplySenders: () => [sender] }
    const { run, permission } = fixture.surface(a.remote, {
      sessions: twinsOn === "local" ? [LOCAL, ...TWINS] : [LOCAL],
      ...extra,
    })
    const admits = () => a.sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message")
    return { run, permission, admits }
  }

  /**
   * A delivered send on either leg: the target it reached, a minted delivery id, and the lane as the contract defines it
   * (contracts/results.ts): the lane the target took once admitted (`follow_up` for the default mode on an idle or busy
   * target), or the requested mode while the delivery still waits for a receiver (`queued_offline` has no lane yet).
   */
  const delivered = (result: unknown, leg: Leg) => {
    const { delivery, delivery_id, effective_mode } = result as {
      delivery: { kind: string }
      delivery_id?: unknown
      effective_mode?: unknown
    }
    expect(result).toMatchObject({ kind: "ok", thread_id: TARGET[leg].id, deduplicated: false })
    expect(delivery_id).toMatch(UUID)
    expect(["started", "queued", "queued_offline"]).toContain(delivery.kind)
    expect(effective_mode).toBe(delivery.kind === "queued_offline" ? "auto" : "follow_up")
    return sharedKeys(result as object)
  }

  test.each(LEGS)(
    "#given a thread on the %s leg #when it is sent to by durable id and by name #then both deliver to it with the same keys, a delivery id and the lane taken",
    async (leg) => {
      const { run } = legs()
      const byId = await run("thread_send", { thread: TARGET[leg].id, message: "hello" })
      const byName = await run("thread_send", { thread: TARGET[leg].name, message: "hello again" })
      expect(delivered(byName, leg)).toEqual(delivered(byId, leg))
    },
  )

  test("#given one send to each leg #when their result keys are compared, leg-only facts aside #then they are the same set", async () => {
    const { run } = legs()
    const here = await run("thread_send", { thread: TARGET.local.id, message: "hello" })
    const there = await run("thread_send", { thread: TARGET.remote.id, message: "hello" })
    expect(sharedKeys(there as object)).toEqual(sharedKeys(here as object))
    expect(sharedKeys(here as object)).toEqual(["deduplicated", "delivery", "delivery_id", "effective_mode", "kind"])
  })

  test.each(LEGS)(
    "#given a run woken by the %s thread's delivery #when it replies by that sender's id and by its stated name #then both are approved without a prompt and both deliver to that sender",
    async (leg) => {
      const { run, permission } = legs({ sender: { session_id: TARGET[leg].id, name: TARGET[leg].name } })
      expect(permission({ thread: TARGET[leg].id, message: "reply" })).toEqual(approved(TARGET[leg].id))
      expect(permission({ thread: TARGET[leg].name, message: "reply" })).toEqual(approved(TARGET[leg].name))
      expect(await run("thread_send", { thread: TARGET[leg].id, message: "reply" })).toMatchObject({
        kind: "ok",
        thread_id: TARGET[leg].id,
      })
      expect(await run("thread_send", { thread: TARGET[leg].name, message: "reply" })).toMatchObject({
        kind: "ok",
        thread_id: TARGET[leg].id,
      })
    },
  )

  test.each(LEGS)(
    "#given a run woken by a sender that stated the %s thread's name but is another session #when it replies by that name #then the ask is approved from the delivery, and the send refuses reply_target_mismatch without sending",
    async (leg) => {
      const { run, permission, admits } = legs({ sender: { session_id: TARGET[leg].other.id, name: TARGET[leg].name } })
      expect(permission({ thread: TARGET[leg].name, message: "reply" })).toEqual(approved(TARGET[leg].name))
      expect(await run("thread_send", { thread: TARGET[leg].name, message: "reply" })).toMatchObject({
        kind: "error",
        error: { code: "reply_target_mismatch", details: { resolved_thread_id: TARGET[leg].id } },
      })
      expect(admits()).toHaveLength(0)
    },
  )

  test.each(LEGS)(
    "#given two threads named twin on the %s leg #when the name is sent to #then it is ambiguous_target naming both, never a silent pick, and nothing is sent",
    async (leg) => {
      const { run, admits } = legs({ twinsOn: leg })
      const twins =
        leg === "local" ? TWINS.map((session) => session.durableSessionId) : B_TWINS.map((row) => row.durable_id)
      const result = await run("thread_send", { thread: "twin", message: "which one" })
      expect(result).toMatchObject({ kind: "error", error: { code: "ambiguous_target" } })
      const candidates =
        (result as { error: { details?: { candidates?: readonly { id: string; device?: string }[] } } }).error.details
          ?.candidates ?? []
      expect(candidates.map((candidate) => candidate.id).sort()).toEqual([...twins].sort())
      if (leg === "remote") expect(candidates.map((candidate) => candidate.device)).toEqual(["b", "b"])
      expect(admits()).toHaveLength(0)
    },
  )

  test.each(LEGS)(
    "#given a send on the %s leg #when the same idempotency_key is sent twice #then the second answer replays the first as deduplicated with the same delivery id and lane",
    async (leg) => {
      const { run } = legs()
      const first = await run("thread_send", { thread: TARGET[leg].id, message: "once", idempotency_key: "k-parity" })
      const again = await run("thread_send", { thread: TARGET[leg].id, message: "once", idempotency_key: "k-parity" })
      expect(first).toMatchObject({ kind: "ok", deduplicated: false })
      const { deduplicated: _first, ...rest } = first as { deduplicated: boolean }
      expect(again).toMatchObject({ ...rest, deduplicated: true })
    },
  )
})
