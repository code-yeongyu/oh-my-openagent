import { resolve } from "node:path"

import { loadMarkdownAgent } from "./markdown"
import { loadOmoAgentOverlays } from "./omo-overlay"
import { listMarkdownAgentFiles, resolveAgentDefinitionLocations } from "./paths"
import { registeredAgentDefinitions } from "./registry"
import type { AgentDefinition, AgentLoaderDiagnostic, LoadAgentsOptions, LoadAgentsResult } from "./types"

/**
 * Loads Senpi task agent definitions from pi-compatible markdown locations,
 * then overlays programmatic registrations, then overlays `omo.json` agents.
 *
 * The final `omo.json` overlay is intentional: pi-task lets programmatic
 * definitions win last, while Senpi task keeps user/project config as the
 * final authority so checked-in or local `omo.json` can override component
 * defaults without code changes.
 */
export function loadAgents(options: LoadAgentsOptions = {}): LoadAgentsResult {
  const resolvedOptions = {
    homeDir: resolve(options.homeDir ?? process.env.HOME ?? process.cwd()),
    projectDir: resolve(options.projectDir ?? process.cwd()),
  }
  const agents = new Map<string, AgentDefinition>()
  const diagnostics: AgentLoaderDiagnostic[] = []

  for (const location of resolveAgentDefinitionLocations(resolvedOptions)) {
    const listed = listMarkdownAgentFiles(location)
    diagnostics.push(...listed.diagnostics)
    for (const path of listed.files) {
      const loaded = loadMarkdownAgent(path)
      if (loaded.ok) overlayAgent(agents, loaded.agent)
      else diagnostics.push(loaded.diagnostic)
    }
  }

  for (const definition of registeredAgentDefinitions()) {
    overlayAgent(agents, definition)
  }

  const omoOverlay = loadOmoAgentOverlays(resolvedOptions)
  diagnostics.push(...omoOverlay.diagnostics)
  for (const definition of omoOverlay.agents) {
    overlayAgent(agents, definition)
  }

  return { agents: Object.fromEntries(agents), diagnostics }
}

function overlayAgent(agents: Map<string, AgentDefinition>, definition: AgentDefinition): void {
  agents.set(definition.name, { ...agents.get(definition.name), ...definition })
}
