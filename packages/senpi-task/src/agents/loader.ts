import { resolve } from "node:path"

import { MERGED_OMO_CONFIG_PATH } from "@oh-my-opencode/omo-config-core"

import { categoryShadowedAgentNames, categoryShadowMessage } from "./category-shadow"
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
    env: options.env ?? {},
    homeDir: resolve(options.homeDir ?? process.env.HOME ?? process.cwd()),
    projectDir: resolve(options.projectDir ?? process.cwd()),
  }
  const agents = new Map<string, AgentDefinition>()
  const diagnostics: AgentLoaderDiagnostic[] = []
  // A user's markdown agent that declares its own model already has a chain, so a same-named category
  // shadows nothing it relies on (same rule as an omo.json agent entry with model/models). The startup
  // notice and the doctor command read config only and do not see markdown agents, so for a markdown
  // agent named after a builtin they can still warn where this loader does not.
  const markdownAgentsWithOwnModel = new Set<string>()

  for (const location of resolveAgentDefinitionLocations(resolvedOptions)) {
    const listed = listMarkdownAgentFiles(location)
    diagnostics.push(...listed.diagnostics)
    for (const path of listed.files) {
      const loaded = loadMarkdownAgent(path)
      if (loaded.ok) {
        overlayAgent(agents, loaded.agent)
        if (loaded.agent.model !== undefined || loaded.agent.models !== undefined) markdownAgentsWithOwnModel.add(loaded.agent.name)
      } else diagnostics.push(loaded.diagnostic)
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

  for (const name of categoryShadowedAgentNames(omoOverlay.config, agents.keys())) {
    if (markdownAgentsWithOwnModel.has(name)) continue
    diagnostics.push({
      kind: "category_shadows_agent",
      path: MERGED_OMO_CONFIG_PATH,
      message: categoryShadowMessage(omoOverlay.config, name),
      issuePaths: [`categories.${name}`],
    })
  }

  return { agents: Object.fromEntries(agents), diagnostics }
}

function overlayAgent(agents: Map<string, AgentDefinition>, definition: AgentDefinition): void {
  agents.set(definition.name, { ...agents.get(definition.name), ...definition })
}
