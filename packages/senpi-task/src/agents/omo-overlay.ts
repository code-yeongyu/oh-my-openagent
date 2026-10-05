import { join } from "node:path"

import {
  loadOmoConfig,
  resolveModelReferences,
  type OmoConfigDiagnostic,
  type OmoModelReferenceDiagnostic,
} from "@oh-my-opencode/omo-config-core"

import { mapOmoConfigAgents } from "./omo-config-agents"
import { findPromptAppendConfigPath, promptAppendFailureMessage, resolvePromptAppend } from "./prompt-append"
import type { AgentDefinition, AgentLoaderDiagnostic, LoadAgentsOptions } from "./types"

type OmoAgentOverlayResult = {
  readonly agents: readonly AgentDefinition[]
  readonly diagnostics: readonly AgentLoaderDiagnostic[]
}

type ConfigDiagnostic = OmoConfigDiagnostic | OmoModelReferenceDiagnostic

export function loadOmoAgentOverlays(options: Required<LoadAgentsOptions>): OmoAgentOverlayResult {
  const env = {
    ...process.env,
    ...options.env,
    APPDATA: join(options.homeDir, "AppData", "Roaming"),
    HOME: options.homeDir,
    USERPROFILE: options.homeDir,
    XDG_CONFIG_HOME: join(options.homeDir, ".config"),
  }
  const loaded = loadOmoConfig({ cwd: options.projectDir, env, harness: "senpi" })
  const resolvedModels = resolveModelReferences(loaded.config)
  const diagnostics = [...loaded.diagnostics, ...resolvedModels.diagnostics].map(toAgentLoaderDiagnostic)
  const roots = { projectDir: options.projectDir, homeDir: options.homeDir }
  const fallbackPath = join(options.homeDir, ".omo", "omo.jsonc")
  const agents: AgentDefinition[] = []
  for (const definition of Object.values(mapOmoConfigAgents(resolvedModels.view))) {
    const value = definition.promptAppend
    if (value === undefined) {
      agents.push(definition)
      continue
    }
    const resolution = resolvePromptAppend(value, roots)
    if (resolution.ok) {
      agents.push({ ...definition, promptAppend: resolution.value })
      continue
    }
    diagnostics.push({
      kind: "prompt_append",
      path: findPromptAppendConfigPath(loaded.layers, definition.name, value, fallbackPath),
      message: promptAppendFailureMessage(definition.name, value, resolution.reason, resolution.targetPath),
    })
    const { promptAppend: _unresolved, ...base } = definition
    agents.push(base)
  }
  return { agents, diagnostics }
}

function toAgentLoaderDiagnostic(diagnostic: ConfigDiagnostic): AgentLoaderDiagnostic {
  const paths = issuePaths(diagnostic)
  return {
    kind: diagnostic.kind === "parse" ? "config_parse" : diagnostic.kind === "read" ? "read" : "validation",
    message: diagnostic.message,
    path: diagnostic.path,
    ...(paths === undefined ? {} : { issuePaths: paths }),
  }
}

function issuePaths(diagnostic: ConfigDiagnostic): readonly string[] | undefined {
  return diagnostic.kind === "model_catalog_cycle" ? undefined : diagnostic.issuePaths
}
