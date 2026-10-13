import { describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { OmoSidePanelSettingsSchema, type OmoSidePanelSettings } from "@oh-my-opencode/omo-config-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"

import {
  GIT_REFRESH_FLOOR_MS,
  MEMORY_REFRESH_FLOOR_MS,
  PI_TUI_LAYOUT_NODE,
  PI_TUI_VIEWPORT,
  SIDE_PANEL_ANCHOR_WIDGET_KEY,
  SIDE_PANEL_FLAG,
} from "./constants"
import { createSidePanelComponent } from "./index"
import type { PanelMemory, PanelMemoryIdentity, PanelTimers } from "./types"
import { SIDE_PANEL_DIFF_COMMAND } from "./constants"
import type { PanelTaskRecord } from "./data/task-records"
import { testTempDir } from "../../../test-support/temp-dir"

interface WidgetCall {
  readonly key: string
  readonly content: unknown
}

function hostContext(widgets: WidgetCall[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget(key: string, content: unknown) {
        widgets.push({ key, content })
      },
      notify() {},
    },
    ...overrides,
  }
}

function componentContext(pi: FakeExtensionAPI): ComponentContext {
  return {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    config: { getFlag: (name) => pi.getFlag(name) },
  }
}

function settings(overrides: Partial<OmoSidePanelSettings> = {}): OmoSidePanelSettings {
  const parsed = OmoSidePanelSettingsSchema.parse({})
  // The usage section is the only one that reads credentials and reaches the network, so it is
  // off unless a test asks for it and hands over its own ports.
  // Clicks paint OSC 8 links over the rows and claim the host url hook, so they are off
  // unless a test asks for them: the row assertions here read plain text.
  return { ...parsed, clickable: false, sections: { ...parsed.sections, usage: false }, ...overrides }
}

describe("side panel component", () => {
  test("#given the panel is disabled #when a session starts #then nothing is mounted", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const widgets: WidgetCall[] = []
    createSidePanelComponent({ loadSettings: () => settings({ enabled: false }) }).register(pi, componentContext(pi))

    // when
    await pi.dispatch("session_start", {}, hostContext(widgets))

    // then
    expect(widgets).toEqual([])
  })

  test("#given the panel is enabled in config #when a session starts #then the anchor widget is installed", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const widgets: WidgetCall[] = []
    createSidePanelComponent({ loadSettings: () => settings({ enabled: true }) }).register(pi, componentContext(pi))

    // when
    await pi.dispatch("session_start", {}, hostContext(widgets))

    // then
    expect(widgets.map((call) => call.key)).toEqual([SIDE_PANEL_ANCHOR_WIDGET_KEY])
  })

  test("#given the flag is registered #when read before any CLI override #then it reports no opinion", () => {
    // given
    const pi = new FakeExtensionAPI()

    // when
    createSidePanelComponent({ loadSettings: () => settings() }).register(pi, componentContext(pi))

    // then
    const registration = pi.flags.find((flag) => flag.name === SIDE_PANEL_FLAG)
    expect(registration?.options.type).toBe("boolean")
    expect(registration?.options.default).toBeUndefined()
    expect(pi.getFlag(SIDE_PANEL_FLAG)).toBeUndefined()
  })

  // The CLI can only produce `true` for a boolean extension flag (senpi ignores any value that
  // follows it and rejects a `--no-` form), so this is the reachable override direction.
  test("#given the flag forces the panel on #when config says off #then the panel still mounts", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const widgets: WidgetCall[] = []
    createSidePanelComponent({ loadSettings: () => settings({ enabled: false }) }).register(pi, componentContext(pi))
    pi.setFlag(SIDE_PANEL_FLAG, true)

    // when
    await pi.dispatch("session_start", {}, hostContext(widgets))

    // then
    expect(widgets.map((call) => call.key)).toEqual([SIDE_PANEL_ANCHOR_WIDGET_KEY])
  })

  test("#given a false flag value from the host #when config says on #then nothing is mounted", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const widgets: WidgetCall[] = []
    createSidePanelComponent({ loadSettings: () => settings({ enabled: true }) }).register(pi, componentContext(pi))
    // Not reachable from the CLI, but the SDK carries flag values across session reloads.
    pi.setFlag(SIDE_PANEL_FLAG, false)

    // when
    await pi.dispatch("session_start", {}, hostContext(widgets))

    // then
    expect(widgets).toEqual([])
  })

  test("#given a host without a ui context #when a session starts #then the component stays dark", async () => {
    // given
    const pi = new FakeExtensionAPI()
    createSidePanelComponent({ loadSettings: () => settings({ enabled: true }) }).register(pi, componentContext(pi))

    // when
    const results = await pi.dispatch("session_start", {}, { mode: "tui", hasUI: true })

    // then
    expect(results).toEqual([undefined])
  })

  test("#given a mounted panel #when the session shuts down #then the anchor widget is cleared", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const widgets: WidgetCall[] = []
    createSidePanelComponent({ loadSettings: () => settings({ enabled: true }) }).register(pi, componentContext(pi))
    await pi.dispatch("session_start", {}, hostContext(widgets))

    // when
    await pi.dispatch("session_shutdown", {}, hostContext(widgets))

    // then
    const anchorCalls = widgets.filter((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY)
    expect(anchorCalls).toHaveLength(2)
    expect(anchorCalls[1]?.content).toBeUndefined()
  })

  test("#given a second session_start #when the panel is already mounted #then it is not mounted twice", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const widgets: WidgetCall[] = []
    createSidePanelComponent({ loadSettings: () => settings({ enabled: true }) }).register(pi, componentContext(pi))
    await pi.dispatch("session_start", {}, hostContext(widgets))

    // when
    await pi.dispatch("session_start", {}, hostContext(widgets))

    // then
    expect(widgets.filter((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY)).toHaveLength(1)
  })
})

// --- wiring: the whole chain from config to painted rows ---------------------------

interface FakeTui {
  layoutRoot: unknown
  readonly terminal: { columns: number }
  renders: number
  setLayoutRoot(component: unknown): void
  requestRender(): void
  openUrl?: (url: string) => void
  readonly [PI_TUI_VIEWPORT]: true
}

function fakeTui(columns = 200): FakeTui {
  const root = { render: () => ["transcript"], invalidate: () => {} }
  const tui: FakeTui = {
    layoutRoot: root,
    terminal: { columns },
    renders: 0,
    setLayoutRoot(component) {
      tui.layoutRoot = component
    },
    requestRender() {
      tui.renders += 1
    },
    [PI_TUI_VIEWPORT]: true,
  }
  return tui
}

interface ManualTimers extends PanelTimers {
  fire(): void
  pending(): number
}

function manualTimers(): ManualTimers {
  let queue: Array<() => void> = []
  return {
    set(callback) {
      queue.push(callback)
      return queue.length
    },
    clear() {
      queue = []
    },
    fire() {
      const due = queue
      queue = []
      for (const callback of due) callback()
    },
    pending: () => queue.length,
  }
}

/** Render the panel column the way the layout engine would. */
function columnRows(tui: FakeTui, width = 52): string[] {
  const root = tui.layoutRoot
  if (typeof root !== "object" || root === null) throw new Error("no layout root")
  const accessor = (root as Record<symbol, unknown>)[PI_TUI_LAYOUT_NODE]
  if (typeof accessor !== "function") throw new Error("root is not a layout node")
  const node = accessor() as { entries: ReadonlyArray<{ component: { render(width: number): string[] } }> }
  const panel = node.entries[1]?.component
  if (panel === undefined) throw new Error("no panel entry")
  return panel.render(width).map((line) => line.trimEnd())
}

function mounted(
  overrides: Partial<Parameters<typeof createSidePanelComponent>[0]> = {},
  hostExtras: Record<string, unknown> = {},
  cwd = "/repo",
) {
  const pi = new FakeExtensionAPI()
  pi.cwd = cwd
  const widgets: WidgetCall[] = []
  const timers = manualTimers()
  let clock = 100_000
  const pending: Promise<void>[] = []
  const component = createSidePanelComponent({
    loadSettings: () => settings({ enabled: true }),
    defer: (callback) => callback(),
    timers,
    now: () => clock,
    readTaskRecords: () => [],
    // Memory resolves a real identity from the developer's omo.json; only memory tests opt in.
    resolveMemory: () => undefined,
    // The panel starts its refreshes without the host waiting; the harness waits for them, so every
    // assertion after a dispatch reads what that event actually led to.
    track: (work) => {
      pending.push(work)
    },
    ...overrides,
  })
  component.register(pi, componentContext(pi))
  const rawDispatch = pi.dispatch.bind(pi)
  pi.dispatch = async (event, payload, ctx) => {
    const results = await rawDispatch(event, payload, ctx)
    while (pending.length > 0) await Promise.all(pending.splice(0))
    return results
  }
  const tui = fakeTui()
  const notices: string[] = []
  const host = hostContext(widgets, {
    model: { id: "anthropic/claude-opus-5" },
    getContextUsage: () => ({ tokens: 29_000, contextWindow: 1_000_000, percent: 2.9 }),
    sessionManager: {
      getSessionId: () => "session-1",
      getUsageTotals: () => ({ input: 12_300, output: 4_500, cacheRead: 0, cacheWrite: 0, cost: 1.2 }),
    },
    ui: {
      setWidget(key: string, content: unknown) {
        widgets.push({ key, content })
      },
      notify(message: string) {
        notices.push(message)
      },
    },
    ...hostExtras,
  })
  return {
    pi,
    rawDispatch,
    tui,
    host,
    timers,
    widgets,
    notices,
    advance: (ms: number) => {
      clock += ms
    },
    attach: (): void => {
      // The latest anchor: a remount registers a fresh one, and an earlier one is stale by design.
      const factory = [...widgets].reverse().find((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY)?.content
      if (typeof factory !== "function") throw new Error("anchor factory missing")
      ;(factory as (tui: unknown, theme: unknown) => unknown)(tui, undefined)
    },
  }
}

describe("side panel wiring", () => {
  test.each([
    { cwd: "/repo", location: "/repo" },
    {
      cwd: "/workspaces/long-nested-directory/another-directory/oh-my-openagent-test-worktree",
      location: "…ory/another-directory/oh-my-openagent-test-worktree",
    },
  ])("#given a mounted panel at $cwd #when the column renders #then it carries the session facts and the location", async ({ cwd, location }) => {
    // given
    const harness = mounted({}, {}, cwd)
    await harness.pi.dispatch("session_start", {}, harness.host)

    // when
    harness.attach()
    const rows = columnRows(harness.tui)

    // then
    expect(rows[0]).toBe("SESSION  $1.20 · 16.8K")
    expect(rows).toContain("model   claude-opus-5")
    expect(rows).toContain("CONTEXT  29K/1M")
    expect(rows[rows.length - 1]).toBe(location)
  })

  test("#given a tool starts #when the column renders #then the tool row appears with its target", async () => {
    // given
    const harness = mounted()
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    await harness.pi.dispatch("tool_execution_start", { toolName: "read", args: { file_path: "src/index.ts" } }, harness.host)
    const rows = columnRows(harness.tui)

    // then
    expect(rows).toContain("TOOLS  1")
    expect(rows).toContain("read  src/index.ts")
  })

  test("#given recorded tools #when the next user input arrives #then the tool section is cleared", async () => {
    // given
    const harness = mounted()
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    await harness.pi.dispatch("tool_execution_start", { toolName: "read" }, harness.host)

    // when
    await harness.pi.dispatch("input", { text: "next" }, harness.host)
    const rows = columnRows(harness.tui)

    // then
    expect(rows.some((row) => row.startsWith("TOOLS"))).toBe(false)
  })

  test("#given a running child in the task store #when the column renders #then its row shows live elapsed time", async () => {
    // given
    const harness = mounted({
      readTaskRecords: () => [
        {
          task_id: "t1",
          status: "running",
          created_at: new Date(40_000).toISOString(),
          parent_session_id: "session-1",
          task_summary: "map the seams",
        },
      ],
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const rows = columnRows(harness.tui)

    // then
    expect(rows).toContain("AGENTS  1 running · 0 done")
    expect(rows.some((row) => row.startsWith("● map the seams  1m00"))).toBe(true)
  })

  test("#given another session's child #when the column renders #then it is not shown", async () => {
    // given
    const harness = mounted({
      readTaskRecords: () => [
        { task_id: "t2", status: "running", created_at: new Date(0).toISOString(), parent_session_id: "other" },
      ],
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const rows = columnRows(harness.tui)

    // then
    expect(rows.some((row) => row.startsWith("AGENTS"))).toBe(false)
  })

  test("#given a running child #when the live timer fires #then the panel repaints and rearms", async () => {
    // given
    const harness = mounted({
      readTaskRecords: () => [
        { task_id: "t1", status: "running", created_at: new Date(0).toISOString(), parent_session_id: "session-1" },
      ],
    })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const before = harness.tui.renders

    // when
    harness.timers.fire()

    // then
    expect(harness.tui.renders).toBeGreaterThan(before)
    expect(harness.timers.pending()).toBe(1)
  })

  test("#given no running children #when mounted #then no live timer is armed", async () => {
    // given
    const harness = mounted()

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(harness.timers.pending()).toBe(0)
  })

  test("#given a mounted panel #when the session shuts down #then the timer is cleared and the root restored", async () => {
    // given
    const harness = mounted({
      readTaskRecords: () => [
        { task_id: "t1", status: "running", created_at: new Date(0).toISOString(), parent_session_id: "session-1" },
      ],
    })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    await harness.pi.dispatch("session_shutdown", {}, harness.host)

    // then
    expect(harness.timers.pending()).toBe(0)
    expect((harness.tui.layoutRoot as { render(width: number): string[] }).render(10)).toEqual(["transcript"])
  })
})

// --- git wiring -------------------------------------------------------------------

const GIT_STATUS = " M tracked.txt\u0000?? brand-new.txt\u0000"
const GIT_UNSTAGED = "2\t1\ttracked.txt\u0000"

function gitExec(calls: string[][] = []) {
  const exec = async (_command: string, args: string[]) => {
    calls.push(args)
    if (args[0] === "status") return { stdout: GIT_STATUS, stderr: "", code: 0 }
    if (args.includes("--cached")) return { stdout: "", stderr: "", code: 0 }
    return { stdout: GIT_UNSTAGED, stderr: "", code: 0 }
  }
  return { exec, calls }
}

describe("side panel git wiring", () => {
  test("#given a repository and a host exec #when the column renders #then changed files and the branch appear", async () => {
    // given
    const { exec } = gitExec()
    const harness = mounted({ exec, findGitRoot: () => "/repo", readGitBranch: () => "feat/side-panel" })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const rows = columnRows(harness.tui)

    // then
    expect(rows).toContain("FILES  2 changed")
    expect(rows).toContain(" M tracked.txt  +2/-1")
    expect(rows).toContain("?? brand-new.txt")
    expect(rows[rows.length - 1]?.endsWith("· feat/side-panel")).toBe(true)
  })

  test("#given two tool ends inside the floor #when git refreshes #then only one read happens", async () => {
    // given
    const { exec, calls } = gitExec()
    const harness = mounted({ exec, findGitRoot: () => "/repo", readGitBranch: () => undefined })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const afterMount = calls.length

    // when
    await harness.pi.dispatch("tool_execution_end", {}, harness.host)
    await harness.pi.dispatch("tool_execution_end", {}, harness.host)

    // then
    expect(afterMount).toBe(3)
    expect(calls.length).toBe(afterMount)
  })

  test("#given the floor has passed #when a tool ends #then git is read again", async () => {
    // given
    const { exec, calls } = gitExec()
    const harness = mounted({ exec, findGitRoot: () => "/repo", readGitBranch: () => undefined })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const afterMount = calls.length

    // when
    harness.advance(GIT_REFRESH_FLOOR_MS + 1)
    await harness.pi.dispatch("tool_execution_end", {}, harness.host)

    // then
    expect(calls.length).toBe(afterMount + 3)
  })

  test("#given a host without exec #when the column renders #then the files section stays empty", async () => {
    // given
    const harness = mounted({ exec: undefined, findGitRoot: () => "/repo", readGitBranch: () => "main" })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const rows = columnRows(harness.tui)

    // then
    expect(rows.some((row) => row.startsWith("FILES"))).toBe(false)
  })

  test("#given a directory outside any repository #when mounted #then git is never invoked", async () => {
    // given
    const { exec, calls } = gitExec()
    const harness = mounted({ exec, findGitRoot: () => undefined })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(calls).toEqual([])
    expect(columnRows(harness.tui).some((row) => row.startsWith("FILES"))).toBe(false)
  })
})

describe("side panel usage wiring", () => {
  test("#given the usage section is off #when a session starts #then no credential is ever read", async () => {
    // given
    let reads = 0
    const harness = mounted({
      loadSettings: () => settings({ enabled: true }),
      usage: {
        readCredentials: () => {
          reads += 1
          return { auth: {}, pool: undefined }
        },
        fetch: () => Promise.reject(new Error("the network must not be touched")),
      },
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(reads).toBe(0)
  })

  test("#given the section is on #when a session starts #then credentials are read for the poll", async () => {
    // given
    let reads = 0
    const harness = mounted({
      loadSettings: () => settings({ enabled: true, sections: { ...allSections(), usage: true } }),
      usage: {
        cachePath: join(testTempDir("omo-usage-wiring-"), "usage.json"),
        readCredentials: () => {
          reads += 1
          return { auth: {}, pool: undefined }
        },
        fetch: () => Promise.reject(new Error("no provider is configured, so nothing should be fetched")),
      },
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)

    // then
    expect(reads).toBe(1)
  })

  test("#given a turn ends #when the panel refreshes #then the poller gets a pass for rotations", async () => {
    // given a pool rotation only shows up when credentials are re-read; waiting for the poll
    // interval would leave the old account's name over the new account's numbers
    let reads = 0
    const harness = mounted({
      loadSettings: () => settings({ enabled: true, sections: { ...allSections(), usage: true } }),
      usage: {
        cachePath: join(testTempDir("omo-usage-nudge-"), "usage.json"),
        readCredentials: () => {
          reads += 1
          return { auth: {}, pool: undefined }
        },
        fetch: () => Promise.reject(new Error("no provider is configured, so nothing should be fetched")),
      },
    })
    await harness.pi.dispatch("session_start", {}, harness.host)
    const afterMount = reads

    // when
    await harness.pi.dispatch("turn_end", {}, harness.host)

    // then
    expect(afterMount).toBe(1)
    expect(reads).toBeGreaterThan(afterMount)
  })

  test("#given numbers another session cached #when the panel mounts #then they are on screen at once", async () => {
    // given the cache is shared, so a new window starts with the numbers rather than waiting
    const cachePath = join(testTempDir("omo-usage-shared-"), "usage.json")
    writeFileSync(
      cachePath,
      JSON.stringify({ claude: { account: "work", updatedAt: 100_000, windows: [{ label: "5h", percent: 44 }] } }),
    )
    const harness = mounted({
      loadSettings: () => settings({ enabled: true, sections: { ...allSections(), usage: true } }),
      usage: {
        cachePath,
        readCredentials: () => ({ auth: {}, pool: undefined }),
        fetch: () => Promise.reject(new Error("the cached entry is fresh, so nothing should be fetched")),
      },
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    const rows = columnRows(harness.tui)
    expect(rows.some((row) => row.startsWith("USAGE"))).toBe(true)
    expect(rows.some((row) => row.includes("44%"))).toBe(true)
  })
})

function allSections(): OmoSidePanelSettings["sections"] {
  return OmoSidePanelSettingsSchema.parse({}).sections
}

describe("side panel goal wiring", () => {
  const GOAL_PATH = "/state/goal.json"
  const OBJECTIVE = "Extend the side panel with the subsystems omo gained since beta.53"
  const goal = {
    objective: OBJECTIVE,
    status: "active" as const,
    tokensUsed: 148_000,
    timeUsedSeconds: 8_040,
    consecutiveContinuations: 0,
    unattendedContinuations: 0,
  }

  test("#given a host that publishes no goal store #when mounted #then no goal block is drawn", async () => {
    // given most sessions carry no goal; the reader's own suite pins that an absent path costs no
    // filesystem call, so what the wiring owes is passing the host's absence through untouched
    const asked: (string | undefined)[] = []
    const harness = mounted({
      readGoal: (path) => {
        asked.push(path)
        return path === undefined ? undefined : goal
      },
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(columnRows(harness.tui).some((row) => row.startsWith("GOAL"))).toBe(false)
    expect(asked.every((path) => path === undefined)).toBe(true)
  })

  test("#given the host exposes a goal store #when mounted #then the goal is on screen", async () => {
    // given
    const harness = mounted({ readGoal: () => goal }, { goalStoreFile: GOAL_PATH })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    const rows = columnRows(harness.tui)
    expect(rows.some((row) => row.startsWith("GOAL  active"))).toBe(true)
    expect(rows.some((row) => row.includes("Extend the side panel"))).toBe(true)
  })

  test("#given a turn ends #when the goal moved #then the column follows it", async () => {
    // given senpi publishes no goal event an extension can subscribe to, so the ordinary refresh
    // path is what keeps the block current
    let status: "active" | "complete" = "active"
    const harness = mounted({ readGoal: () => ({ ...goal, status }) }, { goalStoreFile: GOAL_PATH })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    expect(columnRows(harness.tui).some((row) => row.startsWith("GOAL  active"))).toBe(true)

    // when
    status = "complete"
    await harness.pi.dispatch("turn_end", {}, harness.host)

    // then
    expect(columnRows(harness.tui).some((row) => row.startsWith("GOAL  complete"))).toBe(true)
  })

  test("#given the goal row is clicked #when the host activates it #then the whole objective opens", async () => {
    // given the row shows a cut objective; the rest of it is the entire point of the click
    const harness = mounted(
      { readGoal: () => goal, loadSettings: () => settings({ enabled: true, clickable: true }) },
      { goalStoreFile: GOAL_PATH },
    )
    const foreign: string[] = []
    harness.tui.openUrl = (url) => foreign.push(url)
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    harness.tui.openUrl?.("omo-panel:goal/current")
    await Promise.resolve()
    await Promise.resolve()

    // then the host's own callback never sees our scheme, and the full text is delivered - the
    // viewer wraps it to its own column, so the text is compared with those breaks undone
    expect(foreign).toEqual([])
    const delivered = harness.notices.join("\n").replace(/\n/g, " ")
    expect(delivered).toContain(OBJECTIVE)
  })
})

describe("side panel memory wiring", () => {
  const identity: PanelMemoryIdentity = {
    id: "notwork-09334074",
    reflectionDir: "/mem/runtime/reflection",
    recallDir: "/mem/runtime/recall",
    factsQueueDir: "/mem/runtime/facts-queue",
    recallLedgerDir: "/mem/runtime/recall/ledger",
    recallPendingDir: "/mem/runtime/recall/pending",
  }
  const DETAIL = "bwrap: Creating new namespace failed: Operation not permitted"
  const parked: PanelMemory = {
    identity: identity.id,
    reflection: {
      streak: 3,
      parkedAt: "2026-09-21T09:00:00.000Z",
      nextProbeAt: "2026-09-21T15:00:00.000Z",
      reason: "reflection sandbox refused to start",
      detail: DETAIL,
    },
    factsQueued: 3,
    recallSurfaced: 12,
    recallPending: 0,
  }

  test("#given the memory section is off #when mounted #then the identity is never resolved", async () => {
    // given resolving an identity probes the filesystem; a section nobody asked for must not
    const resolved: string[] = []
    const harness = mounted({
      loadSettings: () => settings({ enabled: true, sections: { ...allSections(), usage: false, memory: false } }),
      resolveMemory: (cwd) => {
        resolved.push(cwd)
        return identity
      },
      readMemory: () => Promise.resolve(parked),
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(resolved).toEqual([])
    expect(columnRows(harness.tui).some((row) => row.startsWith("MEMORY"))).toBe(false)
  })

  test("#given a resolved identity #when mounted #then the memory block is on screen", async () => {
    // given
    const harness = mounted({ resolveMemory: () => identity, readMemory: () => Promise.resolve(parked) })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    const rows = columnRows(harness.tui)
    expect(rows.some((row) => row.startsWith("MEMORY  notwork-09334074"))).toBe(true)
    expect(rows.some((row) => row.startsWith("reflect") && row.includes("parked"))).toBe(true)
    expect(rows.some((row) => row.startsWith("facts") && row.includes("3 queued"))).toBe(true)
  })

  test("#given an identity that will not resolve #when mounted #then nothing is read and nothing is drawn", async () => {
    // given memory can be switched off in omo.json, and the resolver can simply fail
    let reads = 0
    const harness = mounted({
      resolveMemory: () => undefined,
      readMemory: () => {
        reads += 1
        return Promise.resolve(parked)
      },
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(reads).toBe(0)
    expect(columnRows(harness.tui).some((row) => row.startsWith("MEMORY"))).toBe(false)
  })

  test("#given a burst of turns #when they land inside the floor #then memory is read once", async () => {
    // given the block costs a park read plus a readdir, and a turn boundary is not a park transition
    let reads = 0
    const harness = mounted({
      resolveMemory: () => identity,
      readMemory: () => {
        reads += 1
        return Promise.resolve(parked)
      },
    })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    const afterMount = reads

    // when
    await harness.pi.dispatch("turn_end", {}, harness.host)
    await harness.pi.dispatch("turn_end", {}, harness.host)

    // then
    expect(afterMount).toBe(1)
    expect(reads).toBe(afterMount)

    // and when the floor has passed
    harness.advance(MEMORY_REFRESH_FLOOR_MS + 1)
    await harness.pi.dispatch("turn_end", {}, harness.host)

    // then
    expect(reads).toBe(afterMount + 1)
  })

  test("#given the memory row is clicked #when the host activates it #then the park detail opens", async () => {
    // given the row can only say "parked"; the failure that parked it is what the click is for
    const harness = mounted({
      resolveMemory: () => identity,
      readMemory: () => Promise.resolve(parked),
      loadSettings: () => settings({ enabled: true, clickable: true }),
    })
    const foreign: string[] = []
    harness.tui.openUrl = (url) => foreign.push(url)
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    harness.tui.openUrl?.("omo-panel:memory/current")
    await Promise.resolve()
    await Promise.resolve()

    // then
    expect(foreign).toEqual([])
    const delivered = harness.notices.join("\n").replace(/\n/g, " ")
    expect(delivered).toContain(DETAIL)
    expect(delivered).toContain("notwork-09334074")
  })
})

describe("side panel session boundaries and section gates", () => {
  test("#given a child from the previous session #when the session switches #then the next session shows none of it", async () => {
    // given
    let records: PanelTaskRecord[] = [
        {
          task_id: "t1",
          status: "running",
          created_at: new Date(40_000).toISOString(),
          parent_session_id: "session-1",
          task_summary: "map the seams",
        },
    ]
    const harness = mounted({ readTaskRecords: () => records })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    expect(columnRows(harness.tui).some((row) => row.startsWith("AGENTS"))).toBe(true)

    // when
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
    records = []
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(columnRows(harness.tui).some((row) => row.startsWith("AGENTS"))).toBe(false)
  })

  test("#given the files section is off #when the panel mounts and refreshes #then git is never run", async () => {
    // given
    const calls: string[][] = []
    const sections = { ...OmoSidePanelSettingsSchema.parse({}).sections, files: false }
    const harness = mounted({
      loadSettings: () => settings({ enabled: true, sections }),
      findGitRoot: () => "/repo",
      readGitBranch: () => "main",
      exec: async (command, args) => {
        calls.push([command, ...args])
        return { stdout: "", stderr: "", code: 0, killed: false }
      },
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    await harness.pi.dispatch("tool_execution_end", {}, harness.host)

    // then
    expect(calls).toEqual([])
  })

  test("#given the panel is off at load #when the component registers #then no diff command is offered", () => {
    // given / when
    const harness = mounted({ loadSettings: () => settings({ enabled: false }) })

    // then
    expect(harness.pi.commands.some((command) => command.name === SIDE_PANEL_DIFF_COMMAND)).toBe(false)
  })

  test("#given a mounted column #when the host rebuilds its renderer for a TUI mode switch #then the column is attached again", async () => {
    // given
    const harness = mounted()
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    expect(columnRows(harness.tui).length).toBeGreaterThan(0)
    const anchorsBefore = harness.widgets.filter((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY && call.content !== undefined).length

    // when: the host clears the old root and mounts a fresh one, as switchTuiMode does
    harness.tui.setLayoutRoot({ render: () => ["transcript"], invalidate: () => {} })
    await harness.pi.dispatch("turn_end", {}, harness.host)
    harness.attach()

    // then: the host never calls a mounted factory again, so the panel must register a fresh anchor
    expect(harness.widgets.filter((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY && call.content !== undefined).length).toBe(anchorsBefore + 1)
    expect(columnRows(harness.tui).some((row) => row.startsWith("SESSION"))).toBe(true)
  })

  test("#given a widget block because the renderer had no root yet #when a root appears #then the column replaces the block", async () => {
    // given: a fullscreen renderer that builds its root lazily, or the regular half of a mode switch
    const harness = mounted()
    harness.tui.setLayoutRoot(undefined)
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    expect(() => columnRows(harness.tui)).toThrow()
    const anchorsBefore = harness.widgets.filter((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY && call.content !== undefined).length

    // when
    harness.tui.setLayoutRoot({ render: () => ["transcript"], invalidate: () => {} })
    await harness.pi.dispatch("turn_end", {}, harness.host)
    harness.attach()

    // then: the host never calls a mounted factory again, so the panel must register a fresh anchor
    expect(harness.widgets.filter((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY && call.content !== undefined).length).toBe(anchorsBefore + 1)
    expect(columnRows(harness.tui).some((row) => row.startsWith("SESSION"))).toBe(true)
  })

  test("#given the session ends before the deferred attach runs #when it finally runs #then nothing is installed", async () => {
    // given
    const queued: Array<() => void> = []
    const harness = mounted({ defer: (callback) => queued.push(callback) })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
    for (const callback of queued) callback()

    // then
    expect(() => columnRows(harness.tui)).toThrow()
  })
})

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("side panel lifecycle and guards", () => {
  test("#given a mounted column #when a switch is only announced #then the column stays", async () => {
    // given: the host can still cancel a switch after session_before_switch
    const harness = mounted()
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    await harness.pi.dispatch("session_before_switch", {}, harness.host)

    // then
    expect(columnRows(harness.tui).some((row) => row.startsWith("SESSION"))).toBe(true)
  })

  test("#given reads that never answer #when tool, message and turn events fire #then their handlers return at once", async () => {
    // given: every tool call queues behind these handlers in the host
    let hang = false
    const never = new Promise<never>(() => {})
    const harness = mounted({
      exec: async () => (hang ? await never : { stdout: "", code: 0 }),
      findGitRoot: () => "/repo",
      readGitBranch: () => "main",
      readTaskRecords: () => (hang ? never : []),
    })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()
    hang = true

    // when: each dispatch races the next turn of the event loop, which runs only once microtasks drain
    const settled: boolean[] = []
    const events = [["tool_execution_start", { toolName: "read" }], ["tool_execution_end", {}], ["message_end", {}], ["turn_end", {}]] as const
    for (const [event, payload] of events) {
      harness.advance(GIT_REFRESH_FLOOR_MS + 1)
      const idle = new Promise<boolean>((resolve) => setImmediate(() => resolve(false)))
      settled.push(await Promise.race([harness.rawDispatch(event, payload, harness.host).then(() => true), idle]))
    }

    // then
    expect(settled).toEqual([true, true, true, true])
  })

  test("#given the goal section is off #when mounted and refreshed #then the goal store is never read", async () => {
    // given
    let reads = 0
    const harness = mounted({
      loadSettings: () => settings({ enabled: true, sections: { ...allSections(), usage: false, goal: false } }),
      readGoal: () => {
        reads += 1
        return undefined
      },
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    await harness.pi.dispatch("turn_end", {}, harness.host)

    // then
    expect(reads).toBe(0)
  })

  test("#given the agents and session sections are off #when mounted and refreshed #then task records are never read", async () => {
    // given
    let reads = 0
    const harness = mounted({
      loadSettings: () => settings({ enabled: true, sections: { ...allSections(), usage: false, agents: false, session: false } }),
      readTaskRecords: () => {
        reads += 1
        return []
      },
    })

    // when
    await harness.pi.dispatch("session_start", {}, harness.host)
    await harness.pi.dispatch("turn_end", {}, harness.host)

    // then
    expect(reads).toBe(0)
  })

  test("#given a git read still running when its session ends #when it answers late #then the next session never shows it", async () => {
    // given
    const gate = deferred<void>()
    const called = deferred<void>()
    let phase = 1
    const harness = mounted({
      findGitRoot: () => "/repo",
      readGitBranch: () => "main",
      exec: async (_command, args) => {
        if (phase === 2) return { stdout: "", code: 128 }
        called.resolve()
        await gate.promise
        return { stdout: args[0] === "status" ? " M stale.ts\0" : "", code: 0 }
      },
    })
    const first = harness.rawDispatch("session_start", {}, harness.host)
    await called.promise

    // when
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
    phase = 2
    gate.resolve()
    await first
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(columnRows(harness.tui).some((row) => row.includes("stale.ts"))).toBe(false)
  })

  test("#given a memory read still running when its session ends #when it answers late #then the next session never shows it", async () => {
    // given
    const identity: PanelMemoryIdentity = {
      id: "late-memory",
      reflectionDir: "/mem/reflection",
      recallDir: "/mem/recall",
      factsQueueDir: "/mem/facts-queue",
      recallLedgerDir: "/mem/recall/ledger",
      recallPendingDir: "/mem/recall/pending",
    }
    const stale: PanelMemory = {
      identity: identity.id,
      reflection: { streak: 3, parkedAt: "2026-09-21T09:00:00.000Z", nextProbeAt: "2026-09-21T15:00:00.000Z", reason: "stale park", detail: "stale" },
      factsQueued: 7,
      recallSurfaced: 0,
      recallPending: 0,
    }
    const gate = deferred<void>()
    const called = deferred<void>()
    let phase = 1
    const harness = mounted({
      resolveMemory: () => identity,
      readMemory: async (): Promise<PanelMemory | undefined> => {
        if (phase === 2) return undefined
        called.resolve()
        await gate.promise
        return stale
      },
    })
    const first = harness.rawDispatch("session_start", {}, harness.host)
    await called.promise

    // when
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
    phase = 2
    gate.resolve()
    await first
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(columnRows(harness.tui).some((row) => row.includes("7 queued"))).toBe(false)
  })

  test("#given a task-record read still running when its session ends #when it answers late #then the next session never shows it", async () => {
    // given
    const gate = deferred<void>()
    const called = deferred<void>()
    let phase = 1
    const harness = mounted({
      readTaskRecords: async (): Promise<PanelTaskRecord[]> => {
        if (phase === 2) return []
        called.resolve()
        await gate.promise
        return [
          { task_id: "t1", status: "running", created_at: new Date(40_000).toISOString(), parent_session_id: "session-1", task_summary: "late child" },
        ]
      },
    })
    const first = harness.rawDispatch("session_start", {}, harness.host)
    await called.promise

    // when
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
    phase = 2
    gate.resolve()
    await first
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(columnRows(harness.tui).some((row) => row.startsWith("AGENTS"))).toBe(false)
  })

  test("#given the implementation is still loading when the session ends #when it loads #then nothing is mounted", async () => {
    // given
    const gate = deferred<void>()
    const harness = mounted({
      loadRuntime: async () => {
        await gate.promise
        const runtime = await import("./runtime")
        return runtime.createSidePanelController
      },
    })
    const first = harness.rawDispatch("session_start", {}, harness.host)

    // when
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
    gate.resolve()
    await first

    // then
    expect(harness.widgets.some((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY && call.content !== undefined)).toBe(false)
  })

  test("#given an ended session #when a tool finishes before the next one starts #then git is not run", async () => {
    // given
    const { exec, calls } = gitExec()
    const harness = mounted({ exec, findGitRoot: () => "/repo", readGitBranch: () => "main" })
    await harness.pi.dispatch("session_start", {}, harness.host)
    await harness.pi.dispatch("session_shutdown", {}, harness.host)
    calls.length = 0
    harness.advance(GIT_REFRESH_FLOOR_MS + 1)

    // when
    await harness.pi.dispatch("tool_execution_end", {}, harness.host)

    // then
    expect(calls).toEqual([])
  })

  test("#given files the last session showed #when the next session cannot read git #then they are gone", async () => {
    // given
    let failing = false
    const { exec: working } = gitExec()
    const harness = mounted({
      exec: async (command, args) => (failing ? { stdout: "", code: 128 } : await working(command, args)),
      findGitRoot: () => "/repo",
      readGitBranch: () => "main",
    })
    await harness.pi.dispatch("session_start", {}, harness.host)
    await harness.pi.dispatch("session_shutdown", {}, harness.host)

    // when
    failing = true
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(columnRows(harness.tui).some((row) => row.includes("tracked.txt"))).toBe(false)
  })

  test("#given the branch the last session showed #when the next session has files off #then the branch is gone", async () => {
    // given
    let filesOn = true
    const harness = mounted({
      loadSettings: () => settings({ enabled: true, sections: { ...allSections(), usage: false, files: filesOn } }),
      exec: gitExec().exec,
      findGitRoot: () => "/repo",
      readGitBranch: () => "feat-x",
    })
    await harness.pi.dispatch("session_start", {}, harness.host)
    await harness.pi.dispatch("session_shutdown", {}, harness.host)

    // when
    filesOn = false
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // then
    expect(columnRows(harness.tui).some((row) => row.includes("feat-x"))).toBe(false)
  })

  test("#given a file row clicked after the file left the list #when the notice is shown #then it carries no terminal controls", async () => {
    // given
    const { exec } = gitExec()
    const harness = mounted({
      exec,
      findGitRoot: () => "/repo",
      readGitBranch: () => "main",
      loadSettings: () => settings({ enabled: true, clickable: true }),
    })
    harness.tui.openUrl = () => undefined
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    harness.tui.openUrl?.("omo-panel:file/" + encodeURIComponent("gone\x1b]8;;x\x07.txt"))

    // then
    const notice = harness.notices.join("\n")
    expect(notice).not.toContain("\x1b")
    expect(notice).not.toContain("\x07")
    expect(notice).toContain("gone]8;;x.txt is no longer listed")
  })

  test("#given a default config #when the column is laid out #then it shows on a wide terminal and steps aside on a narrow one", async () => {
    // given
    const harness = mounted({ loadSettings: () => ({ ...OmoSidePanelSettingsSchema.parse({}), enabled: true }) })
    await harness.pi.dispatch("session_start", {}, harness.host)
    harness.attach()

    // when
    const accessor = (harness.tui.layoutRoot as Record<symbol, unknown>)[PI_TUI_LAYOUT_NODE]
    if (typeof accessor !== "function") throw new Error("root is not a layout node")
    const node = accessor() as {
      entries: ReadonlyArray<{ basis?: number; visible?: (viewport: { width: number; height: number }) => boolean }>
    }
    const panel = node.entries[1]

    // then: a quarter-ish column beside the transcript, and the classic layout on a small screen
    expect(panel?.visible?.({ width: 200, height: 50 })).toBe(true)
    expect(panel?.visible?.({ width: 100, height: 50 })).toBe(false)
    expect(panel?.basis ?? 0).toBeGreaterThanOrEqual(32)
    expect(panel?.basis ?? 0).toBeLessThan(100)
  })
})
