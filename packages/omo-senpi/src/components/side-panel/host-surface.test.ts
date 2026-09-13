import { describe, expect, test } from "bun:test"

import {
  MIN_TRANSCRIPT_COLUMNS,
  PI_TUI_LAYOUT_NODE,
  PI_TUI_VIEWPORT,
  SIDE_PANEL_ANCHOR_WIDGET_KEY,
  SIDE_PANEL_WIDGET_KEY,
} from "./constants"
import { createPanelHostSurface } from "./host-surface"
import type { PanelAction } from "./links"
import type { PanelComponent, PanelHostContext, PanelStackNode, PanelUi } from "./types"

interface WidgetCall {
  readonly key: string
  readonly content: unknown
  readonly placement: string | undefined
}

interface FakeUi extends PanelUi {
  readonly widgets: WidgetCall[]
  readonly notices: string[]
  factoryFor(key: string): ((tui: unknown, theme: unknown) => PanelComponent) | undefined
}

function fakeUi(): FakeUi {
  const widgets: WidgetCall[] = []
  const notices: string[] = []
  return {
    widgets,
    notices,
    setWidget(key, content, options) {
      widgets.push({ key, content, placement: options?.placement })
    },
    notify(message) {
      notices.push(message)
    },
    factoryFor(key) {
      for (let index = widgets.length - 1; index >= 0; index -= 1) {
        const call = widgets[index]
        if (call?.key !== key) continue
        return typeof call.content === "function" ? (call.content as (tui: unknown, theme: unknown) => PanelComponent) : undefined
      }
      return undefined
    },
  }
}

interface FakeTui {
  layoutRoot: unknown
  readonly terminal: { columns: number }
  renders: number
  setLayoutRoot(component: unknown): void
  requestRender(force?: boolean): void
  openUrl?: (url: string) => void
  readonly [PI_TUI_VIEWPORT]?: true
}

function fakeTui(
  options: {
    viewport?: boolean
    root?: PanelComponent | undefined
    columns?: number
    onUrl?: (url: string) => void
  } = {},
): FakeTui {
  const tui: FakeTui = {
    layoutRoot: options.root,
    terminal: { columns: options.columns ?? 200 },
    renders: 0,
    setLayoutRoot(component) {
      tui.layoutRoot = component
    },
    requestRender() {
      tui.renders += 1
    },
    ...(options.onUrl === undefined ? {} : { openUrl: options.onUrl }),
    ...(options.viewport === false ? {} : { [PI_TUI_VIEWPORT]: true as const }),
  }
  return tui
}

function transcriptRoot(): PanelComponent {
  return { render: () => ["transcript"], invalidate: () => {} }
}

function context(ui: PanelUi, overrides: Partial<PanelHostContext> = {}): PanelHostContext {
  return { ui, mode: "tui", hasUI: true, ...overrides }
}

function surfaceFor(ui: FakeUi, ctx: PanelHostContext, width = 40) {
  const warnings: string[] = []
  const surface = createPanelHostSurface({
    context: ctx,
    source: { rows: () => [{ text: "row" }] },
    width: () => width,
    minColumns: 120,
    clickable: false,
    logger: { warn: (message) => warnings.push(message), debug: () => {} },
    defer: (callback) => callback(),
  })
  return { surface, warnings }
}

/** The layout node is reached through the registry symbol, exactly as the engine reaches it. */
function stackNodeOf(root: unknown): PanelStackNode {
  if (typeof root !== "object" || root === null) throw new Error("root is not an object")
  const accessor = (root as Record<symbol, unknown>)[PI_TUI_LAYOUT_NODE]
  if (typeof accessor !== "function") throw new Error("root exposes no layout node")
  const node: unknown = accessor()
  if (!isStackNode(node)) throw new Error("layout node is not an hstack")
  return node
}

function isStackNode(value: unknown): value is PanelStackNode {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as { type?: unknown; entries?: unknown }
  return candidate.type === "hstack" && Array.isArray(candidate.entries)
}

describe("side panel host surface", () => {
  test("#given no interactive TUI #when mounted #then it stays dark and touches no widget", () => {
    // given
    const ui = fakeUi()
    const { surface } = surfaceFor(ui, context(ui, { hasUI: false }))

    // when
    const kind = surface.mount()

    // then
    expect(kind).toBe("dark")
    expect(ui.widgets).toEqual([])
  })

  test("#given a non-tui mode #when mounted #then it stays dark", () => {
    // given
    const ui = fakeUi()
    const { surface } = surfaceFor(ui, context(ui, { mode: "print" }))

    // when
    const kind = surface.mount()

    // then
    expect(kind).toBe("dark")
    expect(ui.widgets).toEqual([])
  })

  test("#given a viewport renderer with a root #when the anchor renders #then the transcript and panel share an hstack", () => {
    // given
    const ui = fakeUi()
    const root = transcriptRoot()
    const tui = fakeTui({ root })
    const { surface } = surfaceFor(ui, context(ui), 48)
    surface.mount()

    // when
    ui.factoryFor(SIDE_PANEL_ANCHOR_WIDGET_KEY)?.(tui, {})

    // then
    expect(surface.kind()).toBe("column")
    const node = stackNodeOf(tui.layoutRoot)
    expect(node.entries).toHaveLength(2)
    expect(node.entries[0]?.component).toBe(root)
    expect(node.entries[0]?.minSize).toBe(MIN_TRANSCRIPT_COLUMNS)
    expect(node.entries[1]?.basis).toBe(48)
    expect(node.entries[1]?.grow).toBe(0)
  })

  test("#given the wrapped root #when painted without the layout engine #then it renders the transcript unchanged", () => {
    // given
    const ui = fakeUi()
    const root: PanelComponent = { render: (width) => [`transcript:${width}`], invalidate: () => {} }
    const tui = fakeTui({ root })
    const { surface } = surfaceFor(ui, context(ui))
    surface.mount()
    ui.factoryFor(SIDE_PANEL_ANCHOR_WIDGET_KEY)?.(tui, {})

    // when
    const painted = (tui.layoutRoot as PanelComponent).render(120)

    // then
    expect(painted).toEqual(["transcript:120"])
  })

  test("#given a renderer without the layout seam #when the anchor renders #then the rows fall back to a widget block", () => {
    // given
    const ui = fakeUi()
    const { surface } = surfaceFor(ui, context(ui))
    surface.mount()

    // when
    ui.factoryFor(SIDE_PANEL_ANCHOR_WIDGET_KEY)?.({ notARenderer: true }, {})

    // then
    expect(surface.kind()).toBe("widget")
    const widget = ui.widgets.find((call) => call.key === SIDE_PANEL_WIDGET_KEY)
    expect(widget?.placement).toBe("aboveEditor")
    expect(typeof widget?.content).toBe("function")
  })

  test("#given a viewport renderer whose root is not built yet #when the anchor renders #then it falls back to a widget block", () => {
    // given
    const ui = fakeUi()
    const tui = fakeTui({ root: undefined })
    const { surface } = surfaceFor(ui, context(ui))
    surface.mount()

    // when
    ui.factoryFor(SIDE_PANEL_ANCHOR_WIDGET_KEY)?.(tui, {})

    // then
    expect(surface.kind()).toBe("widget")
    expect(tui.layoutRoot).toBeUndefined()
  })

  test("#given an installed column #when disposed #then the original root returns and widgets are cleared", () => {
    // given
    const ui = fakeUi()
    const root = transcriptRoot()
    const tui = fakeTui({ root })
    const { surface } = surfaceFor(ui, context(ui))
    surface.mount()
    ui.factoryFor(SIDE_PANEL_ANCHOR_WIDGET_KEY)?.(tui, {})

    // when
    surface.dispose()

    // then
    expect(tui.layoutRoot).toBe(root)
    expect(surface.kind()).toBe("dark")
    const lastAnchor = [...ui.widgets].reverse().find((call) => call.key === SIDE_PANEL_ANCHOR_WIDGET_KEY)
    expect(lastAnchor?.content).toBeUndefined()
  })

  test("#given another owner replaced the layout root #when disposed #then the foreign root is left alone", () => {
    // given
    const ui = fakeUi()
    const tui = fakeTui({ root: transcriptRoot() })
    const { surface } = surfaceFor(ui, context(ui))
    surface.mount()
    ui.factoryFor(SIDE_PANEL_ANCHOR_WIDGET_KEY)?.(tui, {})
    const foreign = transcriptRoot()
    tui.setLayoutRoot(foreign)

    // when
    surface.dispose()

    // then
    expect(tui.layoutRoot).toBe(foreign)
  })

  test("#given a terminal narrower than min_columns #when the panel entry is asked #then it reports itself invisible", () => {
    // given
    const ui = fakeUi()
    const tui = fakeTui({ root: transcriptRoot() })
    const { surface } = surfaceFor(ui, context(ui))
    surface.mount()
    ui.factoryFor(SIDE_PANEL_ANCHOR_WIDGET_KEY)?.(tui, {})

    // when
    const entry = stackNodeOf(tui.layoutRoot).entries[1]

    // then
    expect(entry?.visible?.({ width: 119, height: 40 })).toBe(false)
    expect(entry?.visible?.({ width: 120, height: 40 })).toBe(true)
  })

  test("#given a resize #when the layout node is queried again #then the panel width re-resolves", () => {
    // given
    const ui = fakeUi()
    const tui = fakeTui({ root: transcriptRoot(), columns: 200 })
    const seen: number[] = []
    const surface = createPanelHostSurface({
      context: context(ui),
      source: { rows: () => [{ text: "row" }] },
      width: (terminalWidth) => {
        seen.push(terminalWidth)
        return Math.floor(terminalWidth / 4)
      },
      minColumns: 120,
      clickable: false,
      logger: { warn: () => {}, debug: () => {} },
      defer: (callback) => callback(),
    })
    surface.mount()
    ui.factoryFor(SIDE_PANEL_ANCHOR_WIDGET_KEY)?.(tui, {})

    // when
    const before = stackNodeOf(tui.layoutRoot).entries[1]?.basis
    tui.terminal.columns = 160
    const after = stackNodeOf(tui.layoutRoot).entries[1]?.basis

    // then
    expect(before).toBe(50)
    expect(after).toBe(40)
    expect(seen).toEqual([50 * 4, 160])
  })
})

describe("side panel url hook", () => {
  interface Harness {
    readonly tui: FakeTui
    readonly hostUrls: string[]
    readonly actions: PanelAction[]
    readonly surface: ReturnType<typeof createPanelHostSurface>
  }

  function mounted(clickable: boolean): Harness {
    const ui = fakeUi()
    const hostUrls: string[] = []
    const actions: PanelAction[] = []
    const tui = fakeTui({ root: transcriptRoot(), onUrl: (url) => hostUrls.push(url) })
    const surface = createPanelHostSurface({
      context: context(ui),
      source: { rows: () => [{ text: "M a.ts", action: { kind: "file", path: "src/a.ts" } }] },
      width: () => 30,
      minColumns: 80,
      clickable,
      onAction: (action) => actions.push(action),
      logger: { warn: () => {}, debug: () => {} },
      defer: (callback) => callback(),
    })
    surface.mount()
    ui.factoryFor(SIDE_PANEL_ANCHOR_WIDGET_KEY)?.(tui, undefined)
    return { tui, hostUrls, actions, surface }
  }

  test("#given one of the panel's own urls #when the host activates it #then the action is dispatched", () => {
    // given
    const harness = mounted(true)

    // when
    harness.tui.openUrl?.("omo-panel:file/src%2Fa.ts")

    // then
    expect(harness.actions).toEqual([{ kind: "file", path: "src/a.ts" }])
    expect(harness.hostUrls).toEqual([])
  })

  test("#given a url the host owns #when activated #then it is handed straight back", () => {
    // given
    const harness = mounted(true)

    // when
    harness.tui.openUrl?.("https://example.com/docs")

    // then
    expect(harness.hostUrls).toEqual(["https://example.com/docs"])
    expect(harness.actions).toEqual([])
  })

  test("#given the panel is disposed #when a panel url arrives #then the host callback is back in place", () => {
    // given
    const harness = mounted(true)

    // when
    harness.surface.dispose()
    harness.tui.openUrl?.("omo-panel:file/src%2Fa.ts")

    // then the panel no longer answers for its own scheme
    expect(harness.actions).toEqual([])
    expect(harness.hostUrls).toEqual(["omo-panel:file/src%2Fa.ts"])
  })

  test("#given clicks are switched off #when the panel attaches #then the hook is never claimed", () => {
    // given
    const harness = mounted(false)

    // when
    harness.tui.openUrl?.("omo-panel:file/src%2Fa.ts")

    // then
    expect(harness.actions).toEqual([])
    expect(harness.hostUrls).toEqual(["omo-panel:file/src%2Fa.ts"])
  })
})

describe("side panel url hook across remounts", () => {
  test("#given a host that re-wraps every function it hands out #when remounted #then the callback does not nest", () => {
    // given the real renderer reaches an extension through a proxy that wraps function reads,
    // so a naive save-and-restore gains one wrapper per mount cycle
    const inner = fakeTui({ root: transcriptRoot(), onUrl: () => {} })
    const wrapping = new Proxy(inner, {
      get: (target, property) => {
        const value = Reflect.get(target, property, target)
        if (typeof value !== "function") return value
        return (...args: unknown[]) => Reflect.apply(value, target, args)
      },
      set: (target, property, value) => Reflect.set(target, property, value, target),
    })

    const mountOnce = (): void => {
      const ui = fakeUi()
      const surface = createPanelHostSurface({
        context: context(ui),
        source: { rows: () => [{ text: "M a.ts", action: { kind: "file", path: "src/a.ts" } }] },
        width: () => 30,
        minColumns: 80,
        clickable: true,
        onAction: () => {},
        logger: { warn: () => {}, debug: () => {} },
        defer: (callback) => callback(),
      })
      surface.mount()
      ui.factoryFor(SIDE_PANEL_ANCHOR_WIDGET_KEY)?.(wrapping, undefined)
      surface.dispose()
    }

    // when
    mountOnce()
    const afterFirst = inner.openUrl
    mountOnce()

    // then the restored callback is the same object, not a wrapper around the last one
    expect(inner.openUrl).toBe(afterFirst)
  })
})
