import { describe, expect, it } from "bun:test"

import type { CapturedUi } from "./runtime-context"
import {
  createDagStatusUi,
  DAG_STATUS_UI_KEY,
  type DagStatusActivityEvent,
  type DagStatusNode,
  type DagStatusRunSnapshot,
  type DagStatusUiManager,
  type DagStatusUiTimers,
} from "./dag-status-ui"

interface FakeUi extends CapturedUi {
  readonly widgetCalls: Array<{ key: string; content: string[] | undefined; placement: string | undefined }>
}

function fakeUi(): FakeUi {
  const widgetCalls: Array<{ key: string; content: string[] | undefined; placement: string | undefined }> = []
  return {
    widgetCalls,
    notify: () => undefined,
    setStatus: () => undefined,
    setWidget: (key, content, options) => widgetCalls.push({ key, content, placement: options?.placement }),
    select: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
  }
}

interface FakeTimers extends DagStatusUiTimers {
  readonly pending: Map<number, { callback: () => void; ms: number }>
  advance(ms: number): void
}

// Deterministic timer seam: no real sleeps, callbacks fire only when the test advances the clock.
function fakeTimers(): FakeTimers {
  const pending = new Map<number, { callback: () => void; ms: number }>()
  let nextHandle = 1
  let elapsed = 0
  const due = new Map<number, number>()
  return {
    pending,
    set: (callback, ms) => {
      const handle = nextHandle++
      pending.set(handle, { callback, ms })
      due.set(handle, elapsed + ms)
      return handle
    },
    clear: (handle) => {
      if (typeof handle !== "number") return
      pending.delete(handle)
      due.delete(handle)
    },
    advance: (ms) => {
      elapsed += ms
      for (const [handle, deadline] of [...due]) {
        if (deadline > elapsed) continue
        const entry = pending.get(handle)
        due.delete(handle)
        pending.delete(handle)
        entry?.callback()
      }
    },
  }
}

function node(overrides: Partial<DagStatusNode> & { id: string; state: DagStatusNode["state"] }): DagStatusNode {
  return {
    label: overrides.id,
    route: { kind: "category", category: "quick" },
    dependsOn: [],
    ...overrides,
  }
}

function snapshot(overrides: Partial<DagStatusRunSnapshot> & { runId: string }): DagStatusRunSnapshot {
  const nodes = overrides.nodes ?? []
  return {
    name: "ship-it",
    status: "running",
    waves: [{ index: 0, nodeIds: nodes.map((entry) => entry.id) }],
    ...overrides,
    nodes,
  }
}

interface FakeManager extends DagStatusUiManager {
  set(runs: readonly DagStatusRunSnapshot[]): void
  readonly snapshotCalls: string[]
}

function fakeManager(initial: readonly DagStatusRunSnapshot[], sessionId = "session-a"): FakeManager {
  let runs = initial
  const snapshotCalls: string[] = []
  return {
    snapshotCalls,
    set: (next) => { runs = next },
    list: (parentSessionId) =>
      parentSessionId !== sessionId ? [] : runs.map((run) => ({ runId: run.runId, status: run.status })),
    snapshot: (runId, parentSessionId) => {
      snapshotCalls.push(runId)
      const found = runs.find((run) => run.runId === runId)
      if (found === undefined || parentSessionId !== sessionId) throw new Error(`unknown dag run "${runId}"`)
      return found
    },
  }
}

function activity(overrides: Partial<DagStatusActivityEvent> & { runId: string; nodeId: string }): DagStatusActivityEvent {
  return {
    taskId: "st_1",
    activity: "running",
    turns: 1,
    ...overrides,
  }
}

function rowsOf(ui: FakeUi): string[] {
  return ui.widgetCalls.at(-1)?.content ?? []
}

describe("createDagStatusUi.syncNow", () => {
  it("#given a run transitioning across node states #when syncing after each transition #then the rows track the states", () => {
    // given
    const manager = fakeManager([
      snapshot({
        runId: "dag_1",
        status: "pending",
        nodes: [
          node({ id: "plan", state: "pending" }),
          node({ id: "build", state: "pending", dependsOn: ["plan"], route: { kind: "agent", agent: "coder" } }),
        ],
        waves: [{ index: 0, nodeIds: ["plan"] }, { index: 1, nodeIds: ["build"] }],
      }),
    ])
    const ui = fakeUi()
    const dagUi = createDagStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers: fakeTimers(),
    })

    // when
    dagUi.syncNow()
    const pendingRows = rowsOf(ui)

    manager.set([
      snapshot({
        runId: "dag_1",
        status: "running",
        nodes: [
          node({ id: "plan", state: "running" }),
          node({ id: "build", state: "blocked", dependsOn: ["plan"], route: { kind: "agent", agent: "coder" } }),
        ],
        waves: [{ index: 0, nodeIds: ["plan"] }, { index: 1, nodeIds: ["build"] }],
      }),
    ])
    dagUi.syncNow()
    const runningRows = rowsOf(ui)

    manager.set([
      snapshot({
        runId: "dag_1",
        status: "running",
        nodes: [
          node({ id: "plan", state: "completed" }),
          node({ id: "build", state: "failed", dependsOn: ["plan"], route: { kind: "agent", agent: "coder" } }),
        ],
        waves: [{ index: 0, nodeIds: ["plan"] }, { index: 1, nodeIds: ["build"] }],
      }),
    ])
    dagUi.syncNow()
    const settledRows = rowsOf(ui)

    // then
    expect(pendingRows[0]).toContain("ship-it")
    expect(pendingRows[0]).toContain("pending")
    expect(pendingRows[0]).toContain("wave 1/2")
    expect(pendingRows.slice(1)).toEqual(["  ◌ plan · category:quick", "  ◌ build · agent:coder"])
    expect(runningRows.slice(1)).toEqual(["  ▶ plan · category:quick", "  ⊟ build · agent:coder"])
    expect(settledRows.slice(1)).toEqual(["  ✗ build · agent:coder", "  ✓ plan · category:quick"])
    expect(settledRows[0]).toContain("wave 2/2")
  })

  it("#given a node re-run by retry #when syncing #then only the retried node carries an xN badge", () => {
    // given a node on its third attempt beside a first-attempt sibling and a legacy node with no
    // attempt on the record at all
    const ui = fakeUi()
    const dagUi = createDagStatusUi({
      manager: fakeManager([
        snapshot({
          runId: "dag_1",
          nodes: [
            node({ id: "plan", state: "completed", attempt: 1 }),
            node({ id: "build", state: "running", attempt: 3 }),
            node({ id: "ship", state: "pending" }),
          ],
        }),
      ]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers: fakeTimers(),
    })

    // when
    dagUi.syncNow()

    // then
    expect(rowsOf(ui).slice(1)).toEqual([
      "  ▶ build · category:quick · x3",
      "  ◌ ship · category:quick",
      "  ✓ plan · category:quick",
    ])
  })

  it("#given skipped and paused nodes #when syncing #then each state renders its own icon", () => {
    // given
    const ui = fakeUi()
    const dagUi = createDagStatusUi({
      manager: fakeManager([
        snapshot({
          runId: "dag_1",
          status: "paused",
          nodes: [node({ id: "a", state: "skipped" }), node({ id: "b", state: "cancelled" })],
        }),
      ]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers: fakeTimers(),
    })

    // when
    dagUi.syncNow()

    // then the run header takes the neutral pause-family icon and still reads paused with no
    // live lease and no running node, while node icons keep their own per-state glyphs
    expect(rowsOf(ui)[0]).toContain("paused")
    expect(rowsOf(ui)[0]).not.toContain("⏸")
    expect(rowsOf(ui).slice(1)).toEqual(["  ⊘ a · category:quick", "  ⊘ b · category:quick"])
  })

  it("#given a run header #when syncing #then the header carries the node counts", () => {
    // given
    const ui = fakeUi()
    const dagUi = createDagStatusUi({
      manager: fakeManager([
        snapshot({
          runId: "dag_1",
          nodes: [
            node({ id: "a", state: "completed" }),
            node({ id: "b", state: "running" }),
            node({ id: "c", state: "failed" }),
            node({ id: "d", state: "pending" }),
          ],
        }),
      ]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers: fakeTimers(),
    })

    // when
    dagUi.syncNow()

    // then
    expect(rowsOf(ui)[0]).toContain("1/4 done")
    expect(rowsOf(ui)[0]).toContain("1 running")
    expect(rowsOf(ui)[0]).toContain("1 failed")
  })

  it("#given a non-tui run mode #when syncing #then nothing renders", () => {
    // given
    const ui = fakeUi()
    const dagUi = createDagStatusUi({
      manager: fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "app-server" },
      timers: fakeTimers(),
    })

    // when
    dagUi.syncNow()
    dagUi.onActivity(activity({ runId: "dag_1", nodeId: "a", activity: "read package.json" }))

    // then
    expect(ui.widgetCalls).toHaveLength(0)
  })

  it("#given every run terminal #when syncing #then the widget is cleared", () => {
    // given
    const manager = fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })])
    const ui = fakeUi()
    const timers = fakeTimers()
    const dagUi = createDagStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
    })
    dagUi.syncNow()
    expect(rowsOf(ui)).not.toHaveLength(0)

    // when
    manager.set([
      snapshot({ runId: "dag_1", status: "completed", nodes: [node({ id: "a", state: "completed" })] }),
    ])
    dagUi.syncNow()

    // then
    expect(ui.widgetCalls.at(-1)?.content).toBeUndefined()
    expect(ui.widgetCalls.at(-1)?.key).toBe(DAG_STATUS_UI_KEY)
    expect(timers.pending.size).toBe(0)
  })

  it("#given a live run #when the widget renders #then it uses the dag key below the editor", () => {
    // given
    const ui = fakeUi()
    const dagUi = createDagStatusUi({
      manager: fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running", startedAt: new Date(0).toISOString() })] })]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers: fakeTimers(),
    })

    // when
    dagUi.syncNow()

    // then
    expect(ui.widgetCalls.at(-1)?.key).toBe("omo-dag")
    expect(DAG_STATUS_UI_KEY).not.toBe("omo-task")
    expect(ui.widgetCalls.at(-1)?.placement).toBe("belowEditor")
  })

  it("#given a terminal width seam #when rendering the same run at two widths #then the row adapts and the elapsed ticks against now", () => {
    // given one running node whose live activity is long enough to need the width budget
    const manager = fakeManager([
      snapshot({
        runId: "dag_1",
        nodes: [node({ id: "wide-node", state: "running", startedAt: new Date(0).toISOString() })],
      }),
    ])
    const ui = fakeUi()
    const dagUi = createDagStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers: fakeTimers(),
      terminalWidth: () => 120,
      now: () => 95_000,
    })
    dagUi.onActivity(activity({ runId: "dag_1", nodeId: "wide-node", activity: "running bash grep -rn scheduler-claim packages and reporting the wave manifest drift" }))
    dagUi.syncNow()
    const wide = rowsOf(ui)[1] ?? ""

    // when the same session narrows to 50 columns
    const narrow = (() => {
      const narrowUi = fakeUi()
      const narrowDagUi = createDagStatusUi({
        manager,
        runtime: { ui: () => narrowUi, sessionId: () => "session-a", mode: () => "tui" },
        timers: fakeTimers(),
        terminalWidth: () => 50,
        now: () => 95_000,
      })
      narrowDagUi.onActivity(activity({ runId: "dag_1", nodeId: "wide-node", activity: "running bash grep -rn scheduler-claim packages and reporting the wave manifest drift" }))
      narrowDagUi.syncNow()
      return rowsOf(narrowUi)[1] ?? ""
    })()

    // then the wide row carries the activity and the elapsed, the narrow row drops only the activity
    expect(wide).toContain("category:")
    expect(wide).toContain("scheduler-claim")
    expect(wide).toContain("1m 35s")
    expect(narrow).toContain("category:quick")
    expect(narrow).toContain("1m 35s")
    expect(narrow).not.toContain("scheduler-claim")
  })
})

describe("createDagStatusUi.scheduleSync", () => {
  it("#given a burst of scheduled syncs #when the debounce window elapses #then exactly one render happens", () => {
    // given
    const ui = fakeUi()
    const timers = fakeTimers()
    const dagUi = createDagStatusUi({
      manager: fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
      debounceMs: 250,
    })

    // when
    dagUi.scheduleSync()
    dagUi.scheduleSync()
    dagUi.scheduleSync()
    expect(ui.widgetCalls).toHaveLength(0)
    timers.advance(250)

    // then
    expect(ui.widgetCalls).toHaveLength(1)
    dagUi.dispose()
  })

  it("#given a nonterminal run #when the refresh interval elapses without input #then the widget repaints", () => {
    // given
    const ui = fakeUi()
    const timers = fakeTimers()
    const dagUi = createDagStatusUi({
      manager: fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
    })
    dagUi.syncNow()
    const afterFirst = ui.widgetCalls.length

    // when
    timers.advance(1_000)

    // then
    expect(ui.widgetCalls.length).toBeGreaterThan(afterFirst)
    dagUi.dispose()
  })

  it("#given a disposed widget #when timers advance #then no further render happens", () => {
    // given
    const ui = fakeUi()
    const timers = fakeTimers()
    const dagUi = createDagStatusUi({
      manager: fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
    })
    dagUi.syncNow()
    const rendered = ui.widgetCalls.length

    // when
    dagUi.dispose()
    timers.advance(10_000)

    // then
    expect(ui.widgetCalls).toHaveLength(rendered)
    expect(timers.pending.size).toBe(0)
  })
})

describe("createDagStatusUi.onActivity", () => {
  it("#given repeated activity for one node #when rendering #then only the latest activity shows", () => {
    // given
    const ui = fakeUi()
    const timers = fakeTimers()
    const dagUi = createDagStatusUi({
      manager: fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
    })

    // when
    dagUi.onActivity(activity({ runId: "dag_1", nodeId: "a", activity: "read package.json" }))
    dagUi.onActivity(activity({ runId: "dag_1", nodeId: "a", activity: "edit manager.ts" }))
    timers.advance(250)

    // then
    const nodeRow = rowsOf(ui)[1] ?? ""
    expect(nodeRow).toContain("edit manager.ts")
    expect(nodeRow).not.toContain("read package.json")
  })

  it("#given a completed node #when its stale activity is still known #then the row shows no activity text", () => {
    // given
    const manager = fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })])
    const ui = fakeUi()
    const timers = fakeTimers()
    const dagUi = createDagStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
    })
    dagUi.onActivity(activity({ runId: "dag_1", nodeId: "a", activity: "edit manager.ts" }))
    timers.advance(250)

    // when
    manager.set([
      snapshot({
        runId: "dag_1",
        nodes: [node({ id: "a", state: "completed" }), node({ id: "b", state: "running" })],
      }),
    ])
    dagUi.syncNow()

    // then
    expect(rowsOf(ui)[1]).toBe("  ▶ b · category:quick")
    expect(rowsOf(ui)[2]).toBe("  ✓ a · category:quick")
    dagUi.dispose()
  })

  it("#given an activity event for an unknown run #when it arrives #then it is ignored without throwing", () => {
    // given
    const ui = fakeUi()
    const timers = fakeTimers()
    const dagUi = createDagStatusUi({
      manager: fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
    })

    // when
    expect(() => dagUi.onActivity(activity({ runId: "dag_missing", nodeId: "ghost", activity: "wandering" }))).not.toThrow()
    timers.advance(250)

    // then
    expect(rowsOf(ui)).toHaveLength(2)
    expect(rowsOf(ui).join("\n")).not.toContain("wandering")
    dagUi.dispose()
  })

  it("#given a run that disappears between list and snapshot #when syncing #then the run is skipped without throwing", () => {
    // given
    const manager = fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })])
    const ui = fakeUi()
    const listOnlyManager: DagStatusUiManager = {
      list: manager.list,
      snapshot: (runId, parentSessionId) => {
        if (runId === "dag_gone") throw new Error("run_not_found")
        return manager.snapshot(runId, parentSessionId)
      },
    }
    const dagUi = createDagStatusUi({
      manager: {
        list: (parentSessionId) => [
          ...listOnlyManager.list(parentSessionId),
          { runId: "dag_gone", status: "running" },
        ],
        snapshot: listOnlyManager.snapshot,
      },
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers: fakeTimers(),
    })

    // when
    expect(() => dagUi.syncNow()).not.toThrow()

    // then
    expect(rowsOf(ui)).toHaveLength(2)
    expect(rowsOf(ui)[0]).toContain("ship-it")
  })

  it("#given no session id #when syncing #then no run is queried and nothing renders", () => {
    // given
    const manager = fakeManager([snapshot({ runId: "dag_1", nodes: [node({ id: "a", state: "running" })] })])
    const ui = fakeUi()
    const dagUi = createDagStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => undefined, mode: () => "tui" },
      timers: fakeTimers(),
    })

    // when
    dagUi.syncNow()

    // then
    expect(manager.snapshotCalls).toHaveLength(0)
    expect(ui.widgetCalls.at(-1)?.content).toBeUndefined()
  })
})


// #7316: a live run whose snapshot projection fails (or whose session filter yields nothing) used
// to clear the widget outright, which reads to the user as "the DAG died".
describe("createDagStatusUi live-run visibility", () => {
  it("#given a live run whose snapshot throws #when syncing #then the widget is not cleared to undefined", () => {
    // given a manager that lists one running run but cannot project it
    const manager: DagStatusUiManager = {
      list: () => [{ runId: "dag_x", status: "running" }],
      snapshot: () => {
        throw new Error("checkpoint unreadable")
      },
    }
    const ui = fakeUi()
    const statusUi = createDagStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
    })

    // when
    statusUi.syncNow()

    // then the widget was never blanked while the run is still live
    const cleared = ui.widgetCalls.filter((call) => call.key === DAG_STATUS_UI_KEY && call.content === undefined)
    expect(cleared).toEqual([])
    statusUi.dispose()
  })
})
