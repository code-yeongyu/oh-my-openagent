import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { EndpointLiveness, GatewayEndpointPort } from "./adapter"
import { SESSION_CONTROL_DELIVERY_TYPE } from "./constants"
import type { InboxDrainOptions } from "./drain"
import { createGatewayEngine, resolveFromEntries, type GatewayAddressEntry, type GatewayEngine } from "./engine"
import { gatewayInboxDirectory } from "./paths"
import { processStartTime } from "./process-identity"
import { createControlEndpointRegistrant, type ControlEndpointRegistrant, type SenpiDrainResult, type SenpiWakeEvent, type SessionControlActionsPort } from "./registration"
import { createGatewayStore, type GatewayStore } from "./store"
import { FakeSessionRuntime } from "./testing/fake-runtime"
import type { DeliveryRow, DeliveryState, GatewayDeliveryResult, ProcessIdentity } from "./types"

type Reason = "idle" | "submission" | "draft_cleared" | "command" | "inbox" | "emitted" | "continue"
const REASON_PRIORITY: readonly Reason[] = ["submission", "draft_cleared", "idle", "continue", "command", "emitted", "inbox"]

/**
 * `pi.session` of one terminal, mirroring senpi's `session-control-wake.ts` / `-lifecycle.ts`: one
 * drain pass at a time, edges arriving during a pass coalesced into exactly one more, a first
 * `inbox` pass right after registration, idle / emitted edges from the runtime, and the clean-exit
 * question `isSessionReferenced` asked when the registration is disposed. `crash()` is the process
 * dying: no edge reaches the drain again.
 */
class FakeSessionControl implements SessionControlActionsPort {
  readonly passes: Reason[] = []
  readonly errors: string[] = []
  persisted = 0
  referencedAtExit: boolean | undefined
  private drainFn: ((event: SenpiWakeEvent) => Promise<SenpiDrainResult>) | undefined
  private crashed = false
  private running = false
  private next: { reasons: Set<Reason>; ids: Set<string>; waiters: Array<(result: SenpiDrainResult) => void> } | undefined
  private idleWaiters: Array<() => void> = []

  constructor(readonly runtime: FakeSessionRuntime) {
    runtime.onEmitted(() => void this.wake("emitted"))
    runtime.onIdle(() => void this.wake("idle"))
  }

  readonly registerControlEndpoint: SessionControlActionsPort["registerControlEndpoint"] = async (options) => {
    mkdirSync(options.inboxDir, { recursive: true, mode: 0o700 })
    this.drainFn = options.drain
    void this.wake("inbox")
    return {
      status: "registered",
      socket: "fake:tui",
      dispose: async () => {
        await this.settled()
        this.drainFn = undefined
        this.referencedAtExit = await options.isSessionReferenced()
      },
    }
  }

  readonly admissionGate: SessionControlActionsPort["admissionGate"] = () => this.runtime.admissionGate()
  readonly admitExternalMessage: SessionControlActionsPort["admitExternalMessage"] = (input) => this.runtime.admitExternalMessage(input)
  readonly listAdmittedDeliveries: SessionControlActionsPort["listAdmittedDeliveries"] = () => this.runtime.listAdmittedDeliveries()
  readonly persistHeaderNow: SessionControlActionsPort["persistHeaderNow"] = async () => {
    this.persisted += 1
  }

  crash(): void {
    this.crashed = true
    this.drainFn = undefined
  }

  submit(): void {
    this.runtime.submitDraft()
    void this.wake("submission")
  }

  wake(reason: Reason, ids: readonly string[] = []): Promise<SenpiDrainResult> {
    if (this.crashed || this.drainFn === undefined) return Promise.resolve({ admitted: [] })
    this.next ??= { reasons: new Set(), ids: new Set(), waiters: [] }
    const batch = this.next
    batch.reasons.add(reason)
    for (const id of ids) batch.ids.add(id)
    const settled = new Promise<SenpiDrainResult>((resolve) => batch.waiters.push(resolve))
    if (!this.running) void this.run()
    return settled
  }

  /** Resolves once no pass is running and none is queued: the edge-driven system is quiescent. */
  settled(): Promise<void> {
    if (!this.running && this.next === undefined) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  private async run(): Promise<void> {
    this.running = true
    try {
      for (let batch = this.next; batch !== undefined; batch = this.next) {
        this.next = undefined
        const reasons = REASON_PRIORITY.filter((candidate) => batch.reasons.has(candidate))
        const reason = reasons[0] ?? "inbox"
        this.passes.push(reason)
        let result: SenpiDrainResult = { admitted: [] }
        const drain = this.drainFn
        if (drain !== undefined && !this.crashed) {
          try {
            result = await drain({ type: "session_control_wake", reason, reasons, ...(batch.ids.size > 0 ? { delivery_ids: [...batch.ids] } : {}) })
          } catch (error) {
            this.errors.push(error instanceof Error ? error.message : String(error))
          }
        }
        for (const waiter of batch.waiters) waiter(result)
      }
    } finally {
      this.running = false
      for (const waiter of this.idleWaiters.splice(0)) waiter()
    }
  }
}

type World = {
  readonly agentDir: string
  readonly clock: { now: number }
  readonly sessionPath: string
  readonly liveness: { value: EndpointLiveness }
  readonly released: string[]
  readonly engine: GatewayEngine
  readonly senderStore: GatewayStore
  readonly process: (options?: { readonly reopen?: boolean; readonly drain?: Pick<InboxDrainOptions, "_test"> }) => Promise<Proc>
  readonly current: () => Proc | undefined
}

type Proc = {
  readonly runtime: FakeSessionRuntime
  readonly control: FakeSessionControl
  readonly store: GatewayStore
  readonly registrant: ControlEndpointRegistrant
}

const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
})

async function world(): Promise<World> {
  const agentDir = realpathSync(mkdtempSync(join(tmpdir(), "omo-inbox-drain-")))
  disposers.push(async () => rmSync(agentDir, { recursive: true, force: true }))
  mkdirSync(join(agentDir, "sessions"), { recursive: true })
  const clock = { now: Date.UTC(2026, 8, 29, 1, 0, 0) }
  const now = () => clock.now
  const sessionPath = join(agentDir, "sessions", "B.jsonl")
  const liveness = { value: "dead" as EndpointLiveness }
  const released: string[] = []
  let proc: Proc | undefined

  const entries = (): readonly GatewayAddressEntry[] => [{
    thread_id: "B",
    name: "b-terminal",
    status: liveness.value === "routable" ? "live" : "resumable",
    cwd: agentDir,
    created_at: new Date(clock.now).toISOString(),
    updated_at: new Date(clock.now).toISOString(),
    endpoint: { kind: "tui", socket: "fake:tui", routing_id: "B" },
    liveness: liveness.value,
  }]
  const endpoints: GatewayEndpointPort = {
    wake: async (_endpoint, deliveryIds) => {
      if (proc === undefined || liveness.value !== "routable") throw new Error("the terminal did not answer")
      return await proc.control.wake("command", deliveryIds)
    },
    releaseSession: async (endpoint) => {
      released.push(endpoint.socket)
      throw new Error("a terminal is never released")
    },
  }
  const senderStore = createGatewayStore({ agentDir, now })
  disposers.push(() => senderStore.dispose())
  const engine = createGatewayEngine({ store: senderStore, endpoints, resolve: resolveFromEntries(entries, () => agentDir), now })

  const process: World["process"] = async (options = {}) => {
    const runtime = new FakeSessionRuntime(sessionPath, "B", agentDir, { reopen: options.reopen === true })
    const control = new FakeSessionControl(runtime)
    const store = createGatewayStore({ agentDir, now })
    disposers.push(() => store.dispose())
    const registrant = createControlEndpointRegistrant({ control, agentDir: () => agentDir, _test: { store, drain: { now, ...(options.drain ?? {}) } } })
    const outcome = await registrant.start({ durableId: "B", sessionPath: () => sessionPath, isIdle: () => runtime.phaseValue === "idle" })
    expect(outcome).toEqual({ status: "registered", socket: "fake:tui" })
    await control.settled()
    proc = { runtime, control, store, registrant }
    liveness.value = "routable"
    return proc
  }
  return { agentDir, clock, sessionPath, liveness, released, engine, senderStore, process, current: () => proc }
}

function okId(result: GatewayDeliveryResult): string {
  if (result.kind !== "ok") throw new Error(`expected ok, got ${JSON.stringify(result)}`)
  return result.delivery_id
}

async function send(w: World, text: string): Promise<GatewayDeliveryResult> {
  return await w.engine.deliver({ sender: { kind: "session", durable_id: "A" }, target: "B", text })
}

async function stateOf(store: GatewayStore, id: string): Promise<DeliveryState | undefined> {
  return (await store.deliveryView(id))?.row.state
}

function tokensOnDisk(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type?: string; customType?: string; details?: { delivery_id?: string } })
    .flatMap((entry) => (entry.type === "custom_message" && entry.customType === SESSION_CONTROL_DELIVERY_TYPE && typeof entry.details?.delivery_id === "string" ? [entry.details.delivery_id] : []))
}

function markerExists(w: World, id: string): boolean {
  return existsSync(join(gatewayInboxDirectory(w.agentDir, "B"), id))
}

async function deadIdentity(): Promise<ProcessIdentity> {
  const child = Bun.spawn(["cat"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
  const startTime = await processStartTime(child.pid)
  child.stdin.end()
  await child.exited
  if (startTime === null) throw new Error("could not read the holder's start time")
  return { pid: child.pid, process_start_time: startTime, instance_id: randomUUID() }
}

describe("session inbox drain through the control endpoint registrant", () => {
  test("#given an idle terminal #when three deliveries arrive #then they are applied in seq order, one transcript entry each, with no user input and no timer", async () => {
    // given
    const w = await world()
    const b = await w.process()

    // when
    const ids = [okId(await send(w, "one")), okId(await send(w, "two")), okId(await send(w, "three"))]
    b.runtime.endTurn()
    await b.control.settled()
    b.runtime.endTurn()
    await b.control.settled()

    // then
    expect(tokensOnDisk(w.sessionPath)).toEqual(ids)
    expect(await Promise.all(ids.map((id) => stateOf(w.senderStore, id)))).toEqual(["applied", "applied", "applied"])
    expect(b.control.persisted).toBe(1)
  })

  test("#given an idle terminal #when one delivery arrives #then the wake round-trip starts it and the emitted edge alone makes it applied", async () => {
    const w = await world()
    const b = await w.process()
    const result = await send(w, "hello idle")
    await b.control.settled()
    expect(result).toMatchObject({ kind: "ok", delivery: { kind: "started" }, endpoint_kind: "tui" })
    const id = okId(result)
    expect({ state: await stateOf(w.senderStore, id), tokens: tokensOnDisk(w.sessionPath) }).toEqual({ state: "applied", tokens: [id] })
  })

  test("#given the user is composing a draft #when a delivery arrives, inbox wakes repeat and then the user presses Enter #then nothing is written while held, the draft runs first and the delivery is applied exactly once after it", async () => {
    // given
    const w = await world()
    const b = await w.process()
    b.runtime.typeDraft()

    // when
    const result = await send(w, "while you type")
    const id = okId(result)
    const before = await b.store.stats()
    await b.control.wake("inbox")
    await b.control.wake("inbox")
    const during = await b.store.stats()
    const heldState = await stateOf(b.store, id)
    const heldMarker = markerExists(w, id)
    b.control.submit()
    await b.control.settled()
    b.runtime.endTurn()
    await b.control.settled()

    // then
    expect(result).toMatchObject({ kind: "ok", delivery: { kind: "queued" } })
    expect({ writes: during.writes - before.writes, state: heldState, marker: heldMarker }).toEqual({ writes: 0, state: "queued", marker: true })
    expect(await stateOf(b.store, id)).toBe("applied")
    expect(markerExists(w, id)).toBe(false)
    const lines = readFileSync(w.sessionPath, "utf8").split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as { type: string; message?: { role?: string } })
    const draftAt = lines.findIndex((line) => line.type === "message" && line.message?.role === "user")
    const deliveryAt = lines.findIndex((line) => line.type === "custom_message")
    expect(draftAt).toBeGreaterThan(0)
    expect(deliveryAt).toBeGreaterThan(draftAt)
    expect(tokensOnDisk(w.sessionPath)).toEqual([id])
    expect(b.runtime.enqueueCount(id)).toBe(1)
  })

  test("#given a turn is running #when a delivery arrives and three more wakes come before the turn ends #then it is admitted once into the follow-up queue and applied only once its entry is written", async () => {
    const w = await world()
    const b = await w.process()
    b.runtime.beginUserTurn()
    const id = okId(await send(w, "after this turn"))
    for (let index = 0; index < 3; index++) await b.control.wake("inbox")
    const midTurn = await stateOf(b.store, id)
    b.runtime.endTurn()
    await b.control.settled()
    expect({ midTurn, final: await stateOf(b.store, id), enqueued: b.runtime.enqueueCount(id), tokens: tokensOnDisk(w.sessionPath) }).toEqual({ midTurn: "admitted", final: "applied", enqueued: 1, tokens: [id] })
  })

  test("#given the terminal is not running #when a delivery is sent and the session is resumed later #then it is queued_offline first and the resumed session drains it once", async () => {
    const w = await world()
    const result = await send(w, "for later")
    const id = okId(result)
    expect(result).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
    expect(markerExists(w, id)).toBe(true)
    const b = await w.process()
    await b.control.settled()
    expect({ state: await stateOf(b.store, id), tokens: tokensOnDisk(w.sessionPath), marker: markerExists(w, id) }).toEqual({ state: "applied", tokens: [id], marker: false })
  })

  test("#given a stopped (SIGSTOPped) terminal #when a delivery is sent and the terminal continues #then it is queued_offline with its row committed, and the continue edge alone applies it once with no second send", async () => {
    const w = await world()
    const b = await w.process()
    w.liveness.value = "live_unresponsive"
    const result = await send(w, "while stopped")
    const id = okId(result)
    expect(result).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
    expect(await stateOf(b.store, id)).toBe("queued")
    w.liveness.value = "routable"
    await b.control.wake("continue")
    await b.control.settled()
    expect({ state: await stateOf(b.store, id), tokens: tokensOnDisk(w.sessionPath), released: w.released }).toEqual({ state: "applied", tokens: [id], released: [] })
  })

  test("#given a sender that committed and died before its wake #when only the inbox marker's edge reaches the terminal #then the delivery is applied once", async () => {
    const w = await world()
    const b = await w.process()
    w.liveness.value = "dead"
    const id = okId(await send(w, "orphaned wake"))
    w.liveness.value = "routable"
    expect(markerExists(w, id)).toBe(true)
    await b.control.wake("inbox")
    await b.control.settled()
    expect({ state: await stateOf(b.store, id), tokens: tokensOnDisk(w.sessionPath) }).toEqual({ state: "applied", tokens: [id] })
  })

  test("#given a live_unresponsive (suspended or remote) terminal #when deliveries are sent to it #then it is never released or reopened elsewhere, and its queued message is applied once after it answers again", async () => {
    const w = await world()
    const b = await w.process()
    w.liveness.value = "live_unresponsive"
    const id = okId(await send(w, "suspended"))
    expect(w.released).toEqual([])
    expect(b.runtime.enqueueCount(id)).toBe(0)
    w.liveness.value = "routable"
    await b.control.wake("continue")
    await b.control.settled()
    expect({ state: await stateOf(b.store, id), enqueued: b.runtime.enqueueCount(id), tokens: tokensOnDisk(w.sessionPath), released: w.released }).toEqual({ state: "applied", enqueued: 1, tokens: [id], released: [] })
  })

  test("#given a fresh session holding only its header and a draft #when a delivery is held and the user exits without submitting, then reopens the same session #then the file is kept (referenced) and the reopened session applies the delivery once under the same durable id", async () => {
    // given
    const w = await world()
    const first = await w.process()
    first.runtime.typeDraft()
    const id = okId(await send(w, "held across exit"))

    // when
    await first.registrant.stop()
    w.liveness.value = "dead"
    const reopened = await w.process({ reopen: true })

    // then
    expect(first.control.referencedAtExit).toBe(true)
    expect(JSON.parse(readFileSync(w.sessionPath, "utf8").split("\n")[0] ?? "{}")).toMatchObject({ type: "session", id: "B" })
    expect({ state: await stateOf(reopened.store, id), tokens: tokensOnDisk(w.sessionPath), enqueued: reopened.runtime.enqueueCount(id) }).toEqual({ state: "applied", tokens: [id], enqueued: 1 })
  })

  describe("crash between the two phases, then a fresh process for the same durable id", () => {
    type Fault = "after_claim" | "after_start" | "after_start_header_only" | "after_mid_turn_queue"

    async function crashThenResume(fault: Fault) {
      const w = await world()
      const dead = await deadIdentity()
      let victim: Proc | undefined
      const crash = (): never => {
        victim?.control.crash()
        throw new Error(`simulated crash ${fault}`)
      }
      victim = await w.process({
        drain: {
          _test: {
            identity: dead,
            ...(fault === "after_claim" ? { afterClaim: (_row: DeliveryRow) => crash() } : { afterAdmit: (_row: DeliveryRow, _kind: string) => crash() }),
          },
        },
      })
      if (fault === "after_start") appendFileSync(w.sessionPath, `${JSON.stringify({ type: "message", message: { role: "assistant", content: "earlier answer" } })}\n`)
      if (fault === "after_mid_turn_queue") victim.runtime.beginUserTurn()
      const id = okId(await send(w, `fault ${fault}`))
      await victim.control.settled()
      const crashedState = await stateOf(w.senderStore, id)
      const tokensAtCrash = tokensOnDisk(w.sessionPath)
      w.liveness.value = "dead"
      const fresh = await w.process({ reopen: true })
      if (fault === "after_mid_turn_queue") {
        fresh.runtime.endTurn()
        await fresh.control.settled()
      }
      return { id, crashedState, tokensAtCrash, victim, fresh, sessionPath: w.sessionPath, store: fresh.store }
    }

    test("#given a crash after T1 and before the runtime call #when a fresh process registers #then the row is re-admitted exactly once", async () => {
      const run = await crashThenResume("after_claim")
      expect({ crashed: run.crashedState, victimEnqueued: run.victim.runtime.enqueueCount(run.id), freshEnqueued: run.fresh.runtime.enqueueCount(run.id) }).toEqual({ crashed: "admitting", victimEnqueued: 0, freshEnqueued: 1 })
      expect(tokensOnDisk(run.sessionPath)).toEqual([run.id])
    })

    test("#given a crash after the runtime started the turn and wrote the entry, on a session that already had an assistant message #when a fresh process registers #then the disk token makes it applied and it is not re-admitted", async () => {
      const run = await crashThenResume("after_start")
      expect({ crashed: run.crashedState, atCrash: run.tokensAtCrash, final: await stateOf(run.store, run.id), freshEnqueued: run.fresh.runtime.enqueueCount(run.id), tokens: tokensOnDisk(run.sessionPath) }).toEqual({ crashed: "admitting", atCrash: [run.id], final: "applied", freshEnqueued: 0, tokens: [run.id] })
    })

    test("#given the same crash on a fresh session holding only its header #when a fresh process registers under the same durable id #then the row is applied and not re-admitted", async () => {
      const run = await crashThenResume("after_start_header_only")
      const header = JSON.parse(readFileSync(run.sessionPath, "utf8").split("\n")[0] ?? "{}") as { id?: string }
      expect({ header: header.id, final: await stateOf(run.store, run.id), freshEnqueued: run.fresh.runtime.enqueueCount(run.id), tokens: tokensOnDisk(run.sessionPath) }).toEqual({ header: "B", final: "applied", freshEnqueued: 0, tokens: [run.id] })
    })

    test("#given a crash after a mid-turn queued admission the runtime never wrote #when a fresh process registers #then the dead claimant's row goes back to queued and is admitted exactly once", async () => {
      const run = await crashThenResume("after_mid_turn_queue")
      expect({ crashed: run.crashedState, atCrash: run.tokensAtCrash, freshEnqueued: run.fresh.runtime.enqueueCount(run.id), final: await stateOf(run.store, run.id), tokens: tokensOnDisk(run.sessionPath) }).toEqual({ crashed: "admitting", atCrash: [], freshEnqueued: 1, final: "applied", tokens: [run.id] })
    })
  })

  test("#given a registered session #when session_start fires again for the same durable id and then the registrant stops #then it registers once and later edges reach nothing", async () => {
    const w = await world()
    const b = await w.process()
    const again = await b.registrant.start({ durableId: "B", sessionPath: () => w.sessionPath, isIdle: () => true })
    await b.registrant.stop()
    const after = await b.control.wake("command", ["nothing"])
    expect({ again, persisted: b.control.persisted, after }).toEqual({ again: { status: "already_registered" }, persisted: 1, after: { admitted: [] } })
  })
})
