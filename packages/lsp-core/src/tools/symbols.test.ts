import { describe, expect, it } from "bun:test";
import { DEFAULT_MAX_SYMBOLS } from "../lsp/constants.js";
import { normalizeSymbolLimit } from "./symbols.js";

describe("normalizeSymbolLimit", () => {
	it("#given invalid symbol limits #when normalizing #then they fall back to the default limit", () => {
		// given / when / then
		expect(normalizeSymbolLimit(undefined)).toBe(DEFAULT_MAX_SYMBOLS);
		expect(normalizeSymbolLimit(0)).toBe(DEFAULT_MAX_SYMBOLS);
		expect(normalizeSymbolLimit(-1)).toBe(DEFAULT_MAX_SYMBOLS);
	});

	it("#given fractional and oversized symbol limits #when normalizing #then they stay within supported bounds", () => {
		// given / when / then
		expect(normalizeSymbolLimit(1.8)).toBe(1);
		expect(normalizeSymbolLimit(DEFAULT_MAX_SYMBOLS + 10)).toBe(DEFAULT_MAX_SYMBOLS);
	});
});
