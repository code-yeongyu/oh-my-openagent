import { tool, type PluginInput } from "@opencode-ai/plugin"
import { join } from "path"
import { mkdir, writeFile, stat } from "node:fs/promises"
import type { ExtractLearningsArgs, ExtractLearningsResult, TranscriptEntry } from "./types"
import {
  EXTRACT_LEARNINGS_DESCRIPTION,
  DEFAULT_TRANSCRIPT_PATH,
} from "./constants"
import { redactSecrets, redactSecretsRecursive } from "../../features/context-learning/secret-redactor"
import { log } from "../../shared/logger"

interface MessagePart {
  type: string
  tool?: string
  state?: {
    status?: string
    input?: Record<string, unknown>
    output?: unknown
  }
  content?: string
}

interface SessionMessage {
  info?: {
    role?: "user" | "assistant"
    content?: unknown
  }
  parts?: MessagePart[]
}

async function getSessionMessages(
  client: PluginInput["client"],
  sessionId: string
): Promise<SessionMessage[]> {
  try {
    const response = await client.session.messages({
      path: { id: sessionId },
    })
    const messages = (response as { data?: unknown[] }).data
      ?? (response as { "200"?: unknown[] })["200"]
      ?? (Array.isArray(response) ? response : [])
    return messages as SessionMessage[]
  } catch (error) {
    log("[extract-learnings] Failed to get session messages:", error)
    return []
  }
}

function serializeToTranscript(messages: SessionMessage[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  const timestamp = () => new Date().toISOString()

  for (const msg of messages) {
    const role = msg.info?.role

    if (role === "user" && msg.info?.content) {
      const content = typeof msg.info.content === "string"
        ? msg.info.content
        : JSON.stringify(msg.info.content)
      entries.push({
        type: "user",
        timestamp: timestamp(),
        content: redactSecrets(content).redacted,
      })
    }

    if (role === "assistant") {
      if (msg.info?.content) {
        const content = typeof msg.info.content === "string"
          ? msg.info.content
          : JSON.stringify(msg.info.content)
        entries.push({
          type: "assistant",
          timestamp: timestamp(),
          content: redactSecrets(content).redacted,
        })
      }

      for (const part of msg.parts || []) {
        if (part.type === "tool" && part.tool && part.state) {
          entries.push({
            type: "tool_use",
            timestamp: timestamp(),
            tool_name: part.tool,
            tool_input: redactSecretsRecursive(part.state.input) as Record<string, unknown>,
          })

          if (part.state.status === "completed" && part.state.output !== undefined) {
            const output = typeof part.state.output === "string"
              ? { result: redactSecrets(part.state.output).redacted }
              : redactSecretsRecursive(part.state.output) as Record<string, unknown>
            entries.push({
              type: "tool_result",
              timestamp: timestamp(),
              tool_name: part.tool,
              tool_output: output,
            })
          }
        }

        if (part.type === "text" && part.content) {
          entries.push({
            type: "assistant",
            timestamp: timestamp(),
            content: redactSecrets(part.content).redacted,
          })
        }
      }
    }
  }

  return entries
}

async function writeTranscript(
  transcriptPath: string,
  entries: TranscriptEntry[]
): Promise<{ success: boolean; lines: number; error?: string }> {
  try {
    const dir = join(transcriptPath, "..")
    await mkdir(dir, { recursive: true })

    const jsonl = entries.map(e => JSON.stringify(e)).join("\n") + "\n"
    await writeFile(transcriptPath, jsonl)

    return { success: true, lines: entries.length }
  } catch (error) {
    return {
      success: false,
      lines: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function countLines(filePath: string): Promise<number> {
  try {
    const file = Bun.file(filePath)
    const content = await file.text()
    return content.split("\n").filter(line => line.trim()).length
  } catch {
    return 0
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

export function createExtractLearningsTool(
  ctx: PluginInput,
  config?: { transcriptPath?: string }
) {
  const transcriptBasePath = config?.transcriptPath ?? DEFAULT_TRANSCRIPT_PATH
  const cwd = process.cwd()

  return tool({
    description: EXTRACT_LEARNINGS_DESCRIPTION,
    args: {
      transcript_path: tool.schema.string().optional().describe("Path to existing transcript file. If provided, skips capture and validates this file."),
      session_id: tool.schema.string().optional().describe("Session ID to capture. Defaults to current session. Ignored if transcript_path provided."),
    },
    async execute(args: ExtractLearningsArgs, toolContext) {
      // Mode 1: Use existing transcript
      if (args.transcript_path) {
        const exists = await fileExists(args.transcript_path)
        if (!exists) {
          const result: ExtractLearningsResult = {
            success: false,
            message: "Transcript file not found",
            error: `File does not exist: ${args.transcript_path}`,
          }
          return JSON.stringify(result, null, 2)
        }

        const lines = await countLines(args.transcript_path)
        const result: ExtractLearningsResult = {
          success: true,
          transcript_path: args.transcript_path,
          transcript_lines: lines,
          message: `Using existing transcript (${lines} entries). Ready for analysis.`,
        }
        return JSON.stringify(result, null, 2)
      }

      // Mode 2: Capture current session
      const sessionId = args.session_id ?? toolContext.sessionID

      if (!sessionId) {
        const result: ExtractLearningsResult = {
          success: false,
          message: "No session ID available",
          error: "Provide session_id or transcript_path",
        }
        return JSON.stringify(result, null, 2)
      }

      const messages = await getSessionMessages(ctx.client, sessionId)

      if (messages.length < 5) {
        const result: ExtractLearningsResult = {
          success: false,
          session_id: sessionId,
          message: "Session too short for meaningful extraction",
          error: `Only ${messages.length} messages found (minimum 5)`,
        }
        return JSON.stringify(result, null, 2)
      }

      const entries = serializeToTranscript(messages)
      const transcriptPath = join(cwd, transcriptBasePath, `${sessionId}.jsonl`)
      const writeResult = await writeTranscript(transcriptPath, entries)

      if (!writeResult.success) {
        const result: ExtractLearningsResult = {
          success: false,
          session_id: sessionId,
          message: "Failed to write transcript",
          error: writeResult.error,
        }
        return JSON.stringify(result, null, 2)
      }

      const result: ExtractLearningsResult = {
        success: true,
        transcript_path: transcriptPath,
        transcript_lines: writeResult.lines,
        session_id: sessionId,
        message: `Transcript captured (${writeResult.lines} entries). Ready for analysis.`,
      }
      return JSON.stringify(result, null, 2)
    },
  })
}
