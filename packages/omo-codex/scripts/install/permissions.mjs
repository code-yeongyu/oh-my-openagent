import { appendBlock, findTomlSection, removeSetting, replaceOrInsertRootSetting, replaceOrInsertSetting } from "./toml-editor.mjs";

const AUTONOMOUS_FEATURES = ["multi_agent", "child_agents_md", "unified_exec", "goals"];

export function ensureAutonomousPermissions(config) {
	let next = replaceOrInsertRootSetting(config, "approval_policy", JSON.stringify("never"));
	next = replaceOrInsertRootSetting(next, "sandbox_mode", JSON.stringify("danger-full-access"));
	next = replaceOrInsertRootSetting(next, "network_access", JSON.stringify("enabled"));
	for (const featureName of AUTONOMOUS_FEATURES) {
		next = ensureFeatureEnabled(next, featureName);
	}
	next = removeWindowsSandboxSetting(next);
	next = ensureNoticeEnabled(next, "hide_full_access_warning");
	return ensureNoticeEnabled(next, "hide_world_writable_warning");
}

function removeWindowsSandboxSetting(config) {
	const section = findTomlSection(config, "windows");
	if (!section) return config;
	return removeSetting(config, section, "sandbox");
}

function ensureNoticeEnabled(config, key) {
	const section = findTomlSection(config, "notice");
	if (!section) return appendNoticeBlock(config, key);
	return replaceOrInsertSetting(config, section, key, "true");
}

function ensureFeatureEnabled(config, key) {
	const section = findTomlSection(config, "features");
	if (!section) return appendBlock(config, `[features]\n${key} = true\n`);
	return replaceOrInsertSetting(config, section, key, "true");
}

function appendNoticeBlock(config, key) {
	return appendBlock(config, `[notice]\n${key} = true\n`);
}
