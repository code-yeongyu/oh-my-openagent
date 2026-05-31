import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { exists, isRecord } from "./utils.mjs";

const EVENT_LABELS = new Map([
	["PreToolUse", "pre_tool_use"],
	["PermissionRequest", "permission_request"],
	["PostToolUse", "post_tool_use"],
	["PreCompact", "pre_compact"],
	["PostCompact", "post_compact"],
	["SessionStart", "session_start"],
	["UserPromptSubmit", "user_prompt_submit"],
	["SubagentStart", "subagent_start"],
	["SubagentStop", "subagent_stop"],
	["Stop", "stop"],
]);

export async function trustedHookStatesForPlugin({ marketplaceName, pluginName, pluginRoot }) {
	const manifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
	if (!(await exists(manifestPath))) return [];
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	if (!isRecord(manifest) || typeof manifest.hooks !== "string") return [];

	const hooksPath = join(pluginRoot, manifest.hooks);
	if (!(await exists(hooksPath))) return [];
	const parsed = JSON.parse(await readFile(hooksPath, "utf8"));
	if (!isRecord(parsed) || !isRecord(parsed.hooks)) return [];

	const keySource = `${pluginName}@${marketplaceName}:${stripDotSlash(manifest.hooks)}`;
	const states = [];
	for (const [eventName, groups] of Object.entries(parsed.hooks)) {
		if (!Array.isArray(groups)) continue;
		const eventLabel = EVENT_LABELS.get(eventName);
		if (eventLabel === undefined) continue;
		for (const [groupIndex, group] of groups.entries()) {
			if (!isRecord(group) || !Array.isArray(group.hooks)) continue;
			for (const [handlerIndex, handler] of group.hooks.entries()) {
				if (!isRecord(handler) || handler.type !== "command") continue;
				if (handler.async === true) continue;
				if (typeof handler.command !== "string" || handler.command.trim() === "") continue;
				const key = `${keySource}:${eventLabel}:${groupIndex}:${handlerIndex}`;
				states.push({
					key,
					trustedHash: commandHookHash(eventLabel, group.matcher, handler),
				});
			}
		}
	}
	return states;
}

function commandHookHash(eventName, matcher, handler) {
	const command = handler.command;
	const timeout = Math.max(Number(handler.timeout ?? 600), 1);
	const normalizedHandler = {
		type: "command",
		command,
		timeout,
		async: false,
	};
	if (typeof handler.statusMessage === "string") normalizedHandler.statusMessage = handler.statusMessage;
	const identity = {
		event_name: eventName,
		hooks: [normalizedHandler],
	};
	if (typeof matcher === "string") identity.matcher = matcher;
	return `sha256:${createHash("sha256").update(JSON.stringify(canonicalJson(identity))).digest("hex")}`;
}

function canonicalJson(value) {
	if (Array.isArray(value)) return value.map(canonicalJson);
	if (!isRecord(value)) return value;
	const result = {};
	for (const key of Object.keys(value).sort()) {
		result[key] = canonicalJson(value[key]);
	}
	return result;
}

function stripDotSlash(value) {
	return value.startsWith("./") ? value.slice(2) : value;
}
