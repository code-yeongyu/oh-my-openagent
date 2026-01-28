import type { PluginInput, PreToolUseInput, PreToolUseOutput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"

const HOOK_NAME = "definition-gates"

export interface TaskContext {
  goal: string
  filesIdentified: string[]
  testCriteria: string
  dependenciesMapped: boolean
  hasAmbiguity: boolean
}

export interface CompletionContext {
  testsPass: boolean
  typesPass: boolean
  noForbiddenPatterns: boolean
  followsCodebaseStyle: boolean
  todoMarkedComplete: boolean
}

export interface ReadinessResult {
  ready: boolean
  missingCriteria: string[]
  message: string
}

export interface CompletenessResult {
  complete: boolean
  failedCriteria: string[]
  message: string
}

type ReadinessCriterion = "goal_is_atomic" | "files_identified" | "test_criteria_defined" | "dependencies_mapped" | "no_ambiguity"
type CompletenessCriterion = "tests_pass" | "types_pass" | "no_forbidden_patterns" | "follows_codebase_style" | "todo_marked_complete"

export function checkDefinitionOfReady(context: TaskContext): ReadinessResult {
  const missingCriteria: ReadinessCriterion[] = []

  if (!context.goal || context.goal.trim().length === 0) {
    missingCriteria.push("goal_is_atomic")
  }

  if (!context.filesIdentified || context.filesIdentified.length === 0) {
    missingCriteria.push("files_identified")
  }

  if (!context.testCriteria || context.testCriteria.trim().length === 0) {
    missingCriteria.push("test_criteria_defined")
  }

  if (!context.dependenciesMapped) {
    missingCriteria.push("dependencies_mapped")
  }

  if (context.hasAmbiguity) {
    missingCriteria.push("no_ambiguity")
  }

  const ready = missingCriteria.length === 0

  return {
    ready,
    missingCriteria,
    message: ready
      ? "Task meets Definition of Ready"
      : `Task NOT ready. Missing: ${missingCriteria.join(", ")}`,
  }
}

export function checkDefinitionOfDone(context: CompletionContext): CompletenessResult {
  const failedCriteria: CompletenessCriterion[] = []

  if (!context.testsPass) {
    failedCriteria.push("tests_pass")
  }

  if (!context.typesPass) {
    failedCriteria.push("types_pass")
  }

  if (!context.noForbiddenPatterns) {
    failedCriteria.push("no_forbidden_patterns")
  }

  if (!context.followsCodebaseStyle) {
    failedCriteria.push("follows_codebase_style")
  }

  if (!context.todoMarkedComplete) {
    failedCriteria.push("todo_marked_complete")
  }

  const complete = failedCriteria.length === 0

  return {
    complete,
    failedCriteria,
    message: complete
      ? "Task meets Definition of Done"
      : `Task NOT complete. Failed: ${failedCriteria.join(", ")}`,
  }
}

function createDoRReminder(result: ReadinessResult): string {
  return `[DEFINITION OF READY - NOT MET]

Before starting this task, ensure:
${result.missingCriteria.map(c => `- [ ] ${formatCriterion(c)}`).join("\n")}

Do NOT proceed until all criteria are satisfied.`
}

function createDoDReminder(result: CompletenessResult): string {
  return `[DEFINITION OF DONE - NOT MET]

Before marking this task complete, ensure:
${result.failedCriteria.map(c => `- [ ] ${formatCriterion(c)}`).join("\n")}

Verification is MANDATORY. Do NOT skip.`
}

function formatCriterion(criterion: string): string {
  const labels: Record<string, string> = {
    goal_is_atomic: "Goal is clear and atomic (one thing)",
    files_identified: "Files to modify are identified",
    test_criteria_defined: "Test criteria defined (Given-When-Then)",
    dependencies_mapped: "Dependencies are mapped",
    no_ambiguity: "No ambiguity remains (or question asked)",
    tests_pass: "Tests pass: `bun test [file.test.ts]`",
    types_pass: "Types pass: `lsp_diagnostics` clean",
    no_forbidden_patterns: "No forbidden patterns (as any, @ts-ignore)",
    follows_codebase_style: "Follows existing codebase style",
    todo_marked_complete: "Todo item marked completed",
  }
  return labels[criterion] ?? criterion
}

function extractTaskContextFromPrompt(prompt: string): Partial<TaskContext> {
  const hasGoal = prompt.length > 10
  const hasFiles = /\.(ts|js|tsx|jsx|md|json)/.test(prompt)
  const hasTestCriteria = /(test|expect|should|must|verify)/i.test(prompt)
  const hasAmbiguity = /(maybe|perhaps|possibly|or|unclear)/i.test(prompt)

  return {
    goal: hasGoal ? prompt.slice(0, 100) : "",
    filesIdentified: hasFiles ? ["detected"] : [],
    testCriteria: hasTestCriteria ? "detected" : "",
    dependenciesMapped: true,
    hasAmbiguity,
  }
}

export interface DefinitionGatesHook {
  "tool.execute.before": (
    input: PreToolUseInput,
    output: PreToolUseOutput
  ) => Promise<PreToolUseOutput>
}

export function createDefinitionGatesHook(_ctx: PluginInput): DefinitionGatesHook {
  return {
    "tool.execute.before": async (
      input: PreToolUseInput,
      output: PreToolUseOutput
    ): Promise<PreToolUseOutput> => {
      const toolName = input.tool.name

      if (toolName === "mcp_delegate_task" || toolName === "delegate_task") {
        const toolInput = input.tool.input as Record<string, unknown>
        const prompt = (toolInput.prompt as string) ?? ""

        const partialContext = extractTaskContextFromPrompt(prompt)
        const context: TaskContext = {
          goal: partialContext.goal ?? "",
          filesIdentified: partialContext.filesIdentified ?? [],
          testCriteria: partialContext.testCriteria ?? "",
          dependenciesMapped: partialContext.dependenciesMapped ?? false,
          hasAmbiguity: partialContext.hasAmbiguity ?? false,
        }

        const result = checkDefinitionOfReady(context)

        if (!result.ready) {
          log(`[${HOOK_NAME}] DoR not met for delegation`, {
            missingCriteria: result.missingCriteria,
          })

          const reminder = createDoRReminder(result)
          output.output = output.output ? `${output.output}\n\n${reminder}` : reminder
        }
      }

      if (toolName === "mcp_todowrite" || toolName === "todowrite") {
        const toolInput = input.tool.input as Record<string, unknown>
        const todos = toolInput.todos as Array<{ status?: string }> | undefined

        const hasCompletingTodo = todos?.some(t => t.status === "completed")

        if (hasCompletingTodo) {
          log(`[${HOOK_NAME}] DoD reminder for todo completion`)

          const reminder = `[DEFINITION OF DONE REMINDER]

Before marking tasks complete, verify:
- [ ] Tests pass
- [ ] Types pass (lsp_diagnostics clean)
- [ ] No forbidden patterns
- [ ] Follows codebase style

Have you verified all criteria?`

          output.output = output.output ? `${output.output}\n\n${reminder}` : reminder
        }
      }

      return output
    },
  }
}

export default createDefinitionGatesHook
