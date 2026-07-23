import { appendFileSync } from "node:fs"
import type { PluginModule } from "@opencode-ai/plugin"
import {
  getMainSessionID,
  isMainSession,
} from "../../../packages/omo-opencode/src/features/claude-code-session-state/state"

const probeLog = process.env.PR6043_ROOT_PROBE_LOG
const trackedRoots: string[] = []

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

const pluginModule: PluginModule = {
  id: "pr6043-root-state-probe",
  server: async () => ({
    event: async ({ event }) => {
      if (!probeLog || (event.type !== "session.created" && event.type !== "session.deleted")) return
      const properties = isRecord(event.properties) ? event.properties : undefined
      const info = isRecord(properties?.info) ? properties.info : undefined
      const sessionID = typeof info?.id === "string" ? info.id : undefined
      const parentID = typeof info?.parentID === "string" ? info.parentID : undefined
      if (event.type === "session.created" && sessionID && !parentID && !trackedRoots.includes(sessionID)) {
        trackedRoots.push(sessionID)
      }
      setTimeout(() => {
        appendFileSync(probeLog, `${JSON.stringify({
          type: event.type,
          eventSessionID: sessionID,
          currentSessionID: getMainSessionID(),
          roots: trackedRoots.map((id) => ({ id, active: isMainSession(id) })),
        })}\n`)
      }, 0)
    },
  }),
}

export default pluginModule
