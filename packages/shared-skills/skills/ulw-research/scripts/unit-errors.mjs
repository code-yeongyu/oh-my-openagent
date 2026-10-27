// Classified refusals shared by public derivation boundaries and the registry.
export class RuleError extends Error {
	constructor(detail, hint, shape = "invalid_input", expected = "a valid ledger and derivation specification") {
		super(detail)
		this.detail = detail
		this.shape = shape
		this.expected = expected
		if (hint) this.hint = hint
	}
}

export const refuse = (detail, hint, shape, expected) => {
	throw new RuleError(detail, hint, shape, expected)
}

export function refusal(error) {
	return {
		shape: error instanceof RuleError ? error.shape : "invalid_input",
		expected: error instanceof RuleError ? error.expected : "valid JSON fields matching the fact ledger grammar",
		detail: error instanceof Error ? error.message : "invalid input",
		...(error instanceof RuleError && error.hint ? { hint: error.hint } : {}),
	}
}
