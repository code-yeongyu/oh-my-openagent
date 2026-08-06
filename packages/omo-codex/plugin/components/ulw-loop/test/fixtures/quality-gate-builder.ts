import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// v2 evidence layout: artifacts must live inside the goal's current attempt dir
export function qaDirFor(goalId: string, attempt = 1, sessionId = "session"): string {
	return `.omo/evidence/ulw/${sessionId}/${goalId}/a${attempt}`;
}

export const QA_DIR = qaDirFor("G001-finished");
export const CODE_REVIEW_PATH = `${QA_DIR}/code-review.md`;
export const GATE_REVIEW_PATH = `${QA_DIR}/gate-review.md`;
export const CLI_PASS_PATH = `${QA_DIR}/cli-pass.txt`;
export const REJECTION_LOG_PATH = `${QA_DIR}/rejection.txt`;
export const MISSING_ARTIFACT_PATH = `${QA_DIR}/missing.txt`;

export async function writeQualityGateArtifacts(repoRoot: string, qaDir = QA_DIR): Promise<void> {
	await mkdir(join(repoRoot, qaDir), { recursive: true });
	await writeFile(join(repoRoot, `${qaDir}/code-review.md`), "code review approved\n", "utf8");
	await writeFile(join(repoRoot, `${qaDir}/gate-review.md`), "gate review approved\n", "utf8");
	await writeFile(join(repoRoot, `${qaDir}/cli-pass.txt`), "cli scenario passed\n", "utf8");
	await writeFile(join(repoRoot, `${qaDir}/rejection.txt`), "invalid gate rejected\n", "utf8");
}

export async function qualityGateJson(
	repoRoot: string,
	cliArtifactPath?: string,
	goalId = "G001-finished",
): Promise<string> {
	const qaDir = qaDirFor(goalId);
	await writeQualityGateArtifacts(repoRoot, qaDir);
	const cliPath = cliArtifactPath ?? `${qaDir}/cli-pass.txt`;
	return JSON.stringify({
		codeReview: {
			by: "lazycodex-code-reviewer",
			recommendation: "APPROVE",
			codeQualityStatus: "CLEAR",
			reportPath: `${qaDir}/code-review.md`,
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
					path: cliPath,
				},
				{
					id: "artifact-cli-reject",
					kind: "log",
					description: "Log proving invalid final checkpoint rejection.",
					path: `${qaDir}/rejection.txt`,
				},
			],
		},
		gateReview: {
			by: "lazycodex-gate-reviewer",
			recommendation: "APPROVE",
			reportPath: `${qaDir}/gate-review.md`,
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
			originalIntent: "User wanted a final checkpoint that only accepts artifact-backed completion.",
			desiredOutcome: "Checkpoint completes only after code review, manual QA, and gate review all pass.",
			userOutcomeReview: "The artifacts show the requested checkpoint behavior from the user's perspective.",
			adversarialClassesCovered: ["missing_artifact", "role_mismatch"],
		},
	});
}
