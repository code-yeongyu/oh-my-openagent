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
];

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
	return value.trim();
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
		return entry.trim();
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
