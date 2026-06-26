import { describe, expect, it } from "vitest";
import {
	collectHookCommandsFromValue,
	readJsonFile,
	readPackageJson,
	readTextFile,
	requireFiles,
	requireScripts,
} from "../../test-support/package-smoke-fixture.js";

function normalizeGuidance(value: string): string {
	return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function expectSparkshellToolStrategyContract(value: string): void {
	const guidance = normalizeGuidance(value);

	expect(value).toContain("`omo sparkshell <command> [args...]`");
	expect(guidance).toMatch(/`omo sparkshell <command> \[args\.\.\.\]`[^.]*\bfirst\b/);
	expect(guidance).toMatch(/\brepo-wide inspection\b/);
	expect(guidance).toMatch(/\bcli smoke tests\b/);
	expect(guidance).toMatch(/\bgit\/history\b/);
	expect(guidance).toMatch(/\bbounded command output\b/);
	expect(guidance).toMatch(/\braw\b[^.]*`rg`\/`grep`\/`cat`\/`git`[^.]*\bfallbacks?\b/);
	expect(guidance).toMatch(/\bsparkshell is unavailable\b/);
	expect(guidance).toMatch(/\btoo narrow\b/);
	expect(value).toContain("`omo sparkshell rg --files`");
	expect(guidance).toMatch(/\bseparate argv tokens\b/);
	expect(value).toContain("not `omo sparkshell 'rg --files'`");
	expect(guidance).toMatch(/\bone executable name\b/);
	expect(guidance).toMatch(/--shell[^.]*\bmetacharacters\b[^.]*\bpipelines\b/);
	expect(guidance).toMatch(/--tmux-pane[^.]*\bonly\b[^.]*\binspect(?:ing)?\b[^.]*\bexisting (?:tmux )?pane\b/);
	expect(guidance).toMatch(/--tmux-pane[^.]*\bnever\b[^.]*\blaunch(?:ing)? ordinary commands\b/);
	expect(guidance).not.toMatch(/\bprefer\b[^.]*\bbefore raw shell commands\b/);
}

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

	it("#given explorer guidance #when inspected #then starts codebase inspection with Sparkshell", () => {
		// given
		const explorer = readTextFile("agents/explorer.toml");
		const directive = readTextFile("directive.md");

		// when
		const guidance = explorer.toLowerCase();
		const sparkshellIndex = guidance.indexOf("omo sparkshell <command>");
		const lspIndex = guidance.indexOf("lsp_goto_definition");
		const structuralIndex = guidance.indexOf("ast-grep");

		// then
		expect(sparkshellIndex).toBeGreaterThanOrEqual(0);
		expect(lspIndex).toBeGreaterThan(sparkshellIndex);
		expect(structuralIndex).toBeGreaterThan(sparkshellIndex);
		expectSparkshellToolStrategyContract(explorer);
		expectSparkshellToolStrategyContract(directive);
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
