export type SettingKind = "boolean" | "enum" | "number"

export type SettingDefinition = {
  readonly path: readonly string[]
  readonly kind: SettingKind
  readonly allowedValues: readonly string[] | undefined
  readonly defaultValue: boolean | string | number
  readonly label: string
  readonly hint: string
}

const DEFAULT_LABEL = "(default)"

/**
 * v1 settings surface. Every path is verified against the real config schema
 * in settings-definitions.test.ts via `OhMyOpenCodeConfigSchema`; key
 * spellings come from src/config/schema/*.ts (note the mixed casing the
 * schema itself uses: snake_case objects, camelCase `nonBlockingByDefault`).
 */
export const SETTINGS_DEFINITIONS: readonly SettingDefinition[] = [
  {
    path: ["catalog", "enabled"],
    kind: "boolean",
    allowedValues: undefined,
    defaultValue: true,
    label: "Catalog MCP",
    hint: "built-in model catalog (default: on)",
  },
  {
    path: ["local_translator", "enabled"],
    kind: "boolean",
    allowedValues: undefined,
    defaultValue: true,
    label: "Prompt translator",
    hint: "translate and compress prompts (default: on)",
  },
  {
    path: ["local_translator", "mode"],
    kind: "enum",
    allowedValues: ["cloud", "local"],
    defaultValue: "cloud",
    label: "Translator backend",
    hint: "cloud = free Gemma via Gemini, local = Ollama (default: cloud)",
  },
  {
    path: ["local_translator", "trigger"],
    kind: "enum",
    allowedValues: ["command", "always"],
    defaultValue: "command",
    label: "Translator trigger",
    hint: "command = only /caveman, always = every prompt (default: command)",
  },
  {
    path: ["local_translator", "min_length"],
    kind: "number",
    allowedValues: undefined,
    defaultValue: 20,
    label: "Translator min length",
    hint: "skip messages shorter than this in chars (default: 20)",
  },
  {
    path: ["background_task", "nonBlockingByDefault"],
    kind: "boolean",
    allowedValues: undefined,
    defaultValue: true,
    label: "Background delegation default",
    hint: "task() without run_in_background runs in the background (default: on)",
  },
  {
    path: ["comment_checker", "enabled"],
    kind: "boolean",
    allowedValues: undefined,
    defaultValue: true,
    label: "Comment checker",
    hint: "flag AI-style comments (default: on)",
  },
]

export function settingId(definition: SettingDefinition): string {
  return definition.path.join(".")
}

export function configNode(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function readSettingValue(
  config: Readonly<Record<string, unknown>>,
  path: readonly string[],
): { readonly present: boolean; readonly value: unknown } {
  let node: unknown = config
  for (const segment of path) {
    if (!configNode(node)) return { present: false, value: undefined }
    node = (node as Record<string, unknown>)[segment]
  }
  if (node === undefined) return { present: false, value: undefined }
  return { present: true, value: node }
}

export function readCurrentSettingValue(
  currentValues: Readonly<Record<string, unknown>>,
  definition: SettingDefinition,
): { readonly present: boolean; readonly value: unknown } {
  const id = settingId(definition)
  if (!Object.prototype.hasOwnProperty.call(currentValues, id)) {
    return { present: false, value: undefined }
  }
  return { present: true, value: currentValues[id] }
}

export function formatSettingValue(value: unknown): string {
  if (value === undefined) return DEFAULT_LABEL
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return String(value)
  if (typeof value === "string") return value
  return JSON.stringify(value)
}

export function isSettingDefault(present: boolean): boolean {
  return !present
}

function nextDefaultValue(definition: SettingDefinition): boolean | string | number {
  return definition.defaultValue
}

export function nextBooleanValue(base: boolean): boolean {
  return !base
}

export function nextEnumValue(
  definition: SettingDefinition,
  base: string,
): string | undefined {
  const values = definition.allowedValues
  if (values === undefined || values.length === 0) return undefined
  const index = values.indexOf(base)
  return values[(index + 1) % values.length]
}

export function settingBaseValue(
  definition: SettingDefinition,
  present: boolean,
  current: unknown,
  pending: unknown,
): boolean | string | number {
  if (pending !== undefined && typeof pending !== "object") return pending as boolean | string | number
  if (present && (typeof current === "boolean" || typeof current === "string" || typeof current === "number")) {
    return current
  }
  return nextDefaultValue(definition)
}
