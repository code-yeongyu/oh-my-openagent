import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as evidence from "../scripts/parent-evidence.mjs";

// Synthetic protocol inputs only; these are never native admission or acceptance.
const actor = "worker",
	turn = "turn",
	callId = "read-call";
const metadata = () => ({ turn_id: turn });
const event = (type, extra = {}) => ({
	type: "event_msg",
	payload: { type, ...extra },
});
const response = (payload) => ({ type: "response_item", payload });
const message = (phase, text) =>
	response({
		type: "message",
		role: "assistant",
		status: "completed",
		phase,
		internal_chat_message_metadata_passthrough: metadata(),
		content: [{ type: "output_text", text }],
	});
function fixture(kind = "custom_tool_call") {
	const final =
		JSON.stringify({
			status: "GAPS FOUND",
			findings: ["D1 conflicts with D2"],
			gaps: [],
		}) + "\n";
	return [
		{ type: "session_meta", payload: { id: actor } },
		event("task_started", { turn_id: turn }),
		{ type: "turn_context", payload: { turn_id: turn } },
		message("commentary", "Required bootstrap"),
		message("commentary", '{"status":"READING","findings":[],"gaps":[]}\n'),
		response({
			type: kind,
			call_id: callId,
			name: "exec",
			input: "read fixture.txt",
			internal_chat_message_metadata_passthrough: metadata(),
		}),
		response({
			type:
				kind === "function_call"
					? "function_call_output"
					: "custom_tool_call_output",
			call_id: callId,
			output:
				kind === "function_call"
					? "opaque-marker\n"
					: [{ type: "input_text", text: "opaque-marker\n" }],
			internal_chat_message_metadata_passthrough: metadata(),
		}),
		event("token_count", { info: {} }),
		message("final_answer", final),
		event("task_complete", { turn_id: turn, last_agent_message: final }),
	];
}
const lines = (events) => events.map((value) => JSON.stringify(value));
const capture = (events, phase = "commentary") =>
	evidence.nativeReviewEvidence(lines(events), actor, turn, phase);

test("#given bootstrap and structured native commentary #when captured #then exact first-valid bytes and hashes survive", () => {
	const events = fixture(),
		raw = lines(events),
		proof = capture(events);
	assert.equal(proof.nativeText, events[4].payload.content[0].text);
	assert.equal(
		Buffer.from(proof.nativeEventBase64, "base64").toString(),
		raw[4],
	);
	assert.equal(
		proof.eventSha256,
		crypto.createHash("sha256").update(raw[4]).digest("hex"),
	);
	evidence.verifyNativeReviewEvidence(raw, proof, actor, turn, "commentary");
	assert.throws(() =>
		evidence.verifyNativeReviewEvidence(
			raw,
			{ ...proof, nativeText: "changed" },
			actor,
			turn,
			"commentary",
		),
	);
});
test("#given native actor and turn provenance #when mismatched #then another worker or turn cannot supply proof", () => {
	const events = fixture();
	assert.throws(() =>
		evidence.nativeReviewEvidence(lines(events), "other", turn),
	);
	assert.equal(
		evidence.nativeReviewEvidence(lines(events), actor, "other"),
		null,
	);
	events[4].payload.internal_chat_message_metadata_passthrough.turn_id =
		"other";
	assert.equal(capture(events), null);
});
test("#given inclusive early budgets #when the event crosses either boundary #then commentary fails closed", () => {
	const before = (responses, tools) => {
		const events = fixture(),
			prefix = [
				...Array.from({ length: responses }, () =>
					event("token_count", { info: {} }),
				),
				...Array.from({ length: tools }, () =>
					response({ type: "custom_tool_call" }),
				),
			];
		events.splice(4, 0, ...prefix);
		return events;
	};
	const proof = capture(before(8, 10));
	assert.equal(proof.responsesAtEvent, 8);
	assert.equal(proof.toolsAtEvent, 10);
	assert.equal(capture(before(9, 10)), null);
	assert.equal(capture(before(8, 11)), null);
});
test("#given malformed structured text or mandatory suffix #when captured #then it is not silently repaired or stripped", () => {
	for (const text of [
		'{"status":"","findings":[],"gaps":[]}',
		'{"status":"OK","findings":{},"gaps":[]}',
		'{"status":"OK","findings":[],"gaps":[]}\n<oai-mem-citation>required</oai-mem-citation>',
	]) {
		const events = fixture();
		events[4].payload.content[0].text = text;
		assert.equal(capture(events), null);
	}
});
test("#given a native final #when latest terminal text or lifecycle differs #then earlier completion is rejected", () => {
	assert.ok(capture(fixture(), "final_answer"));
	for (const mutate of [
		(e) => {
			e.at(-1).payload.last_agent_message += "changed";
		},
		(e) => e.push(event("turn_aborted", { turn_id: turn })),
		(e) => e.push(event("task_started", { turn_id: "next" })),
		(e) =>
			e.splice(
				-1,
				0,
				message("commentary", '{"status":"LATER","findings":[],"gaps":[]}'),
			),
	]) {
		const events = fixture();
		mutate(events);
		assert.equal(capture(events, "final_answer"), null);
	}
});
test("#given an aborted current turn #when a late final completes #then final proof stays rejected", () => {
	for (const index of [8, 9]) {
		const events = fixture();
		events.splice(index, 0, event("turn_aborted", { turn_id: turn }));
		assert.equal(capture(events, "final_answer"), null);
	}
});
test("#given an older aborted turn #when a new turn completes #then its final proof remains valid", () => {
	const events = fixture();
	events.splice(
		1,
		0,
		event("task_started", { turn_id: "older" }),
		event("turn_aborted", { turn_id: "older" }),
	);
	assert.ok(capture(events, "final_answer"));
});
for (const kind of ["function_call", "custom_tool_call"]) {
	test(`#given ${kind} native read #when matched by call ID and turn #then its corresponding output is preserved`, () => {
		const events = fixture(kind),
			proof = evidence.nativeToolOutputEvidence(
				lines(events),
				actor,
				turn,
				callId,
			);
		assert.deepEqual(proof.output, events[6].payload.output);
		assert.equal(
			Buffer.from(proof.outputEventBase64, "base64").toString(),
			lines(events)[6],
		);
	});
}
test("#given native tool pairs #when family, identity or multiplicity changes #then no result is borrowed", () => {
	for (const mutate of [
		(e) => {
			e[6].payload.type = "function_call_output";
		},
		(e) => {
			e[6].payload.call_id = "other";
		},
		(e) => {
			e[5].payload.internal_chat_message_metadata_passthrough.turn_id = "other";
		},
		(e) => {
			e[6].payload.internal_chat_message_metadata_passthrough.turn_id = "other";
		},
		(e) => {
			delete e[6].payload.output;
		},
		(e) => e.splice(6, 1),
		(e) => e.splice(7, 0, structuredClone(e[6])),
	]) {
		const events = fixture();
		mutate(events);
		assert.throws(() =>
			evidence.nativeToolOutputEvidence(lines(events), actor, turn, callId),
		);
	}
});

function cliFixture(t) {
	const root = fs.realpathSync(
		fs.mkdtempSync(path.join(os.tmpdir(), "native-review-")),
	);
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	for (const name of [
		"native-review-capture.mjs",
		"native-review-evidence.mjs",
		"parent-evidence.mjs",
		"entry-guard.mjs",
	])
		fs.copyFileSync(
			new URL("../scripts/" + name, import.meta.url),
			path.join(root, name),
		);
	const file = path.join(root, "native.jsonl");
	fs.writeFileSync(file, lines(fixture()).join("\n") + "\n");
	return {
		root,
		file,
		run: (...args) =>
			spawnSync(
				process.execPath,
				[path.join(root, "native-review-capture.mjs"), ...args],
				{ encoding: "utf8", timeout: 10000 },
			),
	};
}
test("#given the normal CLI #when capture and independent verification run #then stdout proof and original files remain separate", (t) => {
	const f = cliFixture(t),
		before = fs.readFileSync(f.file),
		captured = f.run("capture", f.file, actor, turn, "final_answer");
	assert.equal(captured.status, 0, captured.stderr);
	const proof = path.join(f.root, "proof.json");
	fs.writeFileSync(proof, captured.stdout);
	const descriptorFile = path.join(f.root, "check.json");
	fs.writeFileSync(
		descriptorFile,
		JSON.stringify({
			command: [
				process.execPath,
				path.join(f.root, "native-review-capture.mjs"),
				"verify",
				f.file,
				actor,
				turn,
				"final_answer",
				proof,
			],
			artifact: "check-result.json",
		}),
	);
	const descriptorBefore = fs.readFileSync(descriptorFile);
	const descriptor = evidence.resolveCheckDescriptor(
		JSON.parse(descriptorBefore),
		f.root,
	);
	const verified = spawnSync(
		descriptor.command[0],
		descriptor.command.slice(1),
		{ encoding: "utf8", timeout: 10000 },
	);
	assert.equal(verified.status, 0, verified.stderr);
	fs.writeFileSync(descriptor.artifact, verified.stdout);
	assert.deepEqual(fs.readFileSync(descriptorFile), descriptorBefore);
	assert.deepEqual(JSON.parse(verified.stdout), JSON.parse(captured.stdout));
	assert.deepEqual(fs.readFileSync(f.file), before);
	const output = f.run("tool-output", f.file, actor, turn, callId);
	assert.equal(output.status, 0, output.stderr);
	assert.deepEqual(JSON.parse(output.stdout).output, [
		{ type: "input_text", text: "opaque-marker\n" },
	]);
});
test("#given an invalid CLI request or native file #when executed #then exit is nonzero without false proof", (t) => {
	const f = cliFixture(t);
	for (const args of [
		[],
		["capture", f.file, "other", turn, "final_answer"],
		["capture", f.file, actor, turn, "wrong-phase"],
	]) {
		const r = f.run(...args);
		assert.notEqual(r.status, 0);
		assert.equal(r.stdout, "");
	}
	fs.appendFileSync(f.file, "partial");
	assert.notEqual(
		f.run("capture", f.file, actor, turn, "final_answer").status,
		0,
	);
	fs.writeFileSync(f.file, Buffer.from([255, 10]));
	assert.notEqual(
		f.run("capture", f.file, actor, turn, "final_answer").status,
		0,
	);
});
test("#given module import without the process global #when importing the pure parent API #then no CLI code runs", () => {
	const module = new URL("../scripts/parent-evidence.mjs", import.meta.url)
		.href;
	const r = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`delete globalThis.process; const api=await import(${JSON.stringify(module)}); if(typeof api.nativeReviewEvidence!=="function")throw Error("missing native review API"); console.log("imported");`,
		],
		{ encoding: "utf8", timeout: 10000 },
	);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trim(), "imported");
});
test("#given the CLI module as an import #when loaded by another program #then no transcript or arguments are consumed", () => {
	const url = new URL("../scripts/native-review-capture.mjs", import.meta.url)
		.href;
	const r = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`await import(${JSON.stringify(url)});console.log("imported");`,
		],
		{ encoding: "utf8", timeout: 10000 },
	);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trim(), "imported");
});
