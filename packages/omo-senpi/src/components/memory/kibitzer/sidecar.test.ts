import { describe, expect, test } from "bun:test"

import type { RunnerOutcome } from "@oh-my-opencode/senpi-task"

import { OmoMemoryRecallSchema } from "@oh-my-opencode/omo-config-core"

import { resolveKibitzerSidecarSettings } from "./settings"
import { KIBITZER_RESEED_FRACTION, KIBITZER_SIDECAR_MAX_TOKENS, KIBITZER_WAKE_DEADLINE_MS, KIBITZER_WAKE_TOOL_BUDGET } from "./sidecar"
import { candidate, fakeChild, fakeWakeSlot, sidecarHarness, withinMs, type FakeChild, type SidecarHarness } from "./sidecar.test-support"

const K8S = "reference/kubernetes-rollouts.md"
const HELM = "reference/helm-values.md"
const ISTIO = "reference/istio-retries.md"
const HINT = "Drain nodes before a rollout."

const completed: RunnerOutcome = { status: "completed", finalResponse: "", model: "omo-mock/mock-1" }
const rateLimited: RunnerOutcome = {
  status: "error",
  failure: { kind: "child-turn-failed", message: "429 Too Many Requests: rate limit exceeded" },
  model: "omo-mock/mock-1",
}

/** Seeds the resident child with the first prompt and one candidate; returns the running child. */
async function seeded(harness: SidecarHarness, path = K8S): Promise<FakeChild> {
  harness.prompt(1, "how do we handle kubernetes rollouts")
  const result = await harness.offer([candidate(path)])
  expect(result).toEqual({ action: "seeded", wake: 1 })
  const child = harness.children[0]
  if (child === undefined) throw new Error("the seed did not start a child")
  return child
}

function cursorsOf(envelope: string): number[] {
  return [...envelope.matchAll(/<event cursor="(\d+)"/g)].map((match) => Number(match[1]))
}

function candidatePathsOf(envelope: string): string[] {
  return [...envelope.matchAll(/<candidate path="([^"]+)"/g)].map((match) => match[1] ?? "")
}

describe("KibitzerSidecar lifecycle", () => {
  test("#given a bound session #when fresh candidates arrive while the seed turn runs #then exactly one child exists and the running turn is steered", async () => {
    const harness = sidecarHarness()
    const child = await seeded(harness)

    expect(harness.sidecar.state()).toBe("turn_running")
    expect(child.input).toMatchObject({ sessionId: "parent-session-1", generation: 1, maxItems: 2 })
    expect(child.input.tools.map((tool) => tool.name)).toEqual(["nudge"])
    expect(child.input.prompt.startsWith("<kibitzer-seed ")).toBe(true)
    expect(child.input.prompt).toContain("<summary>how do we handle kubernetes rollouts</summary>")
    expect(cursorsOf(child.input.prompt)).toEqual([1])
    expect(candidatePathsOf(child.input.prompt)).toEqual([K8S])

    harness.toolCall(2)
    const second = await harness.offer([candidate(K8S), candidate(HELM)])

    expect(second).toEqual({ action: "steered", wake: 1 })
    expect(harness.children).toHaveLength(1)
    expect(child.steers).toHaveLength(1)
    expect(child.followUps).toHaveLength(0)
    const steer = child.steers[0] ?? ""
    expect(steer.startsWith("<kibitzer-wake ")).toBe(true)
    expect(cursorsOf(steer)).toEqual([2])
    // The path offered by the seed is not offered twice; only the new one wakes.
    expect(candidatePathsOf(steer)).toEqual([HELM])

    child.consume(steer)
    child.settle(completed)
    const outcome = await harness.nextWake()
    expect(outcome).toMatchObject({ wake: 1, generation: 1, status: "completed", steered: 1, nudges: [], toolCalls: 0, diagnostic: false, model: "omo-mock/mock-1" })
    expect(harness.sidecar.state()).toBe("idle")
    expect(child.disposed).toBe(false)
    // One wake, one machine-wide lease: taken before the seed, handed back at settlement.
    expect(harness.slot.acquisitions).toBe(1)
    expect(harness.slot.held()).toBe(0)
  })

  test("#given an idle resident child #when a fresh candidate arrives #then the child is revived through followUp and never recreated", async () => {
    const harness = sidecarHarness()
    const child = await seeded(harness)
    child.settle(completed)
    await harness.nextWake()
    expect(harness.sidecar.state()).toBe("idle")

    harness.toolCall(2, "grep", { pattern: "helm" })
    const result = await harness.offer([candidate(HELM)])

    expect(result).toEqual({ action: "followed_up", wake: 2 })
    expect(harness.children).toHaveLength(1)
    expect(child.turns).toBe(2)
    expect(child.steers).toHaveLength(0)
    expect(child.followUps).toHaveLength(1)
    expect(cursorsOf(child.followUps[0] ?? "")).toEqual([2])
    expect(candidatePathsOf(child.followUps[0] ?? "")).toEqual([HELM])
    expect(harness.sidecar.state()).toBe("turn_running")

    child.settle(completed)
    const outcome = await harness.nextWake()
    expect(outcome).toMatchObject({ wake: 2, generation: 1, status: "completed", steered: 0 })
  })

  test("#given events without a new candidate #when offered #then no model turn happens and the events keep buffering", async () => {
    const harness = sidecarHarness()
    const child = await seeded(harness)
    child.settle(completed)
    await harness.nextWake()
    harness.surfaced.add(ISTIO)

    harness.toolCall(2)
    harness.toolCall(3)
    // The same path again, plus one the surfaced ledger already holds: nothing new to judge.
    const result = await harness.offer([candidate(K8S), candidate(ISTIO)])

    expect(result).toEqual({ action: "buffered", reason: "no_new_candidate" })
    expect(child.turns).toBe(1)
    expect(child.steers).toHaveLength(0)
    expect(child.followUps).toHaveLength(0)
    expect(harness.children).toHaveLength(1)
    expect(harness.sidecar.events.size()).toBe(2)
    expect(harness.sidecar.state()).toBe("idle")

    // The buffered events ride along once something new appears.
    const woken = await harness.offer([candidate(HELM)])
    expect(woken).toEqual({ action: "followed_up", wake: 2 })
    expect(cursorsOf(child.followUps[0] ?? "")).toEqual([2, 3])
    expect(harness.sidecar.events.size()).toBe(0)
  })

  test("#given steers the turn never consumed #when the turn settles (settlement race) #then the late batches replay by cursor through one followUp", async () => {
    const harness = sidecarHarness()
    const child = await seeded(harness)

    harness.toolCall(2)
    expect(await harness.offer([candidate(HELM)])).toEqual({ action: "steered", wake: 1 })
    harness.toolCall(3)
    expect(await harness.offer([candidate(ISTIO)])).toEqual({ action: "steered", wake: 1 })
    expect(child.steers).toHaveLength(2)

    // The engine finished the turn before either steer reached the transcript.
    child.settle(completed)
    const first = await harness.nextWake()

    expect(first).toMatchObject({ wake: 1, status: "completed", steered: 2 })
    expect(harness.children).toHaveLength(1)
    expect(child.followUps).toHaveLength(1)
    expect(child.turns).toBe(2)
    const replay = child.followUps[0] ?? ""
    expect(replay.startsWith("<kibitzer-wake ")).toBe(true)
    expect(cursorsOf(replay)).toEqual([2, 3])
    expect(candidatePathsOf(replay)).toEqual([HELM, ISTIO])
    expect(harness.sidecar.state()).toBe("turn_running")

    child.settle(completed)
    const second = await harness.nextWake()
    expect(second).toMatchObject({ wake: 2, status: "completed", steered: 0 })
    expect(harness.sidecar.state()).toBe("idle")
  })

  test("#given a provider 429 #when the turn fails #then the sidecar backs off with jitter, disposes the child, and the buffered events survive into the next seed", async () => {
    const harness = sidecarHarness()
    const child = await seeded(harness)
    harness.toolCall(2)

    child.settle(rateLimited)
    const failed = await harness.nextWake()

    expect(failed).toMatchObject({ wake: 1, status: "failed", cause: "child_failed", diagnostic: true, nudges: [] })
    expect(failed.reason).toContain("429")
    expect(harness.sidecar.state()).toBe("backoff")
    expect(child.disposed).toBe(true)
    expect(harness.slot.held()).toBe(0)
    // attempt 0: cap 1s, jitter draw 0.5 -> 750ms, floored to the 1s minimum
    expect(harness.timers.pending().map((timer) => timer.ms)).toEqual([1_000])

    // During backoff nothing is created, and the candidates stay un-offered.
    harness.toolCall(3)
    expect(await harness.offer([candidate(HELM)])).toEqual({ action: "buffered", reason: "backoff" })
    expect(harness.children).toHaveLength(1)

    harness.timers.fire()
    expect(harness.sidecar.state()).toBe("idle")

    // Recreated lazily on the next offer: the failed wake's candidate is judged again, and every
    // event captured before and during the outage is still in the seed.
    const revived = await harness.offer([candidate(K8S), candidate(HELM)])
    expect(revived).toEqual({ action: "seeded", wake: 2 })
    expect(harness.children).toHaveLength(2)
    const replacement = harness.children[1]
    if (replacement === undefined) throw new Error("no replacement child")
    expect(replacement.input.generation).toBe(2)
    expect(replacement.input.prompt.startsWith("<kibitzer-seed ")).toBe(true)
    expect(cursorsOf(replacement.input.prompt)).toEqual([1, 2, 3])
    expect(candidatePathsOf(replacement.input.prompt)).toEqual([K8S, HELM])

    // A second consecutive failure doubles the band: cap 2s, draw 0.5 -> 1.5s.
    replacement.settle(rateLimited)
    await harness.nextWake()
    expect(harness.sidecar.state()).toBe("backoff")
    expect(harness.timers.pending().map((timer) => timer.ms)).toEqual([1_500])
  })

  test("#given a nudge accepted mid-turn #when the wake deadline fires (accepted nudge deadline) #then the turn is aborted, the nudge is still delivered, and the child stays resident", async () => {
    const harness = sidecarHarness()
    const child = await seeded(harness)
    expect(harness.timers.pending().map((timer) => timer.ms)).toEqual([KIBITZER_WAKE_DEADLINE_MS])

    const accepted = await child.nudge(K8S, HINT)
    expect(accepted.isError).not.toBe(true)

    harness.timers.fire()
    const outcome = await harness.nextWake()

    expect(child.aborts).toBe(1)
    expect(outcome).toMatchObject({ wake: 1, status: "deadline", diagnostic: false, toolCalls: 1, nudges: [{ path: K8S, hint: HINT }] })
    expect(harness.delivered).toEqual([[{ path: K8S, hint: HINT }]])
    expect(harness.sidecar.state()).toBe("idle")
    expect(child.disposed).toBe(false)
    expect(harness.timers.pending()).toEqual([])
    expect(harness.slot.held()).toBe(0)

    // The same child carries on; the delivered path is now surfaced and cannot wake again.
    harness.toolCall(2)
    expect(await harness.offer([candidate(K8S)])).toEqual({ action: "buffered", reason: "no_new_candidate" })
    expect(await harness.offer([candidate(HELM)])).toEqual({ action: "followed_up", wake: 2 })
    expect(harness.children).toHaveLength(1)
  })

  test("#given a running turn #when the session shuts down (shutdown during turn) #then the child is aborted, disposed, and never recreated", async () => {
    const harness = sidecarHarness()
    const child = await seeded(harness)
    await child.nudge(K8S, HINT)

    await withinMs(harness.sidecar.shutdown(), "shutdown")

    expect(child.aborts).toBe(1)
    expect(child.disposed).toBe(true)
    expect(harness.sidecar.state()).toBe("disposed")
    expect(harness.timers.pending()).toEqual([])
    expect(harness.slot.held()).toBe(0)
    // A session that is going away receives nothing.
    expect(harness.delivered).toEqual([])
    expect(harness.outcomes.map((outcome) => outcome.status)).toEqual(["cancelled"])

    harness.toolCall(2)
    expect(await harness.offer([candidate(HELM)])).toEqual({ action: "buffered", reason: "disposed" })
    expect(harness.children).toHaveLength(1)
    await withinMs(harness.sidecar.shutdown(), "second shutdown")
    expect(child.aborts).toBe(1)
  })

  test("#given the per-wake tool budget #when the eighth tool call ends #then the wake is aborted as tool_budget_exceeded, never as a failure", async () => {
    const harness = sidecarHarness()
    const child = await seeded(harness)
    expect(KIBITZER_WAKE_TOOL_BUDGET).toBe(8)

    for (let call = 1; call < KIBITZER_WAKE_TOOL_BUDGET; call += 1) {
      await child.nudge(`reference/unknown-${call}.md`, HINT)
    }
    expect(child.aborts).toBe(0)
    expect(harness.sidecar.state()).toBe("turn_running")

    await child.nudge(K8S, HINT)
    const outcome = await harness.nextWake()

    expect(child.aborts).toBe(1)
    expect(outcome).toMatchObject({ wake: 1, status: "tool_budget_exceeded", diagnostic: false, toolCalls: 8, nudges: [{ path: K8S, hint: HINT }] })
    expect(harness.delivered).toEqual([[{ path: K8S, hint: HINT }]])
    expect(harness.sidecar.state()).toBe("idle")
    expect(child.disposed).toBe(false)
    // No backoff timer, no diagnostic outcome: the budget is a bound, not a failure the gate should notice.
    expect(harness.timers.pending()).toEqual([])
    expect(harness.outcomes.filter((entry) => entry.diagnostic)).toEqual([])
    expect(harness.slot.held()).toBe(0)

    // The ninth call never reaches the child's tools as a counted call: the budget closure refuses it.
    const refused = await child.nudge(HELM, HINT)
    expect(refused.isError).toBe(true)
    expect(harness.sidecar.state()).toBe("idle")
  })

  test("#given the accepted-nudge cooldown #when two wakes deliver inside ten minutes #then a third fresh candidate buffers until the window slides, and empty wakes are never charged", async () => {
    const harness = sidecarHarness()
    const child = await seeded(harness)
    await child.nudge(K8S, HINT)
    child.settle(completed)
    expect((await harness.nextWake()).nudges).toHaveLength(1)

    // An empty wake: judged, nothing said, nothing charged.
    harness.clock.now += 60_000
    expect(await harness.offer([candidate(HELM)])).toEqual({ action: "followed_up", wake: 2 })
    child.settle(completed)
    expect((await harness.nextWake()).nudges).toHaveLength(0)

    harness.clock.now += 60_000
    expect(await harness.offer([candidate(ISTIO)])).toEqual({ action: "followed_up", wake: 3 })
    await child.nudge(ISTIO, "Retries are capped at three attempts.")
    child.settle(completed)
    expect((await harness.nextWake()).nudges).toHaveLength(1)
    expect(harness.delivered).toHaveLength(2)

    // Two accepted wakes inside the window: the fourth candidate waits without a model turn.
    harness.clock.now += 60_000
    expect(await harness.offer([candidate("reference/argo.md")])).toEqual({ action: "buffered", reason: "cooldown" })
    expect(child.turns).toBe(3)

    // Once the first charge leaves the ten-minute window the same candidate wakes.
    harness.clock.now = 1_000_000 + 600_001
    expect(await harness.offer([candidate("reference/argo.md")])).toEqual({ action: "followed_up", wake: 4 })
    expect(child.turns).toBe(4)
  })

  test("#given the context estimate crosses the reseed threshold #when the turn settles #then the child is disposed for reseed and the replacement seed carries delivered, rejected paths, and the last cursor", async () => {
    // 60% of 8_500 is 5_100: well above what four envelopes reach through the char/4 fallback, so only
    // provider usage can cross it.
    const harness = sidecarHarness({ sidecarMaxTokens: 8_500 })
    const child = await seeded(harness)
    // wake 1: K8S offered and nudged
    await child.nudge(K8S, HINT)
    child.settle(completed)
    await harness.nextWake()

    // wakes 2-4: HELM offered at wake 2 and never nudged through three wake opportunities
    harness.toolCall(2)
    expect(await harness.offer([candidate(HELM)])).toEqual({ action: "followed_up", wake: 2 })
    child.settle(completed)
    await harness.nextWake()
    harness.toolCall(3)
    expect(await harness.offer([candidate(ISTIO)])).toEqual({ action: "followed_up", wake: 3 })
    child.settle(completed)
    await harness.nextWake()
    harness.toolCall(4)
    expect(await harness.offer([candidate("reference/argo.md")])).toEqual({ action: "followed_up", wake: 4 })
    expect(harness.sidecar.state()).toBe("turn_running")
    child.emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "" }], usage: { input: 4_500, cacheRead: 600, output: 5 } } })
    child.settle(completed)
    const outcome = await harness.nextWake()

    expect(outcome).toMatchObject({ wake: 4, contextTokens: 5_100 })
    expect(harness.sidecar.state()).toBe("reseeding")
    expect(child.disposed).toBe(true)
    expect(harness.children).toHaveLength(1)

    // Recreated lazily on the next wake-eligible offer with reseed state ahead of the batch.
    harness.toolCall(5)
    expect(await harness.offer([candidate("reference/flux.md")])).toEqual({ action: "seeded", wake: 5 })
    const replacement = harness.children[1]
    if (replacement === undefined) throw new Error("no replacement child")
    expect(replacement.input.generation).toBe(2)
    const prompt = replacement.input.prompt
    expect(prompt.startsWith("<kibitzer-reseed ")).toBe(true)
    expect(prompt).toContain(' cursor="4"')
    expect(prompt).toContain(`<delivered count="1" omitted="0">\n<path>${K8S}</path>`)
    expect(prompt).toContain(`<rejected count="1" omitted="0">\n<path>${HELM}</path>`)
    expect(prompt).toContain("<kibitzer-wake ")
    expect(cursorsOf(prompt)).toEqual([5])
    expect(candidatePathsOf(prompt)).toEqual(["reference/flux.md"])
    expect(harness.sidecar.state()).toBe("turn_running")
  })

  test("#given a child whose start is still in flight #when a hook event is captured before startChild resolves #then the event is not drained unread: it rides the next wake", async () => {
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    const started: FakeChild[] = []
    const harness = sidecarHarness({
      startChild: async (input) => {
        const child = fakeChild(input)
        started.push(child)
        entered.resolve()
        await gate.promise
        return child.handle
      },
    })
    harness.prompt(1, "how do we handle kubernetes rollouts")

    const seeding = harness.offer([candidate(K8S)])
    await withinMs(entered.promise, "startChild to be entered")
    // The parent does not pause while its child boots: this hook lands after the seed's payload was
    // built and before the child exists.
    harness.toolCall(2, "grep", { pattern: "rollout" })
    gate.resolve()
    expect(await seeding).toEqual({ action: "seeded", wake: 1 })

    const child = started[0]
    if (child === undefined) throw new Error("the seed did not start a child")
    expect(cursorsOf(child.input.prompt)).toEqual([1])
    expect(harness.sidecar.events.lastCursor()).toBe(2)

    // Too late for the seed, so it must reach the child with the next wake.
    harness.toolCall(3)
    expect(await harness.offer([candidate(HELM)])).toEqual({ action: "steered", wake: 1 })
    expect(cursorsOf(child.steers[0] ?? "")).toEqual([2, 3])
    expect(harness.sidecar.events.size()).toBe(0)
  })

  test("#given a child that cannot be started #when offered #then the start failure enters backoff without a child, the offer is buffered, and the retry seed carries every event and candidate", async () => {
    const started: FakeChild[] = []
    let attempts = 0
    const harness = sidecarHarness({
      startChild: async (input) => {
        attempts += 1
        if (attempts === 1) throw new Error("quick category unavailable")
        const child = fakeChild(input)
        started.push(child)
        return child.handle
      },
    })
    harness.prompt(1, "how do we handle kubernetes rollouts")

    const result = await harness.offer([candidate(K8S)])

    expect(result).toEqual({ action: "buffered", reason: "backoff" })
    expect(harness.outcomes.map((outcome) => [outcome.status, outcome.cause])).toEqual([["failed", "start_failed"]])
    expect(harness.sidecar.state()).toBe("backoff")
    expect(harness.timers.pending().map((timer) => timer.ms)).toEqual([1_000])
    // The lease taken for the wake that never started is handed back before the backoff begins.
    expect(harness.slot.acquisitions).toBe(1)
    expect(harness.slot.held()).toBe(0)

    // Nothing the failed wake was handed is lost: the retry seed carries the event captured before
    // the failure, the one captured during the backoff, and the candidate that was never offered.
    harness.toolCall(2)
    harness.timers.fire()
    expect(harness.sidecar.state()).toBe("idle")
    expect(await harness.offer([candidate(K8S)])).toEqual({ action: "seeded", wake: 2 })
    const retry = started[0]
    if (retry === undefined) throw new Error("the retry did not start a child")
    expect(retry.input.generation).toBe(1)
    expect(cursorsOf(retry.input.prompt)).toEqual([1, 2])
    expect(candidatePathsOf(retry.input.prompt)).toEqual([K8S])
    expect(harness.sidecar.events.size()).toBe(0)
  })
})

describe("KibitzerSidecar wake governance", () => {
  test("#given every machine slot held for five minutes (five minute slot outage) #when hooks keep arriving #then every offer buffers as slot_busy without a child, a timer, or a background retry, and the first admitted wake carries every event", async () => {
    const harness = sidecarHarness()
    harness.slot.busy = true
    harness.prompt(1, "how do we handle kubernetes rollouts")

    // Thirty hooks ten seconds apart: a five-minute outage seen from one session.
    for (let cursor = 2; cursor <= 31; cursor += 1) {
      harness.toolCall(cursor)
      expect(await harness.offer([candidate(`reference/topic-${cursor}.md`)])).toEqual({ action: "buffered", reason: "slot_busy" })
      harness.clock.now += 10_000
    }

    expect(harness.children).toHaveLength(0)
    expect(harness.sidecar.state()).toBe("idle")
    // One bounded attempt per hook, nothing scheduled in between: the sidecar never polls the slot on its own.
    expect(harness.slot.attempts).toBe(30)
    expect(harness.slot.acquisitions).toBe(0)
    expect(harness.timers.pending()).toEqual([])
    expect(harness.outcomes).toEqual([])
    // 31 events captured; the newest 20 stay whole and the 11 older ones are folded, not dropped.
    expect(harness.sidecar.events.size()).toBe(20)
    expect(harness.sidecar.events.lastCursor()).toBe(31)

    harness.slot.busy = false
    harness.toolCall(32)
    expect(await harness.offer([candidate(K8S)])).toEqual({ action: "seeded", wake: 1 })
    const child = harness.children[0]
    if (child === undefined) throw new Error("the admitted wake did not start a child")
    expect(harness.slot.acquisitions).toBe(1)
    expect(harness.slot.held()).toBe(1)
    expect(child.input.prompt).toContain('<digest cursor-from="1" cursor-to="12" folded="12">')
    expect(cursorsOf(child.input.prompt)).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32])
    expect(candidatePathsOf(child.input.prompt)).toEqual([K8S])
    child.settle(completed)
    await harness.nextWake()
    expect(harness.slot.held()).toBe(0)
  })

  test("#given a wake parked on the machine-wide lease #when the session shuts down #then the wait is abandoned, no child is started and nothing is held", async () => {
    const harness = sidecarHarness()
    harness.slot.parked = true
    harness.prompt(1, "how do we handle kubernetes rollouts")

    const offer = harness.offer([candidate(K8S)])
    await withinMs(harness.sidecar.shutdown(), "shutdown during the slot wait")

    expect(await withinMs(offer, "the abandoned offer")).toEqual({ action: "buffered", reason: "disposed" })
    expect(harness.children).toHaveLength(0)
    expect(harness.sidecar.state()).toBe("disposed")
    expect(harness.slot.acquisitions).toBe(0)
    expect(harness.slot.held()).toBe(0)
    expect(harness.outcomes).toEqual([])
  })

  test("#given a lease that cannot be taken at all #when a wake is attempted #then it is a start failure with bounded backoff, never a spin", async () => {
    const slot = fakeWakeSlot()
    slot.acquire = async () => {
      throw new Error("EACCES: locks directory is read-only")
    }
    const harness = sidecarHarness({ wakeSlot: slot })
    harness.prompt(1, "how do we handle kubernetes rollouts")

    expect(await harness.offer([candidate(K8S)])).toEqual({ action: "buffered", reason: "backoff" })

    expect(harness.children).toHaveLength(0)
    expect(harness.sidecar.state()).toBe("backoff")
    expect(harness.outcomes).toHaveLength(1)
    expect(harness.outcomes[0]).toMatchObject({ status: "failed", cause: "start_failed", diagnostic: true })
    expect(harness.outcomes[0]?.reason).toContain("EACCES")
    expect(harness.timers.pending().map((timer) => timer.ms)).toEqual([1_000])
    expect(harness.sidecar.events.size()).toBe(1)
  })

  test("#given the configured recall settings #when the sidecar is built from them #then tool_budget, event_caps and sidecar_max_tokens govern the wake instead of the defaults", async () => {
    const settings = resolveKibitzerSidecarSettings(OmoMemoryRecallSchema.parse({
      category: "deep",
      tool_budget: 3,
      sidecar_max_tokens: 500,
      max_concurrent_wakes: 1,
      event_caps: { tool_args: 400, result_head: 600, assistant: 1500, prompt: 12 },
    }))
    expect(settings).toEqual({
      category: "deep",
      toolBudget: 3,
      sidecarMaxTokens: 500,
      maxConcurrentWakes: 1,
      eventCaps: { toolArgs: 400, resultHead: 600, assistant: 1500, prompt: 12 },
    })
    const harness = sidecarHarness({ toolBudget: settings.toolBudget, sidecarMaxTokens: settings.sidecarMaxTokens, eventCaps: settings.eventCaps })
    harness.prompt(1, "how do we handle kubernetes rollouts")
    expect(await harness.offer([candidate(K8S)])).toEqual({ action: "seeded", wake: 1 })
    const child = harness.children[0]
    if (child === undefined) throw new Error("the seed did not start a child")

    // event_caps.prompt: the prompt event body is cut at 12 characters before it reaches the envelope.
    expect(child.input.prompt).toContain('<event cursor="1" kind="prompt">\n<text>how do we ha</text>\n</event>')
    expect(child.input.prompt).not.toContain("kubernetes rollouts</text>")
    // tool_budget: the third call ends the wake as tool_budget_exceeded, still not a failure.
    await child.nudge("reference/unknown-1.md", HINT)
    await child.nudge("reference/unknown-2.md", HINT)
    expect(child.aborts).toBe(0)
    await child.nudge(K8S, HINT)
    const outcome = await harness.nextWake()
    expect(outcome).toMatchObject({ status: "tool_budget_exceeded", toolCalls: 3, diagnostic: false, nudges: [{ path: K8S, hint: HINT }] })
    // sidecar_max_tokens: with no provider usage the char/4 fallback (the seed alone is well over 1_200
    // characters) already exceeds 60% of 500 tokens, so the child is replaced before its next turn.
    expect(outcome.contextTokens).toBe(Math.ceil(child.input.prompt.length / 4))
    expect(outcome.contextTokens ?? 0).toBeGreaterThanOrEqual(Math.floor(500 * KIBITZER_RESEED_FRACTION))
    expect(harness.sidecar.state()).toBe("reseeding")
    expect(child.disposed).toBe(true)
  })

  test("#given provider usage climbing toward the context window #when it reaches 60% #then the child is reseeded at the threshold and not one token earlier", async () => {
    expect(KIBITZER_SIDECAR_MAX_TOKENS).toBe(48_000)
    expect(KIBITZER_RESEED_FRACTION).toBe(0.6)
    const harness = sidecarHarness({ sidecarMaxTokens: 10_000 })
    const child = await seeded(harness)

    // 5_999 of 10_000: below the line, the child stays resident.
    child.emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "" }], usage: { input: 5_000, cacheRead: 999, output: 5 } } })
    child.settle(completed)
    expect(await harness.nextWake()).toMatchObject({ wake: 1, contextTokens: 5_999 })
    expect(harness.sidecar.state()).toBe("idle")
    expect(child.disposed).toBe(false)

    // 6_000 of 10_000: exactly 60%, the wake settles and the child is replaced before the next turn.
    harness.toolCall(2)
    expect(await harness.offer([candidate(HELM)])).toEqual({ action: "followed_up", wake: 2 })
    child.emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "" }], usage: { input: 5_400, cacheRead: 600, output: 5 } } })
    child.settle(completed)
    expect(await harness.nextWake()).toMatchObject({ wake: 2, contextTokens: 6_000 })
    expect(harness.sidecar.state()).toBe("reseeding")
    expect(child.disposed).toBe(true)
    expect(harness.slot.held()).toBe(0)

    harness.toolCall(3)
    expect(await harness.offer([candidate(ISTIO)])).toEqual({ action: "seeded", wake: 3 })
    expect(harness.children[1]?.input.prompt.startsWith("<kibitzer-reseed ")).toBe(true)
  })
})
