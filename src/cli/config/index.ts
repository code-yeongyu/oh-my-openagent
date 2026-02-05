import * as p from "@clack/prompts"
import color from "picocolors"
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs"
import { getConfigContext } from "../config-manager"
import { parseJsonc } from "../../shared"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import type { ConfigEditorState } from "./types"
import { editAgents } from "./agents"
import { editCategories } from "./categories"
import { runBulkOperations } from "./bulk"
import { displayValidationWarnings, countWarnings } from "./validation"



function getConfigPath(): string {
  const { paths } = getConfigContext()
  return paths.omoConfig
}

function loadConfig(path: string): OhMyOpenCodeConfig | null {
  if (!existsSync(path)) {
    return {}
  }

  try {
    const content = readFileSync(path, "utf-8")
    const config = parseJsonc<OhMyOpenCodeConfig>(content)
    return config ?? {}
  } catch {
    return null
  }
}

function createBackup(configPath: string): string | null {
  try {
    if (!existsSync(configPath)) return null

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backupPath = `${configPath}.backup.${timestamp}`
    renameSync(configPath, backupPath)
    return backupPath
  } catch {
    return null
  }
}

function writeConfigAtomically(configPath: string, config: OhMyOpenCodeConfig): boolean {
  try {
    const tempPath = `${configPath}.tmp`
    writeFileSync(tempPath, JSON.stringify(config, null, 2) + "\n")
    renameSync(tempPath, configPath)
    return true
  } catch {
    return false
  }
}

async function editRootDefaults(state: ConfigEditorState): Promise<void> {
  const currentModel = state.config.default_run_agent

  const model = await p.text({
    message: "Enter default agent for 'oh-my-opencode run' command:",
    initialValue: currentModel ?? "",
    placeholder: "e.g., sisyphus",
  })

  if (p.isCancel(model)) return

  const finalModel = model.trim() || undefined
  state.config.default_run_agent = finalModel
  state.modified = true

  p.log.success(`Updated default_run_agent to ${finalModel ?? "(none)"}`)
}

async function showMainMenu(state: ConfigEditorState): Promise<"exit" | "continue"> {
  const warningCount = countWarnings(state)
  const warningLabel = warningCount > 0 ? color.yellow(` (${warningCount} warnings)`) : ""

  const action = await p.select({
    message: "What would you like to configure?",
    options: [
      { value: "agents", label: "[1] Agents", hint: "model, category, fallback, permissions" },
      { value: "categories", label: "[2] Categories", hint: "model, description" },
      { value: "root", label: "[3] Root Defaults", hint: "default agent" },
      { value: "bulk", label: "[4] Bulk Operations", hint: "set for all agents at once" },
      { value: "validation", label: `[5] View Validation Warnings${warningLabel}`, hint: "check configuration health" },
      { value: "exit", label: "[0] Save and Exit" },
    ],
  })

  if (p.isCancel(action)) {
    return "exit"
  }

  switch (action) {
    case "agents":
      await editAgents(state)
      return "continue"
    case "categories":
      await editCategories(state)
      return "continue"
    case "root":
      await editRootDefaults(state)
      return "continue"
    case "bulk":
      await runBulkOperations(state)
      return "continue"
    case "validation":
      displayValidationWarnings(state)
      await p.confirm({ message: "Press Enter to continue", initialValue: true })
      return "continue"
    case "exit":
      return "exit"
    default:
      return "continue"
  }
}

export { runConfigEditor as config }

async function runConfigEditor(): Promise<number> {
  p.intro(color.bgMagenta(color.white(" oh-my-opencode config ")))

  const configPath = getConfigPath()
  p.log.info(`Config file: ${color.cyan(configPath)}`)

  const config = loadConfig(configPath)
  if (config === null) {
    p.log.error(`Failed to load config from ${configPath}`)
    p.log.info("The file may be corrupted or contain invalid JSON.")
    p.outro(color.red("Configuration failed."))
    return 1
  }

  const state: ConfigEditorState = {
    config,
    modified: false,
    configPath,
  }

  let running = true
  while (running) {
    const result = await showMainMenu(state)
    if (result === "exit") {
      running = false
    }
  }

  if (!state.modified) {
    p.log.info("No changes made.")
    p.outro(color.green("Configuration unchanged."))
    return 0
  }

  const confirmSave = await p.confirm({
    message: `Save changes to config?`,
    initialValue: true,
  })

  if (p.isCancel(confirmSave) || !confirmSave) {
    const discard = await p.confirm({
      message: "Discard changes?",
      initialValue: false,
    })

    if (p.isCancel(discard) || !discard) {
      p.log.info("Returning to menu...")
      return runConfigEditor()
    }

    p.log.info("Changes discarded.")
    p.outro(color.yellow("Configuration not saved."))
    return 0
  }

  const s = p.spinner()
  s.start("Saving configuration...")

  const backupPath = createBackup(configPath)
  const success = writeConfigAtomically(configPath, state.config)

  if (!success) {
    s.stop(`Failed to save config ${color.red("[X]")}`)
    p.outro(color.red("Configuration failed to save."))
    return 1
  }

  s.stop(`Config saved ${color.green("[OK]")}`)

  if (backupPath) {
    p.log.info(`Backup created: ${color.dim(backupPath)}`)
  }

  p.log.success(color.bold("Configuration saved successfully!"))
  p.outro(color.green("oMoMoMoMo... Done!"))

  return 0
}
