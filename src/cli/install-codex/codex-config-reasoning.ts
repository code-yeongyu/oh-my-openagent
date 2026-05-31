import { replaceOrInsertRootSetting } from "./toml-section-editor"

const DEFAULT_MODE_REASONING_EFFORT = "high"
const PLAN_MODE_REASONING_EFFORT = "xhigh"

export function ensureCodexReasoningConfig(config: string): string {
  let next = replaceOrInsertRootSetting(
    config,
    "model_reasoning_effort",
    JSON.stringify(DEFAULT_MODE_REASONING_EFFORT),
  )
  next = replaceOrInsertRootSetting(next, "plan_mode_reasoning_effort", JSON.stringify(PLAN_MODE_REASONING_EFFORT))
  return next
}
