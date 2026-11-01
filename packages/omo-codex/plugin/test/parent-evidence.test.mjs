import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	publishReceipt,
	resolveCheckDescriptor,
	nativeWaitState,
	completionState,
} from "../scripts/parent-evidence.mjs";

function fixture(t) {
	const root = fs.realpathSync(
		fs.mkdtempSync(path.join(os.tmpdir(), "parent-evidence-")),
	);
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	return {
		root,
		output: path.join(root, "receipt.json"),
		result: { accepted: true, physicalSends: 3, toolCalls: 2 },
	};
}
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

test("#given successful checks #when the ledger commit expires #then no accepted receipt is published", async (t) => {
	const f = fixture(t);
	await assert.rejects(
		publishReceipt(f.output, f.result, async () => {
			throw new Error("Wall budget exhausted");
		}),
		/Wall budget exhausted/,
	);
	assert.equal(read(f.output).accepted, false);
	assert.equal(read(f.output).acceptanceState, "rejected");
	assert.equal(read(f.output).physicalSends, 3);
});
test("#given a pending commit #when publishing #then acceptance appears only after commit", async (t) => {
	const f = fixture(t);
	let committed = false;
	await publishReceipt(f.output, f.result, async () => {
		assert.equal(read(f.output).accepted, false);
		assert.equal(read(f.output).acceptanceState, "pending");
		committed = true;
	});
	assert.equal(committed, true);
	assert.equal(read(f.output).accepted, true);
	assert.equal(read(f.output).acceptanceState, "accepted");
});
test("#given a historical receipt #when publishing again #then bytes and commit are untouched", async (t) => {
	const f = fixture(t);
	fs.writeFileSync(f.output, "original failure");
	let called = false;
	await assert.rejects(
		publishReceipt(f.output, f.result, async () => {
			called = true;
		}),
		/EEXIST/,
	);
	assert.equal(called, false);
	assert.equal(fs.readFileSync(f.output, "utf8"), "original failure");
});
test("#given output replaced during commit #when publishing #then replacement is preserved", async (t) => {
	const f = fixture(t);
	await assert.rejects(
		publishReceipt(f.output, f.result, async () => {
			fs.writeFileSync(f.output, "other writer");
		}),
		/ownership changed/,
	);
	assert.equal(fs.readFileSync(f.output, "utf8"), "other writer");
});
test("#given committed ledger and unavailable output #when final publication fails #then pending remains unaccepted", async (t) => {
	const f = fixture(t),
		directory = path.join(f.root, "owned"),
		moved = directory + "-moved";
	fs.mkdirSync(directory);
	const output = path.join(directory, "receipt.json");
	let committed = false;
	await assert.rejects(
		publishReceipt(output, f.result, async () => {
			committed = true;
			fs.renameSync(directory, moved);
		}),
		/ENOENT/,
	);
	assert.equal(committed, true);
	assert.equal(read(path.join(moved, "receipt.json")).accepted, false);
});
test("#given interrupted accounting #when committed #then it remains unaccepted with counts intact", async (t) => {
	const f = fixture(t);
	await publishReceipt(
		f.output,
		{ ...f.result, accepted: false, interrupted: true },
		async () => {},
	);
	assert.equal(read(f.output).accepted, false);
	assert.equal(read(f.output).acceptanceState, "interrupted");
	assert.equal(read(f.output).toolCalls, 2);
});
test("#given completed but rejected work #when publishing #then it is not relabeled interrupted", async (t) => {
	const f = fixture(t);
	await publishReceipt(
		f.output,
		{ ...f.result, accepted: false },
		async () => {},
	);
	assert.equal(read(f.output).acceptanceState, "rejected");
	assert.equal(read(f.output).physicalSends, 3);
});
test("#given missing acceptance identity #when publishing #then no file or commit is created", async (t) => {
	const f = fixture(t);
	let called = false;
	await assert.rejects(
		publishReceipt(f.output, { accepted: "true" }, async () => {
			called = true;
		}),
		/acceptance must be explicit/,
	);
	assert.equal(called, false);
	assert.equal(fs.existsSync(f.output), false);
});
test("#given descriptor metadata #when resolving #then argv is unchanged and artifact is owned", (t) => {
	const f = fixture(t),
		command = ["python3", "/absolute/check.py", "literal argument $(no-shell)"];
	assert.deepEqual(
		resolveCheckDescriptor(
			{ command, artifact: "checks/check-result.json" },
			f.root,
		),
		{ command, artifact: path.join(f.root, "checks/check-result.json") },
	);
});
test("#given retained malformed descriptor forms #when resolving #then output documents and shell strings fail closed", (t) => {
	const f = fixture(t);
	for (const descriptor of [
		{ checks: { manifestHashes: true }, pass: true },
		{ command: "python3 /absolute/check.py", artifact: "result.json" },
		{ command: [] },
		{ command: [""] },
		{ command: ["python3", null] },
	]) {
		assert.throws(
			() => resolveCheckDescriptor(descriptor, f.root),
			/explicit argv/,
		);
	}
});
test("#given outside or symlinked artifact #when resolving #then containment fails", (t) => {
	const f = fixture(t);
	for (const artifact of [
		"../outside.json",
		path.join(f.root, "absolute.json"),
		"",
	])
		assert.throws(() =>
			resolveCheckDescriptor({ command: ["check"], artifact }, f.root),
		);
	fs.symlinkSync(f.root, path.join(f.root, "link"), "dir");
	assert.throws(
		() =>
			resolveCheckDescriptor(
				{ command: ["check"], artifact: "link/result.json" },
				f.root,
			),
		/Symlink/,
	);
});
test("#given native V1 waits #when decoding #then timeout differs from terminal failure", () => {
	assert.equal(
		nativeWaitState({ status: {}, timed_out: true }, "child"),
		"running",
	);
	assert.equal(
		nativeWaitState({ status: { child: { completed: "final" } } }, "child"),
		"completed",
	);
	assert.equal(
		nativeWaitState({ status: { child: { completed: null } } }, "child"),
		"completed",
	);
	for (const result of [
		{},
		{ status: [], timed_out: true },
		{ status: {} },
		{ status: { child: "not_found" } },
		{ status: { child: { errored: "failed" } } },
		{ status: { child: { completed: true } } },
	])
		assert.throws(() => nativeWaitState(result, "child"));
});
const event = (type, turn_id = "turn") => ({
	type: "event_msg",
	payload: { type, turn_id },
});
test("#given latest transcript completion #when actor evidence is missing or busy #then not settled", () => {
	const events = [event("task_started"), event("task_complete")];
	for (const actor of [
		null,
		{ status: "completed" },
		{ status: "completed", activeGoal: true, pendingContinuation: false },
		{ status: "idle", activeGoal: false, pendingContinuation: true },
	])
		assert.equal(completionState(events, actor).settled, false);
	assert.equal(
		completionState(events, {
			status: "completed",
			activeGoal: false,
			pendingContinuation: false,
		}).settled,
		true,
	);
});
test("#given an earlier completion #when a new turn or abort arrives #then settlement is invalidated", () => {
	const actor = {
		status: "completed",
		activeGoal: false,
		pendingContinuation: false,
	};
	for (const tail of [
		event("task_started", "new"),
		event("turn_aborted"),
		event("task_complete", "wrong"),
	])
		assert.equal(
			completionState(
				[event("task_started"), event("task_complete"), tail],
				actor,
			).settled,
			false,
		);
});
