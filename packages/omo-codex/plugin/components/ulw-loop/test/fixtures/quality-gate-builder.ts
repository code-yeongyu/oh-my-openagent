import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const QA_DIR = ".omo/ulw-loop/qa";
export const CODE_REVIEW_PATH = `${QA_DIR}/code-review.md`;
export const GATE_REVIEW_PATH = `${QA_DIR}/gate-review.md`;
export const CLI_PASS_PATH = `${QA_DIR}/cli-pass.txt`;
export const REJECTION_LOG_PATH = `${QA_DIR}/rejection.txt`;
export const MISSING_ARTIFACT_PATH = `${QA_DIR}/missing.txt`;

export async function writeQualityGateArtifacts(repoRoot: string): Promise<void> {
	await mkdir(join(repoRoot, QA_DIR), { recursive: true });
	await writeFile(join(repoRoot, CODE_REVIEW_PATH), "code review approved\n", "utf8");
	await writeFile(join(repoRoot, GATE_REVIEW_PATH), "gate review approved\n", "utf8");
	await writeFile(join(repoRoot, CLI_PASS_PATH), "cli scenario passed\n", "utf8");
	await writeFile(join(repoRoot, REJECTION_LOG_PATH), "invalid gate rejected\n", "utf8");
}

export async function qualityGateJson(repoRoot: string, cliArtifactPath = CLI_PASS_PATH): Promise<string> {
	await writeQualityGateArtifacts(repoRoot);
	return JSON.stringify({
		codeReview: {
			by: "lazycodex-code-reviewer",
			recommendation: "APPROVE",
			codeQualityStatus: "CLEAR",
			reportPath: CODE_REVIEW_PATH,
			evidence: "Reviewed implementation and tests; no blockers remain.",
			blockers: [],
		},
		manualQa: {
			by: "lazycodex-qa-executor",
			status: "passed",
			evidence: "Ran CLI checkpoint validation with artifact-backed evidence.",
			surfaceEvidence: [
				{
					id: "surface-cli-pass",
					criterionRef: "C001",
					surface: "cli",
					invocation: "omo ulw-loop checkpoint --status complete",
					verdict: "passed",
					artifactRefs: ["artifact-cli-pass"],
				},
			],
			adversarialCases: [
				{
					id: "adv-missing-artifact",
					criterionRef: "C002",
					scenario: "quality gate references a missing artifact",
					expectedBehavior: "checkpoint rejects the final completion with ULW_LOOP_QUALITY_GATE_INVALID",
					verdict: "passed",
					artifactRefs: ["artifact-cli-reject"],
				},
			],
			artifactRefs: [
				{
					id: "artifact-cli-pass",
					kind: "cli-transcript",
					description: "CLI transcript for valid final checkpoint.",
					path: cliArtifactPath,
				},
				{
					id: "artifact-cli-reject",
					kind: "log",
					description: "Log proving invalid final checkpoint rejection.",
					path: REJECTION_LOG_PATH,
				},
			],
		},
		gateReview: {
			by: "lazycodex-gate-reviewer",
			recommendation: "APPROVE",
			reportPath: GATE_REVIEW_PATH,
			evidence: "Verified all criteria and artifact evidence.",
			blockers: [],
		},
		iteration: {
			fullRerun: true,
			status: "passed",
			rerunCommands: ["bunx vitest run test/checkpoint.test.ts"],
			evidence: "Focused checkpoint suite reran cleanly.",
		},
		criteriaCoverage: {
			totalCriteria: 2,
			passCount: 2,
			adversarialClassesCovered: ["missing_artifact", "role_mismatch"],
		},
	});
}
