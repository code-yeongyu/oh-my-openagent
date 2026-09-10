/**
 * Structural ports for the host surfaces the side panel drives.
 *
 * Nothing here imports pi-tui. The layout contract is reached through registry
 * symbols (`Symbol.for`), which is what lets the panel work when the host bundles
 * its own pi-tui copy, and the members senpi does not declare on its public types
 * are narrowed from `unknown` with runtime guards instead of a cast.
 */

/** The slice of a pi-tui component the panel renders and wraps. */
export interface PanelComponent {
  render(width: number): string[]
  invalidate?(): void
}

/** One entry of a pi-tui stack layout node. */
export interface PanelStackEntry {
  component: PanelComponent
  basis?: number | "auto"
  grow?: number
  shrink?: number
  minSize?: number
  maxSize?: number
  visible?: (viewport: { width: number; height: number }) => boolean
}

/** The horizontal stack the panel installs as the layout root. */
export interface PanelStackNode {
  type: "hstack"
  entries: readonly PanelStackEntry[]
  gap: number
  align: "stretch"
}

/**
 * The wrapper installed as the layout root: a component for renderers that paint it
 * directly, a container for containment walks, and a layout node for the engine. The
 * symbol index signature carries the `Symbol.for` layout key, which cannot appear as a
 * declared member because a registry symbol is not a `unique symbol`.
 */
export interface PanelLayoutRoot extends PanelComponent {
  readonly children: readonly PanelComponent[]
  readonly [key: symbol]: unknown
}

/**
 * The renderer members the panel needs. `setLayoutRoot` and the viewport marker are
 * public pi-tui API; `layoutRoot` is not declared, so it is read defensively and its
 * absence downgrades the panel instead of breaking it.
 */
export interface PanelHostTui {
  readonly mode?: unknown
  readonly layoutRoot?: unknown
  setLayoutRoot(component: PanelComponent | undefined): void
  requestRender(force?: boolean): void
}

/** The slice of senpi's ExtensionUIContext the panel drives. */
export interface PanelUi {
  setWidget(
    key: string,
    content: string[] | ((tui: unknown, theme: unknown) => PanelComponent) | undefined,
    options?: { placement?: "belowEditor" | "aboveEditor" },
  ): void
  notify(message: string, type?: "info" | "warning" | "error"): void
}

/** The context facts captured on entry; senpi carries `ui` on event contexts, not on ExtensionAPI. */
export interface PanelHostContext {
  readonly ui: PanelUi
  readonly mode: string | undefined
  readonly hasUI: boolean
}

/** Where the panel ended up. */
export type PanelSurfaceKind =
  /** A reflowing right column: the transcript shares the screen instead of being covered. */
  | "column"
  /** A block above the editor: the host refused the layout seam, the rows still render. */
  | "widget"
  /** Nothing rendered: no TUI, or the panel is disabled. */
  | "dark"

/** Semantic colour names; the body resolves them against the host theme. */
export type PanelColor = "text" | "muted" | "dim" | "accent" | "warning" | "error" | "success"

/** One painted line. Sections emit these, so they stay theme-free and testable without a host. */
export interface PanelRow {
  readonly text: string
  readonly color?: PanelColor
}

/** The slice of pi-tui's theme the panel needs; absent on hosts that hand no theme to a widget. */
export interface PanelTheme {
  fg(color: string, text: string): string
}

/** Rows are recomputed per frame so a live session updates while you watch it. */
export interface PanelRowSource {
  rows(width: number): readonly PanelRow[]
}

export interface PanelHostSurfaceDeps {
  readonly context: PanelHostContext
  readonly source: PanelRowSource
  /** Resolved column count for the panel, already clamped. */
  readonly width: (terminalWidth: number) => number
  /** Terminals narrower than this keep the classic single-column layout. */
  readonly minColumns: number
  readonly logger: PanelSurfaceLogger
  /** Injected so tests can drive the deferred attach synchronously. */
  readonly defer?: (callback: () => void) => void
}

export interface PanelSurfaceLogger {
  debug?(message: string, details?: unknown): void
  warn(message: string, details?: unknown): void
}

export interface PanelHostSurface {
  /** Mount the panel and report which surface it landed on. */
  mount(): PanelSurfaceKind
  kind(): PanelSurfaceKind
  requestRender(): void
  /** Restore the host to its pre-panel state. Idempotent. */
  dispose(): void
}

/** Injectable timers, so the live-refresh cadence is deterministic under test. */
export interface PanelTimers {
  set(callback: () => void, ms: number): PanelTimerHandle
  clear(handle: PanelTimerHandle): void
}

export type PanelTimerHandle = unknown
