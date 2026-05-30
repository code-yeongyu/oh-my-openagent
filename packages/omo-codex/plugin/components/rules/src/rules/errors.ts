export class UnsupportedRuleSourceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnsupportedRuleSourceError";
	}
}

export class RuleFrontmatterParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RuleFrontmatterParseError";
	}
}
