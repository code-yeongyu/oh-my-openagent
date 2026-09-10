import { describe, expect, test } from "bun:test"

import { OmoSidePanelSettingsSchema, type OmoSidePanelSettings } from "@oh-my-opencode/omo-config-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { homedir } from "node:os"

import {
  GIT_REFRESH_FLOOR_MS,
  PI_TUI_LAYOUT_NODE,
  PI_TUI_VIEWPORT,
  SIDE_PANEL_ANCHOR_WIDGET_KEY,
  SIDE_PANEL_FLAG,
} from "./constants"
import { createSidePanelComponent } from "./index"
import type { PanelTimers } from "./types"

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
  return { ...OmoSidePanelSettingsSchema.parse({}), ...overrides }
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

function mounted(overrides: Partial<Parameters<typeof createSidePanelComponent>[0]> = {}) {
  const pi = new FakeExtensionAPI()
  const widgets: WidgetCall[] = []
  const timers = manualTimers()
  let clock = 100_000
  const component = createSidePanelComponent({
    loadSettings: () => settings({ enabled: true }),
    defer: (callback) => callback(),
    timers,
    now: () => clock,
    readTaskRecords: () => [],
    ...overrides,
  })
  component.register(pi, componentContext(pi))
  const tui = fakeTui()
  const host = hostContext(widgets, {
    model: { id: "anthropic/claude-opus-5" },
    getContextUsage: () => ({ tokens: 29_000, contextWindow: 1_000_000, percent: 2.9 }),
    sessionManager: {
      getSessionId: () => "session-1",
      getUsageTotals: () => ({ input: 12_300, output: 4_500, cacheRead: 0, cacheWrite: 0, cost: 1.2 }),
    },
  })
  return {
    pi,
    tui,
    host,
    timers,
    widgets,
    advance: (ms: number) => {
      clock += ms
    },
    attach: (): void => {
      const factory = widgets.find((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY)?.content
      if (typeof factory !== "function") throw new Error("anchor factory missing")
      ;(factory as (tui: unknown, theme: unknown) => unknown)(tui, undefined)
    },
  }
}

describe("side panel wiring", () => {
  test("#given a mounted panel #when the column renders #then it carries the session facts and the location", async () => {
    // given
    const harness = mounted()
    await harness.pi.dispatch("session_start", {}, harness.host)

    // when
    harness.attach()
    const rows = columnRows(harness.tui)

    // then
    expect(rows[0]).toBe("SESSION  $1.20 · 16.8K")
    expect(rows).toContain("model   claude-opus-5")
    expect(rows).toContain("CONTEXT  29K/1M")
    expect(rows[rows.length - 1]).toBe(process.cwd().replace(homedir(), "~"))
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
