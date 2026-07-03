#!/usr/bin/env node

import { scanPathsForSecrets, SEEDED_FAKE_SECRET, writeRedactionReport } from "./evidence-redaction.mjs";
import { readPacketInput, writeEvidencePacket } from "./evidence-packet.mjs";

const HELP_TEXT = `pi-codex-app-server PR-012 evidence packet writer

Usage:
  node packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/qa/write-evidence-packet.mjs --input <packet.json> --out <dir>
  node packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/qa/write-evidence-packet.mjs --scan <dir> [--seeded-secret <value>]

Options:
  --help                   Show this help text.
  --input <path>           JSON packet input with commands, transcript, assertions, cleanup, and residualRisks.
  --out <dir>              Evidence packet output directory.
  --scan <dir>             Scan an existing packet or artifact directory for raw secrets.
  --seeded-secret <value>  Additional fake secret that must fail closed if present.
  --redaction-report <path> Write scan output to this report path.
`;

async function main(argv) {
	if (argv.length === 0 || argv.includes("--help")) {
		process.stdout.write(HELP_TEXT);
		return 0;
	}
	const args = parseArgs(argv);
	const seededSecrets = args.seededSecrets.length > 0 ? args.seededSecrets : [SEEDED_FAKE_SECRET];
	if (args.scanPath) {
		const scanResult = scanPathsForSecrets(args.scanPath, seededSecrets);
		if (args.redactionReport) {
			writeRedactionReport(args.redactionReport, scanResult);
		}
		process.stdout.write(formatScanResult(scanResult));
		return scanResult.status === "pass" ? 0 : 1;
	}
	if (!args.inputPath || !args.outputDir) {
		throw new Error("--input and --out are required unless --scan is used.");
	}
	const input = readPacketInput(args.inputPath);
	const scanResult = writeEvidencePacket(input, args.outputDir);
	process.stdout.write(formatScanResult(scanResult));
	return scanResult.status === "pass" ? 0 : 1;
}

function parseArgs(argv) {
	const parsed = {
		inputPath: "",
		outputDir: "",
		scanPath: "",
		seededSecrets: [],
		redactionReport: "",
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		switch (arg) {
			case "--input":
				parsed.inputPath = readValue(argv, index, arg);
				index += 1;
				break;
			case "--out":
				parsed.outputDir = readValue(argv, index, arg);
				index += 1;
				break;
			case "--scan":
				parsed.scanPath = readValue(argv, index, arg);
				index += 1;
				break;
			case "--seeded-secret":
				parsed.seededSecrets.push(readValue(argv, index, arg));
				index += 1;
				break;
			case "--redaction-report":
				parsed.redactionReport = readValue(argv, index, arg);
				index += 1;
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return parsed;
}

function formatScanResult(scanResult) {
	if (scanResult.status === "assertion-fail") {
		return "FAIL assertions failed\n";
	}
	const lines = scanResult.status === "pass" ? ["PASS no secret leaks found"] : ["FAIL secret leaks found"];
	for (const finding of scanResult.findings) {
		lines.push(`${finding.file}: ${finding.label}`);
	}
	return `${lines.join("\n")}\n`;
}

function readValue(argv, index, name) {
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${name} requires a value.`);
	}
	return value;
}

try {
	process.exitCode = await main(process.argv.slice(2));
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
}
