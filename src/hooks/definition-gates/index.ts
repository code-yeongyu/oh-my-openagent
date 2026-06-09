import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"

const HOOK_NAME = "definition-gates"

export interface TaskContext {
  readonly goal: string
  readonly filesIdentified: readonly string[]
  readonly testCriteria: string
  readonly dependenciesMapped: boolean
  readonly hasAmbiguity: boolean
}

export interface CompletionContext {
  readonly testsPass: boolean
  readonly typesPass: boolean
  readonly noForbiddenPatterns: boolean
  readonly followsCodebaseStyle: boolean
  readonly todoMarkedComplete: boolean
}

export interface ReadinessResult {
  readonly ready: boolean
  readonly missingCriteria: readonly string[]
  readonly message: string
}

export interface CompletenessResult {
  readonly complete: boolean
  readonly failedCriteria: readonly string[]
  readonly message: string
}

type ReadinessCriterion = "goal_is_atomic" | "files_identified" | "test_criteria_defined" | "dependencies_mapped" | "no_ambiguity"
type CompletenessCriterion = "tests_pass" | "types_pass" | "no_forbidden_patterns" | "follows_codebase_style" | "todo_marked_complete"

const DELEGATION_TOOLS = new Set(["task", "delegate_task", "delegate-task", "call_omo_agent"])
const TODO_COMPLETION_TOOLS = new Set(["todowrite", "todo_write"])

interface ToolExecuteBeforeInput {
  readonly tool: string
  readonly sessionID: string
  readonly callID: string
}

interface ToolExecuteBeforeOutput {
  readonly args: Record<string, unknown>
  message?: string
}

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

function appendMessage(output: ToolExecuteBeforeOutput, message: string): void {
  output.message = output.message ? `${output.message}\n\n${message}` : message
}

function hasCompletedStatus(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  return "status" in value && value.status === "completed"
}

function extractTaskContextFromPrompt(prompt: string): Partial<TaskContext> {
  const hasGoal = prompt.length > 10
  const hasFiles = /\.(ts|js|tsx|jsx|md|json)/.test(prompt)
  const hasTestCriteria = /(test|expect|should|must|verify)/i.test(prompt)
  const hasAmbiguity = /\b(maybe|perhaps|possibly|unclear)\b/i.test(prompt) ||
    /\bor\b/.test(prompt.replace(/\b(and\/or|either|error|for|or\s+not)\b/gi, ""))
  const hasDependencyMention = /(depends?\s+on|after|requires?|blocks?|prerequisite|first\s+need)/i.test(prompt)
  const dependenciesMapped = !hasDependencyMention || /(already|done|complete|identified)/i.test(prompt)

  return {
    goal: hasGoal ? prompt.slice(0, 100) : "",
    filesIdentified: hasFiles ? ["detected"] : [],
    testCriteria: hasTestCriteria ? "detected" : "",
    dependenciesMapped,
    hasAmbiguity,
  }
}

export interface DefinitionGatesHook {
  "tool.execute.before": (
    input: ToolExecuteBeforeInput,
    output: ToolExecuteBeforeOutput
  ) => Promise<void>
}

export function createDefinitionGatesHook(_ctx?: PluginInput): DefinitionGatesHook {
  return {
    "tool.execute.before": async (
      input: ToolExecuteBeforeInput,
      output: ToolExecuteBeforeOutput
    ): Promise<void> => {
      const toolName = input.tool.toLowerCase().replace(/^mcp_/, "")

      if (DELEGATION_TOOLS.has(toolName)) {
        const prompt = typeof output.args.prompt === "string" ? output.args.prompt : ""

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
          appendMessage(output, reminder)
        }
      }

      if (TODO_COMPLETION_TOOLS.has(toolName)) {
        const rawTodos = output.args.todos
        const todos = Array.isArray(rawTodos) ? rawTodos : []

        const hasCompletingTodo = todos.some(hasCompletedStatus)

        if (hasCompletingTodo) {
          log(`[${HOOK_NAME}] DoD reminder for todo completion`)

          const reminder = createDoDReminder({
            complete: false,
            failedCriteria: [
              "tests_pass",
              "types_pass",
              "no_forbidden_patterns",
              "follows_codebase_style",
            ],
            message: "Verify Definition of Done before completion",
          })

          appendMessage(output, reminder)
        }
      }
    },
  }
}
