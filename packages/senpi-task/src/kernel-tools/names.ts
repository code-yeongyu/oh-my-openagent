import { isTaskOrTeamFamilyTool } from "../runners/in-process/shared-tool-filter"

export const KERNEL_TOOL_NAME_MAX_LENGTH = 64

/**
 * The senpi kernel bridge's own reserved identifiers plus the host names omo never lets a parent
 * closure shadow. The task/team family is covered by isTaskOrTeamFamilyTool, which already owns
 * that vocabulary for the child tool surface.
 */
export const RESERVED_KERNEL_TOOL_ALIASES: readonly string[] = [
  "__agent__",
  "__output__",
  "__schema__",
  "eval",
  "monitor",
]

// MCP tool-name grammar (the same rules the producer applies before fencing a descriptor).
export function sanitizeKernelToolNamePart(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_")
}

function ellipsizeMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return value.slice(0, maxLength)
  const remaining = maxLength - 3
  const prefix = Math.ceil(remaining / 2)
  const suffix = Math.floor(remaining / 2)
  return `${value.slice(0, prefix)}...${value.slice(value.length - suffix)}`
}

export function normalizeKernelToolName(name: string): string {
  return ellipsizeMiddle(sanitizeKernelToolNamePart(name), KERNEL_TOOL_NAME_MAX_LENGTH)
}

/** Dash and underscore are the same identity for collision checks, matching the host matcher key. */
export function kernelToolKey(name: string): string {
  return normalizeKernelToolName(name).replace(/-/g, "_")
}

const RESERVED_KEYS: ReadonlySet<string> = new Set(RESERVED_KERNEL_TOOL_ALIASES.map(kernelToolKey))

export function isReservedKernelToolName(name: string): boolean {
  const normalized = normalizeKernelToolName(name)
  return RESERVED_KEYS.has(kernelToolKey(normalized)) || isTaskOrTeamFamilyTool(normalized)
}
