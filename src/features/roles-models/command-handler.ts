import type { OhMyOpenCodeConfig } from "../../config"
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

function parsePickArguments(args: string): {
  role?: string
  model?: string
  variant?: string
  persist: boolean
  error?: string
} {
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
  setOverride(input.sessionID, role, entry)

  const persistNote = parsed.persist
    ? "\n(--persist will be supported in a follow-up; override is session-only for now)"
    : ""

  pushText(
    output,
    `\`\`\`\n✓ /pick applied · ${role} → ${model}${parsed.variant ? ` ${parsed.variant}` : ""}${persistNote}\n\`\`\``,
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
