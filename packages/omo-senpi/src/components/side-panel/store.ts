import { AGENT_ROW_CAP, TOOL_ROW_CAP } from "./constants"

/** A delegated child as the panel needs to draw it. */
export interface PanelChild {
  readonly id: string
  readonly name: string
  readonly category?: string
  readonly status: PanelChildStatus
  readonly startedAt: number
  readonly finishedAt?: number
  /** Last thing the child was seen doing; the row shows it while the child runs. */
  readonly activity?: string
  readonly turns?: number
  readonly tokens?: number
  readonly cost?: number
}

export type PanelChildStatus = "queued" | "running" | "finished" | "failed" | "cancelled"

/** A child update carries only what the source knows; absent fields keep their previous value. */
export interface PanelChildUpdate {
  readonly id: string
  readonly name?: string
  readonly category?: string
  readonly status?: PanelChildStatus
  readonly startedAt?: number
  readonly finishedAt?: number
  readonly activity?: string
  readonly turns?: number
  readonly tokens?: number
  readonly cost?: number
}

export interface PanelToolCall {
  readonly name: string
  readonly detail?: string
  readonly at: number
}

export interface PanelState {
  readonly children: readonly PanelChild[]
  readonly tools: readonly PanelToolCall[]
  /** Cost of finished children, counted once each: session usage totals do not include them. */
  readonly childSpend: number
}

export interface PanelStore {
  state(): PanelState
  /** Insert or merge a child by id. Returns true when the state actually changed. */
  upsertChild(update: PanelChildUpdate): boolean
  recordTool(call: PanelToolCall): void
  /** Tools are per-exchange context; the next user turn starts a fresh list. */
  clearTools(): void
}

const TERMINAL: ReadonlySet<PanelChildStatus> = new Set<PanelChildStatus>(["finished", "failed", "cancelled"])

export function createPanelStore(now: () => number = Date.now): PanelStore {
  const children = new Map<string, PanelChild>()
  let tools: PanelToolCall[] = []
  let childSpend = 0

  const evict = (): void => {
    if (children.size <= AGENT_ROW_CAP) return
    // A running child never loses its row: it is the one thing the column exists to show.
    const finished = [...children.values()]
      .filter((child) => TERMINAL.has(child.status))
      .sort((left, right) => (left.finishedAt ?? left.startedAt) - (right.finishedAt ?? right.startedAt))
    for (const child of finished) {
      if (children.size <= AGENT_ROW_CAP) break
      children.delete(child.id)
    }
  }

  return {
    state(): PanelState {
      return {
        children: [...children.values()].sort((left, right) => left.startedAt - right.startedAt),
        tools: [...tools],
        childSpend,
      }
    },

    upsertChild(update): boolean {
      const previous = children.get(update.id)
      const merged: PanelChild = {
        id: update.id,
        name: update.name ?? previous?.name ?? update.id,
        category: update.category ?? previous?.category,
        status: update.status ?? previous?.status ?? "queued",
        startedAt: update.startedAt ?? previous?.startedAt ?? now(),
        finishedAt: update.finishedAt ?? previous?.finishedAt,
        activity: update.activity ?? previous?.activity,
        turns: update.turns ?? previous?.turns,
        tokens: update.tokens ?? previous?.tokens,
        cost: update.cost ?? previous?.cost,
      }
      if (previous !== undefined && sameChild(previous, merged)) return false
      // Count a child's cost once, at the moment it stops running.
      const becameTerminal = TERMINAL.has(merged.status) && (previous === undefined || !TERMINAL.has(previous.status))
      if (becameTerminal && merged.cost !== undefined) childSpend += merged.cost
      children.set(merged.id, merged)
      evict()
      return true
    },

    recordTool(call): void {
      tools.push(call)
      if (tools.length > TOOL_ROW_CAP) tools = tools.slice(tools.length - TOOL_ROW_CAP)
    },

    clearTools(): void {
      tools = []
    },
  }
}

function sameChild(left: PanelChild, right: PanelChild): boolean {
  return (
    left.name === right.name &&
    left.category === right.category &&
    left.status === right.status &&
    left.startedAt === right.startedAt &&
    left.finishedAt === right.finishedAt &&
    left.activity === right.activity &&
    left.turns === right.turns &&
    left.tokens === right.tokens &&
    left.cost === right.cost
  )
}
