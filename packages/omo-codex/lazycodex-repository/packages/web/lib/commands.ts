export type LazyCommand = {
  readonly name: string;
  readonly syntax: string;
  readonly summary: string;
  readonly facts: readonly string[];
  readonly glyph: "loop" | "plan" | "work";
};

export const COMMANDS: readonly LazyCommand[] = [
  {
    name: "$ulw-loop",
    glyph: "loop",
    syntax: '$ulw-loop "task" [--completion-promise=TEXT] [--strategy=reset|continue]',
    summary: "A self-referential loop that runs until VERIFIED completion.",
    facts: [
      "Emits <promise>DONE</promise> when it reaches a completion claim",
      "Oracle must verify before the loop ends",
      "Iteration cap 500 in ultrawork mode (100 normal)",
    ],
  },
  {
    name: "$ulw-plan",
    glyph: "plan",
    syntax: '$ulw-plan "what to build"',
    summary: "Prometheus strategic planner — turns an idea into a decision-complete work plan.",
    facts: [
      "Socratic interview, then parallel codebase exploration",
      "Metis gap analysis, optional Momus review",
      "Writes plans/<slug>.md — never writes product code",
    ],
  },
  {
    name: "$start-work",
    glyph: "work",
    syntax: '$start-work [plan] [--worktree <path>]',
    summary: "Executes a Prometheus plan until every checkbox is done.",
    facts: [
      "Durable Boulder state survives across turns",
      "Parallel subagents, strict TDD + 5 evidence gates",
      "Prints ORCHESTRATION COMPLETE when finished",
    ],
  },
] as const;
