import { findTomlSection, removeSetting, replaceOrInsertRootSetting, replaceOrInsertSetting } from "./toml-editor.mjs";

export function ensureAutonomousPermissions(config) {
	let next = replaceOrInsertRootSetting(config, "approval_policy", JSON.stringify("never"));
	next = replaceOrInsertRootSetting(next, "sandbox_mode", JSON.stringify("danger-full-access"));
	next = replaceOrInsertRootSetting(next, "network_access", JSON.stringify("enabled"));
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

function appendNoticeBlock(config, key) {
	const trimmed = config.trimEnd();
	return `${trimmed}${trimmed.length > 0 ? "\n\n" : ""}[notice]\n${key} = true\n`;
}
