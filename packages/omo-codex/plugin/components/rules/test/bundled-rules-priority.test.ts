import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { configFromEnvironment } from "../src/config.js";
import { SOURCE_PRIORITY } from "../src/rules/constants.js";
import { createEngine, defaultConfig, type EngineDeps } from "../src/rules/engine.js";
import { resolvePluginRulesRoot } from "../src/rules/plugin-root.js";
import type { RuleCandidate } from "../src/rules/types.js";

const projectRoot = "/tmp/codex-rules-bundled-priority";
const bundledPath = join(projectRoot, "bundled-rules", "hephaestus.md");
const homePath = join(projectRoot, "home", ".opencode", "rules", "hephaestus.md");
const bundledBody = "Bundled baseline discipline.";
const homeBody = "Home baseline discipline override.";
const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function globalCandidate(source: "plugin-bundled" | "~/.opencode/rules", path: string): RuleCandidate {
	return {
		path,
		realPath: path,
		source,
		distance: 9999,
		isGlobal: true,
		isSingleFile: false,
		relativePath: source === "plugin-bundled" ? "bundled-rules/hephaestus.md" : ".opencode/rules/hephaestus.md",
	};
}

function ruleMarkdown(body: string): string {
	return [
		"---",
		"description: OMO Hephaestus baseline discipline for Codex",
		"alwaysApply: true",
		"---",
		"",
		body,
	].join("\n");
}

describe("plugin bundled rule priority", () => {
	it("#given bundled source explicitly enabled then disabled #when parsing env #then no sources remain enabled", () => {
		// given / when
		const config = configFromEnvironment({
			CODEX_RULES_ENABLED_SOURCES: "plugin-bundled",
			CODEX_RULES_DISABLE_BUNDLED: "1",
		});

		// then
		expect(config.enabledSources).toEqual([]);
	});

	it("#given source priorities #when comparing user-home and bundled rules #then bundled has lower priority", () => {
		// given / when / then
		expect(SOURCE_PRIORITY.get("~/.opencode/rules")).toBe(101);
		expect(SOURCE_PRIORITY.get("plugin-bundled")).toBe(200);
	});

	it("#given user-home and bundled rules share a description #when formatting static rules #then user-home file wins", () => {
		// given
		const bundledCandidate = globalCandidate("plugin-bundled", bundledPath);
		const homeCandidate = globalCandidate("~/.opencode/rules", homePath);
		const deps = {
			findProjectRoot: () => projectRoot,
			findCandidates: () => [bundledCandidate, homeCandidate],
			readFile: (path: string) => {
				if (path === bundledPath) return ruleMarkdown(bundledBody);
				if (path === homePath) return ruleMarkdown(homeBody);
				return null;
			},
		} satisfies EngineDeps;
		const engine = createEngine(defaultConfig(), deps);

		// when
		const loaded = engine.loadStaticRules(projectRoot);
		const formatted = engine.formatStatic(loaded.rules);

		// then
		expect(formatted).toContain(homePath);
		expect(formatted).toContain(homeBody);
		expect(formatted).not.toContain(`- [hephaestus.md]{${homePath}}`);
		expect(formatted).not.toContain(bundledPath);
		expect(formatted).not.toContain(bundledBody);
	});

	it("#given aggregate plugin root #when resolving rules root #then components rules directory is selected", () => {
		// given
		const aggregateRoot = mkdtempSync(join(tmpdir(), "codex-rules-aggregate-plugin-"));
		const componentRoot = join(aggregateRoot, "components", "rules");
		tempDirectories.push(aggregateRoot);
		mkdirSync(join(aggregateRoot, ".codex-plugin"), { recursive: true });
		mkdirSync(componentRoot, { recursive: true });
		writeFileSync(join(aggregateRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "omo" }));

		// when
		const resolvedRoot = resolvePluginRulesRoot(aggregateRoot);

		// then
		expect(resolvedRoot).toBe(componentRoot);
	});
});
