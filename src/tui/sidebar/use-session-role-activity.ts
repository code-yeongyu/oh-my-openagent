// IMPORTED BY: tui — reactive store for per-session role/model activity
import { createSignal, type Accessor } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { deriveRow, type RoleRow } from "./derive-row"

export type { RoleRow }

export function useSessionRoleActivity(
  api: TuiPluginApi,
  sessionID: string,
): {
  rows: Accessor<RoleRow[]>
  activeCount: Accessor<number>
  totalCount: Accessor<number>
  dispose: () => void
} {
  const [rowMap, setRowMap] = createSignal<Map<string, RoleRow>>(new Map())

  // Derived accessors
  const rows: Accessor<RoleRow[]> = () =>
    [...rowMap().values()].sort((a, b) => a.role.localeCompare(b.role))
  // observedCount may exceed totalCount when sub-agent roles appear outside config.
  // Clamp the displayed active count to totalCount so the N/M ratio never exceeds 1.
  const activeCount: Accessor<number> = () => Math.min(rowMap().size, totalCount())
  const totalCount: Accessor<number> = () => {
    const agentConfig = api.state.config.agent
    return agentConfig ? Object.keys(agentConfig).length : 0
  }

  // --- Hydrate from snapshot (one-shot, not reactive) ---
  const messages = api.state.session.messages(sessionID)
  const initialMap = new Map<string, RoleRow>()
  for (const msg of messages) {
    if (msg.role !== "assistant") continue
    // Defend against empty agent string
    if (!msg.agent || msg.agent === "") continue
    // Flat fields per types.gen.d.ts:478-479
    if (!msg.modelID || !msg.providerID) continue
    const role = msg.agent
    const configuredDefault = api.state.config.agent?.[role]?.model
    const requirements = AGENT_MODEL_REQUIREMENTS[role]
    const row = deriveRow({
      role,
      configuredDefault,
      observed: { providerID: msg.providerID, modelID: msg.modelID },
      requirements,
    })
    // last-write-wins: most recent message for this role wins
    initialMap.set(role, row)
  }
  setRowMap(initialMap)

  // --- Live updates via message.updated event ---
  const unsubscribe = api.event.on("message.updated", (event) => {
    // Cross-session isolation
    if (event.properties.sessionID !== sessionID) return
    const info = event.properties.info
    if (info.role !== "assistant") return
    // Defend against empty agent string
    if (!info.agent || info.agent === "") return
    // Flat fields
    if (!info.modelID || !info.providerID) return

    const role = info.agent
    const configuredDefault = api.state.config.agent?.[role]?.model
    const requirements = AGENT_MODEL_REQUIREMENTS[role]
    const row = deriveRow({
      role,
      configuredDefault,
      observed: { providerID: info.providerID, modelID: info.modelID },
      requirements,
    })
    setRowMap((prev) => new Map(prev).set(row.role, row))
  })

  const dispose = () => {
    unsubscribe()
  }

  return { rows, activeCount, totalCount, dispose }
}
