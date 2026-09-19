import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Plugin identity: `omo`. Drives the `/omo:<command>` namespace in CodeBuddy. */
export const PLUGIN_NAME = "omo";

export interface HookEnvironment {
	readonly env?: Record<string, string | undefined>;
	readonly scriptUrl?: string;
	readonly pluginRoot?: string;
}

/**
 * CodeBuddy exports the absolute plugin directory as `CODEBUDDY_PLUGIN_ROOT`
 * (Claude Code compatibility alias: `CLAUDE_PLUGIN_ROOT`). When a hook runs
 * outside CodeBuddy (unit tests, manual `echo | node`) we fall back to walking
 * up from this script: `<pluginRoot>/hooks/scripts/*.mjs` -> `<pluginRoot>`.
 */
export function resolvePluginRoot(options: HookEnvironment = {}): string {
	const env = options.env ?? process.env;
	const fromEnv = options.pluginRoot ?? env["CODEBUDDY_PLUGIN_ROOT"] ?? env["CLAUDE_PLUGIN_ROOT"];
	if (fromEnv !== undefined && fromEnv.trim().length > 0) return resolve(fromEnv);

	const scriptUrl = options.scriptUrl ?? import.meta.url;
	// src/hooks/paths.ts -> packages/omo-codebuddy ; hooks/scripts/*.mjs -> plugin root
	const here = dirname(fileURLToPath(scriptUrl));
	const candidates = [
		// bundled: <plugin>/hooks/scripts/hook.mjs
		resolve(here, "..", ".."),
		// bundled into a nested dir: keep walking one more level
		resolve(here, "..", "..", ".."),
		// source: <package>/src/hooks/paths.ts
		resolve(here, "..", "..", "plugin"),
	];
	for (const candidate of candidates) {
		if (existsSync(join(candidate, ".codebuddy-plugin", "plugin.json"))) return candidate;
	}
	return candidates[0] ?? here;
}

export function resolveProjectRoot(payloadCwd: string | undefined, options: HookEnvironment = {}): string {
	const env = options.env ?? process.env;
	const fromPayload = payloadCwd !== undefined && payloadCwd.trim().length > 0 ? payloadCwd : undefined;
	const candidate =
		fromPayload ?? env["CODEBUDDY_PROJECT_DIR"] ?? env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
	return isAbsolute(candidate) ? candidate : resolve(candidate);
}

/** Absolute path of a bundled skill body inside the installed plugin. */
export function pluginSkillPath(pluginRoot: string, skillName: string): string {
	return join(pluginRoot, "skills", skillName, "SKILL.md");
}

export function skillFileExists(path: string): boolean {
	return existsSync(path);
}
