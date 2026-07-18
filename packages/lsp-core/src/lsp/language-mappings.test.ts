import { describe, expect, test } from "bun:test";

import { getLanguageId } from "./language-mappings.js";

describe("getLanguageId", () => {
	test("#given uppercase extension #when resolving language id #then matches lowercase registry entry", () => {
		// given / when / then
		expect(getLanguageId(".TS")).toBe("typescript");
		expect(getLanguageId(".TsX")).toBe("typescriptreact");
	});
});
