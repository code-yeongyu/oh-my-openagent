import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { withCommitHooks } from "../../dist/plan-commit.js";
import { commit } from "../../dist/plan-commit.js";
import { readLedger, readUlwLoopPlan, withUlwLoopMutationLock } from "../../dist/plan-io.js";
const cli = resolve("dist/cli.js");
const root = mkdtempSync(join(tmpdir(), "ulw-cli-qa-"));
const legacyRoot = mkdtempSync(join(tmpdir(), "ulw-legacy-qa-"));
const scope = { sessionId: "commit-log" };
const dir = join(root, ".omo", "ulw-loop", scope.sessionId);
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
function run(cwd, ...args) {
	const argv = [...args, "--session-id", scope.sessionId, "--json"];
	const result = spawnSync(process.execPath, [cli, ...argv], { cwd, encoding: "utf8", timeout: 15_000, env: { ...process.env, PI_SESSION_ID: "", CODEX_SESSION_ID: "", CODEX_THREAD_ID: "", OMO_ULW_LOOP_SESSION_ID: "" } });
	console.log(`command=${process.execPath} ${cli} ${argv.map((arg) => JSON.stringify(arg)).join(" ")} cwd=${cwd}\n${result.stdout}${result.stderr}\nexit=${result.status}`);
	assert.equal(result.status, 0);
	return JSON.parse(result.stdout);
}
try {
	run(root, "create-goals", "--brief", "Build durable state");
	const original = json(join(dir, "goals.json"));
	assert.equal(run(root, "status").plan.revision, 1);
	rmSync(join(dir, "goals.json"));
	assert.equal(run(root, "status").plan.revision, 1);
	assert.equal(existsSync(join(dir, "goals.json")), false);
	const goal = original.goals[0];
	run(root, "record-evidence", "--goal-id", goal.id, "--criterion-id", goal.successCriteria[0].id, "--status", "pass", "--evidence", "Observed real CLI publication");
	assert.equal(json(join(dir, "revisions", "00000002.json")).ledger[0].kind, "evidence_captured");
	assert.equal(json(join(dir, "goals.json")).revision, 2);
	console.log("QA=PASS log-only status is read-only; CLI evidence repairs and commits plan plus audit");
	const clock = { now: () => 0, schedule: () => { throw new Error("Unexpected scheduler use"); } };
	await assert.rejects(withCommitHooks({ beforeCommit: async () => {
		const child = fork(resolve("test/fixtures/commit-writer.ts"), [root, "write", "201"], { execPath: "bun", execArgv: [], stdio: ["ignore", "inherit", "inherit", "ipc"] });
		const exit = await new Promise((done, reject) => {
			const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("writer B timed out")); }, 10_000);
			child.once("error", (error) => { clearTimeout(timeout); reject(error); });
			child.once("exit", (code) => { clearTimeout(timeout); done(code); });
		});
		assert.equal(exit, 0);
	} }, () => withUlwLoopMutationLock(root, scope, async () => {
		const plan = await readUlwLoopPlan(root, scope);
		plan.brief = "zombie";
		await commit(root, scope, { plan, entries: [{ at: "A", kind: "goal_added", message: "A" }] });
	}, { clock, leaseMs: 200, heartbeatMs: 0 })), { code: "ULW_LOOP_LOCK_LOST" });
	assert.equal(readLedger(root, scope).at(-1).message, "B");
	assert.equal(readLedger(root, scope).some((entry) => entry.message === "A"), false);
	assert.deepEqual(readdirSync(join(dir, "revisions")), ["00000001.json", "00000002.json", "00000003.json"]);
	console.log(`QA=PASS real fork zombie fencing ULW_LOOP_LOCK_LOST record=${JSON.stringify(json(join(dir, "revisions", "00000003.json")))}`);
	run(root, "create-goals", "--brief", "Replacement brief", "--force");
	const recreated = json(join(dir, "goals.json"));
	assert.equal(recreated.revision, 4);
	assert.equal(recreated.ledgerResetRevision, 4);
	assert.equal(readFileSync(join(dir, "brief.md"), "utf8"), recreated.brief);
	assert.equal(readLedger(root, scope).length, 1);
	console.log("QA=PASS force recreation retains revision history and resets the logical audit");
	const legacyDir = join(legacyRoot, ".omo", "ulw-loop", scope.sessionId);
	mkdirSync(legacyDir, { recursive: true });
	delete original.revision; delete original.brief; delete original.ledgerResetRevision;
	writeFileSync(join(legacyDir, "goals.json"), JSON.stringify(original));
	writeFileSync(join(legacyDir, "brief.md"), "Legacy brief\n");
	writeFileSync(join(legacyDir, "ledger.jsonl"), '{"at":"legacy","kind":"goal_started"}\n');
	assert.equal(run(legacyRoot, "status").plan.revision ?? 0, 0);
	assert.equal(existsSync(join(legacyDir, "revisions")), false);
	run(legacyRoot, "add-goal", "--title", "Extra", "--objective", "Verify legacy hydration");
	assert.equal(json(join(legacyDir, "revisions", "00000001.json")).plan.brief, "Legacy brief\n");
	assert.equal(readLedger(legacyRoot, scope)[0].id, "legacy-1");
	console.log("QA=PASS legacy CLI status and first commit preserve brief and legacy audit");
} finally {
	rmSync(root, { recursive: true, force: true });
	rmSync(legacyRoot, { recursive: true, force: true });
	assert.equal(existsSync(root) || existsSync(legacyRoot), false);
	console.log(`cleanup=REMOVED ${root} ${legacyRoot}; real home directories not accessed by this driver`);
}
