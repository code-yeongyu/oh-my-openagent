export type VerbosityMode = "normal" | "concise" | "minimal";

export class VerbosityController {
	/**
	 * Determines the verbosity mode based on token usage percentage (0.0 to 1.0).
	 */
	getVerbosityMode(usagePercentage: number): VerbosityMode {
		if (usagePercentage >= 0.9) {
			return "minimal";
		}
		if (usagePercentage >= 0.7) {
			return "concise";
		}
		return "normal";
	}

	/**
	 * Returns system instructions for the given verbosity mode.
	 */
	getVerbosityInstructions(mode: VerbosityMode): string {
		switch (mode) {
			case "minimal":
				return `
[SYSTEM: MINIMAL MODE ACTIVE]
Token usage is critically high (>90%). 
- Provide ONLY the requested code changes.
- NO explanations, NO reasoning, NO conversational filler.
- Be extremely brief.
`.trim();
			case "concise":
				return `
[SYSTEM: CONCISE MODE ACTIVE]
Token usage is high (>70%). 
- Provide brief explanations only.
- Focus on the code changes.
- Avoid unnecessary verbosity or deep analysis.
`.trim();
			case "normal":
			default:
				return "";
		}
	}
}
