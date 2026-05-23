import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"

import { applyEdits, modify } from "jsonc-parser"

import type { OhMyOpenCodeConfig } from "../../config"
import { getOmoConfigPath } from "../../cli/config-manager/config-context"
import { writeFileAtomically } from "../../shared/write-file-atomically"
import { discoverRoles } from "./discover"
import { buildViews } from "./view"
import { renderPanel } from "./renderer"
import {
  setOverride,
  setAutoPick,
  getAutoPickOverride,
} from "./state"
import type { ChainEntry } from "./types"

type CommandInput = {
  command: string
  sessionID: string
  arguments: string
}

type CommandOutput = {
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
  message?: Record<string, unknown>
}

const HANDLED_COMMANDS = new Set(["show-models", "pick", "auto-pick"])

export function isRolesModelsCommand(command: string): boolean {
  return HANDLED_COMMANDS.has(command.toLowerCase())
}

export function resolveAutoPick(
  sessionID: string,
  config: OhMyOpenCodeConfig | undefined,
): boolean {
  const override = getAutoPickOverride(sessionID)
  if (override !== undefined) return override
  return config?.display?.auto_pick ?? false
}

function pushText(output: CommandOutput, text: string): void {
  output.parts.push({ type: "text", text })
}

type ParsedPickArguments = {
  role?: string
  model?: string
  variant?: string
  persist: boolean
  error?: string
}

function parsePickArguments(args: string): ParsedPickArguments {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  let role: string | undefined
  let model: string | undefined
  let variant: string | undefined
  let persist = false

  for (const token of tokens) {
    if (token === "--persist") {
      persist = true
      continue
    }
    if (token.startsWith("--variant=")) {
      variant = token.slice("--variant=".length)
      continue
    }
    if (!role) {
      role = token
      continue
    }
    if (!model) {
      model = token
      continue
    }
  }

  if (!role || !model) {
    return {
      role,
      model,
      variant,
      persist,
      error: "Usage: /pick <role> <model> [--variant=X] [--persist]",
    }
  }

  return { role, model, variant, persist }
}

type PersistResult =
  | { success: true; configPath: string }
  | { success: false; error: string; configPath: string }

function persistPickToConfig(
  role: string,
  model: string,
  variant: string | undefined,
  config: OhMyOpenCodeConfig | undefined,
): PersistResult {
  const configPath = getOmoConfigPath()

  // Ensure the config directory exists before writing
  try {
    mkdirSync(dirname(configPath), { recursive: true })
  } catch (mkdirErr) {
    const msg = mkdirErr instanceof Error ? mkdirErr.message : String(mkdirErr)
    return { success: false, error: `Cannot create config directory: ${msg}`, configPath }
  }

  // Read existing content; initialize with {} if file is absent or empty
  let content = "{}"
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8")
      content = raw.trim().length > 0 ? raw : "{}"
    } catch (readErr) {
      const msg = readErr instanceof Error ? readErr.message : String(readErr)
      return { success: false, error: `Cannot read config file: ${msg}`, configPath }
    }
  }

  // Apply jsonc-parser modify to preserve comments, trailing commas, formatting
  const fmtOptions = { formattingOptions: { tabSize: 2, insertSpaces: true, eol: "\n" } }
  let updated = content
  try {
    const modelEdits = modify(updated, ["agents", role, "model"], model, fmtOptions)
    updated = applyEdits(updated, modelEdits)

    if (variant !== undefined) {
      const variantEdits = modify(updated, ["agents", role, "variant"], variant, fmtOptions)
      updated = applyEdits(updated, variantEdits)
    }
  } catch (editErr) {
    const msg = editErr instanceof Error ? editErr.message : String(editErr)
    return { success: false, error: `Cannot apply config edits: ${msg}`, configPath }
  }

  // Atomic write: writeFileAtomically writes to <path>.tmp then renames
  try {
    writeFileAtomically(configPath, updated)
  } catch (writeErr) {
    const msg = writeErr instanceof Error ? writeErr.message : String(writeErr)
    return { success: false, error: `Cannot write config file (${(writeErr as NodeJS.ErrnoException).code ?? "UNKNOWN"}): ${msg}`, configPath }
  }

  // Update in-memory config so the current session sees the new value immediately.
  // The next loadPluginConfig call will also pick it up from disk.
  if (config) {
    if (!config.agents) {
      (config as Record<string, unknown>).agents = {}
    }
    const agents = config.agents as Record<string, Record<string, unknown>>
    if (!agents[role]) {
      agents[role] = {}
    }
    agents[role].model = model
    if (variant !== undefined) {
      agents[role].variant = variant
    }
  }

  return { success: true, configPath }
}

function handleShowModels(
  input: CommandInput,
  output: CommandOutput,
  config: OhMyOpenCodeConfig | undefined,
): void {
  const roles = discoverRoles(config)
  const views = buildViews(roles, { sessionID: input.sessionID })
  const panel = renderPanel(views, {
    hideEmptyRoles: true,
    autoPick: resolveAutoPick(input.sessionID, config),
  })
  pushText(output, panel)
}

function handlePick(
  input: CommandInput,
  output: CommandOutput,
  config: OhMyOpenCodeConfig | undefined,
): void {
  const parsed = parsePickArguments(input.arguments)
  if (parsed.error) {
    pushText(output, `\`\`\`\n${parsed.error}\n\`\`\``)
    return
  }

  const role = parsed.role!
  const model = parsed.model!
  const roles = discoverRoles(config)
  const matching = roles.find((r) => r.name === role)

  if (!matching) {
    pushText(output, `\`\`\`\nUnknown role: ${role}\n\`\`\``)
    return
  }

  const entry: ChainEntry = parsed.variant ? { model, variant: parsed.variant } : { model }

  // When --persist is set, persist to config BEFORE setting the session override.
  // If persist fails, the session override must not be left in a stale state.
  if (parsed.persist) {
    // Basic model validation: reject empty strings and paths that look like filesystem references.
    if (model.length === 0 || model.includes("/") || model.includes("\\")) {
      pushText(output, `\`\`\`\n✗ /pick --persist failed · invalid model identifier: "${model}"\n\`\`\``)
      return
    }
    const result = persistPickToConfig(role, model, parsed.variant, config)
    if (!result.success) {
      pushText(
        output,
        `\`\`\`\n✗ /pick --persist failed · ${result.error}\n(path: ${result.configPath})\n\`\`\``,
      )
      return
    }
    // Only set the session override after persist succeeds.
    setOverride(input.sessionID, role, entry)
    pushText(
      output,
      `\`\`\`\n✓ /pick applied · ${role} → ${model}${parsed.variant ? ` ${parsed.variant}` : ""}\n(persisted to ${result.configPath})\n\`\`\``,
    )
    return
  }

  // Non-persist path: set session-only override immediately.
  setOverride(input.sessionID, role, entry)

  pushText(
    output,
    `\`\`\`\n✓ /pick applied · ${role} → ${model}${parsed.variant ? ` ${parsed.variant}` : ""}\n\`\`\``,
  )
}

function handleAutoPick(input: CommandInput, output: CommandOutput): void {
  const arg = input.arguments.trim().toLowerCase()
  if (arg !== "on" && arg !== "off") {
    pushText(output, "```\nUsage: /auto-pick on|off\n```")
    return
  }
  const enabled = arg === "on"
  setAutoPick(input.sessionID, enabled)
  pushText(output, `\`\`\`\n✓ auto-pick ${enabled ? "ON" : "OFF"} for this session\n\`\`\``)
}

const SESSION_PANEL_SHOWN = new Set<string>()

export function maybeAutoPrintPanel(
  sessionID: string,
  messageID: string | undefined,
  output: CommandOutput,
  config: OhMyOpenCodeConfig | undefined,
): void {
  if (!config?.display?.show_models_on_session_start) return
  // opencode rejects parts that don't carry id/sessionID/messageID, so we
  // can only inject during a real chat turn (where messageID is populated
  // by the runtime). Without it, skip silently.
  if (!messageID) return
  if (SESSION_PANEL_SHOWN.has(sessionID)) return
  SESSION_PANEL_SHOWN.add(sessionID)

  const roles = discoverRoles(config)
  const views = buildViews(roles, { sessionID })
  const panel = renderPanel(views, {
    hideEmptyRoles: true,
    autoPick: resolveAutoPick(sessionID, config),
  })
  output.parts.push({
    id: `prt_${randomUUID()}`,
    sessionID,
    messageID,
    type: "text",
    text: panel,
  })
}

export function _resetAutoPrintForTests(): void {
  SESSION_PANEL_SHOWN.clear()
}

export function handleRolesModelsCommand(
  input: CommandInput,
  output: CommandOutput,
  config: OhMyOpenCodeConfig | undefined,
): boolean {
  const command = input.command.toLowerCase()
  switch (command) {
    case "show-models":
      handleShowModels(input, output, config)
      return true
    case "pick":
      handlePick(input, output, config)
      return true
    case "auto-pick":
      handleAutoPick(input, output)
      return true
    default:
      return false
  }
}
