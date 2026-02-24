import type { PluginInput } from "@opencode-ai/plugin"
import { computeLineHash } from "../../tools/hashline-edit/hash-computation"

const WRITE_SUCCESS_MARKER = "File written successfully."

interface HashlineReadEnhancerConfig {
  hashline_edit?: { enabled: boolean }
}

const COLON_READ_LINE_PATTERN = /^\s*(\d+): ?(.*)$/
const PIPE_READ_LINE_PATTERN = /^\s*(\d+)\| ?(.*)$/
const CONTENT_OPEN_TAG = "<content>"
const CONTENT_CLOSE_TAG = "</content>"
const FILE_OPEN_TAG = "<file>"
const FILE_CLOSE_TAG = "</file>"
const OPENCODE_LINE_TRUNCATION_SUFFIX = "... (line truncated to 2000 chars)"

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
  return COLON_READ_LINE_PATTERN.test(firstLine) || PIPE_READ_LINE_PATTERN.test(firstLine)
}

function parseReadLine(line: string): { lineNumber: number; content: string } | null {
  const colonMatch = COLON_READ_LINE_PATTERN.exec(line)
  if (colonMatch) {
    return {
      lineNumber: Number.parseInt(colonMatch[1], 10),
      content: colonMatch[2],
    }
  }

  const pipeMatch = PIPE_READ_LINE_PATTERN.exec(line)
  if (pipeMatch) {
    return {
      lineNumber: Number.parseInt(pipeMatch[1], 10),
      content: pipeMatch[2],
    }
  }

  return null
}

function transformLine(line: string): string {
  const parsed = parseReadLine(line)
  if (!parsed) {
    return line
  }
  if (parsed.content.endsWith(OPENCODE_LINE_TRUNCATION_SUFFIX)) {
    return line
  }
  const hash = computeLineHash(parsed.lineNumber, parsed.content)
  return `${parsed.lineNumber}#${hash}|${parsed.content}`
}

function transformOutput(output: string): string {
  if (!output) {
    return output
  }

  const lines = output.split("\n")
  const contentStart = lines.findIndex(
    (line) => line === CONTENT_OPEN_TAG || line.startsWith(CONTENT_OPEN_TAG)
  )
  const contentEnd = lines.indexOf(CONTENT_CLOSE_TAG)
  const fileStart = lines.findIndex((line) => line === FILE_OPEN_TAG || line.startsWith(FILE_OPEN_TAG))
  const fileEnd = lines.indexOf(FILE_CLOSE_TAG)

  const blockStart = contentStart !== -1 ? contentStart : fileStart
  const blockEnd = contentStart !== -1 ? contentEnd : fileEnd
  const openTag = contentStart !== -1 ? CONTENT_OPEN_TAG : FILE_OPEN_TAG

  if (blockStart !== -1 && blockEnd !== -1 && blockEnd > blockStart) {
    const openLine = lines[blockStart] ?? ""
    const inlineFirst = openLine.startsWith(openTag) && openLine !== openTag
      ? openLine.slice(openTag.length)
      : null
    const fileLines = inlineFirst !== null
      ? [inlineFirst, ...lines.slice(blockStart + 1, blockEnd)]
      : lines.slice(blockStart + 1, blockEnd)
    if (!isTextFile(fileLines[0] ?? "")) {
      return output
    }

    const result: string[] = []
    for (const line of fileLines) {
      if (!parseReadLine(line)) {
        result.push(...fileLines.slice(result.length))
        break
      }
      result.push(transformLine(line))
    }

    const prefixLines = inlineFirst !== null
      ? [...lines.slice(0, blockStart), openTag]
      : lines.slice(0, blockStart + 1)

    return [...prefixLines, ...result, ...lines.slice(blockEnd)].join("\n")
  }

  if (!isTextFile(lines[0] ?? "")) {
    return output
  }

  const result: string[] = []
  for (const line of lines) {
    if (!parseReadLine(line)) {
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
  if (output.output.startsWith(WRITE_SUCCESS_MARKER)) {
    return
  }

  const outputLower = output.output.toLowerCase()
  if (outputLower.startsWith("error") || outputLower.includes("failed")) {
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
  const lineCount = content === "" ? 0 : content.split("\n").length
  output.output = `${WRITE_SUCCESS_MARKER} ${lineCount} lines written.`
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
