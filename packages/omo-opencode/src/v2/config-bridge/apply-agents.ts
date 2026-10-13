import type { V2AgentEditor } from "../context-types"
import type { DesiredConfig } from "./desired-config"

/**
 * Applies the desired agents inside a 2.x agent transform, in the order the host applies its own
 * config: global rules go onto every agent first, then each agent's own fields and rules.
 */
export function applyDesiredAgents(editor: V2AgentEditor, desired: DesiredConfig): void {
  const copyGlobals = () => desired.globalPermissions.map((rule) => ({ ...rule }))
  for (const current of editor.list()) {
    editor.update(current.id, (agent) => void agent.permissions.push(...copyGlobals()))
  }
  for (const [id, patch] of desired.agents) {
    if (patch.remove) {
      editor.remove(id)
      continue
    }
    const exists = editor.get(id) !== undefined
    editor.update(id, (agent) => {
      if (!exists) agent.permissions.push(...copyGlobals())
      if (patch.model !== undefined) agent.model = { ...patch.model }
      if (patch.system !== undefined) agent.system = patch.system
      if (patch.description !== undefined) agent.description = patch.description
      if (patch.mode !== undefined) agent.mode = patch.mode
      if (patch.hidden !== undefined) agent.hidden = patch.hidden
      if (patch.color !== undefined) agent.color = patch.color
      if (patch.steps !== undefined) agent.steps = patch.steps
      Object.assign(agent.request.body, patch.requestBody)
      agent.permissions.push(...patch.permissions.map((rule) => ({ ...rule })))
    })
  }
  if (desired.defaultAgent !== undefined) editor.default(desired.defaultAgent)
}
