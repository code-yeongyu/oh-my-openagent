import { replaceOrInsertRootSetting } from "./toml-section-editor"

const DEFAULT_MODE_REASONING_EFFORT = "high"
const DEFAULT_MODEL = "gpt-5.4"
const DEFAULT_MODEL_CONTEXT_WINDOW = 1_000_000
const PLAN_MODE_REASONING_EFFORT = "xhigh"

export function ensureCodexReasoningConfig(config: string): string {
  let next = replaceOrInsertRootSetting(config, "model", JSON.stringify(DEFAULT_MODEL))
  next = replaceOrInsertRootSetting(next, "model_context_window", DEFAULT_MODEL_CONTEXT_WINDOW.toString())
  next = replaceOrInsertRootSetting(
    next,
    "model_reasoning_effort",
    JSON.stringify(DEFAULT_MODE_REASONING_EFFORT),
  )
  next = replaceOrInsertRootSetting(next, "plan_mode_reasoning_effort", JSON.stringify(PLAN_MODE_REASONING_EFFORT))
  return next
}
