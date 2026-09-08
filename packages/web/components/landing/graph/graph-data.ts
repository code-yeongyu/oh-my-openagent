export interface GraphNode {
  readonly id: string
  readonly label: string
  readonly role: string
  readonly wave: 1 | 2 | 3
  readonly position: [number, number, number]
}

export const graphNodes: readonly GraphNode[] = [
  { id: "sisyphus", label: "Orchestrator", role: "lead", wave: 1, position: [-3, 0, 0] },
  { id: "prometheus", label: "Planner", role: "planner", wave: 2, position: [0, 2, -2] },
  { id: "metis", label: "Metis", role: "consultant", wave: 2, position: [0, 0, -2] },
  { id: "momus", label: "Plan reviewer", role: "reviewer", wave: 2, position: [0, -2, -2] },
  { id: "atlas", label: "Atlas", role: "executor", wave: 3, position: [3, 3, -4] },
  { id: "hephaestus", label: "Hephaestus", role: "builder", wave: 3, position: [4, 2, -4] },
  { id: "oracle", label: "Oracle", role: "advisor", wave: 3, position: [3, 1, -4] },
  { id: "librarian", label: "Librarian", role: "researcher", wave: 3, position: [4, 0, -4] },
  { id: "explore", label: "Explore", role: "search", wave: 3, position: [3, -1, -4] },
  {
    id: "sisyphus-junior",
    label: "Worker",
    role: "worker",
    wave: 3,
    position: [4, -2, -4],
  },
  {
    id: "multimodal-looker",
    label: "Multimodal-Looker",
    role: "media",
    wave: 3,
    position: [3, -3, -4],
  },
]

export const graphEdges = graphNodes.flatMap((source) =>
  graphNodes
    .filter((target) => target.wave === source.wave + 1)
    .map((target) => ({ source: source.id, target: target.id })),
)
export const mobileNodeIds = [
  "sisyphus",
  "prometheus",
  "atlas",
  "hephaestus",
  "oracle",
  "librarian",
  "explore",
] as const
