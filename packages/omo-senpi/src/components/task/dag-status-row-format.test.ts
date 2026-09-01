import { describe, expect, it } from "bun:test"

import { runRows, type DagStatusNode, type DagStatusRunSnapshot } from "./dag-status-row-format"

const NOW = Date.parse("2026-08-24T12:00:00.000Z")

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString()
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

function rows(overrides: Partial<DagStatusRunSnapshot> & { runId: string }, options?: Parameters<typeof runRows>[2]): string[] {
  return runRows(snapshot(overrides), undefined, options)
}

describe("runRows node selection", () => {
  it("#given fifteen nodes with the three running ones beyond the row budget #when rendering #then every running node is shown", () => {
    // given twelve pending nodes declared first, then three running nodes at indexes 12-14
    const nodes = [
      ...Array.from({ length: 12 }, (_, index) => node({ id: `p${index + 1}`, state: "pending" })),
      node({ id: "r13", state: "running", startedAt: iso(-30_000) }),
      node({ id: "r14", state: "running", startedAt: iso(-20_000) }),
      node({ id: "r15", state: "running", startedAt: iso(-10_000) }),
    ]

    // when
    const rendered = rows({ runId: "dag_1", nodes }, { now: NOW, maxWidth: 120 })

    // then the running rows lead and all three survive past the 12-row budget
    expect(rendered.slice(1, 4).map((row) => row.includes("▶"))).toEqual([true, true, true])
    expect(rendered.slice(1, 4).map((row) => row.includes("category:quick"))).toEqual([true, true, true])
    expect(rendered.some((row) => row.includes("r13"))).toBe(true)
    expect(rendered.some((row) => row.includes("r14"))).toBe(true)
    expect(rendered.some((row) => row.includes("r15"))).toBe(true)
    // then the budget still caps the pending tail and reports the overflow
    expect(rendered.filter((row) => row.includes("◌ p"))).toHaveLength(9)
    expect(rendered.at(-1)).toBe("  +3 more")
  })

  it("#given more running nodes than the whole row budget #when rendering #then running rows are exempt from the cap", () => {
    // given thirteen running nodes plus two completed ones
    const nodes = [
      ...Array.from({ length: 13 }, (_, index) => node({ id: `r${index + 1}`, state: "running", startedAt: iso(-15_000) })),
      node({ id: "c14", state: "completed", startedAt: iso(-60_000), completedAt: iso(-30_000) }),
      node({ id: "c15", state: "completed", startedAt: iso(-60_000), completedAt: iso(-30_000) }),
    ]

    // when
    const rendered = rows({ runId: "dag_1", nodes }, { now: NOW, maxWidth: 120 })

    // then all thirteen running rows render and only the completed pair overflows
    expect(rendered.slice(1).filter((row) => row.includes("▶"))).toHaveLength(13)
    expect(rendered.some((row) => row.includes("c14"))).toBe(false)
    expect(rendered.at(-1)).toBe("  +2 more")
  })

  it("#given two running nodes declared latest-first #when rendering #then the earlier start leads", () => {
    // given
    const nodes = [
      node({ id: "late", state: "running", startedAt: iso(-10_000) }),
      node({ id: "early", state: "running", startedAt: iso(-60_000) }),
    ]

    // when
    const rendered = rows({ runId: "dag_1", nodes }, { now: NOW, maxWidth: 120 })

    // then
    expect(rendered[1]).toContain("early")
    expect(rendered[2]).toContain("late")
  })

  it("#given nodes across every settled bucket #when rendering #then running leads waiting, failed, completed, skipped", () => {
    // given
    const nodes = [
      node({ id: "skipped-old", state: "skipped", startedAt: iso(-500_000), completedAt: iso(-400_000) }),
      node({ id: "completed-old", state: "completed", startedAt: iso(-300_000), completedAt: iso(-200_000) }),
      node({ id: "completed-new", state: "completed", startedAt: iso(-300_000), completedAt: iso(-5_000) }),
      node({ id: "failed", state: "failed", startedAt: iso(-300_000), completedAt: iso(-100_000) }),
      node({ id: "pending", state: "pending" }),
      node({ id: "scheduled", state: "scheduled" }),
      node({ id: "running", state: "running", startedAt: iso(-30_000) }),
    ]

    // when
    const rendered = rows({ runId: "dag_1", nodes }, { now: NOW, maxWidth: 120 })

    // then
    expect(rendered.slice(1).map((row) => row.trim().split(/\s+/)[1])).toEqual([
      "running",
      "pending",
      "scheduled",
      "failed",
      "completed-new",
      "completed-old",
      "skipped-old",
    ])
  })
})

describe("runRows node elapsed", () => {
  it("#given a running node with startedAt #when rendering at a fixed now #then the row carries elapsed since start", () => {
    // given
    const nodes = [node({ id: "alpha", state: "running", startedAt: iso(-65_000) })]

    // when
    const rendered = rows({ runId: "dag_1", nodes }, { now: NOW, maxWidth: 120 })

    // then
    expect(rendered[1]).toContain("1m 5s")
  })

  it("#given a completed node #when rendering now and later #then the settled duration is frozen", () => {
    // given
    const nodes = [node({ id: "beta", state: "completed", startedAt: iso(-192_000), completedAt: iso(-8_000) })]

    // when
    const first = rows({ runId: "dag_1", nodes }, { now: NOW, maxWidth: 120 })
    const later = rows({ runId: "dag_1", nodes }, { now: NOW + 600_000, maxWidth: 120 })

    // then
    expect(first[1]).toContain("3m 4s")
    expect(later[1]).toContain("3m 4s")
  })

  it("#given a pending node without startedAt #when rendering #then no elapsed token appears", () => {
    // given
    const nodes = [node({ id: "gamma", state: "pending", createdAt: iso(-300_000) })]

    // when
    const rendered = rows({ runId: "dag_1", nodes }, { now: NOW, maxWidth: 120 })

    // then the row carries no elapsed-since-start token; a node that never started reports how long
    // it has been waiting instead, which is what keeps a booting graph visibly alive.
    expect(rendered[1]).toBe("  ◌ gamma · category:quick · waiting 5m 0s")
  })
})

describe("runRows width awareness", () => {
  it("#given a 50-column terminal #when rendering #then activity is dropped while label route and elapsed stay", () => {
    // given
    const nodes = [node({ id: "narrow", state: "running", startedAt: iso(-45_000) })]
    const activity = new Map([["narrow", "running bash sleep 40 while the dag widget renders"]])

    // when
    const rendered = runRows(snapshot({ runId: "dag_1", nodes }), activity, { now: NOW, maxWidth: 50 })

    // then
    expect(rendered[1]).toContain("narrow")
    expect(rendered[1]).toContain("category:quick")
    expect(rendered[1]).toContain("45s")
    expect(rendered[1]).not.toContain("sleep 40")
    expect(rendered[1].length).toBeLessThanOrEqual(50)
  })

  it("#given a 120-column terminal #when rendering #then a long latest-activity line survives well past 40 characters", () => {
    // given a 150-character activity line, far beyond the old 40-character inline cap
    const longActivity = `inspecting the scheduler claim path: node alpha re-read the wave manifest and moved to the parked bash checkpoint while ${"x".repeat(60)}`
    const nodes = [node({ id: "wide", state: "running", startedAt: iso(-12_000) })]
    const activity = new Map([["wide", longActivity]])

    // when
    const rendered = runRows(snapshot({ runId: "dag_1", nodes }), activity, { now: NOW, maxWidth: 120 })

    // then the visible row keeps a long prefix of the activity and never exceeds the terminal
    expect(rendered[1]).toContain("inspecting the scheduler claim path")
    expect(rendered[1].length).toBeGreaterThan(80)
    expect(rendered[1].length).toBeLessThanOrEqual(120)
  })

  it("#given a 120-column terminal and a short node #when rendering #then the row is not padded", () => {
    // given
    const nodes = [node({ id: "tiny", state: "running", startedAt: iso(-5_000) })]
    const activity = new Map([["tiny", "running bash"]])

    // when
    const rendered = runRows(snapshot({ runId: "dag_1", nodes }), activity, { now: NOW, maxWidth: 120 })

    // then
    expect(rendered[1]).toBe("  ▶ tiny · category:quick · running bash · 5s")
  })
})

describe("runRows paused run header honesty", () => {
  const LIVE_PID = 4242
  const DEAD_PID = 4243
  const isProcessAlive = (pid: number): boolean => pid === LIVE_PID

  it("#given a paused run whose lease holder is alive #when rendering #then the header reads resuming under the neutral icon", () => {
    // given a run paused by session shutdown that a live process has already claimed for resume
    const nodes = [node({ id: "alpha", state: "running", startedAt: iso(-30_000) })]

    // when
    const rendered = runRows(
      snapshot({ runId: "dag_1", status: "paused", leaseHolderPid: LIVE_PID, nodes }),
      undefined,
      { now: NOW, maxWidth: 120, isProcessAlive },
    )

    // then the header stops claiming paused and stops wearing the pause glyph
    expect(rendered[0]).toContain("resuming")
    expect(rendered[0]).not.toContain("paused")
    expect(rendered[0].startsWith("· ")).toBe(true)
    expect(rendered[0]).not.toContain("⏸")
    // then the genuinely running lane keeps its own running icon
    expect(rendered[1]).toContain("▶")
  })

  it("#given a paused run with no live lease and running nodes #when rendering #then the header reads suspended with the active count", () => {
    // given a dead lease holder over two nodes still recorded as running
    const nodes = [
      node({ id: "alpha", state: "running", startedAt: iso(-30_000) }),
      node({ id: "beta", state: "running", startedAt: iso(-20_000) }),
      node({ id: "gamma", state: "completed", startedAt: iso(-60_000), completedAt: iso(-40_000) }),
    ]

    // when
    const rendered = runRows(
      snapshot({ runId: "dag_1", status: "paused", leaseHolderPid: DEAD_PID, nodes }),
      undefined,
      { now: NOW, maxWidth: 200, isProcessAlive },
    )

    // then the header names the suspension and how many lanes are stranded in it
    expect(rendered[0]).toContain("suspended · 2 active")
    expect(rendered[0]).not.toContain("⏸")
    expect(rendered[0].startsWith("· ")).toBe(true)
  })

  it("#given a paused run with no live lease and no running nodes #when rendering #then the header still reads paused under the neutral icon", () => {
    // given a dead lease holder over a wave that never started
    const nodes = [node({ id: "alpha", state: "pending" }), node({ id: "beta", state: "blocked" })]

    // when
    const rendered = runRows(
      snapshot({ runId: "dag_1", status: "paused", leaseHolderPid: DEAD_PID, nodes }),
      undefined,
      { now: NOW, maxWidth: 120, isProcessAlive },
    )

    // then
    expect(rendered[0]).toContain("paused")
    expect(rendered[0]).not.toContain("suspended")
    expect(rendered[0]).not.toContain("resuming")
    expect(rendered[0].startsWith("· ")).toBe(true)
    expect(rendered[0]).not.toContain("⏸")
  })
})

describe("runRows activity semantics", () => {
  it("#given a running node with live activity #when rendering #then the row shows it after the route", () => {
    // given
    const nodes = [node({ id: "live", state: "running", startedAt: iso(-20_000) })]
    const activity = new Map([["live", "running bash grep -rn dag"]])

    // when
    const rendered = runRows(snapshot({ runId: "dag_1", nodes }), activity, { now: NOW, maxWidth: 120 })

    // then
    expect(rendered[1].indexOf("category:quick")).toBeLessThan(rendered[1].indexOf("running bash grep"))
    expect(rendered[1]).toContain("20s")
  })

  it("#given a completed node with stale activity still known #when rendering #then no activity text shows", () => {
    // given
    const nodes = [node({ id: "done", state: "completed", startedAt: iso(-100_000), completedAt: iso(-40_000) })]
    const activity = new Map([["done", "running bash grep -rn dag"]])

    // when
    const rendered = runRows(snapshot({ runId: "dag_1", nodes }), activity, { now: NOW, maxWidth: 120 })

    // then
    expect(rendered[1]).not.toContain("grep")
    expect(rendered[1]).toContain("1m")
  })
})


// The pending phase is where users decide the DAG is frozen: a node that has not started yet must
// still prove the run is alive. These three cases pin that liveness contract.
describe("runRows pending-phase liveness", () => {
  it("#given a pending node with no startedAt #when rendered at two different clocks #then its waiting token advances", () => {
    // given a node enqueued a minute before the first paint but never started
    const nodes = [node({ id: "waiter", state: "pending", createdAt: iso(-60_000) })]
    const run = { runId: "dag_live", nodes }

    // when the same node is painted 30 seconds apart
    const first = rows(run, { now: NOW, maxWidth: 120 })[1]
    const second = rows(run, { now: NOW + 30_000, maxWidth: 120 })[1]

    // then the row is not byte-identical: something on it moved
    expect(first).not.toEqual(second)
  })

  it("#given pending, scheduled and blocked nodes #when rendered #then each carries a distinct icon", () => {
    // given one node in each pre-running state
    const nodes = [
      node({ id: "a", state: "pending" }),
      node({ id: "b", state: "scheduled" }),
      node({ id: "c", state: "blocked" }),
    ]

    // when
    const rendered = rows({ runId: "dag_icons", nodes }, { now: NOW, maxWidth: 120 })

    // then the three leading glyphs differ from one another
    const glyphs = rendered.slice(1, 4).map((row) => row.trimStart().charAt(0))
    expect(new Set(glyphs).size).toBe(3)
  })

  it("#given a pending node carrying spawn activity #when rendered #then the activity text is surfaced", () => {
    // given a node still booting its child, with live telemetry already flowing
    const nodes = [node({ id: "booting", state: "pending" })]
    const activity = new Map([["booting", "spawning child"]])

    // when
    const rendered = runRows(snapshot({ runId: "dag_boot", nodes }), activity, { now: NOW, maxWidth: 200 })

    // then the boot telemetry reaches the row instead of being suppressed by the running-only gate
    expect(rendered[1]).toContain("spawning")
  })
})
