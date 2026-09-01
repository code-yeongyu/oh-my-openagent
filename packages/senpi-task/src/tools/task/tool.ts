import type { ToolDefinition } from "@code-yeongyu/senpi"

import { normalizeTaskToolArguments } from "./argument-normalization"
import { buildTaskToolDescription, TASK_PROMPT_GUIDELINES, TASK_PROMPT_SNIPPET } from "./description"
import { buildTaskExecute } from "./execute"
import { TaskToolParams } from "./params"
import { linesComponent, renderTaskCallLines, renderTaskResultComponent } from "./renderers"
import type { TaskToolDeps, TaskToolDetails } from "./types"

export const TASK_TOOL_NAME = "task"

// Assembles the senpi ToolDefinition: a TypeBox param schema, a description whose category and agent
// lists are injected dynamically from omo.json + the loader, prompt-surface hints, the spawn/continue
// execute logic, and compact call/result renderers. The literal is returned unwrapped: senpi's
// defineTool is an identity helper that exists for type inference only (pinned by the senpi API
// tripwire), and calling it here would statically bind this module to the engine barrel.
export function createTaskTool(deps: TaskToolDeps): ToolDefinition<typeof TaskToolParams, TaskToolDetails> {
  const execute = buildTaskExecute(deps)
  return {
    name: TASK_TOOL_NAME,
    label: "Task",
    description: buildTaskToolDescription({ omoConfig: deps.omoConfig, agents: deps.agents }),
    promptSnippet: TASK_PROMPT_SNIPPET,
    promptGuidelines: [...TASK_PROMPT_GUIDELINES],
    parameters: TaskToolParams,
    prepareArguments: normalizeTaskToolArguments,
    execute: (toolCallId, params, signal, onUpdate, ctx) => execute(toolCallId, params, signal, onUpdate, ctx),
    renderCall: (args, theme) =>
      linesComponent((width) => renderTaskCallLines(args, theme, width).map((line) => theme.fg("toolTitle", line))),
    renderResult: (result, options, theme) => {
      if (options.isPartial) {
        // The live status line is drawn by senpi's own tool-progress renderer from
        // details.progress; the partial content carries only the last-assistant row.
        const liveText = result.content.find((part) => part.type === "text")?.text
        if (liveText !== undefined && liveText.length > 0) {
          return linesComponent(liveText.split("\n").map((line) => theme.fg("muted", line)))
        }
        return linesComponent([])
      }
      return renderTaskResultComponent(result.details, theme)
    },
  }
}
