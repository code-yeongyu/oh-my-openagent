import { describe, expect, it } from "vitest";
import {
	collectHookCommandsFromValue,
	readJsonFile,
	readPackageJson,
	readTextFile,
	requireFiles,
} from "../../test-support/package-smoke-fixture.js";

describe("codex ultrawork package metadata", () => {
	it("#given package metadata #when inspected #then hook ships as bundled CLI", () => {
		// given
		const packageJson = readPackageJson("package.json");
		const hooksJson = readJsonFile("hooks/hooks.json");
		const cliSource = readTextFile("src/cli.ts");

		// when
		const packageFiles = requireFiles(packageJson, "package.json");
		const hookCommands = collectHookCommandsFromValue(hooksJson);
		const pluginRoot = ["$", "{PLUGIN_ROOT}"].join("");

		// then
		expect(packageJson.type).toBe("module");
		expect(packageJson.bin["omo-ultrawork"]).toBe("./dist/cli.js");
		expect(packageFiles).toContain("dist");
		expect(packageFiles).toContain("skills");
		// The directive is no longer a published file: it ships compiled into dist/cli.js via the
		// generated src/directive-content.ts, so assert the bundled contract instead of files-list
		// membership.
		expect(packageFiles).not.toContain("directive.md");
		expect(packageFiles).not.toContain("hooks/ultrawork-detector.py");
		expect(cliSource.startsWith("#!/usr/bin/env node")).toBe(true);
		expect(hookCommands).toContain(`node "${pluginRoot}/dist/cli.js" hook user-prompt-submit`);
		expect(hookCommands).not.toContainEqual(expect.stringMatching(/\bpython3?\b|ultrawork-detector\.py/));
	});
});
