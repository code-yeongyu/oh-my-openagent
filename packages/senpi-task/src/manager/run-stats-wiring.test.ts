import { afterEach, describe, expect, test } from "bun:test"

import { baseSpec, cleanupProjects, makeManager } from "./__fixtures__/manager-fakes"

afterEach(() => {
  cleanupProjects()
})

describe("manager run stats wiring", () => {
  test("#given a spawned child #when it completes #then the terminal record carries accumulated run stats", async () => {
    // given
    const { manager, store, inProcess } = makeManager()
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error(`unexpected start result: ${started.kind}`)
    const fake = inProcess.handles.get(started.task_id)
    if (fake === undefined) throw new Error("fake handle missing")

    // when
    fake.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "working" }],
        usage: { output: 120, totalTokens: 300 },
      },
    })
    fake.emit({ type: "tool_execution_start", toolName: "read", args: { path: "a.ts" } })
    fake.settle({ status: "completed", finalResponse: "done" })
    const final = await manager.waitFor(started.task_id)

    // then
    expect(final.status).toBe("completed")
    const record = store.load(started.task_id)
    expect(record?.run_stats?.turns).toBe(1)
    expect(record?.run_stats?.tool_calls).toBe(1)
    expect(record?.run_stats?.output_tokens).toBe(120)
    expect(record?.run_stats?.total_tokens).toBe(300)
    expect(record?.run_stats?.runtime_ms).toBeGreaterThanOrEqual(0)
  })

  test("#given a spawned child reporting cost and cache usage #when it completes #then cost and cache hit rate persist", async () => {
    // given
    const { manager, store, inProcess } = makeManager()
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error(`unexpected start result: ${started.kind}`)
    const fake = inProcess.handles.get(started.task_id)
    if (fake === undefined) throw new Error("fake handle missing")

    // when: the same usage shape a Senpi assistant message carries (cost object with a total)
    fake.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "working" }],
        usage: {
          input: 100,
          output: 120,
          cacheRead: 300,
          cacheWrite: 100,
          totalTokens: 620,
          cost: { input: 0.02, output: 0.1, total: 0.12 },
        },
      },
    })
    fake.settle({ status: "completed", finalResponse: "done" })
    await manager.waitFor(started.task_id)

    // then: cacheRead 300 of (100 + 300 + 100) = 60%
    const stats = store.load(started.task_id)?.run_stats
    expect(stats?.cost_usd).toBeCloseTo(0.12, 10)
    expect(stats?.cache_hit_rate_last).toBeCloseTo(0.6, 10)
    expect(stats?.cache_hit_rate_run).toBeCloseTo(0.6, 10)
  })

  test("#given a live child with cost usage #when the snapshot is read mid-run #then cost and cache facts are already visible", async () => {
    // given: this is the seam the live TUI row (solo in-process AND rpc team members) reads
    const { manager, inProcess } = makeManager()
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error(`unexpected start result: ${started.kind}`)
    const fake = inProcess.handles.get(started.task_id)
    if (fake === undefined) throw new Error("fake handle missing")

    // when: a cold-ish turn then a hot turn arrive while the child is still running
    fake.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "partial" }],
        usage: { input: 50, output: 10, cacheRead: 50, cacheWrite: 0, totalTokens: 110, cost: 0.0025 },
      },
    })
    fake.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hot" }],
        usage: { input: 10, output: 10, cacheRead: 90, cacheWrite: 0, totalTokens: 110, cost: 0.005 },
      },
    })

    // then: the live seam is optional on the manager interface, so the TUI wiring depends on it
    // actually being present here, not just on the values it returns
    const snapshot = manager.runStatsSnapshot
    if (snapshot === undefined) throw new Error("manager must expose runStatsSnapshot for live rows")
    const live = snapshot.call(manager, started.task_id)
    expect(live?.cost_usd).toBeCloseTo(0.0075, 10)
    expect(live?.cache_hit_rate_last).toBeCloseTo(0.9, 10)
    expect(live?.cache_hit_rate_run).toBeCloseTo(140 / 200, 10)
  })

  test("#given a spawned child #when it fails #then run stats persist on the error record", async () => {
    // given
    const { manager, store, inProcess } = makeManager()
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error(`unexpected start result: ${started.kind}`)
    const fake = inProcess.handles.get(started.task_id)
    if (fake === undefined) throw new Error("fake handle missing")

    // when
    fake.emit({ type: "tool_execution_start", toolName: "bash", args: { command: "ls" } })
    fake.settle({ status: "error", failure: { kind: "child-turn-failed", message: "boom" } })
    const final = await manager.waitFor(started.task_id)

    // then
    expect(final.status).toBe("error")
    expect(store.load(started.task_id)?.run_stats?.tool_calls).toBe(1)
  })

  test("#given a spawned child #when it is cancelled #then run stats persist on the cancelled record", async () => {
    // given
    const { manager, store, inProcess } = makeManager()
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error(`unexpected start result: ${started.kind}`)
    const fake = inProcess.handles.get(started.task_id)
    if (fake === undefined) throw new Error("fake handle missing")

    // when
    fake.emit({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "partial" }], usage: { output: 10, totalTokens: 20 } },
    })
    fake.settle({ status: "cancelled" })
    const final = await manager.waitFor(started.task_id)

    // then
    expect(final.status).toBe("cancelled")
    expect(store.load(started.task_id)?.run_stats?.turns).toBe(1)
  })
})

describe("manager run stats through steering transitions", () => {
  test("#given a running child with usage #when cancelled through cancelTask #then the cancelled record carries run stats", async () => {
    // given
    const { manager, store, inProcess } = makeManager()
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error(`unexpected start result: ${started.kind}`)
    const fake = inProcess.handles.get(started.task_id)
    if (fake === undefined) throw new Error("fake handle missing")
    fake.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "working" }],
        usage: { output: 77, totalTokens: 300 },
      },
    })
    fake.emit({ type: "tool_execution_start", toolName: "read", args: {} })

    // when
    const outcome = await manager.cancelTask(started.task_id, "user cancelled")

    // then
    expect(outcome.kind).toBe("cancelled")
    const record = store.load(started.task_id)
    expect(record?.status).toBe("cancelled")
    expect(record?.run_stats?.turns).toBe(1)
    expect(record?.run_stats?.tool_calls).toBe(1)
    expect(record?.run_stats?.output_tokens).toBe(77)
  })

  test("#given a completed run revived then cancelled #when the revived run has no events #then no stale run stats survive", async () => {
    // given: a first run that completes WITH stats
    const { manager, store, inProcess } = makeManager()
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error(`unexpected start result: ${started.kind}`)
    const fake = inProcess.handles.get(started.task_id)
    if (fake === undefined) throw new Error("fake handle missing")
    fake.emit({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "one" }], usage: { output: 50, totalTokens: 100 } },
    })
    fake.settle({ status: "completed", finalResponse: "done" })
    await manager.waitFor(started.task_id)
    expect(store.load(started.task_id)?.run_stats?.output_tokens).toBe(50)

    // when: a follow-up revives the resident child and the revived run is cancelled with no events
    const send = await manager.sendToTask({ idOrName: started.task_id, message: "keep going" })
    if (send.kind !== "revived") throw new Error(`unexpected send result: ${send.kind}`)
    const outcome = await manager.cancelTask(started.task_id, "stop the revived run")

    // then: the revived run's cancel must not report the previous run's stats
    expect(outcome.kind).toBe("cancelled")
    const record = store.load(started.task_id)
    expect(record?.run_stats?.output_tokens).toBeUndefined()
    expect(record?.run_stats?.turns).toBe(0)
  })
})
