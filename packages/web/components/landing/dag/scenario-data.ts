import type { DagNodeSpec, DagState, DagWave } from "./types"

export const RUN_NAME = "market research, 12,000 sources"
export const USER_COMMAND = "mass ulw 12k sources → ranking model → deck"

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
    id: "source-sweep",
    label: "source-sweep",
    category: "deep",
    model: "GPT 6 Astra",
    dependsOn: ["plan-interview"],
  },
  {
    id: "scope-check",
    label: "scope-check",
    category: "verification",
    model: "Claude Opus 5",
    dependsOn: ["plan-interview"],
  },
  {
    id: "claim-graph",
    label: "claim-graph",
    category: "analysis",
    model: "Claude Opus 5",
    dependsOn: ["source-sweep"],
  },
  {
    id: "dataset-build",
    label: "dataset-build",
    category: "deep",
    model: "GPT 5.6 Sol",
    dependsOn: ["source-sweep", "scope-check"],
  },
  {
    id: "chart-system",
    label: "chart-system",
    category: "visual-engineering",
    model: "Claude Fable 5.1",
    dependsOn: ["scope-check"],
  },
  {
    id: "model-train",
    label: "model-train",
    category: "deep",
    model: "Kimi K3",
    dependsOn: ["dataset-build"],
  },
  {
    id: "report-draft",
    label: "report-draft",
    category: "writing",
    model: "Grok 4.6",
    dependsOn: ["claim-graph"],
  },
  {
    id: "deck",
    label: "deck",
    category: "visual-engineering",
    model: "GPT 6 Astra",
    dependsOn: ["chart-system", "claim-graph"],
  },
  {
    id: "gate-review",
    label: "gate-review",
    category: "unspecified-low",
    model: "GLM 5.2",
    dependsOn: ["model-train", "report-draft", "deck"],
  },
]

export const WAVES: readonly DagWave[] = [
  { index: 0, nodeIds: ["plan-interview"] },
  { index: 1, nodeIds: ["source-sweep", "scope-check"] },
  { index: 2, nodeIds: ["claim-graph", "dataset-build", "chart-system"] },
  { index: 3, nodeIds: ["model-train", "report-draft", "deck"] },
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
  { atMs: 900, nodeId: "plan-interview", state: "running", activity: "reading the brief" },
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
  { atMs: 3000, nodeId: "source-sweep", state: "running", activity: "crawling 12,000 sources" },
  { atMs: 3200, nodeId: "scope-check", state: "running", activity: "checking the brief's scope" },
  { atMs: 4400, nodeId: "source-sweep", state: "running", activity: "8,400 fetched, 612 dupes" },
  { atMs: 4900, nodeId: "source-sweep", state: "completed", activity: "11,388 sources kept" },
  { atMs: 5300, nodeId: "scope-check", state: "completed", activity: "APPROVE" },
  { atMs: 5600, nodeId: "claim-graph", state: "running", activity: "linking 3,100 claims" },
  { atMs: 5800, nodeId: "dataset-build", state: "running", activity: "labeling 40k rows" },
  { atMs: 6000, nodeId: "chart-system", state: "running", activity: "auditing 28 tokens" },
  { atMs: 7300, nodeId: "dataset-build", state: "running", activity: "splitting train / eval" },
  { atMs: 7900, nodeId: "chart-system", state: "completed", activity: "12 charts, one palette" },
  {
    atMs: 8300,
    nodeId: "claim-graph",
    state: "completed",
    activity: "3,100 claims, 41 refuted",
  },
  { atMs: 8700, nodeId: "dataset-build", state: "completed", activity: "40k rows, 0 leaks" },
  { atMs: 9000, nodeId: "model-train", state: "running", activity: "training epoch 1/5" },
  { atMs: 9200, nodeId: "report-draft", state: "running", activity: "writing 6 chapters" },
  { atMs: 9400, nodeId: "deck", state: "running", activity: "rendering 14 slides" },
  { atMs: 10600, nodeId: "model-train", state: "blocked", activity: "waiting: GPU quota" },
  { atMs: 11500, nodeId: "deck", state: "running", activity: "screenshots 375 / 1280" },
  { atMs: 11900, nodeId: "report-draft", state: "completed", activity: "every claim cited" },
  { atMs: 12300, nodeId: "model-train", state: "running", activity: "quota granted, epoch 3/5" },
  { atMs: 12800, nodeId: "deck", state: "completed", activity: "14 slides, overflow 0" },
  { atMs: 14000, nodeId: "model-train", state: "completed", activity: "eval nDCG 0.91" },
  { atMs: 14300, nodeId: "gate-review", state: "running", activity: "auditing 10 nodes" },
  { atMs: 15400, nodeId: "gate-review", state: "running", activity: "replaying 3,100 citations" },
  {
    atMs: 16400,
    nodeId: "gate-review",
    state: "completed",
    activity: "APPROVE — every claim evidenced",
  },
]

/** Hold on the finished graph, then the run replays from pending. */
export const LOOP_MS = 20_500
