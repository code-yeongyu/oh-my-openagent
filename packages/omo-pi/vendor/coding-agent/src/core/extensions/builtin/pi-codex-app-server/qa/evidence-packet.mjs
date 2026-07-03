import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeJsonLine, sanitizeText, scanPathsForSecrets, writeRedactionReport } from "./evidence-redaction.mjs";
import { writeCleanupReceipt } from "./drive-adapter-support.mjs";

export const REQUIRED_PACKET_FILES = [
	"summary.md",
	"commands.txt",
	"sanitized-transcript.jsonl",
	"assertions.json",
	"redaction-report.txt",
	"residual-risks.md",
	"cleanup-receipt.txt",
];

export function readPacketInput(path) {
	return JSON.parse(readFileSync(path, "utf-8"));
}

export function writeEvidencePacket(input, outputDir) {
	const seededSecrets = Array.isArray(input.seededSecrets) ? input.seededSecrets : [];
	mkdirSync(outputDir, { recursive: true });
	writeFileSync(join(outputDir, "summary.md"), createSummary(input, seededSecrets));
	writeFileSync(join(outputDir, "commands.txt"), createCommands(input, seededSecrets));
	writeFileSync(join(outputDir, "sanitized-transcript.jsonl"), createTranscript(input, seededSecrets));
	const assertionResult = createAssertions(input, seededSecrets);
	writeFileSync(join(outputDir, "assertions.json"), assertionResult.content);
	writeFileSync(join(outputDir, "residual-risks.md"), createResidualRisks(input, seededSecrets));
	writeCleanupReceipt(join(outputDir, "cleanup-receipt.txt"), normalizeCleanup(input.cleanup));
	const scanResult = scanPathsForSecrets(outputDir, seededSecrets);
	writeRedactionReport(join(outputDir, "redaction-report.txt"), scanResult);
	if (scanResult.status === "fail") return scanResult;
	if (!assertionResult.passed) {
		return {
			status: "assertion-fail",
			findings: [],
		};
	}
	return scanResult;
}

function createSummary(input, seededSecrets) {
	const title = sanitizeText(String(input.title ?? "PR-012 QA redaction evidence packet"), seededSecrets);
	return [
		`# ${title}`,
		"",
		"- Scope: PR-012 reusable manual QA harness and evidence redaction.",
		"- Packet files: commands, sanitized transcript, assertions, redaction report, residual risks, cleanup receipt.",
		"- Secret safety: seeded fake secrets and token-shaped values are redacted before scanning.",
		"",
	].join("\n");
}

function createCommands(input, seededSecrets) {
	const commands = Array.isArray(input.commands) ? input.commands : [];
	const lines = [];
	for (const command of commands) {
		lines.push(`$ ${sanitizeText(String(command.command ?? ""), seededSecrets)}`);
		lines.push(`exitCode=${Number(command.exitCode ?? 0)}`);
		if (command.output !== undefined) {
			lines.push(sanitizeText(String(command.output), seededSecrets));
		}
		lines.push("");
	}
	return lines.join("\n");
}

function createTranscript(input, seededSecrets) {
	const transcript = Array.isArray(input.transcript) ? input.transcript : [];
	return `${transcript.map((entry) => sanitizeJsonLine(entry, seededSecrets)).join("\n")}\n`;
}

function createAssertions(input, seededSecrets) {
	const assertions = Array.isArray(input.assertions) ? input.assertions : [];
	const normalized = assertions.map((assertion) => ({
		name: sanitizeText(String(assertion.name ?? "unnamed assertion"), seededSecrets),
		passed: assertion.passed === true,
		details: sanitizeText(String(assertion.details ?? ""), seededSecrets),
	}));
	const passed = normalized.every((assertion) => assertion.passed);
	return {
		content: `${JSON.stringify({ assertions: normalized, passed }, null, 2)}\n`,
		passed,
	};
}

function createResidualRisks(input, seededSecrets) {
	const risks = Array.isArray(input.residualRisks) ? input.residualRisks : [];
	if (risks.length === 0) return "No residual risks recorded.\n";
	return `${risks.map((risk) => `- ${sanitizeText(String(risk), seededSecrets)}`).join("\n")}\n`;
}

function normalizeCleanup(cleanup) {
	return {
		childProcesses: Number(cleanup?.childProcesses ?? 0),
		websockets: Number(cleanup?.websockets ?? 0),
		ownedSockets: Number(cleanup?.ownedSockets ?? 0),
		externalSocketPathsReferenced: Number(cleanup?.externalSocketPathsReferenced ?? 0),
	};
}
