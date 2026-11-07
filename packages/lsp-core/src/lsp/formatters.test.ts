import { describe, expect, it } from "bun:test";
import { formatDiagnostic } from "./formatters.js";
import type { Diagnostic } from "./types.js";

const range = {
	start: { line: 0, character: 2 },
	end: { line: 0, character: 5 },
};

describe("formatDiagnostic", () => {
	it("#given diagnostic code zero #when formatting #then the numeric code is preserved", () => {
		// given
		const diagnostic: Diagnostic = {
			range,
			severity: 1,
			code: 0,
			source: "typescript",
			message: "Zero code diagnostic",
		};

		// when
		const formatted = formatDiagnostic(diagnostic);

		// then
		expect(formatted).toBe("error[typescript] (0) at 1:2: Zero code diagnostic");
	});
});
