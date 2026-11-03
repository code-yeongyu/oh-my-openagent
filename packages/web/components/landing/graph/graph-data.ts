export interface GraphNode {
  readonly id: string
  readonly label: string
  readonly role: string
  readonly wave: 1 | 2 | 3
  readonly position: [number, number, number]
}

export const graphNodes: readonly GraphNode[] = [
  { id: "orchestrator", label: "Orchestrator", role: "lead", wave: 1, position: [-3, 0, 0] },
  { id: "planner", label: "Ultrawork Planner", role: "planner", wave: 2, position: [0, 2, -2] },
  {
    id: "plan-consultant",
    label: "Plan Consultant",
    role: "consultant",
    wave: 2,
    position: [0, 0, -2],
  },
  { id: "plan-reviewer", label: "Plan Reviewer", role: "reviewer", wave: 2, position: [0, -2, -2] },
  { id: "kibitzer", label: "Kibitzer", role: "advisor", wave: 3, position: [3, 3, -4] },
  { id: "architect", label: "Architect", role: "architect", wave: 3, position: [4, 2, -4] },
  { id: "deep", label: "Deep", role: "worker", wave: 3, position: [3, 1, -4] },
  { id: "quick", label: "Quick", role: "worker", wave: 3, position: [4, 0, -4] },
  {
    id: "visual-engineering",
    label: "Visual Engineering",
    role: "worker",
    wave: 3,
    position: [3, -1, -4],
  },
  { id: "explore", label: "Explore", role: "search", wave: 3, position: [4, -2, -4] },
  { id: "librarian", label: "Librarian", role: "researcher", wave: 3, position: [3, -3, -4] },
]

export const graphEdges = graphNodes.flatMap((source) =>
  graphNodes
    .filter((target) => target.wave === source.wave + 1)
    .map((target) => ({ source: source.id, target: target.id })),
)
export const mobileNodeIds = [
  "orchestrator",
  "planner",
  "plan-reviewer",
  "architect",
  "deep",
  "explore",
  "librarian",
] as const
