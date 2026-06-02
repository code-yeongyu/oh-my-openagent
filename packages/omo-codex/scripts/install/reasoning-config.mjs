import { replaceOrInsertRootSetting } from "./toml-editor.mjs";

const DEFAULT_MODE_REASONING_EFFORT = "high";
const PLAN_MODE_REASONING_EFFORT = "xhigh";

export function ensureCodexReasoningConfig(config) {
	let next = replaceOrInsertRootSetting(
		config,
		"model_reasoning_effort",
		JSON.stringify(DEFAULT_MODE_REASONING_EFFORT),
	);
	next = replaceOrInsertRootSetting(next, "plan_mode_reasoning_effort", JSON.stringify(PLAN_MODE_REASONING_EFFORT));
	return next;
}
