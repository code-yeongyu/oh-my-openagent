import { describe, expect, it } from "vitest";

import { checkpointUlwLoop } from "../src/checkpoint.js";
import { criterion, goal, lastLedger, plan, repoWith } from "./fixtures/checkpoint-builders.js";

describe("checkpointUlwLoop status=failed", () => {
	it("sets goal.status=failed, goal.failedAt, appends ledger", async () => {
		const repo = await repoWith(plan([goal({ successCriteria: [criterion("C001", "pending")] })]));

		const result = await checkpointUlwLoop(repo, { goalId: "G001", status: "failed", evidence: "tests failed" });

		expect(result.goal.status).toBe("failed");
		expect(result.goal.failedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
		expect((await lastLedger(repo)).kind).toBe("goal_failed");
	});

	it("classifies external authorization blocker signatures", async () => {
		const repo = await repoWith(plan([goal()]));

		const result = await checkpointUlwLoop(repo, {
			goalId: "G001",
			status: "failed",
			evidence: "ghcr.io returned 401 authentication required because token missing",
		});

		expect(result.goal.blockerSignature).toBe(
			"GHCR_PULL_ACCESS:HTTP_401_ANONYMOUS:GHCR_VISIBILITY_OR_CREDENTIAL_REQUIRED",
		);
	});

	it("after 3 same-signature blockers, marks needs_user_decision + nonRetriable", async () => {
		const repo = await repoWith(
			plan(
				[
					goal({ id: "G001", status: "failed", blockerSignature: "EXTERNAL_AUTHORIZATION_REQUIRED" }),
					goal({ id: "G002", status: "blocked", blockerSignature: "EXTERNAL_AUTHORIZATION_REQUIRED" }),
					goal({ id: "G003" }),
				],
				{ activeGoalId: "G003" },
			),
		);

		const result = await checkpointUlwLoop(repo, {
			goalId: "G003",
			status: "failed",
			evidence: "Registry returned 401 because credentials are missing",
		});

		expect(result.goal.status).toBe("needs_user_decision");
		expect(result.goal.nonRetriable).toBe(true);
	});

	it("skips the criteria gate for failed status", async () => {
		const repo = await repoWith(plan([goal({ successCriteria: [criterion("C001", "pending")] })]));

		await expect(
			checkpointUlwLoop(repo, { goalId: "G001", status: "failed", evidence: "not done" }),
		).resolves.toMatchObject({ goal: { status: "failed" } });
	});
});

describe("checkpointUlwLoop status=blocked", () => {
	it("preserves blocker fields + appends ledger", async () => {
		const repo = await repoWith(plan([goal()]));

		const result = await checkpointUlwLoop(repo, {
			goalId: "G001",
			status: "blocked",
			evidence: "ghcr.io requires token and credentials are missing",
		});

		expect(result.goal.status).toBe("blocked");
		expect(result.goal.blockedReason).toContain("ghcr.io");
		expect(result.goal.blockerSignature).toContain("GHCR_PULL_ACCESS");
		expect((await lastLedger(repo)).kind).toBe("goal_blocked");
	});

	it("skips the criteria gate for blocked status", async () => {
		const repo = await repoWith(plan([goal({ successCriteria: [criterion("C001", "pending")] })]));

		await expect(
			checkpointUlwLoop(repo, { goalId: "G001", status: "blocked", evidence: "waiting for approval" }),
		).resolves.toMatchObject({ goal: { status: "blocked" } });
	});
});
