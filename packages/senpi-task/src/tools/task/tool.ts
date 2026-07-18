import { defineTool, type ToolDefinition } from "@code-yeongyu/senpi"

import { buildTaskToolDescription, TASK_PROMPT_GUIDELINES, TASK_PROMPT_SNIPPET } from "./description"
import { buildTaskExecute } from "./execute"
import { TaskToolParams } from "./params"
import { linesComponent, renderTaskCallLines, renderTaskResultComponent } from "./renderers"
import type { TaskToolDeps, TaskToolDetails } from "./types"

export const TASK_TOOL_NAME = "task"

// Assembles the senpi ToolDefinition: a TypeBox param schema, a description whose category and agent
// lists are injected dynamically from omo.json + the loader, prompt-surface hints, the spawn/continue
// execute logic, and compact call/result renderers.
export function createTaskTool(deps: TaskToolDeps): ToolDefinition<typeof TaskToolParams, TaskToolDetails> {
  const execute = buildTaskExecute(deps)
  return defineTool({
    name: TASK_TOOL_NAME,
    label: "Task",
    description: buildTaskToolDescription({ omoConfig: deps.omoConfig, agents: deps.agents }),
    promptSnippet: TASK_PROMPT_SNIPPET,
    promptGuidelines: [...TASK_PROMPT_GUIDELINES],
    parameters: TaskToolParams,
    execute: (toolCallId, params, signal, onUpdate, ctx) => execute(toolCallId, params, signal, onUpdate, ctx),
    renderCall: (args, theme) => {
      const lines = renderTaskCallLines(args, theme)
      return linesComponent(lines.map((line) => theme.fg("toolTitle", line)))
    },
    renderResult: (result, _options, theme) => renderTaskResultComponent(result.details, theme),
  })
}
