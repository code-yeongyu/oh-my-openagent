import { showMainMenu } from "./tui/main-menu"
import { readOmoaState, writeOmoaState, setProviderEnabled, isProviderEnabled } from "./state/state-manager"
import { readOmoaRankings } from "./state/rankings-manager"
import { buildConfig } from "./engine/builder"
import { validateConfig } from "./engine/validator"
import { extractProvider } from "./engine/resolver"
import { loadRuntimeConfig } from "./tui/shared"
import { OverridableAgentNameSchema } from "../../config/schema/agent-names"
import { countProviderUsage } from "./tui/shared"
import { getAllProviders } from "./models/model-cache"
import color from "picocolors"

export async function omoaInteractive(): Promise<number> {
  await showMainMenu()
  return 0
}

export function omoaStatus(): number {
  const state = readOmoaState()
  const rankings = readOmoaRankings()
  const config = loadRuntimeConfig()

  console.log(color.bgCyan(color.black(color.bold(" OMOA Status "))))
  console.log()

  const allProviders = getAllProviders()
  const knownProviders = new Set([...Object.keys(state.providers), ...allProviders])
  console.log("Providers:")
  for (const provider of [...knownProviders].sort()) {
    const enabled = isProviderEnabled(state, provider)
    console.log(`  ${enabled ? color.green("[x]") : color.red("[ ]")} ${provider}`)
  }
  console.log()

  if (config) {
    const agents = config.agents ?? {}
    const categories = config.categories ?? {}

    console.log("Agents:")
    const agentNames = OverridableAgentNameSchema.options
    for (const name of agentNames) {
      const agent = agents[name] as { model?: string; fallback_models?: unknown } | undefined
      const model = agent?.model ? color.cyan(agent.model) : color.dim("not set")
      const managed = (rankings.agents[name]?.length ?? 0) > 0
      console.log(`  ${name.padEnd(22)} ${managed ? color.cyan("[OMOA]") : color.dim("[manual]")} primary=${model}`)
    }
    console.log()

    const { warnings } = validateConfig(
      agents as Record<string, { model?: string; fallback_models?: unknown }>,
      categories as Record<string, { model?: string; fallback_models?: unknown }>,
      state,
    )

    if (warnings.length === 0) {
      console.log(`Validation: ${color.green("OK")}`)
    } else {
      console.log("Validation:")
      for (const w of warnings) {
        const icon = w.severity === "error" ? color.red("[X]") : color.yellow("[!]")
        console.log(`  ${icon} ${w.message}`)
      }
    }
  }

  return 0
}

export function omoaBuild(dryRun: boolean, yes: boolean): number {
  const state = readOmoaState()
  const rankings = readOmoaRankings()
  const result = buildConfig(state, rankings, dryRun)

  if (result.error) {
    console.error(color.red(`Build failed: ${result.error}`))
    return 1
  }

  if (result.changes.length === 0) {
    console.log("No assignment changes needed.")
    return 0
  }

  console.log(dryRun ? "Planned Changes:" : "Applied Changes:")
  for (const change of result.changes) {
    const arrow = color.cyan("->")
    const old = change.oldValue ?? "(none)"
    const newVal = change.newValue ?? "(none)"
    console.log(`  ${change.target} [${change.targetKind}] ${change.field}: ${old} ${arrow} ${newVal}`)
  }

  if (result.warnings.length > 0) {
    console.log("\nWarnings:")
    for (const w of result.warnings) {
      const icon = w.severity === "error" ? color.red("[X]") : color.yellow("[!]")
      console.log(`  ${icon} ${w.message}`)
    }
  }

  if (!dryRun && result.backup.backupPath) {
    console.log(`\nBackup: ${result.backup.backupPath}`)
  }

  return 0
}

export function omoaProviderList(): number {
  const state = readOmoaState()
  const config = loadRuntimeConfig()
  const allProviders = getAllProviders()
  const knownProviders = new Set([...Object.keys(state.providers), ...allProviders])
  const usageCounts = config ? countProviderUsage(config) : new Map<string, { primary: number; fallback: number }>()

  for (const provider of [...knownProviders].sort()) {
    const enabled = isProviderEnabled(state, provider)
    const usage = usageCounts.get(provider)
    const status = enabled ? color.green("enabled") : color.red("disabled")
    const usageStr = usage ? ` (primary:${usage.primary} fallback:${usage.fallback})` : ""
    console.log(`  ${provider}: ${status}${usageStr}`)
  }

  return 0
}

export function omoaProviderSet(providerName: string, enabled: boolean): number {
  const state = readOmoaState()
  const newState = setProviderEnabled(state, providerName, enabled)
  writeOmoaState(newState)
  console.log(`Provider "${providerName}" ${enabled ? "enabled" : "disabled"}. Run "omoa build" to apply.`)
  return 0
}
