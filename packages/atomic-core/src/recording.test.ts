import { expect, test } from "bun:test"

import { createReplaySpawn, exited } from "./__fixtures__/replay-spawn"
import { createAtomicClient } from "./client"
import { AtomicError } from "./errors"
import { createAtomicRecordingCoordinator, type AtomicRecordingLock } from "./recording"
import { type AtomicRecordingSession, resolveAtomicRecordingOwner } from "./recording-session"

const session = {
  sessionId: "session",
  generation: 1,
  agent: "opencode",
  cwd: "/checkout/subdir",
  checkout: "/checkout",
  repository: "/checkout",
  owner: "omo",
  timeoutMs: 1000,
} satisfies AtomicRecordingSession
const base = { agent: "opencode", payload: { session_id: session.sessionId }, turnId: "turn-a" } as const

function setup(acquireLock: AtomicRecordingLock = async () => () => {}, output = exited("")) {
  const replay = createReplaySpawn(() => output)
  const client = createAtomicClient({
    executable: "atomic",
    environment: {},
    version: { major: 0, minor: 22, patch: 1, text: "0.22.1" },
    spawn: replay.spawn,
  })
  const invalidations: string[] = []
  const warnings: unknown[] = []
  const coordinator = createAtomicRecordingCoordinator({
    client,
    acquireLock,
    invalidateContext: (repository) => invalidations.push(repository),
    warn: ({ error }) => warnings.push(error),
  })
  return { coordinator, requests: replay.requests, invalidations, warnings }
}

test.each([
  ["none", "omo", "omo", "unavailable"],
  ["one", "external", "conflict", "external"],
  ["ambiguous", "unavailable", "conflict", "unavailable"],
] as const)("classifies %s active recorders according to each explicit preference", (inventory, auto, omo, external) => {
  // given the effective registration inventory, when each preference is resolved
  const owners = (["auto", "omo", "external"] as const).map((mode) => resolveAtomicRecordingOwner(mode, inventory))
  // then
  expect(owners).toEqual([auto, omo, external])
})

test("deduplicates native dispatch and keeps out-of-order results incomplete", async () => {
  // given
  const { coordinator, requests, invalidations } = setup()
  coordinator.open(session)
  // when
  coordinator.enqueue(session, { ...base, verb: "session-start" })
  coordinator.enqueue(session, { ...base, verb: "session-start" })
  coordinator.enqueue(session, { ...base, verb: "user-prompt" })
  coordinator.enqueue(session, { ...base, verb: "stop", synthetic: true })
  const orphan = coordinator.enqueue(session, { ...base, verb: "after-tool", toolCallId: "orphan" })
  coordinator.enqueue(session, { ...base, verb: "before-tool", toolCallId: "orphan" })
  coordinator.enqueue(session, { ...base, verb: "after-tool", toolCallId: "orphan" })
  coordinator.enqueue(session, { ...base, verb: "before-tool", toolCallId: "internal", internal: true })
  const missing = coordinator.enqueue(session, { ...base, verb: "before-tool" })
  coordinator.enqueue(session, { ...base, verb: "stop" })
  coordinator.enqueue(session, { ...base, verb: "stop" })
  const remaining = await coordinator.drain()
  // then: the pinned protocol sees the result but not an invented call or a second stop
  expect([orphan, missing]).toEqual(["incomplete", "degraded"])
  expect(coordinator.correlation(session)).toBe("degraded")
  expect(requests.map(({ args }) => args[3])).toEqual(["session-start", "user-prompt", "after-tool", "stop"])
  expect(invalidations).toEqual([session.repository])
  expect(remaining).toEqual([])
})

test("ignores late results from retired generations without reactivating them", async () => {
  // given
  const { coordinator, requests } = setup()
  const next = { ...session, generation: 2 }
  coordinator.open(session)
  coordinator.enqueue(session, { ...base, verb: "session-start" })
  coordinator.enqueue(session, { ...base, verb: "user-prompt" })
  coordinator.enqueue(session, { ...base, verb: "session-end" })
  // when
  coordinator.open(next)
  coordinator.enqueue(next, { ...base, verb: "session-start" })
  coordinator.enqueue(next, { ...base, verb: "user-prompt" })
  const reopened = coordinator.open(session)
  coordinator.enqueue(session, { ...base, verb: "after-tool", toolCallId: "late" })
  coordinator.enqueue(next, { ...base, verb: "stop" })
  await coordinator.drain()
  // then
  expect(reopened).toBe(false)
  expect(requests.map(({ args }) => args[3])).toEqual([
    "session-start", "user-prompt", "session-end", "session-start", "user-prompt", "stop",
  ])
})

test("external ownership makes no lock acquisitions or recording spawns", async () => {
  // given
  let locks = 0
  const { coordinator, requests } = setup(async () => { locks += 1; return () => {} })
  coordinator.open({ ...session, owner: "external" })
  // when
  coordinator.enqueue(session, { ...base, verb: "session-start" })
  coordinator.enqueue(session, { ...base, verb: "user-prompt" })
  coordinator.enqueue(session, { ...base, verb: "stop" })
  await coordinator.drain()
  // then
  expect([locks, requests.length]).toEqual([0, 0])
})

const lockTimeout = () => new AtomicError("lock_timeout", { operation: "recording lock", sideEffectsPossible: false })

test("a two-second lock timeout keeps the head ahead of later events", async () => {
  // given
  const acquisitions: { checkout: string; timeoutMs: number }[] = []
  const { coordinator, requests } = setup(async ({ checkout, timeoutMs }) => {
    acquisitions.push({ checkout, timeoutMs })
    if (acquisitions.length === 1) throw lockTimeout()
    return () => {}
  })
  coordinator.open(session)
  // when
  coordinator.enqueue(session, { ...base, verb: "session-start" })
  coordinator.enqueue(session, { ...base, verb: "user-prompt" })
  await coordinator.drain()
  // then
  expect(acquisitions).toEqual(Array.from({ length: 3 }, () => ({ checkout: session.checkout, timeoutMs: 2000 })))
  expect(requests.map(({ args }) => args[3])).toEqual(["session-start", "user-prompt"])
})

test("a bounded drain hands off queued work while a checkout stays locked", async () => {
  // given
  const { coordinator, requests } = setup(async () => { throw lockTimeout() })
  coordinator.open(session)
  // when
  coordinator.enqueue(session, { ...base, verb: "session-start" })
  const remaining = await coordinator.drain(10)
  // then
  expect(remaining.map(({ event, state }) => [event.verb, state])).toEqual([["session-start", "queued"]])
  expect(requests).toHaveLength(0)
})

test("recording errors mark the repository unhealthy and warn once without a manual fallback", async () => {
  // given
  const { coordinator, requests, warnings, invalidations } = setup(undefined, exited("", 4, "hook failed"))
  coordinator.open(session)
  // when
  coordinator.enqueue(session, { ...base, verb: "session-start" })
  coordinator.enqueue(session, { ...base, verb: "user-prompt" })
  coordinator.enqueue(session, { ...base, verb: "stop" })
  await coordinator.drain()
  // then
  expect(coordinator.failure(session.repository)?.error).toMatchObject({ code: "command_failed" })
  expect(warnings).toHaveLength(1)
  expect(invalidations).toEqual([])
  expect(requests.map(({ args }) => args.slice(0, 2))).toEqual(Array.from({ length: 3 }, () => ["agent", "hooks"]))
})
