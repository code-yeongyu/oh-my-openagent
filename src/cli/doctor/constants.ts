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
  OPENCODE_INSTALLATION: "opencode-installation",
  PLUGIN_REGISTRATION: "plugin-registration",
  CONFIG_VALIDATION: "config-validation",
  MODEL_RESOLUTION: "model-resolution",
  AUTH_ANTHROPIC: "auth-anthropic",
  AUTH_OPENAI: "auth-openai",
  AUTH_GOOGLE: "auth-google",
  DEP_AST_GREP_CLI: "dep-ast-grep-cli",
  DEP_AST_GREP_NAPI: "dep-ast-grep-napi",
  DEP_COMMENT_CHECKER: "dep-comment-checker",
  GH_CLI: "gh-cli",
  LSP_SERVERS: "lsp-servers",
  MCP_BUILTIN: "mcp-builtin",
  MCP_USER: "mcp-user",
  VERSION_STATUS: "version-status",
} as const

export const CHECK_NAMES: Record<string, string> = {
  [CHECK_IDS.OPENCODE_INSTALLATION]: "OpenCode Installation",
  [CHECK_IDS.PLUGIN_REGISTRATION]: "Plugin Registration",
  [CHECK_IDS.CONFIG_VALIDATION]: "Configuration Validity",
  [CHECK_IDS.MODEL_RESOLUTION]: "Model Resolution",
  [CHECK_IDS.AUTH_ANTHROPIC]: "Anthropic (Claude) Auth",
  [CHECK_IDS.AUTH_OPENAI]: "OpenAI (ChatGPT) Auth",
  [CHECK_IDS.AUTH_GOOGLE]: "Google (Gemini) Auth",
  [CHECK_IDS.DEP_AST_GREP_CLI]: "AST-Grep CLI",
  [CHECK_IDS.DEP_AST_GREP_NAPI]: "AST-Grep NAPI",
  [CHECK_IDS.DEP_COMMENT_CHECKER]: "Comment Checker",
  [CHECK_IDS.GH_CLI]: "GitHub CLI",
  [CHECK_IDS.LSP_SERVERS]: "LSP Servers",
  [CHECK_IDS.MCP_BUILTIN]: "Built-in MCP Servers",
  [CHECK_IDS.MCP_USER]: "User MCP Configuration",
  [CHECK_IDS.VERSION_STATUS]: "Version Status",
} as const

export const CATEGORY_NAMES: Record<string, string> = {
  installation: "Installation",
  configuration: "Configuration",
  authentication: "Authentication",
  dependencies: "Dependencies",
  tools: "Tools & Servers",
  updates: "Updates",
} as const

export const EXIT_CODES = {
  SUCCESS: 0,
  FAILURE: 1,
} as const

export const MIN_OPENCODE_VERSION = "1.0.150"

export const PACKAGE_NAME = "oh-my-opencode"

export const OPENCODE_BINARIES = ["opencode", "opencode-desktop"] as const
