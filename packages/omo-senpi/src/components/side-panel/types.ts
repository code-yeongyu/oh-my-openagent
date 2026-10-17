import type { ReflectionParkState } from "@oh-my-opencode/memory-core"

import type { PanelAction } from "./links"

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

/** The renderer facts a popup needs; everything else about the host is irrelevant there. */
export interface PopupTui {
  readonly terminal?: { readonly rows?: number }
  requestRender(force?: boolean): void
}

/** Builds the component a host overlay paints, and closes itself through `done`. */
export type PanelPopupFactory = (
  tui: PopupTui,
  theme: PanelTheme | undefined,
  keybindings: unknown,
  done: (value?: unknown) => void,
) => unknown

/**
 * The overlay-capable slice of senpi's ExtensionUIContext, shared by every panel viewer so a
 * click and a command open the same thing. senpi carries the identical context on events and
 * on commands, which is what lets a click reach the overlay at all.
 */
export interface PanelOverlayUi {
  notify(message: string, type?: "info" | "warning" | "error"): void
  /**
   * Raw terminal input, interactive mode only. The host runs these listeners before its own
   * handling and honours `consume`, which is what lets an open viewer claim the wheel.
   */
  onTerminalInput?(handler: (data: string) => { consume?: boolean; data?: string } | undefined): () => void
  /** Absent on hosts without the overlay seam; the viewers degrade to a notification. */
  custom?(factory: PanelPopupFactory, options?: Record<string, unknown>): Promise<unknown>
}

/** The slice of senpi's ExtensionUIContext the panel drives. */
export interface PanelUi extends PanelOverlayUi {
  setWidget(
    key: string,
    content: string[] | ((tui: unknown, theme: unknown) => PanelComponent) | undefined,
    options?: { placement?: "belowEditor" | "aboveEditor" },
  ): void
}

/**
 * The renderer's URL activation callback - the host's only click hook. Not readonly: the panel
 * assigns it to recognise its own rows, and puts the host's back on dispose.
 */
export interface PanelUrlHost {
  openUrl?: (url: string) => void
  /** Parking spot for the host's own callback, keyed by the symbol in `host-surface.ts`. */
  [parked: symbol]: unknown
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

/** The statuses senpi's goal store actually writes. */
export type PanelGoalStatus = "active" | "paused" | "blocked" | "budgetLimited" | "complete"

/** The session's goal, reduced to what the column draws. */
export interface PanelGoal {
  readonly objective: string
  readonly status: PanelGoalStatus
  readonly tokensUsed: number
  readonly timeUsedSeconds: number
  readonly consecutiveContinuations: number
  readonly unattendedContinuations: number
  /** Only present when the goal was registered with one. */
  readonly tokenBudget?: number
}

/**
 * The two filesystem calls the goal reader needs, injected so the unit tests never touch a disk.
 * `stat` answers undefined for an absent file, which is the ordinary case.
 */
export interface PanelGoalSource {
  stat(path: string): { readonly mtimeMs: number; readonly size: number } | undefined
  read(path: string): string | undefined
}

/**
 * The memory identity this session is bound to, reduced to the four directories the column reads.
 * Structural on purpose: the row builders and their tests never import memory-core.
 */
export interface PanelMemoryIdentity {
  readonly id: string
  readonly reflectionDir: string
  /** Parent of the recall tree; the kibitzer's per-session sidecar directory hangs off it. */
  readonly recallDir: string
  readonly factsQueueDir: string
  readonly recallLedgerDir: string
  readonly recallPendingDir: string
}

/** Why automatic reflection is not running, when it is not. */
export interface PanelMemoryReflection {
  /** Consecutive failed runs. Three deterministic failures park the identity, six transient ones. */
  readonly streak: number
  /** Present only while parked; the host keeps one half-open probe per interval. */
  readonly parkedAt?: string
  readonly nextProbeAt?: string
  readonly reason?: string
  readonly detail?: string
}

/**
 * The resident kibitzer, as its own durable trace describes it. Liveness is not here: the sidecar
 * keeps its state in its process, so the only honest facts are the settled wakes it has written.
 */
export interface PanelMemoryKibitzer {
  readonly wakes: number
  readonly lastWakeAt?: string
  readonly lastStatus?: string
  /** The last settled wake counted toward the host's diagnostic-failure streak. */
  readonly lastFailed: boolean
  /** Nudge paths the parent re-validated and handed to delivery, summed over the log read. */
  readonly nudged: number
  /** Provider tokens the wakes reported, input + output + both cache sides. */
  readonly tokens: number
  /** The log was longer than the panel reads, so every count above is a floor. */
  readonly partial: boolean
}

/** What the memory subsystem is holding for this session. */
export interface PanelMemory {
  readonly identity: string
  readonly reflection?: PanelMemoryReflection
  /** Fact batches queued but not yet applied to the memory repository. */
  readonly factsQueued: number
  /** Memory paths recall has already surfaced in this session. */
  readonly recallSurfaced: number
  /** Nudges the kibitzer left for the next prompt of this session. */
  readonly recallPending: number
  /** Absent until the kibitzer has settled at least one wake for this session. */
  readonly kibitzer?: PanelMemoryKibitzer
}

/**
 * The three filesystem reads the memory block needs, injected so the unit tests never touch a
 * disk. All three are total: an absent or unreadable source answers empty, never throws.
 */
export interface PanelMemorySource {
  /** Upstream's lock-free park reader; undefined when the file cannot be read or parsed. */
  park(reflectionDir: string): Promise<ReflectionParkState | undefined>
  list(dir: string): Promise<readonly string[]>
  readJson(path: string): Promise<unknown>
  /** The last `maxBytes` of a file, with the partial first line already dropped when it was cut. */
  readTail(path: string, maxBytes: number): Promise<{ readonly text: string; readonly truncated: boolean } | undefined>
}

/** Semantic colour names; the body resolves them against the host theme. */
export type PanelColor = "text" | "muted" | "dim" | "accent" | "warning" | "error" | "success"

/** One painted line. Sections emit these, so they stay theme-free and testable without a host. */
export interface PanelRow {
  readonly text: string
  readonly color?: PanelColor
  /** What a click on this row opens. A row without one is painted as plain text. */
  readonly action?: PanelAction
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
  /** Paint rows as links and claim the host's URL hook. Off means the column is inert. */
  readonly clickable: boolean
  /** Where an activated row goes. Without it nothing is painted as a link. */
  readonly onAction?: (action: PanelAction) => void
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
