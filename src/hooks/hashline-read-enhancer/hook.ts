import type { PluginInput } from "@opencode-ai/plugin"
import { computeLineHash } from "../../tools/hashline-edit/hash-computation"
import { toHashlineContent } from "../../tools/hashline-edit/diff-utils"

interface HashlineReadEnhancerConfig {
  hashline_edit?: { enabled: boolean }
}

const READ_LINE_PATTERN = /^(\d+): ?(.*)$/
const CONTENT_OPEN_TAG = "<content>"
const CONTENT_CLOSE_TAG = "</content>"

function isReadTool(toolName: string): boolean {
  return toolName.toLowerCase() === "read"
}

function isWriteTool(toolName: string): boolean {
  return toolName.toLowerCase() === "write"
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
  return `${lineNumber}#${hash}:${content}`
}

function transformOutput(output: string): string {
  if (!output) {
    return output
  }

  const lines = output.split("\n")
  const contentStart = lines.indexOf(CONTENT_OPEN_TAG)
  const contentEnd = lines.indexOf(CONTENT_CLOSE_TAG)

  if (contentStart !== -1 && contentEnd !== -1 && contentEnd > contentStart + 1) {
    const fileLines = lines.slice(contentStart + 1, contentEnd)
    if (!isTextFile(fileLines[0] ?? "")) {
      return output
    }

    const result: string[] = []
    for (const line of fileLines) {
      if (!READ_LINE_PATTERN.test(line)) {
        result.push(...fileLines.slice(result.length))
        break
      }
      result.push(transformLine(line))
    }

    return [...lines.slice(0, contentStart + 1), ...result, ...lines.slice(contentEnd)].join("\n")
  }

  if (!isTextFile(lines[0] ?? "")) {
    return output
  }

  const result: string[] = []
  for (const line of lines) {
    if (!READ_LINE_PATTERN.test(line)) {
      result.push(...lines.slice(result.length))
      break
    }
    result.push(transformLine(line))
  }

  return result.join("\n")
}

function extractFilePath(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") {
    return undefined
  }

  const objectMeta = metadata as Record<string, unknown>
  const candidates = [objectMeta.filepath, objectMeta.filePath, objectMeta.path, objectMeta.file]
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate
    }
  }

  return undefined
}

async function appendWriteHashlineOutput(output: { output: string; metadata: unknown }): Promise<void> {
  if (output.output.includes("Updated file (LINE#ID:content):")) {
    return
  }

  const filePath = extractFilePath(output.metadata)
  if (!filePath) {
    return
  }

  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    return
  }

  const content = await file.text()
  const hashlined = toHashlineContent(content)
  output.output = `${output.output}\n\nUpdated file (LINE#ID:content):\n${hashlined}`
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
        if (isWriteTool(input.tool) && typeof output.output === "string" && shouldProcess(config)) {
          await appendWriteHashlineOutput(output)
        }
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
