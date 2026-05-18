import * as p from "@clack/prompts"
import color from "picocolors"
import { getConfigContext } from "../../config-manager"
import { readOmoaState } from "../state/state-manager"
import { readOmoaRankings } from "../state/rankings-manager"
import { validateConfig, type ValidationWarning } from "../engine/validator"
import { buildConfig, type BuildResult, type AgentChange } from "../engine/builder"
import { hasAgentRanking, hasCategoryRanking } from "../state/rankings-manager"
import { OverridableAgentNameSchema } from "../../../config/schema/agent-names"
import { getAllProviders } from "../models/model-cache"
import { showProviderScreen } from "./provider-screen"
import { showRankingScreen } from "./ranking-screen"
import { showAssignScreen } from "./assign-screen"
import { showSchemaEditorMenu } from "./schema-editor/agent-editor"
import { doctor } from "../../doctor"
import { loadRuntimeConfig } from "./shared"

function formatChange(change: AgentChange): string {
  const arrow = color.cyan("->")
  const oldVal = change.oldValue ? color.red(change.oldValue) : color.dim("(none)")
  const newVal = change.newValue ? color.green(change.newValue) : color.dim("(none)")
  return `  ${color.bold(change.target)} ${color.dim(`[${change.targetKind}]`)} ${change.field}: ${oldVal} ${arrow} ${newVal} ${color.dim(`(${change.reason})`)}`
}

function formatWarning(w: ValidationWarning): string {
  const icon = w.severity === "error" ? color.red("[X]") : w.severity === "warning" ? color.yellow("[!]") : color.blue("[i]")
  return `  ${icon} ${w.message}`
}

async function showStatusScreen(): Promise<void> {
  const state = readOmoaState()
  const rankings = readOmoaRankings()
  const config = loadRuntimeConfig()

  console.log()
  console.log(color.bgCyan(color.black(color.bold(" OMOA Status "))))
  console.log()

  const configPath = getConfigContext().paths.omoConfig
  console.log(`  Config: ${color.cyan(configPath)}`)
  console.log()

  console.log(color.bold("  Providers:"))
  const allProviders = getAllProviders()
  const knownProviders = new Set([...Object.keys(state.providers), ...allProviders])
  for (const provider of [...knownProviders].sort()) {
    const enabled = state.providers[provider]?.enabled ?? true
    const icon = enabled ? color.green("[x]") : color.red("[ ]")
    const extra = state.providers[provider]?.free_only ? color.dim(" (free-only)") : ""
    console.log(`    ${icon} ${provider}${extra}`)
  }
  console.log()

  if (state.banned_models.length > 0) {
    console.log(color.bold("  Banned Models:"))
    for (const m of state.banned_models) {
      console.log(`    ${color.red("-")} ${m}`)
    }
    console.log()
  }

  if (state.deprecated_models.length > 0) {
    console.log(color.bold("  Deprecated Models:"))
    for (const m of state.deprecated_models) {
      console.log(`    ${color.yellow("~")} ${m}`)
    }
    console.log()
  }

  if (config) {
    const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>
    const categories = (config.categories ?? {}) as Record<string, Record<string, unknown>>

    console.log(color.bold("  Agents:"))
    const agentNames = OverridableAgentNameSchema.options
    for (const name of agentNames) {
      const agent = agents[name] as { model?: string; fallback_models?: unknown } | undefined
      const managed = hasAgentRanking(rankings, name)
      const badge = managed ? color.cyan("[OMOA]") : color.dim("[manual]")
      const model = agent?.model ? color.cyan(agent.model) : color.dim("not set")
      const fallbacks = agent?.fallback_models
        ? (Array.isArray(agent.fallback_models)
          ? (agent.fallback_models as string[]).map((f) => typeof f === "string" ? f : String(f)).join(", ")
          : String(agent.fallback_models))
        : color.dim("none")
      console.log(`    ${name.padEnd(22)} ${badge.padEnd(12)} primary=${model}  fallback=${fallbacks}`)
    }
    console.log()

    if (Object.keys(categories).length > 0) {
      console.log(color.bold("  Categories:"))
      for (const [name, cat] of Object.entries(categories)) {
        const managed = hasCategoryRanking(rankings, name)
        const badge = managed ? color.cyan("[OMOA]") : color.dim("[manual]")
        const model = (cat.model as string | undefined) ? color.cyan(cat.model as string) : color.dim("not set")
        console.log(`    ${name.padEnd(22)} ${badge.padEnd(12)} model=${model}`)
      }
      console.log()
    }

    const { warnings } = validateConfig(
      agents as Record<string, { model?: string; fallback_models?: unknown }>,
      categories as Record<string, { model?: string; fallback_models?: unknown }>,
      state,
    )

    console.log(color.bold("  Validation:"))
    if (warnings.length === 0) {
      console.log(`    ${color.green("OK")} No issues found`)
    } else {
      for (const w of warnings) {
        console.log(formatWarning(w))
      }
    }
  }

  console.log()
  await p.confirm({ message: "Press Enter to continue", initialValue: true })
}

async function showBuildScreen(dryRun = false): Promise<void> {
  const state = readOmoaState()
  const rankings = readOmoaRankings()

  const s = p.spinner()
  s.start(dryRun ? "Computing planned changes..." : "Building configuration...")
  const result = buildConfig(state, rankings, dryRun)
  s.stop(dryRun ? "Dry run complete" : "Build complete")

  console.log()

  if (result.changes.length === 0) {
    p.log.info("No assignment changes needed.")
  } else {
    console.log(color.bold(dryRun ? "  Planned Changes:" : "  Applied Changes:"))
    for (const change of result.changes) {
      console.log(formatChange(change))
    }
  }

  if (result.warnings.length > 0) {
    console.log()
    console.log(color.bold("  Warnings:"))
    for (const w of result.warnings) {
      console.log(formatWarning(w))
    }
  }

  if (!dryRun && result.backup.backupPath) {
    console.log()
    p.log.info(`Backup: ${color.dim(result.backup.backupPath)}`)
  }

  if (!result.success) {
    p.log.error(`Build failed: ${result.error ?? "unknown error"}`)
  } else if (result.changes.length > 0) {
    p.log.success(dryRun ? "Preview complete. Run without --dry-run to apply." : "Configuration updated.")
  }

  console.log()
  await p.confirm({ message: "Press Enter to continue", initialValue: true })
}

async function showBackupsScreen(): Promise<void> {
  const configPath = getConfigContext().paths.omoConfig
  const dir = configPath.substring(0, configPath.lastIndexOf("/"))
  p.log.info(`Backup directory: ${color.dim(dir)}`)
  p.log.info("Backups are created automatically before each build operation.")
  p.log.info("Look for files matching: *.backup-*")
  console.log()
  await p.confirm({ message: "Press Enter to continue", initialValue: true })
}

export async function showMainMenu(): Promise<void> {
  p.intro(color.bgMagenta(color.white(" OMOA ")))

  while (true) {
    const action = await p.select({
      message: "What would you like to do?",
      options: [
        { value: "status", label: "Status", hint: "Show provider/agent/category overview" },
        { value: "build", label: "Build", hint: "Auto-resolve from rankings + providers" },
        { value: "build-dry", label: "Build (dry run)", hint: "Preview changes without writing" },
        { value: "providers", label: "Providers", hint: "Enable/disable providers" },
        { value: "rankings", label: "Rankings", hint: "View/edit model preference lists" },
        { value: "assign", label: "Assign Model", hint: "Multi-target model assignment" },
        { value: "edit", label: "Edit Config", hint: "Manual per-field editor (schema-driven)" },
        { value: "doctor", label: "Doctor", hint: "Run validation checks" },
        { value: "backups", label: "Backups", hint: "View backup info" },
        { value: "exit", label: color.dim("Exit") },
      ],
    })

    if (p.isCancel(action) || action === "exit") {
      p.outro(color.green("Bye!"))
      return
    }

    switch (action) {
      case "status": await showStatusScreen(); break
      case "build": await showBuildScreen(false); break
      case "build-dry": await showBuildScreen(true); break
      case "providers": await showProviderScreen(); break
      case "rankings": await showRankingScreen(); break
      case "assign": await showAssignScreen(); break
      case "edit": await showSchemaEditorMenu(); break
      case "doctor": await doctor({ mode: "default" }); break
      case "backups": await showBackupsScreen(); break
    }
  }
}
