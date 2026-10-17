import { describe, expect, test } from "bun:test";

import {
	clientOptions,
	optionalBoolean,
	optionalNumber,
	optionalString,
	requireNumber,
	requireString,
	severityFilter,
} from "./parameters.js";

describe("LSP tool parameter helpers", () => {
	test("#given required string parameter #when value is missing or empty #then throws clear error", () => {
		expect(requireString({ filePath: "index.ts" }, "filePath")).toBe("index.ts");
		expect(() => requireString({}, "filePath")).toThrow("Missing required string parameter 'filePath'");
		expect(() => requireString({ filePath: "" }, "filePath")).toThrow("Missing required string parameter 'filePath'");
		expect(() => requireString({ filePath: 42 }, "filePath")).toThrow("Missing required string parameter 'filePath'");
	});

	test("#given required number parameter #when value is non-finite #then throws clear error", () => {
		expect(requireNumber({ line: 3 }, "line")).toBe(3);
		expect(() => requireNumber({}, "line")).toThrow("Missing required number parameter 'line'");
		expect(() => requireNumber({ line: Number.NaN }, "line")).toThrow("Missing required number parameter 'line'");
		expect(() => requireNumber({ line: Number.POSITIVE_INFINITY }, "line")).toThrow(
			"Missing required number parameter 'line'",
		);
	});

	test("#given optional parameters #when values have wrong type #then ignores them", () => {
		expect(optionalString({ query: "symbol" }, "query")).toBe("symbol");
		expect(optionalString({ query: 7 }, "query")).toBeUndefined();
		expect(optionalNumber({ limit: 10 }, "limit")).toBe(10);
		expect(optionalNumber({ limit: Number.NaN }, "limit")).toBeUndefined();
		expect(optionalBoolean({ includeDeclaration: false }, "includeDeclaration")).toBe(false);
		expect(optionalBoolean({ includeDeclaration: "false" }, "includeDeclaration")).toBeUndefined();
	});

	test("#given severity parameter #when value is unknown #then defaults to all", () => {
		expect(severityFilter({ severity: "warning" })).toBe("warning");
		expect(severityFilter({ severity: "fatal" })).toBe("all");
		expect(severityFilter({})).toBe("all");
	});

	test("#given optional abort signal #when building client options #then includes only defined signal", () => {
		const controller = new AbortController();

		expect(clientOptions(undefined)).toEqual({});
		expect(clientOptions(controller.signal)).toEqual({ signal: controller.signal });
	});
});
