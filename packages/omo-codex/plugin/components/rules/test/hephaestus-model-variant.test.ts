import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { type CodexSessionStartInput, runSessionStartHook } from "../src/codex-hook.js";
import { findPluginBundledCandidates } from "@oh-my-opencode/rules-engine/engine";

const GPT_55_VARIANT_PATH = "bundled-rules/hephaestus/gpt-5.5.md";
const GPT_56_VARIANT_PATH = "bundled-rules/hephaestus/gpt-5.6.md";
const BUNDLED_ONLY_ENV = {
	CODEX_RULES_ENABLED_SOURCES: "plugin-bundled",
};
const tempDirectories: string[] = [];
let originalPluginRoot: string | undefined;

afterEach(() => {
	restoreEnv("PLUGIN_ROOT", originalPluginRoot);
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function makeProject(): { readonly root: string; readonly pluginData: string } {
	originalPluginRoot = process.env["PLUGIN_ROOT"];
	process.env["PLUGIN_ROOT"] = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "codex-rules-hephaestus-variant-project-"));
	const pluginData = mkdtempSync(join(tmpdir(), "codex-rules-hephaestus-variant-data-"));
	tempDirectories.push(root, pluginData);
	writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
	return { root, pluginData };
}

function sessionStartInput(root: string, model: string): CodexSessionStartInput {
	return {
		session_id: "session-1",
		transcript_path: null,
		cwd: root,
		hook_event_name: "SessionStart",
		model,
		permission_mode: "default",
		source: "startup",
	};
}

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}

describe("Hephaestus bundled rule model variants", () => {
	it("#given packaged bundled rules #when discovering with a gpt-5.5 model #then only the gpt-5.5 variant is included", () => {
		const candidates = findPluginBundledCandidates({ pluginRoot: process.cwd(), model: "gpt-5.5" });
		const paths = candidates.map((candidate) => candidate.relativePath);

		expect(paths).toContain(GPT_55_VARIANT_PATH);
		expect(paths).not.toContain(GPT_56_VARIANT_PATH);
	});

	it("#given packaged bundled rules #when discovering with a gpt-5.6 family model #then only the gpt-5.6 variant is included", () => {
		const candidates = findPluginBundledCandidates({ pluginRoot: process.cwd(), model: "gpt-5.6-codex" });
		const paths = candidates.map((candidate) => candidate.relativePath);

		expect(paths).toContain(GPT_56_VARIANT_PATH);
		expect(paths).not.toContain(GPT_55_VARIANT_PATH);
	});

	it("#given packaged bundled rules #when discovering without a model #then the gpt-5.5 variant is the fallback", () => {
		const candidates = findPluginBundledCandidates({ pluginRoot: process.cwd() });
		const paths = candidates.map((candidate) => candidate.relativePath);

		expect(paths).toContain(GPT_55_VARIANT_PATH);
		expect(paths).not.toContain(GPT_56_VARIANT_PATH);
	});

	it("#given a gpt-5.5 session #when SessionStart runs #then the gpt-5.5 identity is injected in full", async () => {
		const { root, pluginData } = makeProject();

		const output = await runSessionStartHook(sessionStartInput(root, "gpt-5.5"), {
			pluginDataRoot: pluginData,
			env: BUNDLED_ONLY_ENV,
		});

		expect(output).toContain(`Instructions from: ${join(process.cwd(), GPT_55_VARIANT_PATH)}`);
		expect(output).toContain("based on GPT-5.5");
		expect(output).not.toContain("based on GPT-5.6");
		expect(output).not.toContain("[Truncated. Full:");
	});

	it("#given a gpt-5.6 session #when SessionStart runs #then the gpt-5.6 identity is injected in full", async () => {
		const { root, pluginData } = makeProject();

		const output = await runSessionStartHook(sessionStartInput(root, "gpt-5.6-codex"), {
			pluginDataRoot: pluginData,
			env: BUNDLED_ONLY_ENV,
		});

		expect(output).toContain(`Instructions from: ${join(process.cwd(), GPT_56_VARIANT_PATH)}`);
		expect(output).toContain("based on GPT-5.6");
		expect(output).not.toContain("based on GPT-5.5");
		expect(output).not.toContain("[Truncated. Full:");
	});
});
