import { extname, basename } from "node:path"
import { tool, type PluginInput } from "@opencode-ai/plugin"
import { LOOK_AT_DESCRIPTION, MULTIMODAL_LOOKER_AGENT } from "./constants"
import type { LookAtArgs } from "./types"
import { log } from "../../shared/logger"

function inferMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".xml": "application/xml",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".ts": "text/typescript",
  }
  return mimeTypes[ext] || "application/octet-stream"
}

export function createLookAt(ctx: PluginInput) {
  return tool({
    description: LOOK_AT_DESCRIPTION,
    args: {
      file_path: tool.schema.string().describe("Absolute path to the file to analyze"),
      goal: tool.schema.string().describe("What specific information to extract from the file"),
    },
    async execute(args: LookAtArgs, toolContext) {
      log(`[look_at] Analyzing file: ${args.file_path}, goal: ${args.goal}`)

      const mimeType = inferMimeType(args.file_path)
      const filename = basename(args.file_path)

      const prompt = `Analyze this file and extract the requested information.

Goal: ${args.goal}

Provide ONLY the extracted information that matches the goal.
Be thorough on what was requested, concise on everything else.
If the requested information is not found, clearly state what is missing.`

      log(`[look_at] Creating session with parent: ${toolContext.sessionID}`)
      const createResult = await ctx.client.session.create({
        body: {
          parentID: toolContext.sessionID,
          title: `look_at: ${args.goal.substring(0, 50)}`,
        },
      })

      if (createResult.error) {
        log(`[look_at] Session create error:`, createResult.error)
        return `Error: Failed to create session: ${createResult.error}`
      }

      const sessionID = createResult.data.id
      log(`[look_at] Created session: ${sessionID}`)

      log(`[look_at] Sending prompt with file passthrough to session ${sessionID}`)
      await ctx.client.session.prompt({
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
            { type: "file", mime: mimeType, url: `file://${args.file_path}`, filename },
          ],
        },
      })

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
