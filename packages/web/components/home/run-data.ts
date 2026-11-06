/**
 * OmO's demo mass-ulw run (the same ten nodes as components/landing/dag/scenario-data.ts), grouped by wave with a
 * sample result each. model-train ends blocked on its GPU quota; gate-review is the last node and stays running.
 * Sample data: terminal output, so it is not translated.
 */
export type RunKind = "normal" | "blocked" | "last"

export interface RunNode {
  readonly id: string
  readonly meta: string
  readonly result?: string
  readonly kind: RunKind
}

export const RUN_PROMPT = "mass ulw 12k sources → ranking model → deck"
export const RUN_BOOT = "OmO · Claude Fable 5.1"

export const RUN_WAVES: ReadonlyArray<readonly RunNode[]> = [
  [
    {
      id: "plan-interview",
      meta: "planning · Claude Fable 5.1",
      result: "plan: 10 nodes / 5 waves",
      kind: "normal",
    },
  ],
  [
    { id: "scope-check", meta: "verification · Claude Opus 5", result: "APPROVE", kind: "normal" },
    {
      id: "source-sweep",
      meta: "deep · GPT 6 Astra",
      result: "11,388 sources kept",
      kind: "normal",
    },
  ],
  [
    {
      id: "chart-system",
      meta: "visual-engineering · Claude Fable 5.1",
      result: "12 charts, one palette",
      kind: "normal",
    },
    {
      id: "claim-graph",
      meta: "analysis · Claude Opus 5",
      result: "3,100 claims, 41 refuted",
      kind: "normal",
    },
    {
      id: "dataset-build",
      meta: "deep · GPT 5.6 Sol",
      result: "40k rows, 0 leaks",
      kind: "normal",
    },
  ],
  [
    {
      id: "deck",
      meta: "visual-engineering · GPT 6 Astra",
      result: "screenshots 375 / 1280",
      kind: "normal",
    },
    { id: "model-train", meta: "deep · Kimi K3", result: "waiting: GPU quota", kind: "blocked" },
    { id: "report-draft", meta: "writing · Grok 4.6", result: "every claim cited", kind: "normal" },
  ],
  [{ id: "gate-review", meta: "unspecified-low · GLM 5.2", kind: "last" }],
]

export const RUN_TOTAL = RUN_WAVES.reduce((sum, wave) => sum + wave.length, 0)
