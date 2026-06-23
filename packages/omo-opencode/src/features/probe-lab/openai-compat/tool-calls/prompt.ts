import type { ToolChoice, ToolDefinition } from "../schemas"

const ENVELOPE_TEMPLATE = `<|DSML|tool_calls>
<|DSML|invoke name="TOOL_NAME">
<|DSML|parameter name="ARG_NAME"><![CDATA[ARG_VALUE]]></|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`

const RULES = [
  "Use only the tool names that appear in the Available tools list.",
  "IMPORTANT: DSML markup is NEVER for demonstration, examples, or showing code to the user. If you want to show example code, use markdown code fences (```python ...```). DSML is ONLY for actual tool execution. Do NOT emit DSML when the user asks you to show or demo code.",
  "Use parameter names exactly as declared in the tool schema.",
  "Wrap string values in <![CDATA[...]]> when they contain JSON, XML, code, quotes, or newlines.",
  "Numbers, booleans, and null stay as plain text inside the parameter element.",
  "Never place the DSML block inside Markdown code fences.",
  "If no tool is required, just answer normally and do not emit a tool block.",
]

const EXAMPLE_SINGLE_ARG = `<|DSML|tool_calls>
<|DSML|invoke name="get_current_time">
<|DSML|parameter name="timezone"><![CDATA[UTC]]></|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`

const EXAMPLE_MULTI_ARG = `<|DSML|tool_calls>
<|DSML|invoke name="search_web">
<|DSML|parameter name="query"><![CDATA[bun runtime release notes]]></|DSML|parameter>
<|DSML|parameter name="max_results">5</|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`

function summarizeTool(tool: ToolDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = { name: tool.function.name }
  if (tool.function.description) {
    out.description = tool.function.description
  }
  if (tool.function.parameters) {
    out.parameters = tool.function.parameters
  }
  return out
}

function describeChoiceConstraint(choice: ToolChoice | undefined): string | null {
  if (choice === undefined || choice === "auto") return null
  if (choice === "none") {
    return 'tool_choice is "none": do not emit any tool block; answer normally.'
  }
  if (choice === "required") {
    return 'tool_choice is "required": you MUST call at least one tool from the list. Do not answer in plain text.'
  }
  if (typeof choice === "object" && choice.type === "function") {
    return `tool_choice forces a specific tool: you MUST call only "${choice.function.name}".`
  }
  return null
}

function describeParallelConstraint(parallelEnabled: boolean | undefined): string | null {
  if (parallelEnabled === false) {
    return "parallel_tool_calls is disabled: call at most ONE tool in this turn."
  }
  return null
}

export function buildToolCallsInstructionBlock(
  tools: ReadonlyArray<ToolDefinition>,
  toolChoice: ToolChoice | undefined,
  parallelEnabled?: boolean,
): string {
  if (tools.length === 0) return ""
  const summarized = tools.map(summarizeTool)
  const toolList = JSON.stringify(summarized)
  const lines: string[] = []
  lines.push("You may call tools by emitting exactly one DSML tool_calls block.")
  lines.push("")
  lines.push("Available tools:")
  lines.push(toolList)
  lines.push("")
  lines.push("When calling a tool, emit this structure and nothing else:")
  lines.push(ENVELOPE_TEMPLATE)
  lines.push("")
  lines.push("Rules:")
  for (const rule of RULES) lines.push(`- ${rule}`)
  const constraint = describeChoiceConstraint(toolChoice)
  if (constraint) {
    lines.push("")
    lines.push(constraint)
  }
  const parallel = describeParallelConstraint(parallelEnabled)
  if (parallel) {
    lines.push("")
    lines.push(parallel)
  }
  lines.push("")
  lines.push("Example A (single string argument):")
  lines.push(EXAMPLE_SINGLE_ARG)
  lines.push("")
  lines.push("Example B (mixed string + numeric argument):")
  lines.push(EXAMPLE_MULTI_ARG)
  return lines.join("\n")
}
