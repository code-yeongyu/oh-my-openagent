import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

export const SEEDED_FAKE_SECRET = "pi_codex_fake_secret_DO_NOT_LEAK_20260624";

const BUILTIN_SECRET_PATTERNS = [
	{
		label: "authorization-bearer",
		pattern: /Authorization:\s*Bearer\s+(?!\[REDACTED\])[^\s"'`]+/giu,
		replacement: "Authorization: Bearer [REDACTED]",
	},
	{
		label: "codex-access-token",
		pattern: /CODEX_ACCESS_TOKEN=(?!\[REDACTED\])([^\s"'`]+)/gu,
		replacement: "CODEX_ACCESS_TOKEN=[REDACTED]",
	},
	{
		label: "cookie-header",
		pattern: /Cookie:\s*[^\n\r]+/giu,
		replacement: "Cookie: [REDACTED]",
	},
	{
		label: "openai-key",
		pattern: /sk-[A-Za-z0-9_-]{16,}/gu,
		replacement: "[REDACTED_OPENAI_KEY]",
	},
	{
		label: "github-token",
		pattern: /gh[pousr]_[A-Za-z0-9_]{16,}/gu,
		replacement: "[REDACTED_GITHUB_TOKEN]",
	},
];

export function sanitizeText(text, seededSecrets = [SEEDED_FAKE_SECRET]) {
	let sanitized = text;
	for (const secret of seededSecrets) {
		if (secret.length > 0) {
			sanitized = sanitized.split(secret).join("[REDACTED_SEEDED_SECRET]");
		}
	}
	for (const detector of BUILTIN_SECRET_PATTERNS) {
		sanitized = sanitized.replace(detector.pattern, detector.replacement);
	}
	return sanitized;
}

export function sanitizeJsonLine(value, seededSecrets = [SEEDED_FAKE_SECRET]) {
	return sanitizeText(JSON.stringify(value), seededSecrets);
}

export function scanPathsForSecrets(rootPath, seededSecrets = [SEEDED_FAKE_SECRET]) {
	const findings = [];
	for (const filePath of listFiles(rootPath)) {
		const content = readFileSync(filePath, "utf-8");
		for (const finding of detectSecretLabels(content, seededSecrets)) {
			findings.push({
				file: relative(rootPath, filePath) || basename(filePath),
				label: finding,
			});
		}
	}
	return {
		status: findings.length === 0 ? "pass" : "fail",
		findings,
	};
}

export function writeRedactionReport(path, scanResult) {
	const lines = scanResult.status === "pass" ? ["PASS no secret leaks found"] : ["FAIL secret leaks found"];
	for (const finding of scanResult.findings) {
		lines.push(`${finding.file}: ${finding.label}`);
	}
	writeFileSync(path, `${lines.join("\n")}\n`);
}

function detectSecretLabels(content, seededSecrets) {
	const labels = [];
	for (const secret of seededSecrets) {
		if (secret.length > 0 && content.includes(secret)) {
			labels.push("seeded-fake-secret");
		}
	}
	for (const detector of BUILTIN_SECRET_PATTERNS) {
		detector.pattern.lastIndex = 0;
		if (detector.pattern.test(content)) {
			labels.push(detector.label);
		}
	}
	return labels;
}

function listFiles(rootPath) {
	const stat = statSync(rootPath);
	if (stat.isFile()) return [rootPath];
	const files = [];
	for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
		const path = join(rootPath, entry.name);
		if (entry.isDirectory()) {
			files.push(...listFiles(path));
			continue;
		}
		if (entry.isFile()) {
			files.push(path);
		}
	}
	return files;
}
