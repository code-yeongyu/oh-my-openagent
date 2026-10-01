import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ROOT_LIFETIME_MS } from "./constants"
import type { GatewayDeliverRequest } from "./engine"
import { gatewayInboxDirectory } from "./paths"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import type { GatewayDeliveryResult } from "./types"

let harness: GatewayHarness | undefined

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function open(): GatewayHarness {
  harness = createGatewayHarness()
  return harness
}

type SendOptions = Omit<GatewayDeliverRequest, "sender" | "target" | "text"> & { readonly turn_id?: string; readonly cause_delivery_id?: string }

function send(h: GatewayHarness, from: string, to: string, text: string, options: SendOptions = {}): Promise<GatewayDeliveryResult> {
  const { turn_id, cause_delivery_id, ...rest } = options
  return h.get(from).engine.deliver({
    sender: { kind: "session", durable_id: from, ...(turn_id === undefined ? {} : { turn_id }), ...(cause_delivery_id === undefined ? {} : { cause_delivery_id }) },
    target: to,
    text,
    ...rest,
  })
}

function okId(result: GatewayDeliveryResult): string {
  if (result.kind !== "ok") throw new Error(`expected ok, got ${JSON.stringify(result)}`)
  return result.delivery_id
}

function summary(result: GatewayDeliveryResult): string {
  return result.kind === "ok" ? result.delivery.kind : `error:${result.error.code}`
}

async function stateOf(h: GatewayHarness, id: string): Promise<string | null> {
  return (await h.get("A").store.deliveryView(id))?.row.state ?? null
}

describe("all_fifteen_delivery_state_cases", () => {
  test("#given a target in each runtime state #when A sends with each mode #then the sender sees the table's outcome and the row lands in the matching state", async () => {
    const h = open()
    h.session("A")
    const expected: Record<string, readonly [string, string | null]> = {
      "idle/auto": ["started", "applied"], "idle/steer": ["error:not_steerable", "refused"], "idle/follow_up": ["started", "applied"],
      "mid_turn/auto": ["queued", "admitted"], "mid_turn/steer": ["steered", "admitted"], "mid_turn/follow_up": ["queued", "admitted"],
      "waiting_question/auto": ["queued", "admitted"], "waiting_question/steer": ["error:not_steerable", "refused"], "waiting_question/follow_up": ["queued", "admitted"],
      "compacting/auto": ["queued", "admitted"], "compacting/steer": ["error:not_steerable", "refused"], "compacting/follow_up": ["queued", "admitted"],
      "offline/auto": ["queued_offline", "queued"], "offline/steer": ["error:turn_conflict", null], "offline/follow_up": ["queued_offline", "queued"],
    }
    const observed: Record<string, readonly [string, string | null]> = {}
    for (const state of ["idle", "mid_turn", "waiting_question", "compacting", "offline"] as const) {
      for (const mode of ["auto", "steer", "follow_up"] as const) {
        const id = `T-${state}-${mode}`.replace(/_/g, "-")
        const target = h.session(id, { online: state !== "offline" })
        if (state !== "idle" && state !== "offline") target.runtime.beginUserTurn()
        if (state === "waiting_question" || state === "compacting") target.runtime.phaseValue = state
        const result = await send(h, "A", id, `cell ${state}/${mode}`, { mode, ...(mode === "steer" ? { expected_turn_id: target.runtime.epoch } : {}) })
        await h.quiesce()
        const rows = await target.store.list({ target_durable_id: id })
        observed[`${state}/${mode}`] = [summary(result), rows[0]?.state ?? null]
      }
    }
    expect(observed).toEqual(expected)
  })
})

describe("turn_epoch_cas_and_fifo", () => {
  test("#given a mid-turn target #when a steer names the previous epoch #then it is refused turn_conflict and nothing is enqueued", async () => {
    const h = open()
    h.session("A")
    const b = h.session("B")
    b.runtime.beginUserTurn()
    b.runtime.beginUserTurn()
    const result = await send(h, "A", "B", "stale", { mode: "steer", expected_turn_id: b.runtime.epoch - 1 })
    expect(summary(result)).toBe("error:turn_conflict")
    expect(b.runtime.enqueueCalls).toEqual([])
  })

  test("#given a draft holds the head #when two messages queue behind it and the user submits #then they are admitted in send order and none overtakes the head", async () => {
    const h = open()
    h.session("A")
    const b = h.session("B")
    b.runtime.typeDraft()
    const first = okId(await send(h, "A", "B", "first"))
    const second = okId(await send(h, "A", "B", "second"))
    expect(b.runtime.enqueueCalls).toEqual([])
    expect(await stateOf(h, first)).toBe("queued")
    expect(await stateOf(h, second)).toBe("queued")
    b.runtime.submitDraft()
    await b.drain.drain({ reason: "submission" })
    expect(b.runtime.enqueueCalls.map((call) => call.delivery_id)).toEqual([first, second])
    b.runtime.endTurn()
    await h.quiesce()
    expect([await stateOf(h, first), await stateOf(h, second)]).toEqual(["applied", "applied"])
  })

  test("#given an explicit steer held by a draft #when the turn it named ends before the draft clears #then it is refused, never moved into the next turn", async () => {
    const h = open()
    h.session("A")
    const b = h.session("B")
    b.runtime.beginUserTurn()
    b.runtime.typeDraft()
    const steer = okId(await send(h, "A", "B", "steer me", { mode: "steer", expected_turn_id: b.runtime.epoch }))
    expect(await stateOf(h, steer)).toBe("queued")
    b.runtime.endTurn()
    b.runtime.beginUserTurn()
    b.runtime.clearDraft()
    await b.drain.drain({ reason: "draft_cleared" })
    const row = (await b.store.deliveryView(steer))?.row
    expect({ state: row?.state, reason: row?.reason, enqueued: b.runtime.enqueueCount(steer) }).toEqual({ state: "refused", reason: "turn_conflict", enqueued: 0 })
  })
})

describe("repeated_wake_during_streaming", () => {
  test("#given B streams #when M1 is queued and three more wakes arrive before the turn ends #then the follow-up is enqueued once and applied once, after it is emitted", async () => {
    const h = open()
    h.session("A")
    const b = h.session("B")
    b.runtime.beginUserTurn()
    const result = await send(h, "A", "B", "M1", { mode: "auto" })
    expect(summary(result)).toBe("queued")
    const m1 = okId(result)
    for (let wake = 0; wake < 3; wake++) await b.drain.drain({ reason: "command" })
    expect(await stateOf(h, m1)).toBe("admitted")
    expect(b.runtime.enqueueCount(m1)).toBe(1)
    b.runtime.endTurn()
    await h.quiesce()
    expect({ state: await stateOf(h, m1), enqueued: b.runtime.enqueueCount(m1), entries: b.runtime.transcriptEntries(m1) }).toEqual({ state: "applied", enqueued: 1, entries: 1 })
  })
})

describe("repeated_wake_during_pending_steer", () => {
  test("#given B is paused before its next tool boundary #when M2 is steered and three full reconcile passes run #then the steer is enqueued once, stays admitted, and is applied once at message_end", async () => {
    const h = open()
    h.session("A")
    const b = h.session("B")
    b.runtime.beginUserTurn()
    const result = await send(h, "A", "B", "M2", { mode: "steer", expected_turn_id: b.runtime.epoch })
    expect(summary(result)).toBe("steered")
    const m2 = okId(result)
    expect(b.runtime.listAdmittedDeliveries()).toEqual({ pending: [m2], emitted: [] })
    for (let wake = 0; wake < 3; wake++) await b.drain.drain({ reason: "command" })
    expect({ state: await stateOf(h, m2), enqueued: b.runtime.enqueueCount(m2) }).toEqual({ state: "admitted", enqueued: 1 })
    b.runtime.toolBoundary()
    await h.quiesce()
    expect({ state: await stateOf(h, m2), entries: b.runtime.transcriptEntries(m2) }).toEqual({ state: "applied", entries: 1 })
  })
})

describe("lost_ack_and_durable_recovery", () => {
  test("#given a completed delivery #when the same key is retried with the same and with different arguments #then it replays once and conflicts once", async () => {
    const h = open()
    h.session("A")
    h.session("B")
    const first = await send(h, "A", "B", "hello", { idempotency_key: "k1" })
    const again = await send(h, "A", "B", "hello", { idempotency_key: "k1" })
    const changed = await send(h, "A", "B", "hello!", { idempotency_key: "k1" })
    expect(again).toEqual({ ...(first as Extract<GatewayDeliveryResult, { kind: "ok" }>), deduplicated: true })
    expect(summary(changed)).toBe("error:idempotency_conflict")
    expect(await h.get("B").store.list({ target_durable_id: "B" })).toHaveLength(1)
  })

  test("#given the sender dies after COMMIT and before its receipt completes #when another process retries #then an unadmitted row answers idempotency_uncertain forever and an admitted one replays its outcome", async () => {
    const h = open()
    h.session("A")
    const b = h.session("B", { online: false })
    const crashing = h.engineFor(h.store({ _test: { afterDbCommit: "throw" } }))
    const retrying = h.engineFor(h.store())
    const request = (key: string): GatewayDeliverRequest => ({ sender: { kind: "session", durable_id: "A" }, target: "B", text: `lost ${key}`, idempotency_key: key })

    await expect(crashing.deliver(request("unadmitted"))).rejects.toThrow("gateway test hook afterDbCommit")
    const uncertain = await retrying.deliver(request("unadmitted"))
    expect(summary(uncertain)).toBe("error:idempotency_uncertain")

    await expect(crashing.deliver(request("admitted"))).rejects.toThrow("gateway test hook afterDbCommit")
    b.online = true
    await b.drain.drain({ reason: "start" })
    await h.quiesce()
    const replayed = await retrying.deliver(request("admitted"))
    expect(replayed.kind === "ok" && { delivery: replayed.delivery.kind, deduplicated: replayed.deduplicated }).toEqual({ delivery: "queued", deduplicated: true })

    const stillUncertain = await retrying.deliver(request("unadmitted"))
    expect(summary(stillUncertain)).toBe("error:idempotency_uncertain")
    const rows = await b.store.list({ target_durable_id: "B" })
    expect(rows.map((row) => row.body)).toEqual(["lost unadmitted", "lost admitted"])
    expect(rows.every((row) => b.runtime.transcriptEntries(row.delivery_id) <= 1)).toBe(true)
  })

  test("#given three deliveries queued for an offline target #when every store is closed and a fresh process drains #then they are admitted in their original order", async () => {
    const h = open()
    h.session("A")
    h.session("B", { online: false })
    const ids = [okId(await send(h, "A", "B", "one")), okId(await send(h, "A", "B", "two")), okId(await send(h, "A", "B", "three"))]
    await h.get("A").store.dispose()
    await h.get("B").store.dispose()
    const reopened = h.session("B2")
    const { createInboxDrain } = await import("./drain")
    const drain = createInboxDrain({ store: h.store(), runtime: reopened.runtime, durableId: "B", sessionPath: () => reopened.runtime.sessionPath })
    reopened.runtime.beginUserTurn()
    await drain.drain({ reason: "start" })
    expect(reopened.runtime.enqueueCalls.map((call) => call.delivery_id)).toEqual(ids)
  })
})

describe("causal_cycle_hop_rate_and_fanout_budgets", () => {
  test("#given A->B->C under one root #when C sends back to A #then it is loop_detected and A receives nothing from C", async () => {
    const h = open()
    for (const id of ["A", "B", "C"]) h.session(id)
    const ab = okId(await send(h, "A", "B", "to B"))
    await h.quiesce()
    const bc = okId(await send(h, "B", "C", "to C", { cause_delivery_id: ab }))
    await h.quiesce()
    const ca = await send(h, "C", "A", "back to A", { cause_delivery_id: bc })
    expect(ca.kind === "error" && { code: ca.error.code, guard: ca.error.details?.guard }).toEqual({ code: "loop_detected", guard: "cycle" })
    expect(await h.get("A").store.list({ target_durable_id: "A" })).toEqual([])
    const self = await send(h, "A", "A", "me")
    expect(self.kind === "error" && self.error.details?.guard).toBe("self_send")
  })

  test("#given P and Q under one root #when P->Q and Q->P are sent concurrently from two processes #then exactly one is accepted", async () => {
    const h = open()
    for (const id of ["W", "X", "P", "Q"]) h.session(id)
    const wx = okId(await send(h, "W", "X", "seed"))
    await h.quiesce()
    const xp = okId(await send(h, "X", "P", "p", { cause_delivery_id: wx, turn_id: "x1" }))
    const xq = okId(await send(h, "X", "Q", "q", { cause_delivery_id: wx, turn_id: "x1" }))
    await h.quiesce()
    const results = await Promise.all([send(h, "P", "Q", "p->q", { cause_delivery_id: xp }), send(h, "Q", "P", "q->p", { cause_delivery_id: xq })])
    expect(results.map(summary).toSorted()).toEqual(["error:loop_detected", "queued"])
  })

  test("#given a chain of fresh sessions #when each forwards what it received #then hop 4 is accepted and hop 5 is refused", async () => {
    const h = open()
    for (let index = 0; index <= 5; index++) h.session(`H${index}`)
    let cause: string | undefined
    for (let hop = 1; hop <= 4; hop++) {
      cause = okId(await send(h, `H${hop - 1}`, `H${hop}`, `hop ${hop}`, cause === undefined ? {} : { cause_delivery_id: cause }))
      await h.quiesce()
    }
    const fifth = await send(h, "H4", "H5", "hop 5", { cause_delivery_id: cause })
    expect(fifth.kind === "error" && { code: fifth.error.code, guard: fifth.error.details?.guard }).toEqual({ code: "loop_detected", guard: "hop_limit" })
  })

  test("#given one sender turn #when it reaches a 17th distinct session #then that send is refused while a second send to a known target passes", async () => {
    const h = open()
    h.session("F")
    for (let index = 1; index <= 17; index++) h.phantom(`G${index}`)
    const results: string[] = []
    for (let index = 1; index <= 17; index++) results.push(summary(await send(h, "F", `G${index}`, "fan", { turn_id: "turn-1" })))
    expect(results.slice(0, 16).every((result) => result === "queued_offline")).toBe(true)
    expect(results[16]).toBe("error:overloaded")
    expect(summary(await send(h, "F", "G1", "again", { turn_id: "turn-1" }))).toBe("queued_offline")
  })

  test("#given a pair bucket of 8 #when a 9th send follows at once, a retry replays, and 5 s pass #then the 9th is refused, the retry costs nothing, and one token refills", async () => {
    const h = open()
    h.session("R")
    h.phantom("S")
    for (let index = 1; index <= 8; index++) expect(summary(await send(h, "R", "S", `m${index}`, { idempotency_key: `r${index}` }))).toBe("queued_offline")
    const ninth = await send(h, "R", "S", "m9", { idempotency_key: "r9" })
    expect(ninth.kind === "error" && { code: ninth.error.code, budget: ninth.error.details?.budget }).toEqual({ code: "overloaded", budget: "pair_rate" })
    const retry = await send(h, "R", "S", "m3", { idempotency_key: "r3" })
    expect(retry.kind === "ok" && retry.deduplicated).toBe(true)
    h.clock.now += 5_000
    expect(summary(await send(h, "R", "S", "m9", { idempotency_key: "r9" }))).toBe("queued_offline")
    expect(summary(await send(h, "R", "S", "m10", { idempotency_key: "r10" }))).toBe("error:overloaded")
  })

  test("#given roots are minted by the gateway #when a caller names its own root, continues a delivery it never received, or continues past the root lifetime #then each is refused", async () => {
    const h = open()
    for (const id of ["A", "B", "C"]) h.session(id)
    const forged = await send(h, "A", "B", "x", { root_id: "root-mine" })
    expect(forged.kind === "error" && forged.error.details?.guard).toBe("forged_root")
    const ab = okId(await send(h, "A", "B", "to B"))
    const stolen = await send(h, "C", "A", "not mine", { cause_delivery_id: ab })
    expect(stolen.kind === "error" && stolen.error.details?.guard).toBe("unknown_cause")
    await h.quiesce()
    h.clock.now += ROOT_LIFETIME_MS + 1
    const late = await send(h, "B", "C", "too late", { cause_delivery_id: ab })
    expect(late.kind === "error" && late.error.details?.guard).toBe("root_expired")
  })

  test("#given one root #when a session keeps fanning out under it across turns #then the 64th delivery of the root is refused", async () => {
    const h = open()
    h.session("A")
    h.session("F")
    const seed = okId(await send(h, "A", "F", "seed"))
    await h.quiesce()
    const outcomes: string[] = []
    for (let index = 0; index < 64; index++) {
      h.phantom(`N${index}`)
      outcomes.push(summary(await send(h, "F", `N${index}`, "fan", { cause_delivery_id: seed, turn_id: `t${Math.floor(index / 16)}` })))
    }
    expect(outcomes.filter((outcome) => outcome === "queued_offline")).toHaveLength(63)
    expect(outcomes[63]).toBe("error:loop_detected")
    // 65 sequential fsync'd (`synchronous=FULL`) transactions: measured 5.2-5.3 s at load ~370 and
    // 8.8-13.7 s at load ~450 on a heavily loaded 14-core host, so bun's 5 s default cannot hold it.
  }, 60_000)
})

describe("workspace_scope", () => {
  test("#given two git repositories #when a session sends across them #then it is scope_denied without all_scope and accepted with it", async () => {
    const h = open()
    const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-gateway-scope-")))
    try {
      const env = { ...process.env, HOME: root, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }
      const repos = ["one", "two"].map((name) => {
        const repo = join(root, name)
        mkdirSync(repo)
        execFileSync("git", ["-c", "core.hooksPath=/dev/null", "init", "-q", repo], { env, windowsHide: true })
        return repo
      })
      h.session("A", { cwd: repos[0] })
      h.session("B", { cwd: repos[1] })
      expect(summary(await send(h, "A", "B", "cross"))).toBe("error:scope_denied")
      expect(summary(await send(h, "A", "B", "cross", { all_scope: true }))).toBe("started")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("cli_sender_principal", () => {
  test("#given a bindingless CLI send #when it lands #then the row carries the cli origin and principal and the target sees an external provenance header", async () => {
    const h = open()
    const b = h.session("B")
    const cli = h.engineFor(h.store())
    const result = await cli.deliver({ sender: { kind: "cli", uid: 501, user: "tester" }, target: "B", text: "from the shell" })
    const id = okId(result)
    await h.quiesce()
    const row = (await b.store.deliveryView(id))?.row
    expect({ sender: row?.sender, origin: row?.envelope.origin }).toEqual({
      sender: "cli:501",
      origin: { external: { platform: "cli", account_id: "tester", chat_id: "@cli", thread_id: "@chat", message_id: id } },
    })
    const text = b.runtime.textOf(id) ?? ""
    expect(text.split("\n")[0]).toContain("source=external")
    expect(text.split("\n")[2]).toBe(JSON.stringify("from the shell"))
  })
})

describe("held_draft_quiescence", () => {
  test("#given the receiver holds a draft #when a delivery arrives and inbox wakes repeat #then the drain writes nothing and keeps the marker until the user submits", async () => {
    const h = open()
    h.session("A")
    const b = h.session("B")
    b.runtime.typeDraft()
    const id = okId(await send(h, "A", "B", "later"))
    const marker = join(gatewayInboxDirectory(h.agentDir, "B"), id)
    const before = await b.store.stats()
    await b.drain.drain({ reason: "inbox" })
    await b.drain.drain({ reason: "inbox" })
    const after = await b.store.stats()
    const row = (await b.store.deliveryView(id))?.row
    expect({ writes: after.writes - before.writes, marker: existsSync(marker), state: row?.state, attempt: row?.attempt }).toEqual({ writes: 0, marker: true, state: "queued", attempt: 0 })
    b.runtime.submitDraft()
    await b.drain.drain({ reason: "submission" })
    b.runtime.endTurn()
    await h.quiesce()
    expect({ state: (await b.store.deliveryView(id))?.row.state, marker: existsSync(marker), entries: b.runtime.transcriptEntries(id) }).toEqual({ state: "applied", marker: false, entries: 1 })
  })
})
