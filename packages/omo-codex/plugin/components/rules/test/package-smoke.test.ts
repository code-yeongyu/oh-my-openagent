import { describe, expect, it } from "vitest";
import {
	listDirectoryEntries,
	readHooksJson,
	readPackageJson,
	readPluginJson,
	readTextFile,
	requireFiles,
} from "../../test-support/package-smoke-fixture.js";

describe("plugin package metadata", () => {
	it("#given packaged plugin files #when validating entrypoints #then hook commands use portable plugin root interpolation", () => {
		// given
		const packageJson = readPackageJson("package.json");
		const pluginJson = readPluginJson(".codex-plugin/plugin.json");
		const hooksJson = readHooksJson("hooks/hooks.json");
		const cliSource = readTextFile("src/cli.ts");
		const packageFiles = requireFiles(packageJson, "package.json");
		const bundledRules = [...listDirectoryEntries("bundled-rules")].sort();

		// when
		const hookConfig = hooksJson.hooks;
		const pluginRoot = ["$", "{PLUGIN_ROOT}"].join("");
		const commands = [
			hookConfig["SessionStart"]?.[0]?.hooks[0]?.command,
			hookConfig["UserPromptSubmit"]?.[0]?.hooks[0]?.command,
			hookConfig["PostToolUse"]?.[0]?.hooks[0]?.command,
			hookConfig["PostCompact"]?.[0]?.hooks[0]?.command,
		];
		const postToolUseMatcher = hookConfig["PostToolUse"]?.[0]?.matcher ?? "";

		// then
		expect(packageJson.type).toBe("module");
		expect(packageJson.packageManager).toBe("npm@11.12.1");
		expect(packageJson.dependencies ?? {}).toEqual({ picomatch: "^4.0.3" });
		expect(packageJson.bin["omo-rules"]).toBe("./dist/cli.js");
		expect(packageFiles).toContain("bundled-rules");
		expect(bundledRules).toContain("windows-git-bash.md");
		expect(pluginJson.hooks).toBe("./hooks/hooks.json");
		expect(cliSource.startsWith("#!/usr/bin/env node")).toBe(true);
		expect(commands).toEqual([
			`node "${pluginRoot}/dist/cli.js" hook session-start`,
			`node "${pluginRoot}/dist/cli.js" hook user-prompt-submit`,
			`node "${pluginRoot}/dist/cli.js" hook post-tool-use`,
			`node "${pluginRoot}/dist/cli.js" hook post-compact`,
		]);
		expect(postToolUseMatcher).toBe("^apply_patch$");
		const postToolUseMatcherRegex = new RegExp(postToolUseMatcher);
		expect(postToolUseMatcherRegex.test("apply_patch")).toBe(true);
		expect(
			[
				"read",
				"Read",
				"read_file",
				"mcp__filesystem__read_file",
				"mcp__filesystem__read_multiple_files",
				"mcp__filesystem__write_file",
				"mcp__filesystem__edit_file",
				"write",
				"Write",
				"edit",
				"Edit",
				"multi_edit",
				"MultiEdit",
				"multiedit",
				"exec_command",
				"shell_command",
				"bash",
				"Bash",
			].some((toolName) => postToolUseMatcherRegex.test(toolName)),
		).toBe(false);
	});
});
