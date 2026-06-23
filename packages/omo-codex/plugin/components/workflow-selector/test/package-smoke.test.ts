import { describe, expect, it } from "vitest";
import {
	collectHookCommandsFromValue,
	readJsonFile,
	readPackageJson,
	requireFiles,
	requireScripts,
} from "../../test-support/package-smoke-fixture.js";

describe("codex workflow selector package metadata", () => {
	it("#given package metadata #when inspected #then hook ships as bundled CLI", () => {
		// given
		const packageJson = readPackageJson("package.json");
		const hooksJson = readJsonFile("hooks/hooks.json");

		// when
		const packageFiles = requireFiles(packageJson, "package.json");
		const scripts = requireScripts(packageJson, "package.json");
		const hookCommands = collectHookCommandsFromValue(hooksJson);
		const pluginRoot = ["$", "{PLUGIN_ROOT}"].join("");

		// then
		expect(packageJson.type).toBe("module");
		expect(packageJson.packageManager).toBe("npm@11.12.1");
		expect(packageJson.bin["omo-workflow-selector"]).toBe("./dist/cli.js");
		expect(scripts["build"]).toBe(
			"node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\" && bun build src/cli.ts --target node --format esm --outfile dist/cli.js",
		);
		expect(scripts["test"]).toBe("vitest --run");
		expect(packageFiles).toContain("dist");
		expect(packageFiles).toContain("hooks");
		expect(hookCommands).toContain(
			`node "${pluginRoot}/dist/cli.js" hook user-prompt-submit`,
		);
	});
});
