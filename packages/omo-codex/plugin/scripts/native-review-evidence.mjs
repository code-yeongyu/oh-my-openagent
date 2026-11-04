import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";

const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const metadataTurn = (payload) =>
	payload.internal_chat_message_metadata_passthrough?.turn_id;

function nativeTurn(lines, agentId, turnId) {
	assert.ok(
		typeof agentId === "string" &&
			agentId &&
			typeof turnId === "string" &&
			turnId,
		"Native actor and turn required",
	);
	const events = lines.map((line) => JSON.parse(line));
	const sessions = events.filter((event) => event.type === "session_meta");
	assert.ok(
		sessions.length === 1 && sessions[0].payload.id === agentId,
		"Native review actor mismatch",
	);
	const start = events.findLastIndex(
		(event) =>
			event.type === "event_msg" && event.payload.type === "task_started",
	);
	const context = events
		.slice(start)
		.findLast((event) => event.type === "turn_context")?.payload;
	return {
		events,
		start,
		current:
			start >= 0 &&
			events[start].payload.turn_id === turnId &&
			context?.turn_id === turnId,
	};
}

export function nativeReviewEvidence(
	lines,
	agentId,
	turnId,
	phase = "commentary",
) {
	assert.ok(
		["commentary", "final_answer"].includes(phase),
		"Invalid review phase",
	);
	const { events, start, current } = nativeTurn(lines, agentId, turnId);
	if (!current) return null;
	let responses = 0,
		tools = 0,
		proof = null;
	for (const [index, event] of events.entries()) {
		const payload = event.payload;
		if (
			event.type === "event_msg" &&
			payload.type === "token_count" &&
			payload.info
		)
			responses++;
		if (
			event.type === "response_item" &&
			["function_call", "custom_tool_call"].includes(payload.type)
		)
			tools++;
		if (
			index <= start ||
			event.type !== "response_item" ||
			payload.type !== "message" ||
			payload.role !== "assistant" ||
			payload.phase !== phase ||
			payload.status !== "completed" ||
			metadataTurn(payload) !== turnId
		)
			continue;
		const text = (payload.content ?? [])
			.filter((part) => part.type === "output_text")
			.map((part) => part.text)
			.join("");
		let report;
		try {
			report = JSON.parse(text);
		} catch (error) {
			if (error instanceof SyntaxError) continue;
			throw error;
		}
		if (
			!report ||
			typeof report.status !== "string" ||
			!report.status.trim() ||
			!Array.isArray(report.findings) ||
			!Array.isArray(report.gaps)
		)
			continue;
		if (phase === "commentary" && (responses > 8 || tools > 10)) continue;
		proof = {
			agentId,
			turnId,
			phase,
			eventIndex: index,
			nativeEventBase64: Buffer.from(lines[index]).toString("base64"),
			eventSha256: hash(lines[index]),
			nativeText: text,
			nativeTextSha256: hash(text),
			responsesAtEvent: responses,
			toolsAtEvent: tools,
		};
		if (phase === "commentary") return proof;
	}
	if (phase === "final_answer" && proof) {
		const terminal = events.findLast(
			(event) =>
				event.type === "event_msg" &&
				["task_started", "task_complete", "turn_aborted"].includes(
					event.payload.type,
				),
		);
		const lastAssistant = events.findLastIndex(
			(event) =>
				event.type === "response_item" &&
				event.payload.type === "message" &&
				event.payload.role === "assistant",
		);
		if (
			terminal?.payload.type !== "task_complete" ||
			terminal.payload.turn_id !== turnId ||
			terminal.payload.last_agent_message !== proof.nativeText ||
			lastAssistant !== proof.eventIndex ||
			events.indexOf(terminal) <= proof.eventIndex
		)
			return null;
	}
	return proof;
}

export function verifyNativeReviewEvidence(
	lines,
	proof,
	agentId,
	turnId,
	phase,
) {
	const observed = nativeReviewEvidence(lines, agentId, turnId, phase);
	assert.ok(observed, "Missing native review evidence");
	assert.deepEqual(proof, observed, "Native review capture changed");
	return observed;
}

export function nativeToolOutputEvidence(lines, agentId, turnId, callId) {
	assert.ok(typeof callId === "string" && callId, "Native call ID required");
	const { events, start, current } = nativeTurn(lines, agentId, turnId);
	assert.ok(current, "Native tool turn mismatch");
	const calls = events.flatMap((event, index) =>
		index > start &&
		event.type === "response_item" &&
		["function_call", "custom_tool_call"].includes(event.payload.type) &&
		event.payload.call_id === callId
			? [index]
			: [],
	);
	assert.equal(calls.length, 1, "Expected one native call");
	const callIndex = calls[0],
		call = events[callIndex].payload;
	assert.equal(metadataTurn(call), turnId, "Native call turn mismatch");
	const family =
		call.type === "custom_tool_call"
			? "custom_tool_call_output"
			: "function_call_output";
	const outputs = events.flatMap((event, index) =>
		index > callIndex &&
		event.type === "response_item" &&
		["function_call_output", "custom_tool_call_output"].includes(
			event.payload.type,
		) &&
		event.payload.call_id === callId
			? [index]
			: [],
	);
	assert.equal(outputs.length, 1, "Expected one native output");
	const outputIndex = outputs[0],
		output = events[outputIndex].payload;
	assert.equal(output.type, family, "Native output family mismatch");
	assert.equal(metadataTurn(output), turnId, "Native output turn mismatch");
	assert.ok(Object.hasOwn(output, "output"), "Missing native output content");
	return {
		agentId,
		turnId,
		callId,
		callEventIndex: callIndex,
		outputEventIndex: outputIndex,
		callEventBase64: Buffer.from(lines[callIndex]).toString("base64"),
		outputEventBase64: Buffer.from(lines[outputIndex]).toString("base64"),
		callSha256: hash(lines[callIndex]),
		outputSha256: hash(lines[outputIndex]),
		output: output.output,
	};
}
