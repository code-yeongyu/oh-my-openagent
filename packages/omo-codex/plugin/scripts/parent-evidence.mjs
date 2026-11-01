import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export async function publishReceipt(output, result, commit) {
	assert.equal(
		typeof result?.accepted,
		"boolean",
		"Receipt acceptance must be explicit",
	);
	fs.mkdirSync(path.dirname(output), { recursive: true });
	const pending =
		JSON.stringify({ ...result, accepted: false, acceptanceState: "pending" }) +
		"\n";
	fs.writeFileSync(output, pending, { mode: 0o600, flag: "wx" });
	const owner = fs.lstatSync(output);
	const owns = () => {
		const current = fs.lstatSync(output);
		return (
			!current.isSymbolicLink() &&
			current.ino === owner.ino &&
			current.dev === owner.dev &&
			fs.readFileSync(output, "utf8") === pending
		);
	};
	function publish(value) {
		const temporary = output + "." + crypto.randomUUID() + ".tmp";
		try {
			if (!owns()) throw new Error("Receipt publication ownership changed");
			const fd = fs.openSync(temporary, "wx", 0o600);
			try {
				fs.writeFileSync(fd, JSON.stringify(value) + "\n");
				fs.fsyncSync(fd);
			} finally {
				fs.closeSync(fd);
			}
			if (!owns()) throw new Error("Receipt publication ownership changed");
			fs.renameSync(temporary, output);
		} finally {
			if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
		}
	}
	try {
		await commit();
	} catch (error) {
		publish({
			...result,
			accepted: false,
			acceptanceState: "rejected",
			acceptanceError: error.message,
		});
		throw error;
	}
	// A crash after commit leaves pending evidence, never an accepted file without a commit.
	publish({
		...result,
		acceptanceState: result.accepted
			? "accepted"
			: result.interrupted === true
				? "interrupted"
				: "rejected",
	});
}

export function resolveCheckDescriptor(check, workspace) {
	if (
		!Array.isArray(check?.command) ||
		!check.command.length ||
		check.command.some((arg) => typeof arg !== "string" || !arg)
	) {
		throw new Error("Check command must be explicit argv");
	}
	if (
		typeof check.artifact !== "string" ||
		!check.artifact ||
		path.isAbsolute(check.artifact)
	) {
		throw new Error("Check artifact must be workspace-relative");
	}
	const artifact = path.resolve(workspace, check.artifact);
	const relative = path.relative(workspace, artifact);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
		throw new Error("Check artifact must be an owned workspace file");
	let cursor = path.resolve(workspace);
	if (fs.realpathSync(cursor) !== cursor)
		throw new Error("Symlink in workspace");
	for (const part of relative.split(path.sep)) {
		cursor = path.join(cursor, part);
		try {
			if (fs.lstatSync(cursor).isSymbolicLink())
				throw new Error("Symlink in check artifact path");
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	return { command: [...check.command], artifact };
}

export function nativeWaitState(result, agentId) {
	assert.ok(
		typeof agentId === "string" && agentId.length > 0,
		"Native target is required",
	);
	assert.ok(
		result &&
			typeof result === "object" &&
			result.status &&
			typeof result.status === "object" &&
			!Array.isArray(result.status),
		"Missing native wait status",
	);
	const state = Object.hasOwn(result.status, agentId)
		? result.status[agentId]
		: undefined;
	if (state === undefined) {
		assert.equal(
			result.timed_out,
			true,
			"Target missing without native timeout",
		);
		return "running";
	}
	if (["running", "pending_init"].includes(state)) return "running";
	if (state && typeof state === "object" && Object.hasOwn(state, "completed")) {
		assert.ok(
			state.completed === null || typeof state.completed === "string",
			"Invalid native completion",
		);
		return "completed";
	}
	throw new Error("Native worker did not complete: " + JSON.stringify(state));
}

export function completionState(events, actor) {
	const lifecycle = events.filter(
		(event) =>
			event.type === "event_msg" &&
			["task_started", "task_complete", "turn_aborted"].includes(
				event.payload?.type,
			),
	);
	const start = lifecycle.findLast(
		(event) => event.payload.type === "task_started",
	);
	const last = lifecycle.at(-1);
	const turnComplete = Boolean(
		start?.payload.turn_id &&
			last?.payload.type === "task_complete" &&
			last.payload.turn_id === start.payload.turn_id,
	);
	return {
		turnComplete,
		settled:
			turnComplete &&
			["idle", "completed"].includes(actor?.status) &&
			actor?.activeGoal === false &&
			actor?.pendingContinuation === false,
	};
}
