import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	findPluginBundledCandidates,
	matchRule,
	parseRule,
	scanRuleFiles,
	SOURCE_PRIORITY,
} from "@oh-my-opencode/rules-engine/engine";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("rules-engine package consumption", () => {
	it("#given Codex bundled rule sources #when imported from rules-engine #then plugin-bundled ordering is preserved", () => {
		// given
		const pluginRoot = mkdtempSync(join(tmpdir(), "codex-rules-engine-consumption-"));
		tempDirectories.push(pluginRoot);
		mkdirSync(join(pluginRoot, "bundled-rules"), { recursive: true });
		writeFileSync(join(pluginRoot, "bundled-rules", "hephaestus.md"), "---\nalwaysApply: true\n---\nBundled\n");
		writeFileSync(
			join(pluginRoot, "bundled-rules", "windows-git-bash.md"),
			"---\nalwaysApply: true\n---\nWindows only\n",
		);

		// when
		const nonWindowsCandidates = findPluginBundledCandidates({ pluginRoot, platform: "darwin" });
		const windowsCandidates = findPluginBundledCandidates({ pluginRoot, platform: "win32" });

		// then
		expect(SOURCE_PRIORITY.get("plugin-bundled")).toBe(200);
		expect(nonWindowsCandidates.map((candidate) => candidate.relativePath)).toEqual([
			"bundled-rules/hephaestus.md",
		]);
		expect(windowsCandidates.map((candidate) => candidate.relativePath)).toEqual([
			"bundled-rules/hephaestus.md",
			"bundled-rules/windows-git-bash.md",
		]);
	});

	it("#given Codex rule parser and matcher edge cases #when imported from rules-engine #then current behavior is preserved", () => {
		// given
		const malformedRule = "---\nglobs: [\n---\nBody";

		// when
		const parsed = parseRule(malformedRule);
		const dotMatch = matchRule({
			frontmatter: { globs: "**/.env" },
			isSingleFile: false,
			pathBases: { projectRelative: "apps/web/.env", basename: ".env" },
		});
		const braceMatch = matchRule({
			frontmatter: { globs: "src/*.{ts,tsx}" },
			isSingleFile: false,
			pathBases: { projectRelative: "src/app.tsx", basename: "app.tsx" },
		});

		// then
		expect(parsed.diagnostic).toMatch(/^Malformed frontmatter:/);
		expect(parsed.body).toBe(malformedRule);
		expect(dotMatch).toEqual({ matched: true, reason: { kind: "glob", pattern: "**/.env" } });
		expect(braceMatch).toEqual({ matched: true, reason: { kind: "glob", pattern: "src/*.{ts,tsx}" } });
	});

	it("#given Codex scanner options #when imported from rules-engine #then scan depth and max files remain bounded", () => {
		// given
		const root = mkdtempSync(join(tmpdir(), "codex-rules-scanner-"));
		tempDirectories.push(root);
		mkdirSync(join(root, "a", "b"), { recursive: true });
		writeFileSync(join(root, "root.md"), "root");
		writeFileSync(join(root, "a", "nested.md"), "nested");
		writeFileSync(join(root, "a", "b", "too-deep.md"), "too deep");

		// when
		const depthOne = scanRuleFiles({ rootDir: root, maxDepth: 1 }).map((entry) => entry.path);
		const maxOne = scanRuleFiles({ rootDir: root, maxFiles: 1 });

		// then
		expect(depthOne).toContain(join(root, "root.md"));
		expect(depthOne).toContain(join(root, "a", "nested.md"));
		expect(depthOne).not.toContain(join(root, "a", "b", "too-deep.md"));
		expect(maxOne).toHaveLength(1);
	});
});
