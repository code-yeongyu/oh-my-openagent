interface RedactionRule {
	readonly pattern: RegExp;
	readonly replacement: string;
}

const REDACTION_RULES = [
	{
		pattern: /BEGIN TRANSCRIPT[\s\S]*?(?:END TRANSCRIPT|$)/gi,
		replacement: "[REDACTED:transcript]",
	},
	{
		pattern: /\bignore\s+(?:all\s+)?previous\s+instructions\b[^\r\n]*/gi,
		replacement: "[REDACTED:instruction-injection]",
	},
	{
		pattern: /\bAuthorization:\s*(?:Bearer|Basic)\s+[^\r\n]+/gi,
		replacement: "[REDACTED:authorization]",
	},
	{
		pattern: /\b(?:Cookie|Set-Cookie):[^\r\n]+/gi,
		replacement: "[REDACTED:cookie]",
	},
	{
		pattern: /\b(?:[A-Z][A-Z0-9_]*_)?API[-_]?KEY\s*[:=]\s*[^\s\r\n]+/gi,
		replacement: "[REDACTED:api-key]",
	},
	{
		pattern: /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{2,}\b/g,
		replacement: "[REDACTED:api-key]",
	},
	{
		pattern: /\b(?:[A-Z][A-Z0-9_]*_)?TOKEN\s*[:=]\s*[^\s\r\n]+/gi,
		replacement: "[REDACTED:token]",
	},
	{
		pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{3,}|github_pat_[A-Za-z0-9_]{3,}|xox[abprs]-[A-Za-z0-9-]{3,})\b/g,
		replacement: "[REDACTED:token]",
	},
	{
		pattern: /\b(?:[A-Z][A-Z0-9_]*_)?(?:SECRET|PASSWORD|PASSWD|PWD)\s*[:=]\s*[^\s\r\n]+/gi,
		replacement: "[REDACTED:env-secret]",
	},
	{
		pattern: /\bhttps?:\/\/[^\s/:@]+:[^\s@/]+@[^\s)]+/gi,
		replacement: "[REDACTED:url-credential]",
	},
] as const satisfies readonly RedactionRule[];

export function redactSnapshotText(value: string): string {
	let redacted = value;
	for (const rule of REDACTION_RULES) {
		redacted = redacted.replace(rule.pattern, rule.replacement);
	}
	return redacted;
}
