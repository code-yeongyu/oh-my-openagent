import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"

// Issue #6917 guardrail: long visual-engineering waves burst 30-40 lsp_* calls per worker in a
// single file scan, exploding token volume until the provider answers 429 and the harness detaches
// the task mid-wave. The cap is enforced here at the in-process child tool surface so the burst
// cannot happen regardless of prompt discipline.

export const MAX_LSP_TOOL_CALLS_PER_TASK = 10

export function isLspFamilyTool(name: string): boolean {
  return name.startsWith("lsp_")
}

export type LspCallGate = {
  readonly used: number
  admit(): boolean
}

export function createLspCallGate(max: number): LspCallGate {
  let calls = 0
  return {
    get used() {
      return calls
    },
    admit() {
      if (calls >= max) return false
      calls += 1
      return true
    },
  }
}

export function lspBudgetExhaustedText(toolName: string, max: number): string {
  return `${toolName} blocked: the lsp_* budget for this task is exhausted (${max}/${max} calls). Stop issuing lsp_* calls for the rest of this task. Switch to structural search (ast-grep, rg, grep) or batch the remaining lookups through an explore subagent spawned with the task tool. Finish the task with what is already gathered.`
}

export function applyLspCallCap(
  tools: readonly ToolDefinition[],
  max: number = MAX_LSP_TOOL_CALLS_PER_TASK,
): ToolDefinition[] {
  const gate = createLspCallGate(max)
  return tools.map((tool) => {
    if (!isLspFamilyTool(tool.name)) return tool
    const wrapped: ToolDefinition = {
      ...tool,
      execute: (toolCallId, params, signal, onUpdate, ctx): Promise<AgentToolResult<unknown>> => {
        if (!gate.admit()) {
          return Promise.resolve({
            content: [{ type: "text", text: lspBudgetExhaustedText(tool.name, max) }],
            details: undefined,
          })
        }
        return tool.execute(toolCallId, params, signal, onUpdate, ctx)
      },
    }
    return wrapped
  })
}
