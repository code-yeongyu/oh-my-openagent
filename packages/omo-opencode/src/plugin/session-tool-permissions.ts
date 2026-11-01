import { z } from "zod"

import type { NativePromptContext } from "../agents/native-prompt-frame"
import { log } from "../shared/logger"
import type { PluginContext } from "./types"

type ToolPermissions = NonNullable<NativePromptContext["toolPermissions"]>

const sessionToolPermissionsSchema = z.object({
  permission: z.array(z.object({
    permission: z.string(),
    pattern: z.string(),
    action: z.enum(["allow", "ask", "deny"]),
  })).optional(),
})

const sessionEventSchema = z.object({
  type: z.string(),
  properties: z.object({ info: z.object({ id: z.string() }).passthrough() }).passthrough().optional(),
})

function toToolPermissions(data: unknown): ToolPermissions | undefined {
  const session = sessionToolPermissionsSchema.safeParse(data)
  if (!session.success) return undefined
  return (session.data.permission ?? []).map((rule) => ({
    pattern: rule.permission, permission: rule.action, scope: rule.pattern,
  }))
}

export function createSessionToolPermissionLookup(ctx: PluginContext) {
  const bySession = new Map<string, ToolPermissions>()

  const lookup = async (sessionID?: string): Promise<ToolPermissions | undefined> => {
    if (!sessionID) return []
    const cached = bySession.get(sessionID)
    if (cached) return cached
    const sessionsApi = ctx.client.session
    if (!sessionsApi?.get) return undefined
    const response = await sessionsApi.get({
      path: { id: sessionID },
      query: { directory: ctx.directory },
      signal: AbortSignal.timeout(3000),
    }).catch((error: unknown) => {
      log("[native-prompt] Could not refresh session tool permissions", { sessionID, error })
      return undefined
    })
    if (!response?.data) return undefined
    const permissions = toToolPermissions(response.data)
    if (permissions) bySession.set(sessionID, permissions)
    return permissions
  }

  const observe = (input: { event: unknown }): void => {
    const event = sessionEventSchema.safeParse(input.event)
    if (!event.success || !event.data.properties) return
    const { info } = event.data.properties
    if (event.data.type === "session.deleted") {
      bySession.delete(info.id)
      return
    }
    if (event.data.type !== "session.updated") return
    const permissions = toToolPermissions(info)
    if (permissions) bySession.set(info.id, permissions)
    else bySession.delete(info.id)
  }

  return { lookup, observe }
}
