import type { DagState } from "./types"

/**
 * Port of the desktop app's workflowNodeStatus table onto the ledger tokens (DESIGN.md §2):
 * info → --accent, success → --status-ok, destructive → --status-err, warning → --status-busy,
 * muted → --text-lo. One table, so a state can never read as two inks on one surface.
 */
export interface DagStatusPresentation {
  readonly textClass: string
  readonly strokeClass: string
  readonly dotClass: string
  readonly dotPulses: boolean
  /** Card tone: border + opaque wash (running/failed only). */
  readonly cardToneClass: string
  readonly cardHoverClass: string
  /** Border-only emphasis for a card on the focused dependency path. */
  readonly cardConnectedClass: string
}

const ROWS: Record<DagState, DagStatusPresentation> = {
  running: {
    textClass: "text-accent",
    strokeClass: "stroke-accent",
    dotClass: "bg-accent",
    dotPulses: true,
    cardToneClass: "border-accent-32 dag-card-running",
    cardHoverClass: "hover:border-accent",
    cardConnectedClass: "border-accent",
  },
  completed: {
    textClass: "text-status-ok",
    strokeClass: "stroke-status-ok",
    dotClass: "bg-status-ok",
    dotPulses: false,
    cardToneClass: "border-status-ok/30",
    cardHoverClass: "hover:border-status-ok/70",
    cardConnectedClass: "border-status-ok/70",
  },
  failed: {
    textClass: "text-status-err",
    strokeClass: "stroke-status-err",
    dotClass: "bg-status-err",
    dotPulses: false,
    cardToneClass: "border-status-err/30 dag-card-failed",
    cardHoverClass: "hover:border-status-err/70",
    cardConnectedClass: "border-status-err/70",
  },
  blocked: {
    textClass: "text-status-busy",
    strokeClass: "stroke-status-busy",
    dotClass: "bg-status-busy",
    dotPulses: false,
    cardToneClass: "border-status-busy/30",
    cardHoverClass: "hover:border-status-busy/70",
    cardConnectedClass: "border-status-busy/70",
  },
  pending: {
    textClass: "text-text-lo",
    strokeClass: "stroke-text-lo",
    dotClass: "bg-text-lo/60",
    dotPulses: false,
    cardToneClass: "",
    cardHoverClass: "hover:border-line-strong",
    cardConnectedClass: "border-line-strong",
  },
}

export function dagStatus(state: DagState): DagStatusPresentation {
  return ROWS[state]
}

export function dagStrokeClass(state: DagState | undefined): string {
  return state === undefined ? ROWS.pending.strokeClass : ROWS[state].strokeClass
}
