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
  | "sisyphus"
  | "hephaestus"
  | "prometheus"
  | "metis"
  | "momus"
  | "atlas"
  | "oracle"
  | "librarian"
  | "explore"
  | "sisyphusJunior"
  | "multimodalLooker"
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
  sisyphus: { key: "sisyphus", icon: ListChecks, colSpan: 2, rowSpan: 2, order: 0 },
  hephaestus: { key: "hephaestus", icon: Hammer, colSpan: 2, rowSpan: 1, order: 1 },
  prometheus: { key: "prometheus", icon: Compass, colSpan: 1, rowSpan: 1, order: 2 },
  metis: { key: "metis", icon: Scale, colSpan: 1, rowSpan: 1, order: 3 },
  momus: { key: "momus", icon: Eye, colSpan: 1, rowSpan: 1, order: 4 },
  atlas: { key: "atlas", icon: Anvil, colSpan: 1, rowSpan: 1, order: 5 },
  oracle: { key: "oracle", icon: Lightbulb, colSpan: 1, rowSpan: 1, order: 6 },
  librarian: { key: "librarian", icon: BookOpen, colSpan: 1, rowSpan: 1, order: 7 },
  explore: { key: "explore", icon: Search, colSpan: 1, rowSpan: 1, order: 8 },
  "sisyphus-junior": { key: "sisyphusJunior", icon: GitBranch, colSpan: 1, rowSpan: 1, order: 9 },
  "multimodal-looker": {
    key: "multimodalLooker",
    icon: ImageIcon,
    colSpan: 1,
    rowSpan: 1,
    order: 10,
  },
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

if (graphCells.length !== Object.keys(AGENT_META).length) {
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
