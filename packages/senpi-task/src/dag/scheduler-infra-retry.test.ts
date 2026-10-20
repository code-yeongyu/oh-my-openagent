import { afterEach, expect, test } from "bun:test"
import { dagNode, infraFixture, infrastructureFailure, success, RetryClock } from "./infra-retry-fixture"
import { createDagScheduler } from "./scheduler"
import { RunnerError } from "../runners/in-process/runner-error"

const fixtures: ReturnType<typeof infraFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

test("retries seven infrastructure-failed roots before skipping their 54 dependents", async () => {
  // Given seven first-wave failures and the production incident's dependent count.
  const roots = Array.from({ length: 7 }, (_, index) => `root-${index}`)
  const dependents = Array.from({ length: 54 }, (_, index) => dagNode(`dependent-${index}`, roots))
  const fixture = infraFixture((name, attempt) =>
    roots.includes(name) && attempt === 1 ? infrastructureFailure() : success())
  fixtures.push(fixture)
  const scheduler = await fixture.scheduler([...roots.map((id) => dagNode(id)), ...dependents])

  // When the real scheduler folds the real task manager's typed infrastructure outcomes.
  const result = await scheduler.run()

  // Then every root is retried and every dependent executes.
  expect(result.status).toBe("completed")
  expect(result.nodes.filter((node) => node.state === "completed")).toHaveLength(61)
  expect(roots.map((id) => fixture.starts.get(id))).toEqual(Array(7).fill(2))
  const events = fixture.store.readEvents(result.runId, 0, { limit: 1000 }).events
  const retries = events.filter((event) => event.type === "dag.node.retried")
  expect(retries).toHaveLength(7)
  expect(retries.map((event) => event.automatic?.attempt)).toEqual(Array(7).fill(1))
  expect(result.diagnostics.filter((diagnostic) => diagnostic.kind === "node_flag")).toHaveLength(7)
  // 61 real task-manager runs on a file store: ~3 s alone, past bun's 5 s default when the host is loaded.
}, 30_000)

test("exhausts two infrastructure retries and skips only that root's descendants", async () => {
  // Given a broken branch and an independent branch, with a controlled backoff clock.
  const clock = new RetryClock()
  const fixture = infraFixture((name) => name === "broken" ? infrastructureFailure() : success(), clock.schedule, clock.now)
  fixtures.push(fixture)
  const scheduler = await fixture.scheduler([
    dagNode("broken"), dagNode("child", ["broken"]), dagNode("grandchild", ["child"]),
    dagNode("independent"), dagNode("independent-child", ["independent"]),
  ])
  const first = clock.whenScheduled(1)
  // When each infrastructure attempt fails and the injected timers fire.
  const running = scheduler.run()
  await first
  expect(fixture.starts.get("broken")).toBe(1)
  expect(scheduler.snapshot().nodes.some((node) => node.state === "skipped")).toBe(false)
  const second = clock.whenScheduled(2)
  clock.advance()
  await second
  expect(fixture.starts.get("broken")).toBe(2)
  clock.advance()
  const result = await running
  // Then the initial attempt plus two retries fail, without skipping unrelated work.
  expect(result.status).toBe("failed")
  expect(fixture.starts.get("broken")).toBe(3)
  expect(clock.delays).toEqual([1000, 2000])
  expect(result.nodes.filter((node) => node.state === "skipped").map((node) => String(node.id))).toEqual(["child", "grandchild"])
  expect(result.nodes.filter((node) => node.state === "completed")).toHaveLength(2)
  const retries = fixture.store.readEvents(result.runId, 0, { limit: 1000 }).events
    .filter((event) => event.type === "dag.node.retried")
  expect(retries.map((event) => event.automatic?.attempt)).toEqual([1, 2])
})

test("does not retry task failures even when their message describes a heartbeat", async () => {
  // Given an ordinary child work failure with misleading infrastructure words.
  const fixture = infraFixture(() => ({
    status: "error",
    failure: { kind: "child-turn-failed", message: "child-unresponsive: host disconnected after 3 heartbeats" },
  }))
  fixtures.push(fixture)
  const scheduler = await fixture.scheduler([dagNode("work"), dagNode("child", ["work"])])
  // When the task fails.
  const result = await scheduler.run()
  // Then today's failure and cascade behavior is unchanged.
  expect(fixture.starts.get("work")).toBe(1)
  expect(result.nodes.map((node) => node.state)).toEqual(["failed", "skipped"])
  expect(result.nodes[0]?.error?.code).toBe("task_error")
})

test("does not retry a user-cancelled child", async () => {
  // Given a child that reports explicit cancellation.
  const fixture = infraFixture(() => ({ status: "cancelled" }))
  fixtures.push(fixture)
  const scheduler = await fixture.scheduler([dagNode("work"), dagNode("child", ["work"])])
  // When the cancellation settles through the manager.
  const result = await scheduler.run()
  // Then the existing task_cancelled outcome remains, without another start.
  expect(fixture.starts.get("work")).toBe(1)
  expect(result.nodes[0]?.error?.code).toBe("task_cancelled")
  expect(result.nodes[1]?.state).toBe("skipped")
})

test("cancels a run during infrastructure backoff without launching the retry", async () => {
  // Given a failed child waiting on its first backoff.
  const clock = new RetryClock()
  const fixture = infraFixture(infrastructureFailure, clock.schedule, clock.now)
  fixtures.push(fixture)
  const scheduler = await fixture.scheduler([dagNode("work"), dagNode("child", ["work"])])
  const scheduled = clock.whenScheduled(1)
  const running = scheduler.run()
  await scheduled
  // When the user cancels the run before the timer fires.
  await scheduler.cancel(scheduler.snapshot().runId)
  clock.advance()
  const result = await running
  // Then both waiting nodes remain cancelled and there is no new child.
  expect(result.status).toBe("cancelled")
  expect(result.nodes.map((node) => node.state)).toEqual(["cancelled", "cancelled"])
  expect(fixture.starts.get("work")).toBe(1)
})

test("preserves the infrastructure retry budget and backoff across scheduler re-entry", async () => {
  // Given one durable automatic retry that has not started yet.
  const clock = new RetryClock()
  const fixture = infraFixture(infrastructureFailure, clock.schedule, clock.now)
  fixtures.push(fixture)
  const scheduler = await fixture.scheduler([dagNode("work"), dagNode("child", ["work"])])
  const scheduled = clock.whenScheduled(1)
  const running = scheduler.run()
  await scheduled
  await scheduler.suspend()
  await running
  const recoveredClock = new RetryClock()
  const recovered = createDagScheduler({
    store: fixture.store,
    taskManager: fixture.taskManager,
    initialRecord: scheduler.snapshot(),
    scheduleRetry: recoveredClock.schedule,
    now: recoveredClock.now,
  })
  // When a fresh scheduler resumes the durable intent and its remaining attempts.
  const resumed = recovered.run()
  const second = recoveredClock.whenScheduled(2)
  expect(fixture.starts.get("work")).toBe(1)
  recoveredClock.advance()
  await second
  recoveredClock.advance()
  const result = await resumed
  // Then re-entry cannot reset the budget or bypass the recorded backoff.
  expect(fixture.starts.get("work")).toBe(3)
  expect(recoveredClock.delays).toEqual([1000, 2000])
  expect(result.nodes.map((node) => node.state)).toEqual(["failed", "skipped"])
})

test("retries a typed host-unavailable start refusal", async () => {
  // Given an unavailable host before the child can start.
  const fixture = infraFixture((_name, attempt) => {
    if (attempt === 1) throw new RunnerError({ kind: "host_unavailable", reason: "host_unreachable", message: "synthetic host failure" })
    return success()
  })
  fixtures.push(fixture)
  const scheduler = await fixture.scheduler([dagNode("work")])
  // When the host start fails.
  const result = await scheduler.run()
  // Then the durable typed start failure is retried through normal admission.
  expect(result.status).toBe("completed")
  expect(fixture.starts.get("work")).toBe(2)
})

test("manually retries an exhausted infrastructure node with a prompt override", async () => {
  const fixture = infraFixture((prompt) => prompt === "work" ? infrastructureFailure() : success())
  fixtures.push(fixture)
  const scheduler = await fixture.scheduler([dagNode("work"), dagNode("child", ["work"])])
  const failed = await scheduler.run()
  expect(failed.nodes.map((node) => node.state)).toEqual(["failed", "skipped"])
  expect(fixture.starts.get("work")).toBe(3)

  const nodeIds = failed.nodes.filter((node) => node.id === "work").map((node) => node.id)
  const retry = scheduler.retryNode(failed.runId, nodeIds, { prompt: "fixed" })
  const result = await retry.run
  expect(result.status).toBe("completed")
  expect(result.nodes.map((node) => node.state)).toEqual(["completed", "completed"])
  expect(fixture.starts.get("work")).toBe(3)
  expect(fixture.starts.get("fixed")).toBe(1)
  expect(fixture.starts.get("child")).toBe(1)
  const events = fixture.store.readEvents(result.runId, 0, { limit: 1000 }).events
  const retries = events.filter((event) => event.type === "dag.node.retried")
  expect(retries.map((event) => event.automatic?.attempt)).toEqual([1, 2, undefined])
  const manual = retries.at(-1)
  expect(manual?.promptChanged).toBe(true)
  const amendment = events.find((event) => event.type === "dag.definition.amended")
  expect(amendment?.seq).toBeLessThan(manual?.seq ?? 0)

  // Completed work must still be rejected before an override can amend its definition.
  expect(() => retry.scheduler.retryNode(result.runId, nodeIds, { prompt: "again" })).toThrow()
  expect(fixture.store.readEvents(result.runId, 0, { limit: 1000 }).events).toHaveLength(events.length)
  expect(fixture.store.readCheckpoint<typeof result>(result.runId)?.definitionFingerprint).toBe(result.definitionFingerprint)
})
