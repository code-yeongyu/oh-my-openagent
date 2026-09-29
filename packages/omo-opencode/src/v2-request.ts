import type { Plugin } from "@opencode/plugin"
import { isRecord } from "@oh-my-opencode/utils"
import { TODOWRITE_DESCRIPTION } from "./hooks/todo-description-override/description"
import { OMO_INTERNAL_INITIATOR_MARKER } from "./shared"

const INTERNAL_MARKER_CACHE_LIMIT = 1000
const internalMarkerCache = new Map<string, boolean>()

export function clearInternalMarkerCache(sessionID: string): void {
  internalMarkerCache.delete(sessionID)
}

export function isCopilotProviderV2(providerID: string): boolean {
  return providerID === "github-copilot" || providerID === "github-copilot-enterprise"
}

function messageHasMarker(message: unknown): boolean {
  if (!isRecord(message) || message.role !== "user") return false
  const parts = message.parts
  if (!Array.isArray(parts)) return false
  return parts.some((part) =>
    isRecord(part)
    && part.type === "text"
    && typeof part.text === "string"
    && part.text.includes(OMO_INTERNAL_INITIATOR_MARKER)
  )
}

export async function hasInternalMarkerV2(
  listMessages: () => Promise<readonly unknown[]>,
  sessionID: string,
): Promise<boolean> {
  const cached = internalMarkerCache.get(sessionID)
  if (cached !== undefined) return cached

  let found = false
  try {
    const messages = await listMessages()
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messageHasMarker(messages[index])) {
        found = true
        break
      }
    }
  } catch {
    found = false
  }

  internalMarkerCache.set(sessionID, found)
  if (internalMarkerCache.size > INTERNAL_MARKER_CACHE_LIMIT) {
    internalMarkerCache.clear()
  }
  return found
}

export async function registerToolDefinitionV2(ctx: Plugin.Context): Promise<void> {
  await ctx.tool.transform((editor) => {
    if (!editor.get("todowrite")) return
    editor.update("todowrite", (tool) => {
      tool.description = TODOWRITE_DESCRIPTION
    })
  })
}

export async function registerHeadersV2Hook(ctx: Plugin.Context): Promise<void> {
  await ctx.session.hook("model.request", async (event) => {
    if (!isCopilotProviderV2(String(event.model.providerID))) return
    // V1 additionally skipped when model.api.npm === "@ai-sdk/github-copilot"
    // (that wrapper sets x-initiator itself). The V2 event carries no npm
    // metadata, so this guard cannot be evaluated here; the positive-marker
    // requirement below is retained as the safety gate.
    const found = await hasInternalMarkerV2(
      () => ctx.session.context({ sessionID: event.sessionID }),
      event.sessionID,
    )
    if (!found) return
    event.headers["x-initiator"] = "agent"
  })
}
