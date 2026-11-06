/**
 * The sample mass ulw run drawn as a graph: the orchestrator on top, the ten agents in five wave columns. Each scene
 * gives every node a target: shown (0/1), state, and whether records travel between the orchestrator and its agents.
 */
export type NodeState = "idle" | "running" | "done" | "blocked"

export interface GraphNode {
  readonly id: string
  readonly model: string
  readonly wave: number
}

export const GRAPH_NODES: readonly GraphNode[] = [
  { id: "plan-interview", model: "Fable 5.1", wave: 0 },
  { id: "scope-check", model: "Opus 5", wave: 1 },
  { id: "source-sweep", model: "GPT 6 Astra", wave: 1 },
  { id: "chart-system", model: "Fable 5.1", wave: 2 },
  { id: "claim-graph", model: "Opus 5", wave: 2 },
  { id: "dataset-build", model: "GPT 5.6 Sol", wave: 2 },
  { id: "deck", model: "GPT 6 Astra", wave: 3 },
  { id: "model-train", model: "Kimi K3", wave: 3 },
  { id: "report-draft", model: "Grok 4.6", wave: 3 },
  { id: "gate-review", model: "GLM 5.2", wave: 4 },
]

export interface Scene {
  readonly states: Readonly<Record<string, NodeState | null>>
  readonly flow: boolean
}

const all = (pick: (node: GraphNode) => NodeState | null): Scene["states"] =>
  Object.fromEntries(GRAPH_NODES.map((node) => [node.id, pick(node)]))

export const SCENES: readonly Scene[] = [
  { states: all((n) => (n.wave === 0 ? "running" : n.wave <= 4 ? "idle" : null)), flow: false },
  {
    states: all((n) =>
      n.wave === 0 ? "done" : n.wave === 1 ? "done" : n.wave === 2 ? "running" : "idle",
    ),
    flow: true,
  },
  {
    states: all((n) => (n.id === "model-train" ? "blocked" : n.wave <= 3 ? "done" : "idle")),
    flow: true,
  },
  {
    states: all((n) => (n.id === "model-train" ? "blocked" : n.wave === 4 ? "running" : "done")),
    flow: true,
  },
]
