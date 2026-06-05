import type { PluginContext } from "../types"
import { normalizeSDKResponse } from "../../shared"

export type ModelFallbackTitleInput = {
  readonly sessionID: string
  readonly providerID: string
  readonly modelID: string
  readonly variant?: string
}

export function createModelFallbackTitleUpdater(ctx: PluginContext) {
  const fallbackTitleMaxEntries = 200
  const fallbackTitleState = new Map<string, { baseTitle?: string; lastKey?: string }>()

  return async (input: ModelFallbackTitleInput): Promise<void> => {
    const key = `${input.providerID}/${input.modelID}${input.variant ? `:${input.variant}` : ""}`
    const existing = fallbackTitleState.get(input.sessionID) ?? {}
    if (existing.lastKey === key) return

    if (!existing.baseTitle) {
      const sessionResp = await ctx.client.session.get({ path: { id: input.sessionID } }).catch(() => null)
      const sessionInfo = sessionResp
        ? normalizeSDKResponse<{ readonly title?: string } | null>(sessionResp, null, { preferResponseOnMissingData: true })
        : null
      const rawTitle = sessionInfo?.title
      existing.baseTitle = typeof rawTitle === "string" && rawTitle.length > 0
        ? rawTitle.replace(/\s*\[fallback:[^\]]+\]$/i, "").trim()
        : "Session"
    }

    const variantLabel = input.variant ? ` ${input.variant}` : ""
    const newTitle = `${existing.baseTitle} [fallback: ${input.providerID}/${input.modelID}${variantLabel}]`

    await ctx.client.session
      .update({
        path: { id: input.sessionID },
        body: { title: newTitle },
        query: { directory: ctx.directory },
      })
      .catch(() => {})

    existing.lastKey = key
    fallbackTitleState.set(input.sessionID, existing)
    if (fallbackTitleState.size > fallbackTitleMaxEntries) {
      const oldestKey = fallbackTitleState.keys().next().value
      if (oldestKey) fallbackTitleState.delete(oldestKey)
    }
  }
}
