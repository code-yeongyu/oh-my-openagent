#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const REQUIRED_STRING_FIELDS = [
	"title",
	"targetRepository",
	"problem",
	"reproductionLogs",
	"approach",
	"confidence",
	"risks",
	"userVisibleBehaviorChanges",
	"globalReviewDebugGate",
];

const GLOBAL_REVIEW_DEBUG_GATE_ERROR =
	"globalReviewDebugGate must start with PASS and include review-work all-lanes, debugging hypotheses, and redacted evidence";
const NEGATIVE_GLOBAL_REVIEW_DEBUG_GATE_PATTERN =
	/\b(?:fail(?:ed|ure)?|inconclusive|omitted|missing|not done|zero hypotheses|blocked|timed out|timeout)\b/i;
const REVIEW_WORK_ALL_LANES_PASS_PATTERN = /\breview-work\b[\s\S]*\ball(?:\s+five)?\s+lanes\s+passed\b/i;
const DEBUGGING_HYPOTHESES_PASS_PATTERN =
	/\b(?:debugging[\s\S]*(?:three|3)\s+(?:plausible\s+)?hypothes(?:is|es)\s+(?:were\s+)?(?:checked|covered|passed|audited|recorded|ruled out)|(?:three|3)\s+(?:plausible\s+)?debugging\s+hypothes(?:is|es)\s+(?:were\s+)?(?:checked|covered|passed|audited|recorded|ruled out)|debugging[\s\S]*(?:checked|covered|passed|audited|recorded|ruled out)[\s\S]*(?:three|3)\s+(?:plausible\s+)?hypothes(?:is|es))\b/i;
const RAW_SENSITIVE_EVIDENCE_PATTERN =
	/(?:github_pat_[A-Za-z0-9_]{20,}|gh[opsu]_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|Authorization:\s*Bearer\s+\S+|Cookie:\s*[^=\s]+=|api[_ -]?key\s*[:=]\s*["']?[A-Za-z0-9._-]{16,}|password\s*[:=]\s*["']?\S{8,}|env dump|private log|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;

function requireRecord(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("input must be a JSON object");
	}
	return value;
}

function requireStringField(record, field) {
	const value = record[field];
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${field} must be a non-empty string`);
	}
	const trimmed = value.trim();
	assertNoSensitiveEvidence(trimmed, field);
	return trimmed;
}

function assertNoSensitiveEvidence(value, field) {
	if (RAW_SENSITIVE_EVIDENCE_PATTERN.test(value)) {
		throw new Error(`${field} must not contain raw sensitive evidence`);
	}
}

function requireGlobalReviewDebugGate(record) {
	const value = requireStringField(record, "globalReviewDebugGate");
	if (
		!/^PASS\b/i.test(value) ||
		NEGATIVE_GLOBAL_REVIEW_DEBUG_GATE_PATTERN.test(value) ||
		!REVIEW_WORK_ALL_LANES_PASS_PATTERN.test(value) ||
		!DEBUGGING_HYPOTHESES_PASS_PATTERN.test(value) ||
		!/\bredacted evidence\b/i.test(value)
	) {
		throw new Error(GLOBAL_REVIEW_DEBUG_GATE_ERROR);
	}
	return value;
}

function requireVerification(record) {
	const value = record.verification;
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error("verification must be a non-empty string array");
	}
	return value.map((entry, index) => {
		if (typeof entry !== "string" || entry.trim() === "") {
			throw new Error(`verification[${index}] must be a non-empty string`);
		}
		const trimmed = entry.trim();
		assertNoSensitiveEvidence(trimmed, `verification[${index}]`);
		return trimmed;
	});
}

function parseInput(value) {
	const record = requireRecord(value);
	const strings = Object.fromEntries(REQUIRED_STRING_FIELDS.map((field) => [field, requireStringField(record, field)]));
	return {
		title: strings.title,
		targetRepository: strings.targetRepository,
		problem: strings.problem,
		reproductionLogs: strings.reproductionLogs,
		approach: strings.approach,
		confidence: strings.confidence,
		risks: strings.risks,
		userVisibleBehaviorChanges: strings.userVisibleBehaviorChanges,
		globalReviewDebugGate: requireGlobalReviewDebugGate(record),
		verification: requireVerification(record),
	};
}

function bulletList(items) {
	return items.map((item) => `- ${item}`).join("\n");
}

export function createLazyCodexBugFixPrBody(value) {
	const input = parseInput(value);
	return `## Problem Situation
${input.problem}

## Reproduction Logs
${input.reproductionLogs}

## Approach
${input.approach}

## Why I Am Confident
${input.confidence}

## Risks
${input.risks}

## User-Visible Behavior Changes
${input.userVisibleBehaviorChanges}

## Verification
${bulletList(input.verification)}

## Global Review and Debugging Gate
${input.globalReviewDebugGate}

---
This PR was debugged, implemented, and created with [LazyCodex](https://github.com/code-yeongyu/lazycodex).
Tag: lazycodex-generated
`;
}

async function main() {
	const [, , inputPath, outputPath] = process.argv;
	if (typeof inputPath !== "string" || inputPath.trim() === "") {
		throw new Error("usage: create-pr-body.mjs <input.json> <output.md>");
	}
	if (typeof outputPath !== "string" || outputPath.trim() === "") {
		throw new Error("usage: create-pr-body.mjs <input.json> <output.md>");
	}
	const parsed = JSON.parse(await readFile(inputPath, "utf8"));
	await writeFile(outputPath, createLazyCodexBugFixPrBody(parsed), "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
