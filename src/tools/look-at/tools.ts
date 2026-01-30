import { extname, basename } from "node:path"
import { pathToFileURL } from "node:url"
import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin"
import { LOOK_AT_DESCRIPTION, MULTIMODAL_LOOKER_AGENT } from "./constants"
import type { LookAtArgs } from "./types"
import { findByNameCaseInsensitive, log, promptWithModelSuggestionRetry } from "../../shared"

interface LookAtArgsWithAlias extends LookAtArgs {
  path?: string
}

export function normalizeArgs(args: LookAtArgsWithAlias): LookAtArgs {
  return {
    file_path: args.file_path ?? args.path ?? "",
    goal: args.goal ?? "",
  }
}

export function validateArgs(args: LookAtArgs): string | null {
  if (!args.file_path) {
    return `Error: Missing required parameter 'file_path'. Usage: look_at(file_path="/path/to/file", goal="what to extract")`
  }
  if (!args.goal) {
    return `Error: Missing required parameter 'goal'. Usage: look_at(file_path="/path/to/file", goal="what to extract")`
  }
  return null
}

function inferMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".mp4": "video/mp4",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpeg",
    ".mov": "video/mov",
    ".avi": "video/avi",
    ".flv": "video/x-flv",
    ".webm": "video/webm",
    ".wmv": "video/wmv",
    ".3gpp": "video/3gpp",
    ".3gp": "video/3gpp",
    ".wav": "audio/wav",
    ".mp3": "audio/mp3",
    ".aiff": "audio/aiff",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".md": "text/md",
    ".html": "text/html",
    ".json": "application/json",
    ".xml": "application/xml",
    ".js": "text/javascript",
    ".py": "text/x-python",
  }
  return mimeTypes[ext] || "application/octet-stream"
}

export function createLookAt(ctx: PluginInput): ToolDefinition {
  return tool({
    description: LOOK_AT_DESCRIPTION,
    args: {
      file_path: tool.schema.string().describe("Absolute path to the file to analyze"),
      goal: tool.schema.string().describe("What specific information to extract from the file"),
    },
    async execute(rawArgs: LookAtArgs, toolContext) {
      const args = normalizeArgs(rawArgs as LookAtArgsWithAlias)
      const validationError = validateArgs(args)
      if (validationError) {
        log(`[look_at] Validation failed: ${validationError}`)
        return validationError
      }

      log(`[look_at] Analyzing file: ${args.file_path}, goal: ${args.goal}`)

      const mimeType = inferMimeType(args.file_path)
      const filename = basename(args.file_path)

      const prompt = `Analyze this file and extract the requested information.

Goal: ${args.goal}

Provide ONLY the extracted information that matches the goal.
Be thorough on what was requested, concise on everything else.
If the requested information is not found, clearly state what is missing.`

      log(`[look_at] Creating session with parent: ${toolContext.sessionID}`)
      const parentSession = await ctx.client.session.get({
        path: { id: toolContext.sessionID },
      }).catch(() => null)
      const parentDirectory = parentSession?.data?.directory ?? ctx.directory

      const createResult = await ctx.client.session.create({
        body: {
          parentID: toolContext.sessionID,
          title: `look_at: ${args.goal.substring(0, 50)}`,
          permission: [
            { permission: "question", action: "deny" as const, pattern: "*" },
          ],
        } as any,
        query: {
          directory: parentDirectory,
        },
      })

      if (createResult.error) {
        log(`[look_at] Session create error:`, createResult.error)
        const errorStr = String(createResult.error)
        if (errorStr.toLowerCase().includes("unauthorized")) {
          return `Error: Failed to create session (Unauthorized). This may be due to:
1. OAuth token restrictions (e.g., Claude Code credentials are restricted to Claude Code only)
2. Provider authentication issues
3. Session permission inheritance problems

Try using a different provider or API key authentication.

Original error: ${createResult.error}`
        }
        return `Error: Failed to create session: ${createResult.error}`
      }

      const sessionID = createResult.data.id
      log(`[look_at] Created session: ${sessionID}`)

      let agentModel: { providerID: string; modelID: string } | undefined
      let agentVariant: string | undefined

      try {
        const agentsResult = await ctx.client.app?.agents?.()
        type AgentInfo = {
          name: string
          mode?: "subagent" | "primary" | "all"
          model?: { providerID: string; modelID: string }
          variant?: string
        }
        const agents = ((agentsResult as { data?: AgentInfo[] })?.data ?? agentsResult) as AgentInfo[] | undefined
        if (agents?.length) {
          const matchedAgent = findByNameCaseInsensitive(agents, MULTIMODAL_LOOKER_AGENT)
          if (matchedAgent?.model) {
            agentModel = matchedAgent.model
          }
          if (matchedAgent?.variant) {
            agentVariant = matchedAgent.variant
          }
        }
      } catch (error) {
        log("[look_at] Failed to resolve multimodal-looker model info", error)
      }

      log(`[look_at] Sending prompt with file passthrough to session ${sessionID}`)
      try {
        await promptWithModelSuggestionRetry(ctx.client, {
          path: { id: sessionID },
          body: {
            agent: MULTIMODAL_LOOKER_AGENT,
            tools: {
              task: false,
              call_omo_agent: false,
              look_at: false,
              read: false,
            },
            parts: [
              { type: "text", text: prompt },
              { type: "file", mime: mimeType, url: pathToFileURL(args.file_path).href, filename },
            ],
            ...(agentModel ? { model: { providerID: agentModel.providerID, modelID: agentModel.modelID } } : {}),
            ...(agentVariant ? { variant: agentVariant } : {}),
          },
        })
      } catch (promptError) {
        const errorMessage = promptError instanceof Error ? promptError.message : String(promptError)
        log(`[look_at] Prompt error:`, promptError)

        const isJsonParseError = errorMessage.includes("JSON") && (errorMessage.includes("EOF") || errorMessage.includes("parse"))
        if (isJsonParseError) {
          return `Error: Failed to analyze file - received malformed response from multimodal-looker agent.

This typically occurs when:
1. The multimodal-looker model is not available or not connected
2. The model does not support this file type (${mimeType})
3. The API returned an empty or truncated response

File: ${args.file_path}
MIME type: ${mimeType}

Try:
- Ensure a vision-capable model (e.g., gemini-3-flash, gpt-5.2) is available
- Check provider connections in opencode settings
- For text files like .md, .txt, use the Read tool instead

Original error: ${errorMessage}`
        }

        return `Error: Failed to send prompt to multimodal-looker agent: ${errorMessage}`
      }

      log(`[look_at] Prompt sent, fetching messages...`)

      const messagesResult = await ctx.client.session.messages({
        path: { id: sessionID },
      })

      if (messagesResult.error) {
        log(`[look_at] Messages error:`, messagesResult.error)
        return `Error: Failed to get messages: ${messagesResult.error}`
      }

      const messages = messagesResult.data
      log(`[look_at] Got ${messages.length} messages`)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lastAssistantMessage = messages
        .filter((m: any) => m.info.role === "assistant")
        .sort((a: any, b: any) => (b.info.time?.created || 0) - (a.info.time?.created || 0))[0]

      if (!lastAssistantMessage) {
        log(`[look_at] No assistant message found`)
        return `Error: No response from multimodal-looker agent`
      }

      log(`[look_at] Found assistant message with ${lastAssistantMessage.parts.length} parts`)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const textParts = lastAssistantMessage.parts.filter((p: any) => p.type === "text")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseText = textParts.map((p: any) => p.text).join("\n")

      log(`[look_at] Got response, length: ${responseText.length}`)

      return responseText
    },
  })
}
