import color from "picocolors"

export const SYMBOLS = {
  check: color.green("\u2713"),
  cross: color.red("\u2717"),
  warn: color.yellow("\u26A0"),
  info: color.blue("\u2139"),
  arrow: color.cyan("\u2192"),
  bullet: color.dim("\u2022"),
  skip: color.dim("\u25CB"),
} as const

export const STATUS_COLORS = {
  pass: color.green,
  fail: color.red,
  warn: color.yellow,
  skip: color.dim,
} as const

export const CHECK_IDS = {
  SYSTEM: "system",
  CONFIG: "config",
  PROVIDERS: "providers",
  TOOLS: "tools",
  MODELS: "models",
} as const

export const CHECK_NAMES: Record<string, string> = {
  [CHECK_IDS.SYSTEM]: "System",
  [CHECK_IDS.CONFIG]: "Configuration",
  [CHECK_IDS.PROVIDERS]: "Providers",
  [CHECK_IDS.TOOLS]: "Tools",
  [CHECK_IDS.MODELS]: "Models",
} as const

export const AUTH_ENV_VARS: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
} as const

export const AUTH_PLUGINS: Record<string, { plugin: string; name: string }> = {
  anthropic: { plugin: "builtin", name: "Anthropic" },
  openai: { plugin: "opencode-openai-codex-auth", name: "OpenAI" },
  google: { plugin: "opencode-antigravity-auth", name: "Google" },
} as const

export const EXIT_CODES = {
  SUCCESS: 0,
  FAILURE: 1,
} as const

export const MIN_OPENCODE_VERSION = "1.0.150"

export const PACKAGE_NAME = "oh-my-opencode"

export const OPENCODE_BINARIES = ["opencode", "opencode-desktop"] as const
