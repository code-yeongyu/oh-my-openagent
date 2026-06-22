import type { PluginInput } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../../config"
import { getCache, setCache, getSessionEntries } from "./file-cache-store"
import { createHash } from "node:crypto"
import { resolve, isAbsolute } from "node:path"

// Turn tracker
const sessionTurnMap = new Map<string, number>()

function resolveSessionID(input: any, messages: any[]): string | undefined {
  if (typeof input.sessionID === "string" && input.sessionID.length > 0) {
    return input.sessionID
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const sid = messages[i]?.info?.sessionID
    if (typeof sid === "string" && sid.length > 0) {
      return sid
    }
  }
  return undefined
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

function getPathFromArgs(args: any): string | undefined {
  if (!args || typeof args !== "object") return undefined
  return args.filePath ?? args.path ?? args.file_path ?? args.file
}

export function createFileCacheHook(ctx: PluginInput, _pluginConfig: OhMyOpenCodeConfig) {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args?: any },
      output: { title: string; output: string; metadata: any }
    ) => {
      const toolName = input.tool.toLowerCase()
      const sessionID = input.sessionID
      if (!sessionID) return

      const currentTurn = sessionTurnMap.get(sessionID) ?? 0

      if (toolName === "read") {
        const filePath = output.title || extractFilePath(output.metadata) || getPathFromArgs(input.args)
        if (!filePath || typeof output.output !== "string") return

        const resolvedPath = isAbsolute(filePath) ? filePath : resolve(ctx.directory, filePath)
        const content = output.output
        const size = Buffer.byteLength(content, "utf8")
        const hash = createHash("sha256").update(content).digest("hex")

        setCache(sessionID, resolvedPath, {
          content,
          hash,
          size,
          lastUsedTurn: currentTurn,
        })

        // Replace output.output with a concise metadata cache marker
        output.output = `[File Cache: ${resolvedPath} (v${hash}, ${size} bytes) - Cached in Virtual Memory. Refer to this file directly or edit it without re-reading.]`
      } else if (["write", "edit", "hashline-edit"].includes(toolName)) {
        const filePath = extractFilePath(output.metadata) || getPathFromArgs(input.args) || output.title
        if (!filePath) return
        const resolvedPath = isAbsolute(filePath) ? filePath : resolve(ctx.directory, filePath)

        // Mark active
        const entry = getCache(sessionID, resolvedPath)
        if (entry) {
          entry.lastUsedTurn = currentTurn
        }
      }
    },

    "experimental.chat.messages.transform": async (
      input: { sessionID?: string; [key: string]: unknown },
      output: { messages: any[] }
    ) => {
      const sessionID = input.sessionID || resolveSessionID(input, output.messages)
      if (!sessionID) return

      const currentTurn = output.messages.length
      sessionTurnMap.set(sessionID, currentTurn)

      const sessionCache = getSessionEntries(sessionID)
      if (!sessionCache || sessionCache.size === 0) return

      for (const msg of output.messages) {
        if (!msg.parts || !Array.isArray(msg.parts)) continue
        for (const part of msg.parts) {
          if (part.type !== "text" || typeof part.text !== "string") continue

          let text = part.text

          // 1. Rehydrate any active cache markers
          const markerRegex = /\[File Cache: (.*?) \(v([0-9a-f]+), (\d+) bytes\) - Cached in Virtual Memory\. Refer to this file directly or edit it without re-reading\.\]/g
          text = text.replace(markerRegex, (match: string, filePath: string) => {
            const resolvedPath = isAbsolute(filePath) ? filePath : resolve(ctx.directory, filePath)
            const entry = sessionCache.get(resolvedPath) || sessionCache.get(filePath)
            if (entry) {
              const isActive = currentTurn - entry.lastUsedTurn <= 2
              if (isActive) {
                return entry.content
              }
            }
            return match
          })

          // 2. Dehydrate any inactive full content blocks (in case they weren't dehydrated or need it)
          const fileContentRegex = /<file>(.*?)<\/file>\s*<content>([\s\S]*?)<\/content>/g
          text = text.replace(fileContentRegex, (match: string, filePath: string, content: string) => {
            const resolvedPath = isAbsolute(filePath) ? filePath : resolve(ctx.directory, filePath)
            const entry = sessionCache.get(resolvedPath) || sessionCache.get(filePath)
            if (entry) {
              const isActive = currentTurn - entry.lastUsedTurn <= 2
              if (!isActive) {
                return `[File Cache: ${resolvedPath} (v${entry.hash}, ${entry.size} bytes) - Cached in Virtual Memory. Refer to this file directly or edit it without re-reading.]`
              }
            } else {
              // If not in cache but we found full content, let's cache it now!
              const size = Buffer.byteLength(content, "utf8")
              const hash = createHash("sha256").update(content).digest("hex")
              setCache(sessionID, resolvedPath, { content: match, hash, size, lastUsedTurn: currentTurn })
            }
            return match
          })

          part.text = text
        }
      }
    },

    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type === "session.deleted") {
        const props = event.properties as Record<string, unknown> | undefined
        const sessionID = resolveSessionID(props, []) || (props?.sessionID as string)
        if (sessionID) {
          sessionTurnMap.delete(sessionID)
        }
      }
    }
  }
}
