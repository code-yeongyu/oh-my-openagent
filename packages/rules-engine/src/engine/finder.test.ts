import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import { findPluginBundledCandidates } from "./finder";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function makePluginRoot(): string {
	const pluginRoot = mkdtempSync(join(tmpdir(), "rules-engine-finder-"));
	tempDirectories.push(pluginRoot);
	const hephaestusDir = join(pluginRoot, "bundled-rules", "hephaestus");
	mkdirSync(hephaestusDir, { recursive: true });
	writeFileSync(join(hephaestusDir, "gpt-5.5.md"), "---\nalwaysApply: true\n---\nGPT-5.5 variant\n");
	writeFileSync(join(hephaestusDir, "gpt-5.6.md"), "---\nalwaysApply: true\n---\nGPT-5.6 variant\n");
	writeFileSync(join(pluginRoot, "bundled-rules", "other.md"), "---\nalwaysApply: true\n---\nOther\n");
	return pluginRoot;
}

function relativePaths(pluginRoot: string, model?: string): string[] {
	return findPluginBundledCandidates({
		pluginRoot,
		platform: "darwin",
		...(model === undefined ? {} : { model }),
	}).map((candidate) => candidate.relativePath);
}

describe("engine findPluginBundledCandidates hephaestus model variants", () => {
	describe("#given hephaestus variant files for gpt-5.5 and gpt-5.6", () => {
		it("#when no model is provided #then only the gpt-5.5 default variant is selected", () => {
			const pluginRoot = makePluginRoot();

			const paths = relativePaths(pluginRoot);

			expect(paths).toContain("bundled-rules/hephaestus/gpt-5.5.md");
			expect(paths).not.toContain("bundled-rules/hephaestus/gpt-5.6.md");
		});

		it("#when the model is a gpt-5.5 slug #then only the gpt-5.5 variant is selected", () => {
			const pluginRoot = makePluginRoot();

			const paths = relativePaths(pluginRoot, "gpt-5.5-codex");

			expect(paths).toContain("bundled-rules/hephaestus/gpt-5.5.md");
			expect(paths).not.toContain("bundled-rules/hephaestus/gpt-5.6.md");
		});

		it("#when the model is a gpt-5.6 family slug #then only the gpt-5.6 variant is selected", () => {
			const pluginRoot = makePluginRoot();

			for (const model of ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-codex", "GPT-5.6-TERRA"]) {
				const paths = relativePaths(pluginRoot, model);

				expect(paths).toContain("bundled-rules/hephaestus/gpt-5.6.md");
				expect(paths).not.toContain("bundled-rules/hephaestus/gpt-5.5.md");
			}
		});

		it("#when the model is an older slug #then the gpt-5.5 variant is the fallback", () => {
			const pluginRoot = makePluginRoot();

			const paths = relativePaths(pluginRoot, "gpt-5.3-codex");

			expect(paths).toContain("bundled-rules/hephaestus/gpt-5.5.md");
			expect(paths).not.toContain("bundled-rules/hephaestus/gpt-5.6.md");
		});

		it("#when variants are gated #then other bundled rules stay unaffected", () => {
			const pluginRoot = makePluginRoot();

			expect(relativePaths(pluginRoot, "gpt-5.6")).toContain("bundled-rules/other.md");
			expect(relativePaths(pluginRoot)).toContain("bundled-rules/other.md");
		});
	});
});
