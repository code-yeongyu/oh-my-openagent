import type { PluginInput } from "@opencode-ai/plugin"
import { computeLineHash } from "../../tools/hashline-edit/hash-computation"

interface HashlineReadEnhancerConfig {
  hashline_edit?: { enabled: boolean }
}

const READ_LINE_PATTERN = /^(\d+): (.*)$/

function isReadTool(toolName: string): boolean {
  return toolName.toLowerCase() === "read"
}

function shouldProcess(config: HashlineReadEnhancerConfig): boolean {
  return config.hashline_edit?.enabled ?? false
}

function isTextFile(output: string): boolean {
  const firstLine = output.split("\n")[0] ?? ""
  return READ_LINE_PATTERN.test(firstLine)
}

function transformLine(line: string): string {
  const match = READ_LINE_PATTERN.exec(line)
  if (!match) {
    return line
  }
  const lineNumber = parseInt(match[1], 10)
  const content = match[2]
  const hash = computeLineHash(lineNumber, content)
  return `${lineNumber}:${hash}|${content}`
}

function transformOutput(output: string): string {
  if (!output) {
    return output
  }
  if (!isTextFile(output)) {
    return output
  }
  const lines = output.split("\n")
  return lines.map(transformLine).join("\n")
}

export function createHashlineReadEnhancerHook(
  _ctx: PluginInput,
  config: HashlineReadEnhancerConfig
) {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      if (!isReadTool(input.tool)) {
        return
      }
      if (typeof output.output !== "string") {
        return
      }
      if (!shouldProcess(config)) {
        return
      }
      output.output = transformOutput(output.output)
    },
  }
}
