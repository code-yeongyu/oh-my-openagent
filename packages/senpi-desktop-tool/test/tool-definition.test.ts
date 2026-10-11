import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computerPreludeAssets } from "@oh-my-opencode/senpi-desktop-prelude";
import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { ComputerHandle } from "../src/activation";
import { ComputerArgumentsError } from "../src/action-schema";
import { ComputerParams } from "../src/params";
import { resolveComputerSettings } from "../src/settings";
import { computerToolDefinition } from "../src/tool-definition";
import { createComputerTool, parseComputerParams } from "../src/tool";
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

	it("keeps the registration shell's search surface and prompt guidelines on dev's bytes (#9113)", () => {
		// Given: the prelude texts now load from the staged JSON; the published surface must not move.
		const bullets = computerPreludeAssets.safety
			.split("\n")
			.filter((line) => line.startsWith("- "))
			.map((line) => line.slice(2));

		// When / Then
		expect(computerToolDefinition.promptGuidelines).toEqual(bullets);
		expect(computerToolDefinition.searchText).toBe(
			"Operate the real desktop (experimental): screenshots, clicks, typing, key chords, window list, accessibility tree, clipboard; macOS/Linux/Windows",
		);
		expect(computerToolDefinition.kernelPrelude).toBe(computerPreludeAssets);
	});

	it("contributes exactly the computer global to the eval kernels", () => {
		// Given
		const definition = tool();

		// When
		const exports = definition.kernelPrelude.exports;

		// Then
		expect(exports).toEqual(["computer"]);
	});

	it("publishes one root object schema with the action enum, which every provider accepts", () => {
		// Given
		const definition = tool();

		// When
		const schema = JSON.parse(JSON.stringify(definition.parameters));

		// Then
		expect({ type: schema.type, anyOf: schema.anyOf, oneOf: schema.oneOf, action: schema.properties.action }).toEqual({
			type: "object",
			anyOf: undefined,
			oneOf: undefined,
			action: expect.objectContaining({ type: "string", enum: ["call", "run", "capabilities", "close"] }),
		});
	});

	it.each([
		{ action: "call", chain: [{ method: "screenshot" }] },
		{ action: "run", code: "return 1", read_only: true, timeout: 5 },
		{ action: "capabilities" },
		{ action: "close" },
	])("accepts the model-facing action %j", (params) => {
		// Given: a parameter object the prelude facade emits.
		// When
		const parsed = parseComputerParams(params);

		// Then
		expect({ published: Check(ComputerParams, params), parsed }).toEqual({ published: true, parsed: params });
	});

	it.each([
		{ params: { action: "resume" }, reason: 'computer: unknown action "resume"; expected one of call, run, capabilities, close' },
		{ params: { action: "capabilities", token: "stolen" }, reason: 'computer: action "capabilities" does not take token' },
		{ params: { action: "run", code: "return 1", timeout: 0 }, reason: 'computer: action "run" at /timeout: must be >= 1' },
		{ params: { action: "call" }, reason: 'computer: action "call": must have required properties chain' },
		{ params: { action: "close", code: "x" }, reason: 'computer: action "close" does not take code' },
	])("rejects $params with a typed COMPUTER_INVALID_ARGUMENTS error, so resume stays user-only", ({ params, reason }) => {
		// Given: arguments no single action accepts.
		// When
		const error = (() => {
			try {
				parseComputerParams(params);
				return undefined;
			} catch (caught) {
				return caught;
			}
		})();

		// Then
		expect(error instanceof ComputerArgumentsError ? { code: error.code, reason: error.reason } : error).toEqual({
			code: "COMPUTER_INVALID_ARGUMENTS",
			reason,
		});
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
