import { readFileSync } from "node:fs"

export interface DriverGoalSnapshot {
  readonly codexGoalJson: string | undefined
  readonly warnings: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Missing candidates are normal. Invalid or unreadable stores are advisory diagnostics, not writes.
export function readDriverGoalJson(paths: readonly string[]): DriverGoalSnapshot {
  const warnings: string[] = []
  for (const path of paths) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
      if (!isRecord(parsed) || parsed.version !== 1) {
        warnings.push(`Unsupported driver goal store: ${path}`)
        continue
      }
      if (parsed.goal === null) return { codexGoalJson: undefined, warnings }
      if (isRecord(parsed.goal)) return { codexGoalJson: JSON.stringify({ goal: parsed.goal }), warnings }
      warnings.push(`Invalid driver goal: ${path}`)
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue
      warnings.push(`Cannot read driver goal ${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { codexGoalJson: undefined, warnings }
}
