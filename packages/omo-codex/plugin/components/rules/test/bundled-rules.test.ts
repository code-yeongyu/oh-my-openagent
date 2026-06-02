import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	type CodexPostCompactInput,
	type CodexSessionStartInput,
	runPostCompactHook,
	runSessionStartHook,
	runUserPromptSubmitHook,
} from "../src/codex-hook.js";
import { createRuleDiscoveryCache, findRuleCandidates } from "../src/rules/finder.js";

interface FixtureOptions {
	readonly writeProjectDuplicate?: boolean;
}

interface Fixture {
	readonly root: string;
	readonly pluginRoot: string;
	readonly pluginData: string;
	readonly bundledRulePath: string;
	readonly projectRulePath: string;
}

const BUNDLED_ONLY_ENV = {
	CODEX_RULES_ENABLED_SOURCES: "plugin-bundled",
};

const PROJECT_AND_BUNDLED_ENV = {
	CODEX_RULES_ENABLED_SOURCES: ".omo/rules,plugin-bundled",
};

const DISABLED_BUNDLED_ENV = {
	CODEX_RULES_ENABLED_SOURCES: "plugin-bundled",
	CODEX_RULES_DISABLE_BUNDLED: "1",
};

const BUNDLED_BODY = "Bundled craftsman baseline.";
const SHARED_BODY = "Always choose the smallest correct change.";

const tempDirectories: string[] = [];
let originalPluginRoot: string | undefined;

beforeEach(() => {
	originalPluginRoot = process.env["PLUGIN_ROOT"];
});

afterEach(() => {
	restoreEnv("PLUGIN_ROOT", originalPluginRoot);
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function makeFixture(options: FixtureOptions = {}): Fixture {
	const root = mkdtempSync(join(tmpdir(), "codex-rules-bundled-project-"));
	const pluginRoot = mkdtempSync(join(tmpdir(), "codex-rules-bundled-plugin-"));
	const pluginData = mkdtempSync(join(tmpdir(), "codex-rules-bundled-data-"));
	tempDirectories.push(root, pluginRoot, pluginData);

	writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
	mkdirSync(join(root, ".omo", "rules"), { recursive: true });
	mkdirSync(join(pluginRoot, "bundled-rules"), { recursive: true });

	const bundledRulePath = join(pluginRoot, "bundled-rules", "hephaestus.md");
	const bundledBody = options.writeProjectDuplicate === true ? SHARED_BODY : BUNDLED_BODY;
	writeFileSync(bundledRulePath, ruleMarkdown(bundledBody));

	const projectRulePath = join(root, ".omo", "rules", "hephaestus.md");
	if (options.writeProjectDuplicate === true) {
		writeFileSync(projectRulePath, ruleMarkdown(SHARED_BODY));
	}

	process.env["PLUGIN_ROOT"] = pluginRoot;
	return { root, pluginRoot, pluginData, bundledRulePath, projectRulePath };
}

function ruleMarkdown(body: string): string {
	return ["---", "description: Fixture", "alwaysApply: true", "---", "", body].join("\n");
}

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
		return;
	}

	process.env[name] = value;
}

function sessionStartInput(root: string): CodexSessionStartInput {
	return {
		session_id: "session-1",
		transcript_path: null,
		cwd: root,
		hook_event_name: "SessionStart",
		model: "gpt-5.5",
		permission_mode: "default",
		source: "startup",
	};
}

function postCompactInput(root: string): CodexPostCompactInput {
	return {
		session_id: "session-1",
		turn_id: "turn-compact",
		transcript_path: null,
		cwd: root,
		hook_event_name: "PostCompact",
		model: "gpt-5.5",
		trigger: "manual",
	};
}

function userPromptSubmitInput(root: string): Parameters<typeof runUserPromptSubmitHook>[0] {
	return {
		session_id: "session-1",
		turn_id: "turn-1",
		transcript_path: null,
		cwd: root,
		hook_event_name: "UserPromptSubmit",
		model: "gpt-5.5",
		permission_mode: "default",
		prompt: "continue",
	};
}

function occurrenceCount(value: string, search: string): number {
	return value.split(search).length - 1;
}

describe("plugin bundled rules", () => {
	it("#given PLUGIN_ROOT with bundled markdown #when finding candidates #then plugin-bundled source is cached", () => {
		// given
		const { pluginRoot } = makeFixture();
		const cache = createRuleDiscoveryCache();

		// when
		const candidates = findRuleCandidates({ projectRoot: null, targetFile: null, skipUserHome: true, cache });

		// then
		expect(candidates.map((candidate) => `${candidate.source}:${candidate.relativePath}`)).toEqual([
			"plugin-bundled:bundled-rules/hephaestus.md",
		]);
		expect(cache.scannedRuleFiles.has(join(pluginRoot, "bundled-rules"))).toBe(true);
	});

	it("#given alwaysApply bundled rule #when SessionStart runs #then static context includes it", async () => {
		// given
		const { root, pluginData } = makeFixture();

		// when
		const output = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: BUNDLED_ONLY_ENV,
		});

		// then
		expect(output).toContain('"hookEventName":"SessionStart"');
		expect(output).toContain(BUNDLED_BODY);
	});

	it("#given same project and bundled body #when SessionStart runs #then project rule wins", async () => {
		// given
		const { root, pluginData, bundledRulePath, projectRulePath } = makeFixture({ writeProjectDuplicate: true });

		// when
		const output = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: PROJECT_AND_BUNDLED_ENV,
		});

		// then
		expect(occurrenceCount(output, SHARED_BODY)).toBe(1);
		expect(output).toContain(projectRulePath);
		expect(output).not.toContain(bundledRulePath);
	});

	it("#given bundled rules disabled #when SessionStart runs #then bundled context is suppressed", async () => {
		// given
		const { root, pluginData } = makeFixture();

		// when
		const output = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: DISABLED_BUNDLED_ENV,
		});

		// then
		expect(output).toBe("");
	});

	it("#given bundled static context already injected #when UserPromptSubmit runs after PostCompact #then it emits no duplicate bundled context", async () => {
		// given
		const { root, pluginData } = makeFixture();
		const firstOutput = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: BUNDLED_ONLY_ENV,
		});
		expect(firstOutput).toContain(BUNDLED_BODY);

		// when
		const compactOutput = await runPostCompactHook(postCompactInput(root), { pluginDataRoot: pluginData });
		const output = await runUserPromptSubmitHook(userPromptSubmitInput(root), {
			pluginDataRoot: pluginData,
			env: BUNDLED_ONLY_ENV,
		});

		// then
		expect(compactOutput).toBe("");
		expect(output).toBe("");
	});

	it("#given bundled rule body exceeds per-rule cap #when SessionStart runs #then bundled body lands in full without truncation", async () => {
		// given
		const root = mkdtempSync(join(tmpdir(), "codex-rules-bundled-large-project-"));
		const pluginRoot = mkdtempSync(join(tmpdir(), "codex-rules-bundled-large-plugin-"));
		const pluginData = mkdtempSync(join(tmpdir(), "codex-rules-bundled-large-data-"));
		tempDirectories.push(root, pluginRoot, pluginData);
		writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
		mkdirSync(join(pluginRoot, "bundled-rules"), { recursive: true });
		const oversizedBody = "The bundled craftsman discipline is non-negotiable. ".repeat(400);
		expect(oversizedBody.length).toBeGreaterThan(12000);
		const tailMarker = "BUNDLED_TAIL_SENTINEL_LANDS_IN_FULL";
		const bundledBody = `${oversizedBody}\n\n${tailMarker}\n`;
		writeFileSync(join(pluginRoot, "bundled-rules", "hephaestus.md"), ruleMarkdown(bundledBody));
		process.env["PLUGIN_ROOT"] = pluginRoot;

		// when
		const output = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: BUNDLED_ONLY_ENV,
		});

		// then
		expect(output).toContain(tailMarker);
		expect(output).not.toContain("[Truncated. Full:");
	});

	it("#given project rule body exceeds per-rule cap #when SessionStart runs #then project body is truncated", async () => {
		// given
		const root = mkdtempSync(join(tmpdir(), "codex-rules-project-large-project-"));
		const pluginRoot = mkdtempSync(join(tmpdir(), "codex-rules-project-large-plugin-"));
		const pluginData = mkdtempSync(join(tmpdir(), "codex-rules-project-large-data-"));
		tempDirectories.push(root, pluginRoot, pluginData);
		writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
		mkdirSync(join(root, ".omo", "rules"), { recursive: true });
		mkdirSync(join(pluginRoot, "bundled-rules"), { recursive: true });
		const oversizedBody = "The project rule body is intentionally oversized for the cap test. ".repeat(300);
		expect(oversizedBody.length).toBeGreaterThan(12000);
		const tailMarker = "PROJECT_TAIL_SENTINEL_SHOULD_NOT_LAND";
		const projectBody = `${oversizedBody}\n\n${tailMarker}\n`;
		writeFileSync(join(root, ".omo", "rules", "oversized.md"), ruleMarkdown(projectBody));
		process.env["PLUGIN_ROOT"] = pluginRoot;

		// when
		const output = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: { CODEX_RULES_ENABLED_SOURCES: ".omo/rules" },
		});

		// then
		expect(output).toContain("[Truncated. Full: .omo/rules/oversized.md]");
		expect(output).not.toContain(tailMarker);
	});
});
