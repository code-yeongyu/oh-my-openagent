import { ULTRAWORK_PLANNER_PROMPT } from "@oh-my-opencode/prompts-core"

export const ULTRAWORK_PLANNER_SECTION = ULTRAWORK_PLANNER_PROMPT

export function getPlannerUltraworkMessage(): string {
  return `<ultrawork-mode>

**MANDATORY**: You MUST say "ULTRAWORK MODE ENABLED!" to the user as your first response when this mode activates. This is non-negotiable.

${ULTRAWORK_PLANNER_SECTION}

</ultrawork-mode>

`
}
