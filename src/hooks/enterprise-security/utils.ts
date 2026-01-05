import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { minimatch } from "minimatch";
import {
	ALLOWED_PATHS,
	BLOCKED_PATHS,
	CREDENTIAL_PATTERNS,
	DANGEROUS_BASH_PATTERNS,
	INSECURE_LOGGING_PATTERNS,
	PII_PATTERNS,
	PROTECTED_FILE_PATTERNS,
} from "./constants";
import type { ComplianceViolation } from "./types";

function normalizePath(path: string): string {
	let normalized = path;
	if (normalized.startsWith("~/")) {
		normalized = resolve(homedir(), normalized.slice(2));
	}
	if (normalized.startsWith("./")) {
		normalized = normalized.slice(2);
	}
	return normalized;
}

function isAllowedPath(filePath: string): boolean {
	const normalized = normalizePath(filePath);
	for (const allowed of ALLOWED_PATHS) {
		const allowedNormalized = normalizePath(allowed);
		if (
			normalized.endsWith(allowedNormalized) ||
			normalized.includes(allowedNormalized)
		) {
			return true;
		}
	}
	return false;
}

export function isProtectedFile(filePath: string): {
	blocked: boolean;
	reason: string;
} {
	const normalized = normalizePath(filePath);

	if (isAllowedPath(filePath)) {
		return { blocked: false, reason: "Explicitly allowed" };
	}

	for (const blocked of BLOCKED_PATHS) {
		const blockedNormalized = normalizePath(blocked);
		if (
			normalized === blockedNormalized ||
			normalized.endsWith(blockedNormalized)
		) {
			return { blocked: true, reason: `Exact match: ${blocked}` };
		}
	}

	for (const pattern of PROTECTED_FILE_PATTERNS) {
		const patternNormalized = normalizePath(pattern);

		if (minimatch(normalized, patternNormalized)) {
			return { blocked: true, reason: `Pattern match: ${pattern}` };
		}

		if (minimatch(normalized, `**/${patternNormalized}`)) {
			return { blocked: true, reason: `Pattern match: ${pattern}` };
		}

		if (
			!pattern.includes("/") &&
			minimatch(basename(normalized), patternNormalized)
		) {
			return { blocked: true, reason: `Basename pattern match: ${pattern}` };
		}
	}

	return { blocked: false, reason: "" };
}

export function checkComplianceViolations(
	content: string,
): ComplianceViolation[] {
	const violations: ComplianceViolation[] = [];

	for (const pattern of PII_PATTERNS) {
		if (pattern.test(content)) {
			violations.push({
				type: "PII",
				pattern: pattern.source,
				severity: "warning",
			});
		}
	}

	for (const pattern of CREDENTIAL_PATTERNS) {
		if (pattern.test(content)) {
			violations.push({
				type: "Hardcoded Credential",
				pattern: pattern.source,
				severity: "error",
			});
		}
	}

	for (const pattern of INSECURE_LOGGING_PATTERNS) {
		if (pattern.test(content)) {
			violations.push({
				type: "Insecure Logging",
				pattern: "sensitive data in logs",
				severity: "warning",
			});
		}
	}

	return violations;
}

export function checkDangerousBashCommand(command: string): {
	dangerous: boolean;
	reason: string;
} {
	for (const pattern of DANGEROUS_BASH_PATTERNS) {
		if (pattern.test(command)) {
			return {
				dangerous: true,
				reason: `Dangerous command pattern detected: ${pattern.source}`,
			};
		}
	}

	return { dangerous: false, reason: "" };
}
