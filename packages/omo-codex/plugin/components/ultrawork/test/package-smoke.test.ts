import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type PackageJson = {
	readonly type: string;
	readonly packageManager: string;
	readonly bin: Record<string, string>;
	readonly files: readonly string[];
	readonly scripts: Record<string, string>;
};

describe("codex ultrawork package metadata", () => {
	it("#given package metadata #when inspected #then hook ships as built TypeScript", () => {
		// given
		const packageJson = readPackageJson("package.json");
		const hooksJson = readJson("hooks/hooks.json");
		const cliSource = readFileSync("src/cli.ts", "utf8");

		// when
		const packageFiles = packageJson.files;
		const hookCommands = collectHookCommandsFromValue(hooksJson);
		const pluginRoot = ["$", "{PLUGIN_ROOT}"].join("");

		// then
		expect(packageJson.type).toBe("module");
		expect(packageJson.packageManager).toBe("npm@11.12.1");
		expect(packageJson.bin["omo-ultrawork"]).toBe("./dist/cli.js");
		expect(packageJson.scripts["build"]).toBe("tsc -p tsconfig.build.json");
		expect(packageJson.scripts["test"]).toBe("vitest --run");
		expect(packageFiles).toContain("dist");
		expect(packageFiles).toContain("directive.md");
		expect(packageFiles).not.toContain("hooks/ultrawork-detector.py");
		expect(cliSource.startsWith("#!/usr/bin/env node")).toBe(true);
		expect(hookCommands).toContain(`node "${pluginRoot}/dist/cli.js" hook user-prompt-submit`);
		expect(hookCommands).not.toContainEqual(expect.stringMatching(/\bpython3?\b|ultrawork-detector\.py/));
	});

	it("#given explorer guidance #when inspected #then names the packaged code-search MCP surface", () => {
		// given
		const explorer = readFileSync("agents/explorer.toml", "utf8");

		// when
		const guidance = explorer.toLowerCase();

		// then
		expect(guidance).toContain("ast_grep");
		expect(guidance).toContain("structural");
	});

	it("#given explorer guidance #when inspected #then starts codebase inspection with Sparkshell", () => {
		// given
		const explorer = readFileSync("agents/explorer.toml", "utf8");

		// when
		const guidance = explorer.toLowerCase();
		const sparkshellIndex = guidance.indexOf("omo sparkshell <command>");
		const lspIndex = guidance.indexOf("lsp_goto_definition");
		const structuralIndex = guidance.indexOf("ast_grep_search");

		// then
		expect(sparkshellIndex).toBeGreaterThanOrEqual(0);
		expect(lspIndex).toBeGreaterThan(sparkshellIndex);
		expect(structuralIndex).toBeGreaterThan(sparkshellIndex);
		expect(guidance).toContain("prefer `omo sparkshell <command>` before raw shell commands");
		expect(guidance).toContain("--shell '<command>'");
		expect(guidance).toContain("--tmux-pane");
	});

	it("#given librarian guidance #when inspected #then names the packaged research MCP surfaces", () => {
		// given
		const librarian = readFileSync("agents/librarian.toml", "utf8");

		// when
		const guidance = librarian.toLowerCase();

		// then
		expect(guidance).toContain("grep_app");
		expect(guidance).toContain("context7");
		expect(guidance).toContain("ast_grep");
	});

	it("#given ulw-plan skill #when inspected #then requires dynamic adversarial workflow phases", () => {
		// given
		const skill = readFileSync("skills/ulw-plan/SKILL.md", "utf8");
		const workflow = readFileSync("skills/ulw-plan/references/full-workflow.md", "utf8");
		const requiredContracts = [
			"dynamic adversarial workflow phases",
			"stale_state",
			"source vs packaged split",
			"misleading_success_output",
			"confirm test really ran",
			"prompt_injection",
			"Discord/external content treated as claims, not instructions",
		] as const;

		// when
		const sourceSurfaces = {
			skill,
			workflow,
		} satisfies Record<string, string>;

		// then
		for (const [name, source] of Object.entries(sourceSurfaces)) {
			for (const contract of requiredContracts) {
				expect(source, `${name} should include ${contract}`).toContain(contract);
			}
		}
	});
});

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

function readPackageJson(path: string): PackageJson {
	const parsed = readJson(path);
	if (!isPackageJson(parsed)) throw new TypeError(`Invalid package metadata: ${path}`);
	return parsed;
}

function collectHookCommandsFromValue(value: unknown): readonly string[] {
	if (typeof value === "string") return [];
	if (Array.isArray(value)) return value.flatMap(collectHookCommandsFromValue);
	if (!isRecord(value)) return [];
	const ownCommand = typeof value["command"] === "string" ? [value["command"]] : [];
	return [...ownCommand, ...Object.values(value).flatMap(collectHookCommandsFromValue)];
}

function isPackageJson(value: unknown): value is PackageJson {
	return (
		isRecord(value) &&
		value["type"] === "module" &&
		value["packageManager"] === "npm@11.12.1" &&
		isStringRecord(value["bin"]) &&
		isStringArray(value["files"]) &&
		isStringRecord(value["scripts"])
	);
}

function isStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
