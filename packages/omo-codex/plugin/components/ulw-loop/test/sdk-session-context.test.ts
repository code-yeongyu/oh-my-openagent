import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ulwLoopLedgerPath, ulwLoopStateLockPath } from "../src/paths.js";
import { createAgentToolkit } from "../src/sdk.js";

const children: ChildProcess[] = [];
const workDirs: string[] = [];

afterEach(async () => {
	for (const child of children.splice(0)) {
		if (child.exitCode === null) child.kill("SIGKILL");
	}
	for (const dir of workDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const HOLDER_SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");
const [lockPath, holdMs] = process.argv.slice(1);
fs.mkdirSync(path.dirname(lockPath), { recursive: true });
const fd = fs.openSync(lockPath, "wx");
fs.writeSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), token: "holder-" + process.pid }));
fs.closeSync(fd);
process.stdout.write("HELD\\n");
setTimeout(() => {
	fs.writeFileSync(lockPath + ".released", "");
	fs.unlinkSync(lockPath);
}, Number(holdMs));
`;

async function makeWorkdir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "ulw-sdk-session-"));
	workDirs.push(dir);
	return dir;
}

function holdStateLock(lockPath: string, holdMs: number): Promise<{ readonly releasedMarker: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ["-e", HOLDER_SCRIPT, lockPath, String(holdMs)], {
			stdio: ["ignore", "pipe", "inherit"],
		});
		children.push(child);
		let output = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			output += chunk;
			if (output.includes("HELD")) resolve({ releasedMarker: `${lockPath}.released` });
		});
		child.once("error", reject);
	});
}

async function seedSession(
	cwd: string,
	sessionId: string,
): Promise<{ readonly goalId: string; readonly criteria: readonly string[] }> {
	const toolkit = createAgentToolkit({ cwd, sessionId, surface: "lazycodex" });
	const created = await toolkit.createGoals({ brief: "Session context fixture" });
	if (!created.ok) throw new Error("fixture could not create goals");
	const started = await toolkit.completeGoals({});
	if (!started.ok || started.operation !== "complete-goals" || "done" in started.result)
		throw new Error("fixture could not start a goal");
	const goalId = started.result.goal.id;
	const criteria = await toolkit.criteria({ goalId });
	if (!criteria.ok || criteria.operation !== "criteria") throw new Error("fixture has no criteria");
	return { goalId, criteria: criteria.result.criteria.map((criterion) => criterion.id) };
}

describe("agent toolkit session context", () => {
	describe("#given a plan written under session A", () => {
		it("#when session B reads through its own context #then the read fails closed instead of borrowing A", async () => {
			const cwd = await makeWorkdir();
			await seedSession(cwd, "session-a");

			const foreign = createAgentToolkit({ cwd, sessionId: "session-b", surface: "lazycodex" });
			const status = await foreign.status();

			expect(status.ok).toBe(false);
		});
	});

	describe("#given the session state lock held by another process", () => {
		it("#when an SDK mutation runs #then it waits for that release before writing", async () => {
			const cwd = await makeWorkdir();
			const sessionId = "session-lock";
			const seeded = await seedSession(cwd, sessionId);
			const criterionId = seeded.criteria[0];
			if (criterionId === undefined) throw new Error("fixture has no criterion");
			const holder = await holdStateLock(ulwLoopStateLockPath(cwd, { sessionId }), 300);

			const toolkit = createAgentToolkit({ cwd, sessionId, surface: "lazycodex" });
			const recorded = await toolkit.recordEvidence({
				goalId: seeded.goalId,
				criterionId,
				status: "pass",
				evidence: "waited for the held lock",
			});

			expect(recorded.ok).toBe(true);
			expect(existsSync(holder.releasedMarker)).toBe(true);
		});
	});

	describe("#given two SDK instances bound to one session directory", () => {
		it("#when both record evidence concurrently #then the ledger keeps both entries", async () => {
			const cwd = await makeWorkdir();
			const sessionId = "session-concurrent";
			const seeded = await seedSession(cwd, sessionId);
			const first = seeded.criteria[0];
			const second = seeded.criteria[1];
			if (first === undefined || second === undefined) throw new Error("fixture needs two criteria");

			const results = await Promise.all([
				createAgentToolkit({ cwd, sessionId, surface: "lazycodex" }).recordEvidence({
					goalId: seeded.goalId,
					criterionId: first,
					status: "pass",
					evidence: "first instance",
				}),
				createAgentToolkit({ cwd, sessionId, surface: "lazycodex" }).recordEvidence({
					goalId: seeded.goalId,
					criterionId: second,
					status: "pass",
					evidence: "second instance",
				}),
			]);

			expect(results.every((result) => result.ok)).toBe(true);
			const ledger = await readFile(ulwLoopLedgerPath(cwd, { sessionId }), "utf8");
			const recorded = ledger
				.split("\n")
				.filter((line) => line.trim().length > 0)
				.map((line): unknown => JSON.parse(line))
				.filter((entry): entry is { readonly criterionId: string } => {
					if (typeof entry !== "object" || entry === null || !("criterionId" in entry)) return false;
					return typeof entry.criterionId === "string";
				})
				.map((entry) => entry.criterionId);
			expect(recorded).toContain(first);
			expect(recorded).toContain(second);
		});
	});
});
