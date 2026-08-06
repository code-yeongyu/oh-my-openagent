import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"

export type WaitBounds = OmoTaskSettings["wait"]

// Codex wait contract (config min/default/max): an omitted timeout falls back to default_ms; any
// supplied value is clamped into [min_ms, max_ms]. Boundary intent (defaults 5000/60000/600000):
// 4999 -> 5000, 999999 -> 600000.
export function clampWaitTimeout(requested: number | undefined, bounds: WaitBounds): number {
  if (requested === undefined) return bounds.default_ms
  if (requested < bounds.min_ms) return bounds.min_ms
  if (requested > bounds.max_ms) return bounds.max_ms
  return requested
}
