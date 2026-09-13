import { createPanelBody } from "./body"
import { isRecord } from "./guards"
import { parsePanelActionUrl } from "./links"
import {
  MIN_TRANSCRIPT_COLUMNS,
  SIDE_PANEL_PARKED_URL_HOOK,
  PI_TUI_LAYOUT_NODE,
  PI_TUI_VIEWPORT,
  SIDE_PANEL_ANCHOR_WIDGET_KEY,
  SIDE_PANEL_WIDGET_KEY,
} from "./constants"
import type {
  PanelComponent,
  PanelHostSurface,
  PanelHostSurfaceDeps,
  PanelHostTui,
  PanelLayoutRoot,
  PanelStackEntry,
  PanelSurfaceKind,
  PanelTheme,
  PanelUrlHost,
} from "./types"

/**
 * The only file that touches the host renderer.
 *
 * `setLayoutRoot` and the viewport marker are public pi-tui API, and senpi hands a
 * widget factory the live renderer, so the column is assembled from documented
 * surfaces. The current root is not declared anywhere, so it is read defensively:
 * when it cannot be found the panel downgrades to a widget block instead of
 * leaving the session with a half-installed layout.
 */
export function createPanelHostSurface(deps: PanelHostSurfaceDeps): PanelHostSurface {
  let theme: PanelTheme | undefined
  const clickable = (): boolean => deps.clickable && deps.onAction !== undefined
  const body = createPanelBody(deps.source, () => theme, clickable)
  const defer = deps.defer ?? queueMicrotask
  let kind: PanelSurfaceKind = "dark"
  let installed: InstalledColumn | undefined
  let widgetMounted = false
  let renderer: PanelHostTui | undefined

  interface InstalledColumn {
    readonly tui: PanelHostTui
    readonly originalRoot: PanelComponent
    readonly root: PanelComponent
  }

  interface InstalledUrlHook {
    readonly host: PanelUrlHost
    readonly previous: (url: string) => void
  }

  let urlHook: InstalledUrlHook | undefined

  /**
   * Claim the host's URL activation callback, which is the only path a mouse click has into an
   * extension: the renderer resolves an OSC 8 link from its own screen buffer and calls this.
   * Anything that is not one of the panel's own URLs is handed straight back to the host.
   */
  const installUrlHook = (candidate: unknown): void => {
    const onAction = deps.onAction
    if (!clickable() || onAction === undefined || urlHook !== undefined) return
    if (!isUrlHost(candidate)) {
      deps.logger.debug?.("side-panel: renderer exposes no url hook, rows stay unclickable")
      return
    }
    // The host's callback is parked on the renderer itself, once, and stays there: re-reading
    // it through the proxy would wrap it again on every mount.
    const parked = candidate[SIDE_PANEL_PARKED_URL_HOOK]
    const previous = isParkedHook(parked) ? parked.hook : candidate.openUrl
    if (!isParkedHook(parked)) candidate[SIDE_PANEL_PARKED_URL_HOOK] = { hook: previous }
    urlHook = { host: candidate, previous }
    candidate.openUrl = (url: string): void => {
      const action = parsePanelActionUrl(url)
      if (action === undefined) {
        previous(url)
        return
      }
      onAction(action)
    }
  }

  const mountWidget = (): PanelSurfaceKind => {
    deps.context.ui.setWidget(SIDE_PANEL_WIDGET_KEY, () => body, { placement: "aboveEditor" })
    widgetMounted = true
    kind = "widget"
    return kind
  }

  const attach = (candidate: unknown): void => {
    if (installed !== undefined) return
    // Clicks are wired before the layout is, because the widget fallback paints the same rows
    // and the host resolves a click from the rendered frame either way.
    installUrlHook(candidate)
    if (!isHostTui(candidate)) {
      deps.logger.debug?.("side-panel: renderer does not expose the layout seam, using a widget block")
      mountWidget()
      return
    }
    renderer = candidate
    const originalRoot = candidate.layoutRoot
    if (!isPanelComponent(originalRoot)) {
      // Fullscreen renderers build their root lazily; a widget block still shows the rows.
      deps.logger.debug?.("side-panel: no layout root to wrap yet, using a widget block")
      mountWidget()
      return
    }
    // The original root is installed by identity: it is itself a layout component,
    // and wrapping it in an adapter would strip its own scroll layout.
    const root = createColumnRoot(originalRoot, body, candidate, deps)
    candidate.setLayoutRoot(root)
    installed = { tui: candidate, originalRoot, root }
    kind = "column"
    candidate.requestRender(true)
  }

  return {
    mount(): PanelSurfaceKind {
      if (!deps.context.hasUI || deps.context.mode !== "tui") {
        deps.logger.debug?.("side-panel: no interactive TUI, staying dark")
        kind = "dark"
        return kind
      }
      // The widget factory is the sanctioned way to reach the live renderer. Mutating
      // the layout inside a render pass is unsafe, so the attach is deferred one tick.
      deps.context.ui.setWidget(SIDE_PANEL_ANCHOR_WIDGET_KEY, (tui, hostTheme) => {
        theme = panelThemeFrom(hostTheme)
        defer(() => attach(tui))
        return { render: () => [], invalidate: () => {} }
      })
      return kind
    },
    kind(): PanelSurfaceKind {
      return kind
    },
    requestRender(): void {
      renderer?.requestRender(false)
    },
    dispose(): void {
      if (urlHook !== undefined) {
        const { host, previous } = urlHook
        urlHook = undefined
        // Ownership cannot be checked the way the layout root's is: the renderer reaches an
        // extension through a proxy that returns a fresh wrapper for every function read, so
        // `host.openUrl === ours` is never true. The host assigns this callback once, at
        // construction, so putting the parked original back is the safe move.
        host.openUrl = previous
      }
      if (installed !== undefined) {
        const { tui, originalRoot, root } = installed
        installed = undefined
        // Only restore what is still ours: another owner may have replaced the root
        // since, and clobbering that would break the session we are leaving.
        if (tui.layoutRoot === root) {
          tui.setLayoutRoot(originalRoot)
          tui.requestRender(true)
        } else {
          deps.logger.debug?.("side-panel: layout root changed owner, leaving it alone")
        }
      }
      if (widgetMounted) {
        deps.context.ui.setWidget(SIDE_PANEL_WIDGET_KEY, undefined)
        widgetMounted = false
      }
      deps.context.ui.setWidget(SIDE_PANEL_ANCHOR_WIDGET_KEY, undefined)
      renderer = undefined
      kind = "dark"
    },
  }
}

/**
 * The hstack that puts the transcript and the panel side by side. Entries are rebuilt
 * on every layout query so a resize re-resolves the panel width, and `visible` drops
 * the column on terminals too narrow to carry both.
 */
function createColumnRoot(
  originalRoot: PanelComponent,
  body: PanelComponent,
  tui: PanelHostTui,
  deps: PanelHostSurfaceDeps,
): PanelLayoutRoot {
  const entries = (): readonly PanelStackEntry[] => [
    { component: originalRoot, basis: 0, grow: 1, shrink: 1, minSize: MIN_TRANSCRIPT_COLUMNS },
    {
      component: body,
      basis: deps.width(terminalColumns(tui)),
      grow: 0,
      shrink: 0,
      visible: (viewport) => viewport.width >= deps.minColumns,
    },
  ]
  return {
    // Containment walks expect children on a container-shaped root.
    children: [originalRoot, body],
    [PI_TUI_LAYOUT_NODE]: () => ({ type: "hstack" as const, entries: entries(), gap: 0, align: "stretch" as const }),
    // If anything ever paints this without the layout engine, behave exactly like
    // the unwrapped session rather than rendering a broken column.
    render: (width: number) => originalRoot.render(width),
    invalidate: () => {
      originalRoot.invalidate?.()
      body.invalidate?.()
    },
  }
}

function terminalColumns(tui: PanelHostTui): number {
  const terminal = isRecord(tui) ? tui["terminal"] : undefined
  if (isRecord(terminal) && typeof terminal["columns"] === "number") return terminal["columns"]
  return 0
}

/** The host theme is not declared on the adapter's ports, so it is adapted the same way `ui` is. */
function panelThemeFrom(value: unknown): PanelTheme | undefined {
  if (!isRecord(value)) return undefined
  const fg = value["fg"]
  if (typeof fg !== "function") return undefined
  return {
    fg(color, text) {
      const painted: unknown = Reflect.apply(fg, value, [color, text])
      return typeof painted === "string" ? painted : text
    },
  }
}


/** A pi-tui viewport renderer that exposes the public layout seam. */
function isHostTui(value: unknown): value is PanelHostTui {
  if (!isRecord(value)) return false
  if (value[PI_TUI_VIEWPORT] !== true) return false
  return typeof value["setLayoutRoot"] === "function" && typeof value["requestRender"] === "function"
}

function isParkedHook(value: unknown): value is { readonly hook: (url: string) => void } {
  return isRecord(value) && typeof value["hook"] === "function"
}

/** A renderer that activates URLs. Absent on hosts that never wired one. */
function isUrlHost(value: unknown): value is PanelUrlHost & { openUrl: (url: string) => void } {
  return isRecord(value) && typeof value["openUrl"] === "function"
}

function isPanelComponent(value: unknown): value is PanelComponent {
  return isRecord(value) && typeof value["render"] === "function"
}
