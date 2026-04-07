import { log } from "../../shared/logger"

interface CacheEntry {
  result: string
  hitCount: number
  storedAt: number
}

const globalCache = new Map<string, CacheEntry>()

function normalizePrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, " ")
}

function makeCacheKey(subagentType: string, prompt: string): string {
  return `${subagentType}::${normalizePrompt(prompt)}`
}

function debugLog(msg: string, data?: any) {
  try {
    const fs = require("fs")
    const timestamp = new Date().toISOString()
    const entry = `[${timestamp}] [explore-cache-hook] ${msg} ${data ? JSON.stringify(data) : ""}\n`
    fs.appendFileSync("/tmp/explore-cache-hook.log", entry)
  } catch {}
}

function isExploreLike(toolUse: any): boolean {
  if (toolUse?.name !== "task") return false
  const input = toolUse?.input
  if (!input) return false
  const subagent = input.subagent_type?.toLowerCase()
  const hasSamePrompt = !!input.prompt
  const noSessionId = !input.session_id
  return (subagent === "explore" || subagent === "librarian") && hasSamePrompt && noSessionId
}

export function createExploreResultCacheHook(): any {
  return {
    name: "explore-result-cache-hook",
    hook: "experimental.chat.messages.transform",
    async handler(messages: any, ctx: any) {
      debugLog("HOOK INVOKED", { msgCount: messages?.length })
      
      if (!messages || messages.length === 0) return messages

      const lastMessage = messages[messages.length - 1]
      if (lastMessage?.role !== "assistant") return messages

      const toolUses = (lastMessage?.content as any[])?.filter((c) => c?.type === "tool_use") || []
      debugLog("FOUND TOOL USES", { count: toolUses.length })

      for (const toolUse of toolUses) {
        if (isExploreLike(toolUse)) {
          const key = makeCacheKey(toolUse.input.subagent_type, toolUse.input.prompt)
          const cached = globalCache.get(key)

          if (cached) {
            cached.hitCount++
            debugLog("CACHE HIT", {
              key: key.slice(0, 80),
              hitCount: cached.hitCount,
              ageMs: Date.now() - cached.storedAt,
            })
            log("[explore-result-cache-hook] Cache HIT", {
              key: key.slice(0, 80),
              hitCount: cached.hitCount,
              ageMs: Date.now() - cached.storedAt,
            })
          }
        }
      }

      const toolResults = (lastMessage?.content as any[])?.filter((c) => c?.type === "tool_result") || []
      debugLog("FOUND TOOL RESULTS", { count: toolResults.length })

      for (const toolResult of toolResults) {
        const toolUse = toolUses.find((u) => u?.id === toolResult?.tool_use_id)
        if (toolUse && isExploreLike(toolUse)) {
          const key = makeCacheKey(toolUse.input.subagent_type, toolUse.input.prompt)
          const content = toolResult?.content

          if (typeof content === "string" && content.length > 0) {
            globalCache.set(key, {
              result: content,
              hitCount: 0,
              storedAt: Date.now(),
            })

            debugLog("CACHE STORE", {
              key: key.slice(0, 80),
              contentLength: content.length,
              totalCacheSize: globalCache.size,
            })
            log("[explore-result-cache-hook] Cache STORE", {
              key: key.slice(0, 80),
              contentLength: content.length,
              totalCacheSize: globalCache.size,
            })
          }
        }
      }

      return messages
    },
  }
}
