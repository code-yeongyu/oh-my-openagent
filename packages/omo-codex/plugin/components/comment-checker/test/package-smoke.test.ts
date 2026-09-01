import { describe, expect, it } from "vitest";
import { readHooksJson, readPackageJson, readTextFile } from "../../test-support/package-smoke-fixture.js";

describe("plugin package metadata", () => {
	it("#given packaged plugin files #when validating entrypoints #then hook command uses portable plugin root interpolation", () => {
		// given
		const packageJson = readPackageJson("package.json");
		const hooksJson = readHooksJson("hooks/hooks.json");
		const cliSource = readTextFile("src/cli.ts");

		// when
		const command = hooksJson.hooks["PostToolUse"]?.[0]?.hooks[0]?.command;
		const pluginRoot = ["$", "{PLUGIN_ROOT}"].join("");

		// then
		expect(packageJson.type).toBe("module");
		expect(packageJson.packageManager).toBe("npm@11.12.1");
		expect(packageJson.dependencies ?? {}).not.toHaveProperty("@code-yeongyu/comment-checker");
		expect(packageJson.optionalDependencies).toHaveProperty("@code-yeongyu/comment-checker");
		expect(packageJson.bin["omo-comment-checker"]).toBe("./dist/cli.js");
		expect(cliSource.startsWith("#!/usr/bin/env node")).toBe(true);
		expect(command).toBe(`node "${pluginRoot}/dist/cli.js" hook post-tool-use`);
	});
});
