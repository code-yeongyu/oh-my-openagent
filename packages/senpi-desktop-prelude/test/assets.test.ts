import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ASSETS_JSON_PATH, renderAssetsJson } from "../scripts/generate-assets";
import { computerPreludeAssets } from "../src/index";
import { loadJsFacade, runPythonFacade, windowResponder } from "./harness";
import { javascriptHelperNames } from "./helper-names";

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("computer prelude assets", () => {
	it("keeps the committed assets JSON in sync with the asset files", () => {
		// When
		const rendered = renderAssetsJson();

		// Then
		expect(readFileSync(ASSETS_JSON_PATH, "utf8")).toBe(rendered);
	});

	it("defines every declared export in the JavaScript kernel", async () => {
		// Given
		const kernel = loadJsFacade(windowResponder);

		// When
		const defined = await kernel.run("return typeof computer;");

		// Then
		expect({ exports: computerPreludeAssets.exports, defined }).toEqual({ exports: ["computer"], defined: "object" });
	});

	it("defines every declared export in the Python kernel", () => {
		// When
		const run = runPythonFacade(
			`out = [name for name in ${JSON.stringify(computerPreludeAssets.exports)} if name in globals()]`,
		);

		// Then
		expect(run.out).toEqual(computerPreludeAssets.exports);
	});

	it("documents every facade helper as a call in the model-facing docs", async () => {
		// Given
		const helpers = [...new Set(await javascriptHelperNames())];

		// When
		const undocumented = helpers.filter(
			(name) => !new RegExp(`\\b${escapeRegExp(name)}\\(`).test(computerPreludeAssets.documentation),
		);

		// Then
		expect(undocumented).toEqual([]);
	});

	it("keeps the documentation free of code fences, since the eval prompt renders it inside one", () => {
		expect(computerPreludeAssets.documentation.includes("```")).toBe(false);
	});
});
