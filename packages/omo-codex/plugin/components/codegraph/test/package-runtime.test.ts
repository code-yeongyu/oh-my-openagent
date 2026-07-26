import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type CodegraphPackageJson = {
	readonly files?: readonly string[];
	readonly optionalDependencies?: Readonly<Record<string, string>>;
};

const componentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(componentRoot, "../../../../..");

function readCodegraphPackageJson(): CodegraphPackageJson {
	const parsed: unknown = JSON.parse(readFileSync(resolve(componentRoot, "package.json"), "utf8"));
	if (!isCodegraphPackageJson(parsed)) throw new TypeError("Invalid CodeGraph package metadata");
	return parsed;
}

function isCodegraphPackageJson(value: unknown): value is CodegraphPackageJson {
	return isRecord(value) && maybeStringArray(value["files"]) && maybeStringRecord(value["optionalDependencies"]);
}

function maybeStringArray(value: unknown): value is readonly string[] | undefined {
	return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string"));
}

function maybeStringRecord(value: unknown): value is Readonly<Record<string, string>> | undefined {
	return value === undefined || (isRecord(value) && Object.values(value).every((item) => typeof item === "string"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("CodeGraph component runtime package metadata", () => {
	it("#given the CodeGraph component package #when validating runtime distribution metadata #then upstream CodeGraph installs optionally with shipped legal files", () => {
		// given
		const packageJson = readCodegraphPackageJson();

		// when
		const optionalDependencies = packageJson.optionalDependencies ?? {};
		const files = packageJson.files ?? [];

		// then
		expect(optionalDependencies["@colbymchenry/codegraph"]).toBe("1.4.1");
		expect(files).toContain("LICENSE");
		expect(files).toContain("NODE-RUNTIME-LICENSES.md");
		expect(files).toContain("NOTICE");
		expect(existsSync(resolve(componentRoot, "LICENSE"))).toBe(true);
		expect(existsSync(resolve(componentRoot, "NODE-RUNTIME-LICENSES.md"))).toBe(true);
		expect(existsSync(resolve(componentRoot, "NOTICE"))).toBe(true);
		expect(existsSync(resolve(componentRoot, "dist", "cli.d.ts"))).toBe(false);
		expect(existsSync(resolve(componentRoot, "dist", "serve.d.ts"))).toBe(false);
	});

	it("#given marketplace payload includes only the plugin tree #when reading CodeGraph NOTICE #then it is self-contained", () => {
		// given
		const notice = readFileSync(resolve(componentRoot, "NOTICE"), "utf8");

		expect(notice).toContain("@colbymchenry/codegraph@1.0.1");
		expect(notice).toContain("MIT license");
		expect(notice).toContain("Node.js v24.16.0 runtime");
		expect(notice).toContain("NODE-RUNTIME-LICENSES.md");
		expect(notice).not.toContain("packages/omo-codex/THIRD-PARTY-NOTICES.md");
	});

	it("#given CodeGraph platform bundles include Node #when reading runtime licenses #then Node license text ships with the component", () => {
		// given
		const licenseText = readFileSync(resolve(componentRoot, "NODE-RUNTIME-LICENSES.md"), "utf8");

		// then
		expect(licenseText).toContain("Node.js v24.16.0 LICENSE text");
		expect(licenseText).toContain("Copyright Node.js contributors");
		expect(licenseText).toContain("The externally maintained libraries used by Node.js are:");
	});

	it("#given third-party notices #when validating CodeGraph component notices #then aggregate Codex notices list CodeGraph as shipped", () => {
		// given
		const codexNotice = readFileSync(resolve(repoRoot, "packages/omo-codex/THIRD-PARTY-NOTICES.md"), "utf8");

		// when
		const listsCodegraphComponent = codexNotice.includes("@sisyphuslabs/codex-codegraph");
		const listsUpstreamRuntime = codexNotice.includes("@colbymchenry/codegraph");

		// then
		expect(listsCodegraphComponent).toBe(true);
		expect(listsUpstreamRuntime).toBe(true);
		expect(codexNotice).not.toContain("not currently an omo-codex plugin component");
	});
});
