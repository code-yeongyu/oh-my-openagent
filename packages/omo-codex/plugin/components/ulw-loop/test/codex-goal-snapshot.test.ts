import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	CodexGoalSnapshotError,
	formatCodexGoalReconciliation,
	parseCodexGoalSnapshot,
	readCodexGoalSnapshotInput,
	reconcileCodexGoalSnapshot,
} from "../src/codex-goal-snapshot.ts";

describe("parseCodexGoalSnapshot", () => {
	it("returns available snapshot from { goal: { ... } } JSON", () => {
		// given
		const payload = { goal: { objective: "X", status: "active" } };

		// when
		const snapshot = parseCodexGoalSnapshot(payload);

		// then
		expect(snapshot.available).toBe(true);
		expect(snapshot.objective).toBe("X");
		expect(snapshot.status).toBe("active");
	});

	it("reads the objective from a title-bearing ulw-loop status goal", () => {
		// given
		const payload = {
			id: "G002-goal-2-senpi-repo-audit-determine-wh",
			title: "Audit the Senpi repository",
			status: "in_progress",
			successCriteria: [],
		};

		// when
		const snapshot = parseCodexGoalSnapshot(payload);

		// then
		expect(snapshot.available).toBe(true);
		expect(snapshot.objective).toBe("Audit the Senpi repository");
		expect(snapshot.status).toBe("active");
	});

	it("ignores remaining token budget fields from goal snapshots", () => {
		// given
		const payload = { goal: { objective: "X", status: "active" }, remainingTokens: 123 };

		// when
		const snapshot = parseCodexGoalSnapshot(payload);

		// then
		expect("remainingTokens" in snapshot).toBe(false);
	});

	it("returns unavailable snapshot from null", () => {
		// when
		const snapshot = parseCodexGoalSnapshot(null);

		// then
		expect(snapshot.available).toBe(false);
	});

	it("returns unavailable snapshot from malformed payload", () => {
		// when
		const snapshot = parseCodexGoalSnapshot({ wrong: "shape" });

		// then
		expect(snapshot.available).toBe(false);
		expect(snapshot.status).toBe("unknown");
	});
});

describe("readCodexGoalSnapshotInput", () => {
	let dir = "";

	beforeEach(async () => {
		// given
		dir = await mkdtemp(join(tmpdir(), "ug-snap-"));
	});

	it("parses inline JSON string", async () => {
		// when
		const snapshot = await readCodexGoalSnapshotInput('{"goal":{"objective":"X","status":"active"}}');

		// then
		expect(snapshot?.available).toBe(true);
		expect(snapshot?.objective).toBe("X");
	});

	it("reads from file path", async () => {
		// given
		const filePath = join(dir, "snap.json");
		await writeFile(filePath, '{"goal":{"objective":"X","status":"complete"}}', "utf8");

		// when
		const snapshot = await readCodexGoalSnapshotInput(filePath);

		// then
		expect(snapshot?.available).toBe(true);
		expect(snapshot?.status).toBe("complete");
	});

	it("reads from sample fixture path", async () => {
		// given
		const filePath = new URL("./fixtures/codex-goal-snapshot.json", import.meta.url);

		// when
		const snapshot = await readCodexGoalSnapshotInput(filePath.pathname);

		// then
		expect(snapshot?.available).toBe(true);
		expect(snapshot?.objective).toBe("Complete the durable ulw-loop plan");
	});

	it("throws CodexGoalSnapshotError when input is neither JSON nor a path", async () => {
		// when/then
		await expect(readCodexGoalSnapshotInput("not json and not a path")).rejects.toThrow(CodexGoalSnapshotError);
	});
});

describe("reconcileCodexGoalSnapshot", () => {
	it("preserves objective whitespace in driver advice while normalizing comparison", () => {
		const expectedObjective = "  exact   objective\nwith spacing  ";
		const result = reconcileCodexGoalSnapshot(
			parseCodexGoalSnapshot({ goal: { objective: "different", status: "active" } }),
			{ expectedObjective },
		);

		expect(result.warnings[0]).toContain(`expected "${expectedObjective}"`);
	});
	it("returns ok=true when snapshot matches expected", () => {
		// when
		const reconciliation = reconcileCodexGoalSnapshot(
			{ available: true, objective: "X", status: "active", raw: null },
			{ expectedObjective: "X" },
		);

		// then
		expect(reconciliation.ok).toBe(true);
		expect(reconciliation.errors).toHaveLength(0);
	});

	it("reports warning when objective mismatches", () => {
		// when
		const reconciliation = reconcileCodexGoalSnapshot(
			{ available: true, objective: "X", status: "active", raw: null },
			{ expectedObjective: "Y" },
		);

		// then
		expect(reconciliation.ok).toBe(true);
		expect(reconciliation.errors).toHaveLength(0);
		expect(reconciliation.warnings.join(" ")).toContain("driver_objective_differs");
	});

	it("accepts a parsable snapshot without objective as advisory", () => {
		// when
		const reconciliation = reconcileCodexGoalSnapshot(
			{ available: true, status: "active", raw: { goal: { status: "active" } } },
			{ expectedObjective: "X" },
		);

		// then
		expect(reconciliation.ok).toBe(true);
		expect(reconciliation.errors).toHaveLength(0);
	});

	it("accepts limited driver statuses", () => {
		// when
		const reconciliation = reconcileCodexGoalSnapshot(
			{ available: true, objective: "X", status: "budget_limited", raw: null },
			{ expectedObjective: "X" },
		);

		// then
		expect(reconciliation.ok).toBe(true);
		expect(reconciliation.errors).toHaveLength(0);
		expect(reconciliation.warnings.join(" ")).toContain("/goal resume");
	});
});

describe("formatCodexGoalReconciliation", () => {
	it("renders errors joined", () => {
		// given
		const reconciliation = reconcileCodexGoalSnapshot(
			{ available: true, objective: "X", status: "active", raw: null },
			{ expectedObjective: "Y" },
		);

		// when
		const formatted = formatCodexGoalReconciliation(reconciliation);

		// then
		expect(formatted).toMatch(/objective|status/i);
	});
});
