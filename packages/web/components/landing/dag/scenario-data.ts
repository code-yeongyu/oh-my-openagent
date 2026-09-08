import type { DagNodeSpec, DagState, DagWave } from "./types"

export const RUN_NAME = "ship the dashboard"
export const USER_COMMAND = "mass ulw ship the dashboard"

/**
 * One realistic mass-ulw run: 10 nodes over 5 waves. Models are spread on purpose — at any
 * mid-run frame three or four different models are working side by side.
 */
export const NODE_SPECS: readonly DagNodeSpec[] = [
  {
    id: "plan-interview",
    label: "plan-interview",
    category: "planning",
    model: "Claude Fable 5.1",
    dependsOn: [],
  },
  {
    id: "gap-analysis",
    label: "gap-analysis",
    category: "analysis",
    model: "Claude Opus 5",
    dependsOn: ["plan-interview"],
  },
  {
    id: "plan-review",
    label: "acceptance-check",
    category: "verification",
    model: "GPT 6 Astra",
    dependsOn: ["plan-interview"],
  },
  {
    id: "schema-migration",
    label: "schema-migration",
    category: "deep",
    model: "GPT 6 Astra",
    dependsOn: ["gap-analysis"],
  },
  {
    id: "api-endpoints",
    label: "api-endpoints",
    category: "deep",
    model: "GPT 5.6 Sol",
    dependsOn: ["gap-analysis", "plan-review"],
  },
  {
    id: "design-tokens",
    label: "design-tokens",
    category: "visual-engineering",
    model: "Claude Fable 5.1",
    dependsOn: ["plan-review"],
  },
  {
    id: "dashboard-ui",
    label: "dashboard-ui",
    category: "visual-engineering",
    model: "Claude Opus 5",
    dependsOn: ["design-tokens", "api-endpoints"],
  },
  {
    id: "e2e-suite",
    label: "e2e-suite",
    category: "unspecified-high",
    model: "Kimi K3",
    dependsOn: ["api-endpoints", "schema-migration"],
  },
  {
    id: "docs",
    label: "docs",
    category: "writing",
    model: "Grok 4.6",
    dependsOn: ["api-endpoints"],
  },
  {
    id: "gate-review",
    label: "gate-review",
    category: "unspecified-low",
    model: "GLM 5.2",
    dependsOn: ["dashboard-ui", "e2e-suite", "docs"],
  },
]

export const WAVES: readonly DagWave[] = [
  { index: 0, nodeIds: ["plan-interview"] },
  { index: 1, nodeIds: ["gap-analysis", "plan-review"] },
  { index: 2, nodeIds: ["schema-migration", "api-endpoints", "design-tokens"] },
  { index: 3, nodeIds: ["dashboard-ui", "e2e-suite", "docs"] },
  { index: 4, nodeIds: ["gate-review"] },
]

export interface TimelineEvent {
  readonly atMs: number
  readonly nodeId: string
  readonly state: DagState
  readonly activity: string
}

/** Deterministic script, ~16.5s of run time followed by a hold; see LOOP_MS. */
export const TIMELINE: readonly TimelineEvent[] = [
  { atMs: 900, nodeId: "plan-interview", state: "running", activity: "reading 14 files" },
  {
    atMs: 2000,
    nodeId: "plan-interview",
    state: "running",
    activity: "interviewing: 3 forks resolved",
  },
  {
    atMs: 2700,
    nodeId: "plan-interview",
    state: "completed",
    activity: "plan: 10 nodes / 5 waves",
  },
  { atMs: 3000, nodeId: "gap-analysis", state: "running", activity: "diffing plan vs. codebase" },
  { atMs: 3200, nodeId: "plan-review", state: "running", activity: "checking acceptance criteria" },
  { atMs: 4400, nodeId: "gap-analysis", state: "running", activity: "found 3 gaps, 3 patched" },
  { atMs: 4900, nodeId: "gap-analysis", state: "completed", activity: "0 open gaps" },
  { atMs: 5300, nodeId: "plan-review", state: "completed", activity: "APPROVE" },
  { atMs: 5600, nodeId: "schema-migration", state: "running", activity: "writing migration 0042" },
  { atMs: 5800, nodeId: "api-endpoints", state: "running", activity: "scaffolding 12 routes" },
  { atMs: 6000, nodeId: "design-tokens", state: "running", activity: "auditing 28 tokens" },
  { atMs: 7300, nodeId: "api-endpoints", state: "running", activity: "bun run test:api" },
  { atMs: 7900, nodeId: "design-tokens", state: "completed", activity: "28 tokens, 0 raw hex" },
  {
    atMs: 8300,
    nodeId: "schema-migration",
    state: "completed",
    activity: "bun run typecheck exit 0",
  },
  { atMs: 8700, nodeId: "api-endpoints", state: "completed", activity: "12 routes verified" },
  { atMs: 9000, nodeId: "dashboard-ui", state: "running", activity: "rendering 6 views" },
  { atMs: 9200, nodeId: "e2e-suite", state: "running", activity: "bunx playwright test" },
  { atMs: 9400, nodeId: "docs", state: "running", activity: "writing 3 guides" },
  { atMs: 10600, nodeId: "e2e-suite", state: "blocked", activity: "waiting: seed fixture missing" },
  { atMs: 11500, nodeId: "dashboard-ui", state: "running", activity: "screenshots 375 / 1280" },
  { atMs: 11900, nodeId: "docs", state: "completed", activity: "examples checked" },
  { atMs: 12300, nodeId: "e2e-suite", state: "running", activity: "fixture seeded, rerunning" },
  { atMs: 12800, nodeId: "dashboard-ui", state: "completed", activity: "6 views, overflow 0" },
  { atMs: 14000, nodeId: "e2e-suite", state: "completed", activity: "84 passed, 0 flaky" },
  { atMs: 14300, nodeId: "gate-review", state: "running", activity: "auditing 10 nodes" },
  { atMs: 15400, nodeId: "gate-review", state: "running", activity: "replaying 3 mutation proofs" },
  {
    atMs: 16400,
    nodeId: "gate-review",
    state: "completed",
    activity: "APPROVE — every claim evidenced",
  },
]

/** Hold on the finished graph, then the run replays from pending. */
export const LOOP_MS = 20_500
