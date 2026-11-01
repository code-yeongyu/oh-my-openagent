import { expect, test } from "bun:test"
import { makeHandle } from "./__fixtures__/manager-fakes"
import { boundedProbeOutcome } from "./usage-limit-probe"
import { createProbeRequestSignal } from "../runners/probe-request"

test("the probe budget excludes spawn and context preparation and starts at the provider request", async () => {
  const fake = makeHandle("probe")
  const scheduled: Array<{ run: () => void; delay: number; cancelled: boolean }> = []
  let answered = 0
  const outcome = boundedProbeOutcome({
    handle: fake.handle,
    probe: { provider: "test", message: "Weekly usage limit reached", until: 999999 },
    model: "test/sibling",
    timeoutMs: 60_000,
    onAnswered: () => { answered += 1 },
    scheduleTimeout: (run, delay) => {
      const entry = { run, delay, cancelled: false }
      scheduled.push(entry)
      return { cancel: () => { entry.cancelled = true } }
    },
  })
  expect(scheduled).toHaveLength(0)
  fake.emit({ type: "agent_start" })
  expect(scheduled).toHaveLength(0)
  fake.emit({ type: "turn_start" })
  expect(scheduled).toHaveLength(0)
  fake.emit({ type: "extension_event", name: "omo.task.provider_request_started" } as never)
  fake.emit({ type: "turn_start" })
  expect(scheduled).toHaveLength(1)
  expect(scheduled[0]?.delay).toBe(60_000)
  fake.emit({ type: "message_update" })
  expect(answered).toBe(1)
  expect(scheduled[0]?.cancelled).toBe(true)
  fake.settle({ status: "completed", finalResponse: "done" })
  expect(await outcome).toEqual({ status: "completed", finalResponse: "done" })
})

test("a timed-out probe is explicitly non-limit evidence even when the original text names a reset", async () => {
  const fake = makeHandle("timeout")
  let expire: (() => void) | undefined
  const outcome = boundedProbeOutcome({
    handle: fake.handle,
    probe: { provider: "test", message: "Weekly usage limit reached. Resets at 2099-10-29T04:27:07Z", until: 999999 },
    model: "test/sibling", timeoutMs: 60_000, onAnswered: () => {},
    scheduleTimeout: (run) => { expire = run; return { cancel: () => {} } },
  })
  fake.emit({ type: "extension_event", name: "omo.task.provider_request_started" } as never)
  expect(expire).toBeDefined()
  expire?.()
  expect(await outcome).toMatchObject({ status: "error", failure: { kind: "child-unresponsive" } })
})

test("a request that preceded handle attachment retains its original deadline", async () => {
  const fake = makeHandle("early")
  let now = 1000
  const request = createProbeRequestSignal(() => now)
  request.started()
  now = 6000
  let delay: number | undefined
  const outcome = boundedProbeOutcome({
    handle: fake.handle,
    probe: { provider: "test", message: "Weekly usage limit reached", until: 999999 },
    model: "test/sibling", timeoutMs: 60_000, onAnswered: () => {},
    now: () => now, subscribeRequest: request.subscribe,
    scheduleTimeout: (_run, ms) => { delay = ms; return { cancel: () => {} } },
  })
  expect(delay).toBe(55_000)
  fake.settle({ status: "completed", finalResponse: "done" })
  expect(await outcome).toMatchObject({ status: "completed" })
})
