import { describe, expect, it } from "vitest";
import {
	collectHookCommandsFromValue,
	readJsonFile,
	readPackageJson,
	readTextFile,
	requireFiles,
	requireScripts,
} from "../../test-support/package-smoke-fixture.js";

describe("codex ultrawork package metadata", () => {
	it("#given package metadata #when inspected #then hook ships as bundled CLI", () => {
		// given
		const packageJson = readPackageJson("package.json");
		const hooksJson = readJsonFile("hooks/hooks.json");
		const cliSource = readTextFile("src/cli.ts");

		// when
		const packageFiles = requireFiles(packageJson, "package.json");
		const scripts = requireScripts(packageJson, "package.json");
		const hookCommands = collectHookCommandsFromValue(hooksJson);
		const pluginRoot = ["$", "{PLUGIN_ROOT}"].join("");

		// then
		expect(packageJson.type).toBe("module");
		expect(packageJson.packageManager).toBe("npm@11.12.1");
		expect(packageJson.bin["omo-ultrawork"]).toBe("./dist/cli.js");
		expect(scripts["build"]).toBe(
			"node scripts/sync-directive.mjs && node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\" && bun build src/cli.ts --target node --format esm --outfile dist/cli.js",
		);
		expect(scripts["test"]).toBe("vitest --run");
		expect(packageFiles).toContain("dist");
		expect(packageFiles).toContain("directive.md");
		expect(packageFiles).not.toContain("hooks/ultrawork-detector.py");
		expect(cliSource.startsWith("#!/usr/bin/env node")).toBe(true);
		expect(hookCommands).toContain(`node "${pluginRoot}/dist/cli.js" hook user-prompt-submit`);
		expect(hookCommands).not.toContainEqual(expect.stringMatching(/\bpython3?\b|ultrawork-detector\.py/));
	});

	it("#given explorer guidance #when inspected #then names the packaged code-search surfaces", () => {
		// given
		const explorer = readTextFile("agents/explorer.toml");

		// when
		const guidance = explorer.toLowerCase();

		// then
		expect(guidance).toContain("ast-grep");
		expect(guidance).toContain("structural");
	});

	it("#given explorer guidance #when inspected #then starts codebase inspection with native search", () => {
		// given
		const explorer = readTextFile("agents/explorer.toml");
		const directive = readTextFile("directive.md");

		// when
		const guidance = explorer.toLowerCase();
		const repoInspectionIndex = guidance.indexOf("repo-wide inspection");
		const lspIndex = guidance.indexOf("lsp_goto_definition");
		const structuralIndex = guidance.indexOf("ast-grep");

		// then
		expect(repoInspectionIndex).toBeGreaterThanOrEqual(0);
		expect(lspIndex).toBeGreaterThan(repoInspectionIndex);
		expect(structuralIndex).toBeGreaterThan(repoInspectionIndex);
		expect(explorer).toContain("`rg`, `rg --files`, `cat`, and `git`");
		expect(directive).toContain("`rg`, `rg --files`,");
	});

	it("#given librarian guidance #when inspected #then names the packaged research MCP surfaces", () => {
		// given
		const librarian = readTextFile("agents/librarian.toml");

		// when
		const guidance = librarian.toLowerCase();

		// then
		expect(guidance).toContain("grep_app");
		expect(guidance).toContain("context7");
		expect(guidance).toContain("ast-grep");
	});

	it("#given ulw-plan skill #when inspected #then requires dynamic adversarial workflow phases", () => {
		// given
		const skill = readTextFile("skills/ulw-plan/SKILL.md");
		const workflow = readTextFile("skills/ulw-plan/references/full-workflow.md");
		const skillContracts = ["CodeGraph first", "scripts/scaffold-plan.mjs", "Approval gate"] as const;
		const workflowContracts = [
			"dynamic adversarial workflow phases",
			"stale_state",
			"source-vs-packaged split",
			"misleading_success_output",
			"confirm a test really ran",
			"prompt_injection",
			"Discord / external content as claims",
		] as const;

		// then
		for (const contract of skillContracts) {
			expect(skill, `skill should include ${contract}`).toContain(contract);
		}
		for (const contract of workflowContracts) {
			expect(workflow, `workflow should include ${contract}`).toContain(contract);
		}
	});
});
