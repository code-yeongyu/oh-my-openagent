#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Hook-trust discovery utilities for the OMO Codex plugin.
 *
 * These functions scan installed plugin manifests and compute trusted
 * hook hashes. They are pure read/scan operations — they do NOT modify
 * any user configuration files.
 */

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

/**
 * Discover trusted hook states for an installed plugin by reading its
 * manifest and hook definition files.
 *
 * @param {{ marketplaceName: string, pluginName: string, pluginRoot: string }} opts
 * @returns {Promise<Array<{ key: string, trustedHash: string }>>}
 */
export async function trustedHookStatesForPlugin({ marketplaceName, pluginName, pluginRoot }) {
	const manifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
	let manifest;
	try {
		manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	} catch (error) {
		if (error instanceof Error) return [];
		throw error;
	}
	if (!isRecord(manifest)) return [];

	const states = [];
	for (const hookPath of hookManifestPaths(manifest.hooks)) {
		const hooksPath = join(pluginRoot, hookPath);
		let parsed;
		try {
			parsed = JSON.parse(await readFile(hooksPath, "utf8"));
		} catch (error) {
			if (error instanceof Error) continue;
			throw error;
		}
		if (!isRecord(parsed) || !isRecord(parsed.hooks)) continue;
		states.push(...trustedHookStatesForHooksFile({
			keySource: `${pluginName}@${marketplaceName}:${hookPath}`,
			hooks: parsed.hooks,
		}));
	}
	return states;
}

/**
 * Extract hook paths from a plugin manifest's `hooks` field.
 * Accepts a single string or an array of strings.
 * @param {string | string[] | undefined} value
 * @returns {string[]}
 */
export function hookManifestPaths(value) {
	if (typeof value === "string" && value.trim() !== "") return [stripDotSlash(value)];
	if (!Array.isArray(value)) return [];
	return value.filter((item) => typeof item === "string" && item.trim() !== "").map(stripDotSlash);
}

/**
 * Compute trusted hook states from a parsed hooks definition file.
 * @param {{ keySource: string, hooks: Record<string, unknown[]> }} opts
 * @returns {Array<{ key: string, trustedHash: string }>}
 */
export function trustedHookStatesForHooksFile({ keySource, hooks }) {
	const states = [];
	for (const [eventName, groups] of Object.entries(hooks)) {
		if (!Array.isArray(groups)) continue;
		const eventLabel = EVENT_LABELS.get(eventName);
		if (eventLabel === undefined) continue;
		for (const [groupIndex, group] of groups.entries()) {
			if (!isRecord(group) || !Array.isArray(group.hooks)) continue;
			for (const [handlerIndex, handler] of group.hooks.entries()) {
				if (!isRecord(handler) || handler.type !== "command") continue;
				if (handler.async === true) continue;
				if (typeof handler.command !== "string" || handler.command.trim() === "") continue;
				states.push({
					key: `${keySource}:${eventLabel}:${groupIndex}:${handlerIndex}`,
					trustedHash: commandHookHash(eventLabel, group.matcher, handler),
				});
			}
		}
	}
	return states;
}

/**
 * Compute the SHA-256 trusted hash for a command-type hook handler.
 * @param {string} eventName - The snake_case event label (e.g. "session_start")
 * @param {string | undefined} matcher - Optional matcher string
 * @param {{ command: string, timeout?: number, statusMessage?: string }} handler
 * @returns {string} The hash in the form `sha256:<hex>`
 */
export function commandHookHash(eventName, matcher, handler) {
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

/**
 * Canonical JSON serialization — recursively sorts object keys
 * to produce a stable serialization for hashing.
 * @param {unknown} value
 * @returns {unknown}
 */
export function canonicalJson(value) {
	if (Array.isArray(value)) return value.map(canonicalJson);
	if (!isRecord(value)) return value;
	const result = {};
	for (const key of Object.keys(value).sort()) {
		result[key] = canonicalJson(value[key]);
	}
	return result;
}

/**
 * Strip a leading `./` from a path string.
 * @param {string} value
 * @returns {string}
 */
export function stripDotSlash(value) {
	return value.startsWith("./") ? value.slice(2) : value;
}

/**
 * Type guard: is the value a plain object (not array, not null)?
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
