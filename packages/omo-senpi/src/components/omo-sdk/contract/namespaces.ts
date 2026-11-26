// The namespaces of the root (first-party design 4.2), in the order the design lists them.
const NAMESPACES = [
  "threads",
  "devices",
  "account",
  "deviceService",
  "sync",
  "config",
  "daemon",
  "diagnostics",
  "install",
  "engine",
  "mcp",
  "boulder",
  "worktrees",
  "toolkit",
] as const

export type Namespace = (typeof NAMESPACES)[number]
