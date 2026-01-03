export const HOOK_NAME = "knowledge-monitor"

export const MONITORED_TOOLS = ["write", "edit", "multiedit", "bash"] as const
export type MonitoredTool = (typeof MONITORED_TOOLS)[number]

export const SEVERITY_PRIORITY: Record<string, number> = {
  block: 3,
  warn: 2,
  info: 1,
}

export const VIOLATION_HEADER = `[KNOWLEDGE POLICY VIOLATION DETECTED]

Your action conflicts with established knowledge policies.
Review the violations below and take appropriate action.

`

export const BLOCK_SUFFIX = `
BLOCKING: This action cannot proceed until violations are resolved.
Either fix the issue or request a policy exception from a knowledge curator.
`

export const WARN_SUFFIX = `
WARNING: This action may proceed, but please acknowledge the policy concern.
Consider whether your approach aligns with organizational standards.
`

export const INFO_SUFFIX = `
INFO: For your awareness. No action required unless relevant to your task.
`
