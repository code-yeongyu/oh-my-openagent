import * as p from "@clack/prompts"
import color from "picocolors"
import { readOmoaState, isProviderEnabled } from "../state/state-manager"
import { readOmoaRankings, hasAgentRanking } from "../state/rankings-manager"
import { resolveBestModel, extractProvider } from "../engine/resolver"
import { OverridableAgentNameSchema } from "../../../config/schema/agent-names"
import { loadRuntimeConfig } from "./shared"
import { getAllCachedModels } from "../models/model-cache"
import { backupConfigFile } from "../../config-manager/backup-config"
import { getConfigContext } from "../../config-manager"
import { writeFileAtomically } from "../../../shared/write-file-atomically"

export async function showAssignScreen(): Promise<void> {
  const cachedModels = getAllCachedModels()

  const modelInput = await p.text({
    message: "Enter model to assign (e.g., provider/model-name):",
    placeholder: "provider/model-name",
  })

  if (p.isCancel(modelInput)) return

  const model = (modelInput as string).trim()
  if (!model) return

  const state = readOmoaState()
  const rankings = readOmoaRankings()
  const config = loadRuntimeConfig()
  const agents = (config?.agents ?? {}) as Record<string, Record<string, unknown>>
  const agentNames = OverridableAgentNameSchema.options

  const provider = extractProvider(model)
  const providerEnabled = isProviderEnabled(state, provider)

  if (!providerEnabled) {
    p.log.warn(`Provider "${provider}" is currently disabled. Enable it first via Providers menu.`)
    return
  }

  console.log()
  console.log(`Selected model: ${color.cyan(model)}`)
  console.log()

  const targetOptions = agentNames.map((name) => {
    const current = (agents[name] as { model?: string } | undefined)?.model ?? "not set"
    const managed = hasAgentRanking(rankings, name)
    return {
      value: name,
      label: `${name.padEnd(22)} current=${color.dim(current)}${managed ? color.cyan(" [OMOA-managed]") : ""}`,
    }
  })

  const selected = await p.multiselect({
    message: "Select agents to assign this model to:",
    options: targetOptions,
  })

  if (p.isCancel(selected)) return

  if ((selected as string[]).length === 0) {
    p.log.info("No agents selected.")
    return
  }

  const targets = selected as string[]

  const confirm = await p.confirm({
    message: `Assign ${color.cyan(model)} to ${targets.length} agent(s)?`,
    initialValue: true,
  })

  if (p.isCancel(confirm) || !confirm) {
    p.log.info("Cancelled.")
    return
  }

  const backup = backupConfigFile(getConfigContext().paths.omoConfig)
  const fullConfig: Record<string, unknown> = { ...config! }
  const agentsMap: Record<string, Record<string, unknown>> = (fullConfig.agents ?? {}) as Record<string, Record<string, unknown>>
  fullConfig.agents = agentsMap

  for (const target of targets) {
    if (!agentsMap[target]) agentsMap[target] = {}
    agentsMap[target].model = model
  }

  writeFileAtomically(getConfigContext().paths.omoConfig, JSON.stringify(fullConfig, null, 2) + "\n")

  p.log.success(`Assigned ${model} to: ${targets.join(", ")}`)
  if (backup.backupPath) {
    p.log.info(`Backup: ${color.dim(backup.backupPath)}`)
  }
}
