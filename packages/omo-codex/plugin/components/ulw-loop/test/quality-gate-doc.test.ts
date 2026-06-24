import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateQualityGate } from "../src/quality-gate.js";

const FULL_WORKFLOW_URL = new URL("../skills/ulw-loop/references/full-workflow.md", import.meta.url);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const FS_OPTS = { repoRoot: REPO_ROOT, fs: { existsSync, statSync } } as const;

function extractQualityGateSample(workflow: string): unknown {
	const sectionStart = workflow.indexOf("`--quality-gate-json` shape:");
	if (sectionStart === -1) throw new Error("Expected documented quality gate shape section");
	const sampleStart = workflow.indexOf("```json", sectionStart);
	if (sampleStart === -1) throw new Error("Expected JSON fence for documented quality gate sample");
	const jsonStart = sampleStart + "```json".length;
	const sampleEnd = workflow.indexOf("```", jsonStart);
	if (sampleEnd === -1) throw new Error("Expected closing fence for documented quality gate sample");
	return JSON.parse(workflow.slice(jsonStart, sampleEnd));
}

describe("documented quality gate sample", () => {
	it("#given the workflow quality gate example #when validated with fs opts #then documented artifact paths exist", async () => {
		// given
		const workflow = await readFile(FULL_WORKFLOW_URL, "utf8");
		const parsed = extractQualityGateSample(workflow);

		// when
		const gate = validateQualityGate(parsed, FS_OPTS);

		// then
		expect(gate.manualQa.surfaceEvidence).toHaveLength(2);
		expect(gate.gateReview.recommendation).toBe("APPROVE");
	});
});
