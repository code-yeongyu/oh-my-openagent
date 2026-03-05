export const HOOK_NAME = "learning-bus-injector"

export const DEFAULT_SKIP_AGENTS = [
  "prometheus",
  "compaction",
  "oracle",
  "librarian",
  "explore",
  "atlas",
  "metis",
  "momus",
  "sisyphus-junior",
  "multimodal-looker",
]

export const RECENCY_DAYS = 7
export const MIN_CONFIDENCE = 0.5
export const MAX_EVENTS_TO_INJECT = 10
export const MAX_INJECTION_CHARS = 2000

export const EVENT_TYPE_WEIGHTS: Record<string, number> = {
  correction: 1.0,
  discovery: 0.8,
  pattern: 0.8,
  insight: 0.7,
  calibration: 0.7,
  decision: 0.4,
  result: 0.3,
  task_dispatched: 0.1,
  task_completed: 0.2,
}
