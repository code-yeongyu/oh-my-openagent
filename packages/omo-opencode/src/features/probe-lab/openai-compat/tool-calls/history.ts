import type { ToolCallResponse } from "../schemas"

export type ToolResultInput = {
  tool_call_id: string
  name?: string
  content: string
}

function escapeForCdata(value: string): string {
  if (value.length === 0) return ""
  return value.split("]]>").join("]]]]><![CDATA[>")
}

function renderParameterValue(value: unknown): string {
  if (typeof value === "string") {
    return `<![CDATA[${escapeForCdata(value)}]]>`
  }
  if (value === null) return "null"
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return `<![CDATA[${escapeForCdata(JSON.stringify(value))}]]>`
}

function renderInvokeFromArgs(name: string, rawArgs: string): string {
  const lines: string[] = [`<|DSML|invoke name="${name}">`]
  let parsed: unknown = undefined
  try {
    parsed = JSON.parse(rawArgs)
  } catch {
    parsed = undefined
  }
  if (parsed === undefined || parsed === null || typeof parsed !== "object") {
    if (rawArgs.length > 0) {
      lines.push(
        `<|DSML|parameter name="_raw">${renderParameterValue(rawArgs)}</|DSML|parameter>`,
      )
    }
    lines.push("</|DSML|invoke>")
    return lines.join("\n")
  }
  const obj = parsed as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    lines.push(
      `<|DSML|parameter name="${key}">${renderParameterValue(obj[key])}</|DSML|parameter>`,
    )
  }
  lines.push("</|DSML|invoke>")
  return lines.join("\n")
}

export function formatAssistantToolCallsAsDsml(
  toolCalls: ReadonlyArray<ToolCallResponse>,
): string {
  if (toolCalls.length === 0) return ""
  const inner = toolCalls
    .map((c) => renderInvokeFromArgs(c.function.name, c.function.arguments))
    .join("\n")
  return `<|DSML|tool_calls>\n${inner}\n</|DSML|tool_calls>`
}

export function formatToolResultAsDsml(input: ToolResultInput): string {
  const safe = escapeForCdata(input.content)
  const nameAttr = input.name ? ` name="${input.name}"` : ""
  return [
    "<|DSML|tool_results>",
    `<|DSML|result tool_call_id="${input.tool_call_id}"${nameAttr}><![CDATA[${safe}]]></|DSML|result>`,
    "</|DSML|tool_results>",
  ].join("\n")
}
