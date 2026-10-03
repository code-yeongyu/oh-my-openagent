import type { ToolDefinition } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../config"
import type { ToolRegistryFactories } from "./tool-registry-factories"

export function createSecurityMissionToolsRecord(args: {
  readonly pluginConfig: OhMyOpenCodeConfig
  readonly factories: ToolRegistryFactories
}): Record<string, ToolDefinition> {
  const { pluginConfig, factories } = args
  if (!pluginConfig.security_mission?.enabled) return {}

  const store = factories.createMissionStore({
    persistenceDir: pluginConfig.security_mission.persistence_dir ?? undefined,
    maxFindings: pluginConfig.security_mission.max_findings,
  })

  return {
    security_mission_start: factories.createSecurityMissionStartTool(store),
    security_finding_add: factories.createSecurityFindingAddTool(store),
    security_finding_verify: factories.createSecurityFindingVerifyTool(store),
    security_mission_report: factories.createSecurityMissionReportTool(store),
  }
}
