import plannerPrompt from "../../../../packages/prompts-core/prompts/ultrawork/planner.md" with { type: "text" }

export const ULTRAWORK_PLANNER_SECTION = plannerPrompt

export function getPlannerUltraworkMessage(): string {
  return `<ultrawork-mode>

**MANDATORY**: You MUST say "ULTRAWORK MODE ENABLED!" to the user as your first response when this mode activates. This is non-negotiable.

${ULTRAWORK_PLANNER_SECTION}

</ultrawork-mode>

`
}
