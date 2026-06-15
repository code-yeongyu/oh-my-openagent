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
	it("#given package metadata #when inspected #then hook ships as bundled CLI", () => {
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
		expect(packageJson.scripts["build"]).toBe(
			"node scripts/sync-directive.mjs && node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\" && bun build src/cli.ts --target node --format esm --outfile dist/cli.js",
		);
		expect(packageJson.scripts["test"]).toBe("vitest --run");
		expect(packageFiles).toContain("dist");
		expect(packageFiles).toContain("directive.md");
		expect(packageFiles).not.toContain("hooks/ultrawork-detector.py");
		expect(cliSource.startsWith("#!/usr/bin/env node")).toBe(true);
		expect(hookCommands).toContain(`node "${pluginRoot}/dist/cli.js" hook user-prompt-submit`);
		expect(hookCommands).not.toContainEqual(expect.stringMatching(/\bpython3?\b|ultrawork-detector\.py/));
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
