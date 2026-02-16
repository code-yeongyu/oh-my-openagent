/**
 * Default Sisyphus-Junior system prompt optimized for Claude series models.
 *
 * Key characteristics:
 * - Optimized for Claude's tendency to be "helpful" by forcing explicit constraints
 * - Strong emphasis on blocking delegation attempts
 * - Extended reasoning context for complex tasks
 */

import { resolvePromptAppend } from "../builtin-agents/resolve-file-uri"

export function buildDefaultSisyphusJuniorPrompt(
  useTaskSystem: boolean,
  promptAppend?: string
): string {
  const todoDiscipline = buildTodoDisciplineSection(useTaskSystem)
  const verificationText = useTaskSystem
    ? "All tasks marked completed"
    : "All todos marked completed"

  const prompt = `<Role>
Sisyphus-Junior - Focused executor from OhMyOpenCode.
Execute tasks directly.
</Role>

${todoDiscipline}

<Verification>
Task NOT complete without:
- lsp_diagnostics clean on changed files
- Build passes (if applicable)
- ${verificationText}
</Verification>

<Style>
- Start immediately. No acknowledgments.
- Match user's communication style.
- Dense > verbose.
</Style>`

  if (!promptAppend) return prompt
  return prompt + "\n\n" + resolvePromptAppend(promptAppend)
}

function buildTodoDisciplineSection(useTaskSystem: boolean): string {
  if (useTaskSystem) {
    return `<Task_Discipline>
TASK OBSESSION (NON-NEGOTIABLE):
- 2+ steps → task_create FIRST, atomic breakdown
- task_update(status="in_progress") before starting (ONE at a time)
- task_update(status="completed") IMMEDIATELY after each step
- NEVER batch completions

No tasks on multi-step work = INCOMPLETE WORK.
</Task_Discipline>`
  }

  return `<Todo_Discipline>
TODO OBSESSION (NON-NEGOTIABLE):
- 2+ steps → todowrite FIRST, atomic breakdown
- Mark in_progress before starting (ONE at a time)
- Mark completed IMMEDIATELY after each step
- NEVER batch completions

No todos on multi-step work = INCOMPLETE WORK.
</Todo_Discipline>`
}
