import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { ComputerHandle } from "../src/activation";
import { ComputerParams } from "../src/params";
import { resolveComputerSettings } from "../src/settings";
import { createComputerTool } from "../src/tool";
import { closedService } from "./fixtures";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function tool() {
	const handle = new ComputerHandle({ service: closedService(), settings: () => resolveComputerSettings({}) });
	return createComputerTool({ handle, executeTool: () => Promise.reject(new Error("no tools")) });
}

describe("computer ToolDefinition", () => {
	it("is search-exposed under the computer name", () => {
		// Given
		const definition = tool();

		// When
		const { name, exposure, searchGroup } = definition;

		// Then
		expect({ name, exposure, searchGroup }).toEqual({ name: "computer", exposure: "search", searchGroup: "desktop" });
	});

	it("indexes the cua keyword for tool_search", () => {
		// Given
		const definition = tool();

		// When
		const keywords = definition.searchKeywords;

		// Then
		expect(keywords).toContain("cua");
	});

	it("contributes exactly the computer global to the eval kernels", () => {
		// Given
		const definition = tool();

		// When
		const exports = definition.kernelPrelude.exports;

		// Then
		expect(exports).toEqual(["computer"]);
	});

	it.each([
		{ action: "call", chain: [{ method: "screenshot" }] },
		{ action: "run", code: "return 1", read_only: true, timeout: 5 },
		{ action: "capabilities" },
		{ action: "close" },
	])("accepts the model-facing action %j", (params) => {
		// Given: a parameter object the prelude facade emits.
		// When
		const accepted = Check(ComputerParams, params);

		// Then
		expect(accepted).toBe(true);
	});

	it.each([
		{ action: "resume" },
		{ action: "stop" },
		{ action: "capabilities", token: "stolen" },
		{ action: "run", code: "return 1", timeout: 0 },
	])("rejects %j at the schema, so resume stays a user-only command", (params) => {
		// Given: parameters no model-facing action declares.
		// When
		const accepted = Check(ComputerParams, params);

		// Then
		expect(accepted).toBe(false);
	});
});

describe("computer tool permission boundary", () => {
	const sources = readdirSync(srcDir)
		.filter((file) => file.endsWith(".ts"))
		.map((file) => ({ file, text: readFileSync(join(srcDir, file), "utf8") }));
	const imports = sources.flatMap(({ file, text }) =>
		[...text.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => ({ file, specifier: match[1] })),
	);

	it("imports no permission-system module and not the coding-agent package", () => {
		// Given: every value and type import of the package's sources.
		// When
		const violations = imports.filter(
			({ specifier }) =>
				specifier === undefined ||
				/permission-system|coding-agent/.test(specifier) ||
				specifier === "@code-yeongyu/senpi",
		);

		// Then
		expect(violations).toEqual([]);
	});

	it("never calls evaluate or showPermissionPrompt", () => {
		// Given
		const calls = sources.filter(({ text }) => /\b(?:evaluate|showPermissionPrompt)\s*\(/.test(text));

		// When
		const offenders = calls.map(({ file }) => file);

		// Then
		expect(offenders).toEqual([]);
	});
});
