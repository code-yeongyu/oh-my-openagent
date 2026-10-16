import { describe, expect, it } from "vitest";
import { throwQualityGateDefects } from "../src/quality-gate-fields.js";
import { UlwLoopError } from "../src/types.js";

describe("quality gate cap and dedupe", () => {
	it("#given duplicate defects beyond the cap #when formatting #then deduplicates before capping", () => {
		const defects = Array.from({ length: 30 }, (_, index) => ({
			field: index < 10 ? "duplicate" : `field-${index - 10}`,
			message: index < 10 ? "same defect" : `defect-${index - 10}`,
		}));
		try {
			throwQualityGateDefects(defects);
			throw new Error("expected validation failure");
		} catch (error) {
			expect(error).toBeInstanceOf(UlwLoopError);
			if (!(error instanceof UlwLoopError)) throw error;
			const fields = error.details?.["fields"];
			expect(Array.isArray(fields) ? fields.length : 0).toBe(21);
			expect(error.details?.["truncated"]).toBeUndefined();
		}
	});
});
