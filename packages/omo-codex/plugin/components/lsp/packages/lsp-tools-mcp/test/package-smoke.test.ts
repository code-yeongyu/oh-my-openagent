import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type PackageJson = {
	readonly type: string;
	readonly packageManager: string;
	readonly name: string;
	readonly license: string;
	readonly bin: Record<string, string>;
	readonly files: readonly string[];
	readonly dependencies?: Record<string, unknown>;
};

function readPackageJson(path: string): PackageJson {
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!isPackageJson(parsed)) throw new TypeError(`Invalid package metadata: ${path}`);
	return parsed;
}

describe("package metadata", () => {
	it("#given packaged files #when validating entrypoints #then package metadata is consistent", () => {
		// given
		const packageJson = readPackageJson("package.json");
		const cliSource = readFileSync("src/cli.ts", "utf8");

		// then
		expect(packageJson.type).toBe("module");
		expect(packageJson.packageManager).toBe("npm@11.12.1");
		expect(packageJson.name).toBe("@code-yeongyu/lsp-tools-mcp");
		expect(packageJson.license).toBe("MIT");
		expect(packageJson.dependencies ?? {}).toEqual({});
		expect(packageJson.bin["lsp-tools-mcp"]).toBe("./dist/cli.js");
		expect(packageJson.files).toEqual(["dist", "LICENSE", "NOTICE", "README.md", "CHANGELOG.md"]);
		expect(cliSource.startsWith("#!/usr/bin/env node")).toBe(true);
		expect(cliSource).toContain("Usage: lsp-tools-mcp [mcp]");
	});
});

function isPackageJson(value: unknown): value is PackageJson {
	const dependencies = isRecord(value) ? value["dependencies"] : undefined;
	return (
		isRecord(value) &&
		value["type"] === "module" &&
		value["packageManager"] === "npm@11.12.1" &&
		value["name"] === "@code-yeongyu/lsp-tools-mcp" &&
		value["license"] === "MIT" &&
		isStringRecord(value["bin"]) &&
		isStringArray(value["files"]) &&
		(dependencies === undefined || isRecord(dependencies))
	);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
