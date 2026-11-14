import { afterEach, describe, expect, test } from "bun:test"
import { appendFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { WAKE_LEASE_MS } from "../gateway/constants"
import type { IntakeAdmission } from "../gateway/intake-admission"
import type { GatewayStore } from "../gateway/store"
import { createGatewayHarness, type GatewayHarness } from "../gateway/testing/harness"
import { createCarrier, type Carrier, type CarrierEvent } from "./carrier"
import { connectCarrierHost } from "./carrier-connection"
import {
  BACKGROUND,
  FINISHED,
  HOST_STAMPED,
  PARKED_APPROVAL,
  STALLED,
  STOPPED,
  STREAMING,
  startFakeEngineHost,
  type FakeEngineHost,
  type FakeEngineOptions,
} from "./testing/fake-engine-host"
import { writeSessionFile } from "./testing/fake-wake-host"

// The carrier (#13037 A3.1.3 to A3.1.8, A3.2): it lifts a woken session's gate, sends the engine's wake, reads
// "finished" and hands the session back quietly, and follows the held rule and the 30 minute rule, over a real store
// and an engine host that answers with the close probe's measured replies.

let harness: GatewayHarness | undefined
let host: FakeEngineHost | undefined
const carriers: Carrier[] = []
afterEach(async () => {
  for (const carrier of carriers.splice(0)) await carrier.stop()
  await host?.close()
  host = undefined
  await harness?.dispose()
  harness = undefined
})

type Setup = {
  readonly h: GatewayHarness
  readonly fake: FakeEngineHost
  readonly store: GatewayStore
  readonly sessions: string
  readonly carrier: Carrier
  readonly events: CarrierEvent[]
  /** Resolves on the first event matching `match`, armed before the trigger; fails after 5 s. */
  readonly next: (match: (event: CarrierEvent) => boolean, what: string) => Promise<CarrierEvent>
  /** Writes the session file and queues one same-device row for it: the queued row every open needs (A7.2.3). */
  readonly path: (id: string) => string
  /** Writes the session file only, with no queued row. */
  readonly file: (id: string) => string
  /** Queues one row for the session from another device, through the intake. */
  readonly intakeRow: (id: string, deliveryId: string) => Promise<void>
}

async function setup(
  options: FakeEngineOptions & {
    readonly wakeLimit?: number
    readonly sameDevice?: () => boolean
    readonly remoteWake?: () => boolean
    readonly admitIntake?: (device: string) => Promise<IntakeAdmission>
    readonly storeWrap?: (store: GatewayStore) => GatewayStore
    readonly schedule?: (run: () => void, ms: number) => () => void
  } = {},
): Promise<Setup> {
  const h = (harness = createGatewayHarness())
  const fake = (host = await startFakeEngineHost(options))
  const store = options.storeWrap === undefined ? h.store() : options.storeWrap(h.store())
  const sessions = join(h.agentDir, "sessions")
  const events: CarrierEvent[] = []
  const waiters: {
    readonly match: (event: CarrierEvent) => boolean
    readonly resolve: (event: CarrierEvent) => void
  }[] = []
  const next = (match: (event: CarrierEvent) => boolean, what: string): Promise<CarrierEvent> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`waited 5s for ${what}, never fired`)), 5_000)
      waiters.push({
        match,
        resolve: (event) => {
          clearTimeout(timer)
          resolve(event)
        },
      })
    })
  const carrier = createCarrier({
    store,
    sessionsDirectory: sessions,
    ensureHost: async () => undefined,
    connect: () => connectCarrierHost({ socket: fake.socketPath, keyRoot: () => h.agentDir }),
    wakeLimit: () => options.wakeLimit ?? 0,
    sameDevice: options.sameDevice ?? (() => true),
    ...(options.remoteWake === undefined ? {} : { remoteWake: options.remoteWake }),
    ...(options.admitIntake === undefined ? {} : { admitIntake: options.admitIntake }),
    schedule: options.schedule ?? (() => () => undefined),
    onEvent: (event) => {
      events.push(event)
      for (const waiter of waiters.splice(0)) {
        if (waiter.match(event)) waiter.resolve(event)
        else waiters.push(waiter)
      }
    },
  })
  carriers.push(carrier)
  const paths = new Map<string, string>()
  // A row queued for the session is what every open needs (A7.2.3), so `path` queues one and the carrier the tests
  // drive waits for those writes before it acts: the fixture's own ordering, never a timer.
  const queueing: Promise<unknown>[] = []
  let sender: ReturnType<GatewayHarness["session"]> | undefined
  const file = (id: string): string => {
    let found = paths.get(id)
    if (found === undefined) {
      found = writeSessionFile(sessions, id)
      paths.set(id, found)
    }
    return found
  }
  const settled = async <T>(run: () => Promise<T>): Promise<T> => {
    while (queueing.length > 0) await Promise.all(queueing.splice(0))
    return await run()
  }
  const waited: Carrier = {
    wake: (id) => settled(() => carrier.wake(id)),
    evaluate: (id) => settled(() => carrier.evaluate(id)),
    sweep: () => settled(() => carrier.sweep()),
    stop: () => carrier.stop(),
  }
  return {
    h,
    fake,
    store,
    sessions,
    carrier: waited,
    events,
    next,
    path: (id) => {
      const known = paths.has(id)
      const found = file(id)
      if (!known) {
        h.phantom(id)
        const from = (sender ??= h.session("row-sender"))
        queueing.push(
          from.engine
            .deliver({ sender: { kind: "session", durable_id: "row-sender" }, target: id, text: `to ${id}` })
            .then((sent) => {
              if (sent.kind !== "ok") throw new Error(`queueing a same-device row for ${id} answered ${sent.kind}`)
            }),
        )
      }
      return found
    },
    file,
    intakeRow: async (id, deliveryId) => {
      file(id)
      const outcome = await store.intake({
        now: h.clock.now,
        attested_device: "dev-b",
        record: {
          sessionId: id,
          deliveryId,
          text: deliveryId,
          displayText: deliveryId,
          sender: { kind: "agent", session_id: "sender-s" },
          deliverAs: "followUp",
          chainCount: 1,
        },
        provenance: { workspace: "remote", project: "remote" },
        target_session_kind: "interactive",
      })
      if (outcome.kind !== "queued") throw new Error(`the intake for ${id} answered ${outcome.kind}`)
    },
  }
}

const sent = (fake: FakeEngineHost, type: string) => fake.frames.filter((frame) => frame.type === type)

describe("the carrier lifts, reads finished, and hands back", () => {
  test("#given a session that ended cleanly #when it is woken and found finished #then the gate is lifted, the engine's wake is sent, and a quiet release ends the row", async () => {
    const { fake, store, carrier, path } = await setup()
    path("s1")

    expect(await carrier.wake("s1")).toMatchObject({ kind: "open" })
    expect(await store.woken.list()).toMatchObject([{ durable_id: "s1", state: "open" }])
    expect(sent(fake, "wake")).toHaveLength(1)
    const [open] = sent(fake, "open_session")
    expect(Object.keys(open ?? {}).sort()).toEqual(["cwd", "id", "retain_on_disconnect", "sessionPath", "type"])

    expect(await carrier.evaluate("s1")).toEqual({ kind: "released" })
    const [release] = sent(fake, "release_session")
    expect(release).toMatchObject({ reason: "takeover" })
    expect(release).not.toHaveProperty("interrupt")
    expect(release).not.toHaveProperty("force")
    expect(sent(fake, "detach_connection")).toHaveLength(1)
    expect(await store.woken.list()).toEqual([])
  })

  test("#given a streaming turn #when the carrier looks #then it sends no release and keeps the row, and releases once the turn settled", async () => {
    const { fake, store, carrier, path } = await setup()
    fake.setSnapshot(path("s1"), FINISHED)
    await carrier.wake("s1")
    fake.setSnapshot(path("s1"), STREAMING)
    expect(await carrier.evaluate("s1")).toEqual({ kind: "kept", reason: "working" })
    expect(sent(fake, "release_session")).toEqual([])
    expect(await store.woken.list()).toHaveLength(1)

    fake.setSnapshot(path("s1"), FINISHED)
    expect(await carrier.evaluate("s1")).toEqual({ kind: "released" })
  })

  test("#given background work the engine would not refuse #when the carrier looks #then it never sends the release", async () => {
    const { fake, carrier, path } = await setup()
    path("s1")
    await carrier.wake("s1")
    fake.setSnapshot(path("s1"), BACKGROUND)
    expect(await carrier.evaluate("s1")).toEqual({ kind: "kept", reason: "working" })
    expect(sent(fake, "release_session")).toEqual([])
  })

  test("#given a session whose only wait is stalled #when the carrier looks #then it counts as finished and is released", async () => {
    const { fake, carrier, path } = await setup()
    path("s1")
    await carrier.wake("s1")
    fake.setSnapshot(path("s1"), STALLED)
    expect(await carrier.evaluate("s1")).toEqual({ kind: "released" })
  })

  test("#given a person's client attached meanwhile #when the carrier looks #then it hands the session over: own attachment released, row gone, wake count reset", async () => {
    const { fake, store, carrier, path } = await setup({ wakeLimit: 5 })
    path("s1")
    await carrier.wake("s1")
    expect(await store.woken.wakeCount({ durable_id: "s1" })).toBe(1)
    fake.session(path("s1")).others = 1
    expect(await carrier.evaluate("s1")).toEqual({ kind: "handed_over" })
    expect(sent(fake, "release_attachment")).toHaveLength(1)
    expect(await store.woken.list()).toEqual([])
    expect(await store.woken.wakeCount({ durable_id: "s1" })).toBe(0)
  })

  test("#given a host that answers the release as an unknown command #when the carrier closes #then the close failed, the row ends and the session is left to the host", async () => {
    const { store, carrier, path } = await setup({ releaseUnknown: true })
    path("s1")
    await carrier.wake("s1")
    expect(await carrier.evaluate("s1")).toEqual({ kind: "close_failed", code: "unknown_command" })
    expect(await store.woken.list()).toEqual([])
  })

  test("#given a lifecycle event on the carrier's connection #when the session settles #then the carrier looks again by itself", async () => {
    const { fake, store, carrier, next, path } = await setup()
    fake.setSnapshot(path("s1"), STREAMING)
    await carrier.wake("s1")
    const released = next(
      (event) => event.kind === "evaluated" && event.outcome.kind === "released",
      "the carrier to release after a lifecycle event",
    )
    fake.setSnapshot(path("s1"), FINISHED)
    fake.emitLifecycle(path("s1"))
    await released
    expect(await store.woken.list()).toEqual([])
  })
})

describe("waiting for a person (A3.2.6)", () => {
  test("#given an approval that arose after admission #when 30 minutes pass with only the carrier attached #then the state is read again and close_session ends it", async () => {
    const { h, fake, store, carrier, path } = await setup()
    path("s1")
    await carrier.wake("s1")
    fake.setSnapshot(path("s1"), PARKED_APPROVAL)
    expect(await carrier.evaluate("s1")).toEqual({ kind: "waiting", since: h.clock.now })
    h.clock.now += 30 * 60_000 - 1
    expect(await carrier.evaluate("s1")).toMatchObject({ kind: "waiting" })
    expect(sent(fake, "close_session")).toEqual([])
    h.clock.now += 1
    expect(await carrier.evaluate("s1")).toEqual({ kind: "closed_waiting" })
    expect(sent(fake, "close_session")).toHaveLength(1)
    expect(await store.woken.list()).toEqual([])
  })

  test("#given a wait that ended before 30 minutes #when the carrier reads no wait #then the first-seen time is cleared", async () => {
    const { h, fake, store, carrier, path } = await setup()
    path("s1")
    await carrier.wake("s1")
    fake.setSnapshot(path("s1"), PARKED_APPROVAL)
    await carrier.evaluate("s1")
    fake.setSnapshot(path("s1"), STREAMING)
    await carrier.evaluate("s1")
    expect((await store.woken.list())[0]?.first_waiting_at).toBeNull()
    h.clock.now += 31 * 60_000
    fake.setSnapshot(path("s1"), PARKED_APPROVAL)
    expect(await carrier.evaluate("s1")).toMatchObject({ kind: "waiting", since: h.clock.now })
  })

  test("#given a question its owner left unanswered #when the wake opens it #then nothing is lifted, the wait state is stored, and the row ends without ending the question", async () => {
    const { fake, store, carrier, path } = await setup()
    fake.setSnapshot(path("s1"), PARKED_APPROVAL)
    expect(await carrier.wake("s1")).toEqual({ kind: "waiting" })
    expect(sent(fake, "wake")).toEqual([])
    expect(sent(fake, "close_session")).toEqual([])
    expect(await store.sessionWait.read({ durable_id: "s1" })).toMatchObject({ wait: "waiting" })
    expect(await store.woken.list()).toEqual([])
  })
})

describe("the held rule (A3.2.8)", () => {
  test("#given a Stop left on the session and nothing admitted #when it is woken #then the hold is stored, a quiet release ends it, and it is not woken again", async () => {
    const { fake, store, carrier, path } = await setup()
    fake.setSnapshot(path("s1"), STOPPED)
    expect(await carrier.wake("s1")).toEqual({ kind: "held" })
    expect(sent(fake, "wake")).toEqual([])
    expect(sent(fake, "release_session")).toMatchObject([{ reason: "takeover" }])
    expect(await store.sessionWait.read({ durable_id: "s1" })).toMatchObject({
      wait: "held",
      hold_kinds: ["session_hold"],
    })
    expect(await store.woken.list()).toEqual([])

    const opens = sent(fake, "open_session").length
    expect(await carrier.wake("s1")).toEqual({ kind: "held" })
    expect(sent(fake, "open_session")).toHaveLength(opens)
  })

  test("#given a held state whose file grew #when it is woken #then one new probe opens it and a released hold lets it run", async () => {
    const { fake, store, carrier, path } = await setup()
    fake.setSnapshot(path("s1"), STOPPED)
    await carrier.wake("s1")
    appendFileSync(path("s1"), `${JSON.stringify({ type: "custom", customType: "resume" })}\n`)
    fake.setSnapshot(path("s1"), FINISHED)
    expect(await carrier.wake("s1")).toMatchObject({ kind: "open" })
    expect(await store.sessionWait.read({ durable_id: "s1" })).toBeNull()
  })

  test("#given a hold that appears after the lift with a delivery held as a notice #when the carrier looks #then it releases with interrupt and the row ends", async () => {
    const { fake, store, carrier, path } = await setup()
    path("s1")
    await carrier.wake("s1")
    fake.setSnapshot(path("s1"), STOPPED)
    fake.session(path("s1")).heldDeliveries = ["d-held"]
    expect(await carrier.evaluate("s1")).toEqual({ kind: "held" })
    expect(sent(fake, "release_session").at(-1)).toMatchObject({ reason: "takeover", interrupt: true })
    expect(await store.woken.list()).toEqual([])
  })

  test("#given a session a host restart stamped and still holds #when it is woken #then the carrier releases only its own attachment and deletes the row", async () => {
    const { fake, store, carrier, path } = await setup()
    fake.setSnapshot(path("s1"), HOST_STAMPED)
    fake.session(path("s1")).others = 1
    expect(await carrier.wake("s1")).toEqual({ kind: "held" })
    expect(sent(fake, "release_attachment")).toHaveLength(1)
    expect(sent(fake, "close_session")).toEqual([])
    expect(await store.woken.list()).toEqual([])
  })

  test("#given four held sessions woken in turn #when a fifth is woken #then it still opens: a held session holds no place", async () => {
    const { fake, carrier, path } = await setup()
    for (const id of ["a", "b", "c", "d"]) {
      fake.setSnapshot(path(id), STOPPED)
      expect(await carrier.wake(id)).toEqual({ kind: "held" })
    }
    path("e")
    expect(await carrier.wake("e")).toMatchObject({ kind: "open" })
  })
})

describe("the lease (A3.1.3)", () => {
  test("#given a row another carrier took over after the lease ran out #when the first carrier looks #then it only releases its own attachment", async () => {
    const { h, fake, store, carrier, path } = await setup()
    path("s1")
    await carrier.wake("s1")
    h.clock.now += WAKE_LEASE_MS + 1
    expect(await h.store().woken.takeOver({ durable_id: "s1" })).toMatchObject({ kind: "taken_over" })
    expect(await carrier.evaluate("s1")).toEqual({ kind: "lost_lease" })
    expect(sent(fake, "release_attachment")).toHaveLength(1)
    expect(sent(fake, "release_session")).toEqual([])
    expect(await store.woken.list()).toMatchObject([{ generation: 2 }])
  })

  test("#given a carrier that died after the open #when another carrier sweeps past the lease #then it takes the row over and ends the finished session", async () => {
    const { h, fake, store, carrier, path } = await setup()
    path("s1")
    await carrier.wake("s1")
    await carrier.stop()
    h.clock.now += WAKE_LEASE_MS + 1
    const successor = createCarrier({
      store: h.store(),
      sessionsDirectory: join(h.agentDir, "sessions"),
      ensureHost: async () => undefined,
      connect: () => connectCarrierHost({ socket: fake.socketPath, keyRoot: () => h.agentDir }),
      sameDevice: () => true,
      schedule: () => () => undefined,
    })
    carriers.push(successor)
    await successor.sweep()
    expect(await store.woken.list()).toEqual([])
    expect(sent(fake, "release_session")).toHaveLength(1)
  })

  // The #13455 delta review's MEDIUM: the sweep a carrier runs AT ITS START takes over rows a dead process left,
  // with no wake of its own and no hand-called sweep; the timer still arms only while the table holds a row.
  test("#given a table holding a row whose lease ran out #when a successor carrier starts with no wake of its own #then it takes the row over at its start", async () => {
    const { h, fake, store, carrier, path } = await setup()
    path("s1")
    await carrier.wake("s1")
    await carrier.stop()
    h.clock.now += WAKE_LEASE_MS + 1
    let tookOver: () => void = () => undefined
    const settled = new Promise<void>((resolve, reject) => {
      tookOver = resolve
      const timer = setTimeout(() => reject(new Error("waited 5s for the successor to take the row over at its start")), 5_000)
      timer.unref?.()
      const original = tookOver
      tookOver = () => {
        clearTimeout(timer)
        original()
      }
    })
    const successor = createCarrier({
      store: h.store(),
      sessionsDirectory: join(h.agentDir, "sessions"),
      ensureHost: async () => undefined,
      connect: () => connectCarrierHost({ socket: fake.socketPath, keyRoot: () => h.agentDir }),
      sameDevice: () => true,
      schedule: () => () => undefined,
      onEvent: (event) => {
        if (event.kind === "evaluated" && event.durable_id === "s1") tookOver()
      },
    })
    carriers.push(successor)
    await settled
    expect(await store.woken.list()).toEqual([])
    expect(sent(fake, "release_session")).toHaveLength(1)
  })

  // The #13455 delta review's LOW: a sweep whose store read throws once still has work to tend, so the timer is
  // re-armed for the next tick instead of left disarmed while rows exist.
  test("#given a sweep whose store read throws once #when the timer fires #then the sweep is scheduled again for the next tick", async () => {
    let reads = 0
    const timers: (() => void)[] = []
    let secondArm: () => void = () => undefined
    const reArmed = new Promise<void>((resolve, reject) => {
      secondArm = resolve
      const timer = setTimeout(() => reject(new Error("waited 5s for the sweep to be scheduled again")), 5_000)
      timer.unref?.()
      const original = secondArm
      secondArm = () => {
        clearTimeout(timer)
        original()
      }
    })
    const { carrier, path } = await setup({
      storeWrap: (real) => ({
        ...real,
        woken: {
          ...real.woken,
          list: async () => {
            reads += 1
            if (reads === 2) throw new Error("the store read failed once")
            return await real.woken.list()
          },
        },
      }),
      schedule: (run) => {
        timers.push(run)
        if (timers.length === 2) secondArm()
        return () => undefined
      },
    })
    path("t")
    expect(await carrier.wake("t")).toMatchObject({ kind: "open" })
    expect(timers).toHaveLength(1)
    timers[0]?.()
    await reArmed
    expect(timers).toHaveLength(2)
    await carrier.stop()
  })

  // Review of #13220 (MEDIUM): a successor must reopen the session in the session's own directory, never its own, or an
  // unattended woken turn runs its tools outside the project.
  test("#given a carrier that died after the open #when its successor takes the row over #then the successor opens the session in the session's own working directory", async () => {
    const { h, fake, carrier, path } = await setup()
    path("s1")
    await carrier.wake("s1")
    await carrier.stop()
    h.clock.now += WAKE_LEASE_MS + 1
    await successorOf(h, fake).sweep()
    expect(sent(fake, "open_session").map((frame) => frame.cwd)).toEqual(["/work/project", "/work/project"])
  })

  test.each([
    ["gone", (sessions: string, file: string) => rmSync(file)],
    ["ambiguous", (sessions: string) => writeSessionFile(sessions, "s1", {}, "--other-project--")],
  ] as const)(
    "#given a carrier that died after the open #when the session is %s at the takeover #then the row ends and nothing is opened",
    async (_case, change) => {
      const { h, fake, store, sessions, carrier, path } = await setup()
      const file = path("s1")
      await carrier.wake("s1")
      await carrier.stop()
      change(sessions, file)
      h.clock.now += WAKE_LEASE_MS + 1
      await successorOf(h, fake).sweep()
      expect(await store.woken.list()).toEqual([])
      expect(sent(fake, "open_session")).toHaveLength(1)
    },
  )
})

// Review of #13220 at 9351a872b6, LOW: the classifier is closed. A header it cannot read (here a header-only file with
// no trailing newline, which the disk lookup accepts while the classifier sees no header) and a `kind` value this build
// does not know are their own answer, never `interactive`, so neither a wake nor a takeover opens such a session.
const UNCLASSIFIABLE = [
  [
    "a header the classifier cannot read",
    (file: string) =>
      writeFileSync(
        file,
        JSON.stringify({
          type: "session",
          version: 3,
          id: "s1",
          timestamp: "2026-11-12T00:00:00.000Z",
          cwd: "/work/project",
        }),
      ),
  ],
  [
    "an unrecognised kind",
    (file: string) =>
      writeFileSync(
        file,
        `${JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-11-12T00:00:00.000Z", cwd: "/work/project", kind: "robot" })}\n`,
      ),
  ],
] as const

describe("the session-kind classifier is closed", () => {
  test.each(UNCLASSIFIABLE)(
    "#given %s #when the session is woken #then it is refused not_wakeable as unknown and nothing opens",
    async (_case, rewrite) => {
      const { fake, carrier, path } = await setup()
      rewrite(path("s1"))
      expect(await carrier.wake("s1")).toEqual({ kind: "not_wakeable", session_kind: "unknown" })
      expect(sent(fake, "open_session")).toEqual([])
    },
  )

  test.each(UNCLASSIFIABLE)(
    "#given a carrier that died after the open #when the session file now carries %s at the takeover #then the row ends and nothing is opened",
    async (_case, rewrite) => {
      const { h, fake, store, carrier, path } = await setup()
      const file = path("s1")
      await carrier.wake("s1")
      await carrier.stop()
      rewrite(file)
      h.clock.now += WAKE_LEASE_MS + 1
      await successorOf(h, fake).sweep()
      expect(await store.woken.list()).toEqual([])
      expect(sent(fake, "open_session")).toHaveLength(1)
    },
  )
})

// Delta review of #13220 at da331c654d, LOW 3: a takeover reopens only a session a wake would open. A header that now
// names a child or a worker is refused there as `not_wakeable`, so the takeover ends the row and opens nothing.
describe("the takeover refuses a session a wake would refuse", () => {
  test.each([
    ["child", { spawnedBy: { session_id: "parent-s" } }],
    ["worker", { kind: "worker" }],
  ] as const)(
    "#given a carrier that died after the open #when the session file now names a %s at the takeover #then the row ends and nothing is opened",
    async (_kind, header) => {
      const { h, fake, store, sessions, carrier, path } = await setup()
      path("s1")
      await carrier.wake("s1")
      await carrier.stop()
      writeSessionFile(sessions, "s1", header)
      h.clock.now += WAKE_LEASE_MS + 1
      await successorOf(h, fake).sweep()
      expect(await store.woken.list()).toEqual([])
      expect(sent(fake, "open_session")).toHaveLength(1)
    },
  )
})

// Delta review of #13220 at da331c654d, LOW 2: a wake that finds nothing queued ends only a record that is still
// `requested`. Another carrier's record that is being opened or is open is left alone and the wake answers busy, so
// that carrier keeps its lease and still closes the session it carries.
describe("a wake with nothing queued and another carrier's live record", () => {
  test("#given carrier A carrying an open session whose last row was settled #when carrier B is asked to wake it #then B answers busy, A's record and lease are untouched, and A still closes the session", async () => {
    const { h, fake, store, carrier, path } = await setup()
    path("s1")
    expect(await carrier.wake("s1")).toMatchObject({ kind: "open" })
    const before = await store.woken.list()
    for (const row of await store.list({ target_durable_id: "s1" }))
      await store.refuseQueued({ now: store.now(), delivery_id: row.delivery_id, reason: "sender_not_admitted" })
    expect(await successorOf(h, fake).wake("s1")).toEqual({ kind: "busy", code: "wake_in_progress" })
    expect(await store.woken.list()).toEqual(before)
    expect(await carrier.evaluate("s1")).toEqual({ kind: "released" })
    expect(sent(fake, "release_session")).toHaveLength(1)
  })
})

// #13456's noted follow-up: the retry and lease-takeover paths re-check the sender's peer admission before any start,
// failing closed when the answer is unknown (the accept-time check of consumer.ts and the before-turn check of
// intake-admission.ts bracket them; nothing else did).
describe("the sender's admission at the retry and the takeover", () => {
  test("#given a remote row deferred by a failed open #when the sweep retries it and the sender's admission answers unknown #then nothing opens, and it opens once the sender is admitted", async () => {
    let refuse = true
    let admission: IntakeAdmission = "admitted"
    const { h, fake, store, carrier, file, intakeRow } = await setup({
      remoteWake: () => true,
      admitIntake: async () => admission,
      openRefusal: () => (refuse ? { success: false, error: "host_stopping", errorCode: "host_stopping" } : undefined),
    })
    file("t")
    await intakeRow("t", "d-remote")
    expect(await carrier.wake("t")).toMatchObject({ kind: "deferred" })
    expect(sent(fake, "open_session")).toHaveLength(1)
    refuse = false
    admission = "unknown"
    const [row] = await store.woken.list()
    h.clock.now = (row?.next_attempt_at ?? h.clock.now) + 1
    await carrier.sweep()
    expect(sent(fake, "open_session")).toHaveLength(1)
    expect(await store.woken.list()).toMatchObject([{ durable_id: "t", state: "requested" }])
    admission = "admitted"
    const [again] = await store.woken.list()
    h.clock.now = (again?.next_attempt_at ?? h.clock.now) + 1
    await carrier.sweep()
    expect(sent(fake, "open_session")).toHaveLength(2)
    expect(sent(fake, "wake")).toHaveLength(1)
  })

  test("#given a carrier that died after opening for a remote row #when its successor sweeps past the lease and the sender's admission answers unknown #then nothing is reopened and the row ends, and a later admitted row opens again", async () => {
    let admission: IntakeAdmission = "admitted"
    const { h, fake, carrier, file, intakeRow, store } = await setup({
      remoteWake: () => true,
      admitIntake: async () => admission,
    })
    file("t")
    await intakeRow("t", "d-remote")
    expect(await carrier.wake("t")).toMatchObject({ kind: "open" })
    await carrier.stop()
    admission = "refused"
    h.clock.now += WAKE_LEASE_MS + 1
    await successorOf(h, fake, { remoteWake: () => true, admitIntake: async () => admission }).sweep()
    expect(sent(fake, "open_session")).toHaveLength(1)
    expect(await store.woken.list()).toEqual([])
    admission = "admitted"
    const successor = successorOf(h, fake, { remoteWake: () => true, admitIntake: async () => admission })
    expect(await successor.wake("t")).toMatchObject({ kind: "open" })
    expect(sent(fake, "open_session")).toHaveLength(2)
  })
})

// Review of #13220 (LOW) and A7.2.3 (A7R-10), one rule: a carrier opens a session only when the session holds a
// queued row whose own switch allows the open. A same-device row reads `session_wake.same_device` at the open; a row
// from another device reads the wake the consumer was told on its own connection.
describe("the switches at the open (A7.2.3)", () => {
  test("#given a same-device wake requested while the switch was on and then deferred #when the switch is off at the sweep #then nothing opens, and with the switch on again it opens", async () => {
    let on = true
    let refuse = true
    const { h, fake, store, carrier, path } = await setup({
      sameDevice: () => on,
      openRefusal: () => (refuse ? { success: false, error: "host_stopping", errorCode: "host_stopping" } : undefined),
    })
    path("t")
    expect(await carrier.wake("t")).toMatchObject({ kind: "deferred" })
    refuse = false
    on = false
    const [row] = await store.woken.list()
    h.clock.now = (row?.next_attempt_at ?? h.clock.now) + 1
    await carrier.sweep()
    expect(sent(fake, "open_session")).toHaveLength(1)
    expect(await store.woken.list()).toMatchObject([{ durable_id: "t", state: "requested" }])
    on = true
    await carrier.sweep()
    expect(sent(fake, "open_session")).toHaveLength(2)
    expect(sent(fake, "wake")).toHaveLength(1)
  })

  test.each([
    [false, false, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ])(
    "#given a session holding a row of each kind #when the wake is told %p and the same-device switch is %p #then an open happens: %p",
    async (wake, same, opens) => {
      const { fake, carrier, path, intakeRow } = await setup({ sameDevice: () => same, remoteWake: () => wake })
      path("t")
      await intakeRow("t", "d-remote")
      expect(await carrier.wake("t")).toMatchObject(opens ? { kind: "open" } : { kind: "switched_off" })
      expect(sent(fake, "open_session")).toHaveLength(opens ? 1 : 0)
    },
  )

  test("#given a session whose only row is from another device #when the consumer was told off #then nothing opens, the row stays queued, and it opens when the consumer is told on", async () => {
    let wake = false
    const { fake, store, carrier, intakeRow } = await setup({ sameDevice: () => false, remoteWake: () => wake })
    await intakeRow("t", "d-remote")
    expect(await carrier.wake("t")).toEqual({ kind: "switched_off" })
    expect(await store.list({ target_durable_id: "t" })).toMatchObject([{ state: "queued" }])
    expect(await store.woken.list()).toMatchObject([{ durable_id: "t", state: "requested" }])
    wake = true
    await carrier.sweep()
    expect(sent(fake, "open_session")).toHaveLength(1)
  })

  test("#given a wake that is told off while the session is being opened #when the open finishes #then the session is not killed and the row is carried", async () => {
    let wake = true
    const { fake, carrier, path, intakeRow } = await setup({
      sameDevice: () => false,
      remoteWake: () => wake,
      openRefusal: () => {
        wake = false
        return undefined
      },
    })
    path("t")
    await intakeRow("t", "d-remote")
    expect(await carrier.wake("t")).toMatchObject({ kind: "open" })
    expect(sent(fake, "wake")).toHaveLength(1)
  })

  test("#given a session with no queued row #when the sweep finds its requested record #then nothing opens and the record ends", async () => {
    const { fake, store, carrier, file } = await setup()
    const session = file("t")
    await store.woken.request({ durable_id: "t", session_file: session })
    await carrier.sweep()
    expect(sent(fake, "open_session")).toEqual([])
    expect(await store.woken.list()).toEqual([])
  })
})

function successorOf(
  h: GatewayHarness,
  fake: FakeEngineHost,
  options: { readonly sameDevice?: () => boolean; readonly remoteWake?: () => boolean; readonly admitIntake?: (device: string) => Promise<IntakeAdmission> } = {},
): Carrier {
  const successor = createCarrier({
    store: h.store(),
    sessionsDirectory: join(h.agentDir, "sessions"),
    ensureHost: async () => undefined,
    connect: () => connectCarrierHost({ socket: fake.socketPath, keyRoot: () => h.agentDir }),
    sameDevice: options.sameDevice ?? (() => true),
    ...(options.remoteWake === undefined ? {} : { remoteWake: options.remoteWake }),
    ...(options.admitIntake === undefined ? {} : { admitIntake: options.admitIntake }),
    schedule: () => () => undefined,
  })
  carriers.push(successor)
  return successor
}

describe("the bound on woken turns (A3.5.3)", () => {
  test("#given the default setting #when a session is woken many times #then nothing is refused", async () => {
    const { carrier, path } = await setup()
    path("s1")
    for (let round = 0; round < 6; round++) {
      expect(await carrier.wake("s1")).toMatchObject({ kind: "open" })
      expect(await carrier.evaluate("s1")).toEqual({ kind: "released" })
    }
  })

  test("#given the setting at 2 #when the third consecutive wake comes #then it is refused with the typed outcome and nothing opens", async () => {
    const { fake, carrier, path } = await setup({ wakeLimit: 2 })
    path("s1")
    for (let round = 0; round < 2; round++) {
      await carrier.wake("s1")
      await carrier.evaluate("s1")
    }
    const opens = sent(fake, "open_session").length
    expect(await carrier.wake("s1")).toEqual({ kind: "wake_limit_reached" })
    expect(sent(fake, "open_session")).toHaveLength(opens)
  })

  test("#given the setting at 2 #when a person's input moved the session's input revision between wakes #then the count starts again", async () => {
    const { fake, carrier, path } = await setup({ wakeLimit: 2 })
    path("s1")
    await carrier.wake("s1")
    await carrier.evaluate("s1")
    fake.setSnapshot(path("s1"), { ...FINISHED, lifecycle: { ...FINISHED.lifecycle, humanInputRevision: 7 } })
    await carrier.wake("s1")
    await carrier.evaluate("s1")
    expect(await carrier.wake("s1")).toMatchObject({ kind: "open" })
    await carrier.evaluate("s1")
    expect(await carrier.wake("s1")).toEqual({ kind: "wake_limit_reached" })
  })
})
