import type { LucideIcon } from "lucide-react"
import {
  Anvil,
  BookOpen,
  Compass,
  Eye,
  GitBranch,
  Hammer,
  ImageIcon,
  Lightbulb,
  ListChecks,
  Scale,
  Search,
  Shapes,
} from "lucide-react"

import { graphNodes, type GraphNode } from "@/components/landing/graph/graph-data"

import type { BentoSpan } from "@/components/ledger/bento-cell"

/** `landing.agents.roster.*` message keys. */
export type AgentKey =
  | "orchestrator"
  | "planner"
  | "planConsultant"
  | "planReviewer"
  | "kibitzer"
  | "architect"
  | "deep"
  | "quick"
  | "visualEngineering"
  | "explore"
  | "librarian"
  | "dynamic"

interface AgentMeta {
  readonly key: AgentKey
  readonly icon: LucideIcon
  readonly colSpan: BentoSpan
  readonly rowSpan: BentoSpan
  /** Bento order: the spanning cells first so `grid-flow-dense` fills without holes. */
  readonly order: number
}

export interface AgentCell extends AgentMeta {
  /** Graph node id (`components/landing/graph/graph-data.ts`) — shared with `useGraphFocus`. */
  readonly id: string
  readonly wave: GraphNode["wave"] | null
}

const AGENT_META: Readonly<Record<string, AgentMeta>> = {
  orchestrator: { key: "orchestrator", icon: ListChecks, colSpan: 2, rowSpan: 2, order: 0 },
  planner: { key: "planner", icon: Compass, colSpan: 2, rowSpan: 1, order: 1 },
  "plan-consultant": { key: "planConsultant", icon: Scale, colSpan: 1, rowSpan: 1, order: 2 },
  "plan-reviewer": { key: "planReviewer", icon: Eye, colSpan: 1, rowSpan: 1, order: 3 },
  kibitzer: { key: "kibitzer", icon: Lightbulb, colSpan: 1, rowSpan: 1, order: 4 },
  architect: { key: "architect", icon: Anvil, colSpan: 1, rowSpan: 1, order: 5 },
  deep: { key: "deep", icon: Hammer, colSpan: 1, rowSpan: 1, order: 6 },
  quick: { key: "quick", icon: GitBranch, colSpan: 1, rowSpan: 1, order: 7 },
  "visual-engineering": {
    key: "visualEngineering",
    icon: ImageIcon,
    colSpan: 1,
    rowSpan: 1,
    order: 8,
  },
  explore: { key: "explore", icon: Search, colSpan: 1, rowSpan: 1, order: 9 },
  librarian: { key: "librarian", icon: BookOpen, colSpan: 1, rowSpan: 1, order: 10 },
}

const DYNAMIC_CELL: AgentCell = {
  id: "dynamic",
  key: "dynamic",
  icon: Shapes,
  colSpan: 1,
  rowSpan: 1,
  order: 11,
  wave: null,
}

const graphCells: readonly AgentCell[] = graphNodes.flatMap((node) => {
  const meta = AGENT_META[node.id]
  return meta ? [{ ...meta, id: node.id, wave: node.wave }] : []
})

if (
  graphCells.length !== Object.keys(AGENT_META).length ||
  graphCells.length !== graphNodes.length
) {
  throw new Error("agents-data: graph nodes and agent roster disagree")
}

/**
 * 11 graph agents + the dynamic agent cell = 16 grid units (4 + 2 + 10) — fills 4 × 4 on
 * desktop and 2 × 8 on tablet with no holes (DESIGN.md §5 gapless verification).
 */
export const agentCells: readonly AgentCell[] = [...graphCells, DYNAMIC_CELL].sort(
  (a, b) => a.order - b.order,
)

export interface GraphWave {
  readonly wave: GraphNode["wave"]
  readonly nodeIds: readonly string[]
  readonly firstNodeId: string
}

const WAVES: readonly GraphNode["wave"][] = [1, 2, 3]

/** Waves in scheduling order; the terminal rows and the hero rail read from here. */
export const graphWaves: readonly GraphWave[] = WAVES.flatMap((wave) => {
  const nodeIds = graphNodes.filter((node) => node.wave === wave).map((node) => node.id)
  const [firstNodeId] = nodeIds
  return firstNodeId ? [{ wave, nodeIds, firstNodeId }] : []
})
