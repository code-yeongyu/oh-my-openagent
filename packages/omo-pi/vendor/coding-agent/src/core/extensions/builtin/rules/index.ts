import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";

import type { ExtensionAPI } from "../../types.ts";

import { registerSlashCommands } from "./commands.ts";
import { createEngine, defaultConfig } from "./rules/engine.ts";
import { findRuleCandidates } from "./rules/finder.ts";
import { findProjectRoot } from "./rules/project-root.ts";
import { extractToolPaths } from "./rules/tool-paths.ts";
import type { PiRulesConfig } from "./rules/types.ts";

type PiRulesMode = PiRulesConfig["mode"];

const MODE_VALUES = new Set<string>(["static", "dynamic", "both", "off"]);

export default function piRulesExtension(pi: ExtensionAPI): void {
	pi.registerFlag("pi-rules-disabled", {
		type: "boolean",
		default: false,
		description: "Disable pi-rules hooks.",
	});
	pi.registerFlag("pi-rules-mode", {
		type: "string",
		default: "both",
		description: "Rule injection mode: static, dynamic, both, or off.",
	});
	const config = defaultConfig();
	const engine = createEngine(config, {
		findCandidates: findRuleCandidates,
		readFile: (path) => {
			try {
				return readFileSync(path, "utf-8");
			} catch {
				return null;
			}
		},
		findProjectRoot,
		extractToolPaths,
	});
	registerSlashCommands(pi, engine);

	function syncConfigFromFlags(): void {
		const disabled = pi.getFlag("pi-rules-disabled");
		const mode = pi.getFlag("pi-rules-mode");

		if (typeof disabled === "boolean") {
			engine.config.disabled = disabled;
		}
		if (typeof mode === "string" && isPiRulesMode(mode)) {
			engine.config.mode = mode;
		}
	}

	pi.on("session_start", async (event, ctx) => {
		syncConfigFromFlags();
		if (engine.config.disabled) {
			return undefined;
		}

		engine.resetSession(ctx.cwd);
		pi.appendEntry("pi-rules.scan", { cwd: ctx.cwd, reason: event.reason });
		return undefined;
	});

	pi.on("session_compact", async (_event, ctx) => {
		engine.resetSession(ctx.cwd);
		pi.appendEntry("pi-rules.scan", { cwd: ctx.cwd, reason: "compact" });
		return undefined;
	});

	pi.on("before_agent_start", async (event, ctx) => {
		syncConfigFromFlags();
		if (engine.config.disabled || engine.config.mode === "off" || engine.config.mode === "dynamic") {
			return undefined;
		}

		const loaded = engine.loadStaticRules(ctx.cwd);
		const nativeContextPaths = new Set(
			event.systemPromptOptions.contextFiles?.flatMap((contextFile) => pathKeys(contextFile.path)) ?? [],
		);
		for (const rule of loaded.rules) {
			if (nativeContextPaths.has(rule.path) || nativeContextPaths.has(rule.realPath)) {
				engine.markStaticInjected(rule);
			}
		}
		const rules = loaded.rules.filter(
			(rule) =>
				!nativeContextPaths.has(rule.path) &&
				!nativeContextPaths.has(rule.realPath) &&
				!engine.isStaticInjected(rule),
		);

		if (rules.length === 0) {
			return undefined;
		}

		const block = engine.formatStatic(rules);
		for (const rule of rules) {
			engine.markStaticInjected(rule);
		}

		return { systemPrompt: event.systemPrompt + block };
	});

	pi.on("tool_result", async (event, ctx) => {
		syncConfigFromFlags();
		if (engine.config.disabled || engine.config.mode === "off" || engine.config.mode === "static" || event.isError) {
			return undefined;
		}

		const targetPaths = extractToolPaths(event, ctx.cwd);
		const firstTargetPath = targetPaths[0];
		if (firstTargetPath === undefined) {
			return undefined;
		}

		const fingerprints = engine.fingerprintDynamicTargets(ctx.cwd, targetPaths);
		const pendingFingerprints = fingerprints.filter((target) => !engine.isDynamicTargetFingerprintCurrent(target));
		if (pendingFingerprints.length === 0) {
			engine.commitDynamicTargetFingerprints(fingerprints);
			return undefined;
		}

		const loaded = engine.loadDynamicRules(
			ctx.cwd,
			pendingFingerprints.map((target) => target.targetPath),
		);
		engine.commitDynamicTargetFingerprints(fingerprints);
		const rules = loaded.rules.filter(
			(rule) => !engine.isStaticInjected(rule) && !engine.isDynamicInjected(firstTargetPath, rule),
		);
		if (rules.length === 0) {
			return undefined;
		}

		const firstPendingTarget = pendingFingerprints[0]?.targetPath ?? firstTargetPath;
		const block = engine.formatDynamic(rules, displayPath(ctx.cwd, firstPendingTarget));
		for (const rule of rules) {
			engine.markDynamicInjected(firstTargetPath, rule);
		}

		return { content: [...event.content, { type: "text", text: block }] };
	});
}

function isPiRulesMode(value: string): value is PiRulesMode {
	return MODE_VALUES.has(value);
}

function pathKeys(filePath: string): string[] {
	try {
		return [filePath, realpathSync.native(filePath)];
	} catch {
		return [filePath];
	}
}

function displayPath(cwd: string, filePath: string): string {
	return isAbsolute(filePath) ? relative(cwd, filePath) : filePath;
}
