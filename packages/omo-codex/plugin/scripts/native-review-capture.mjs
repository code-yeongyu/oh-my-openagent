import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import { isCliEntry } from "./entry-guard.mjs";
import {
	nativeReviewEvidence,
	nativeToolOutputEvidence,
	verifyNativeReviewEvidence,
} from "./parent-evidence.mjs";

if (isCliEntry(import.meta.url)) {
	const [mode, transcript, actor, turn, phaseOrCall, proofFile] =
		process.argv.slice(2);
	assert.ok(
		["capture", "verify", "tool-output"].includes(mode),
		"Use capture|verify TRANSCRIPT ACTOR TURN PHASE [PROOF], or tool-output TRANSCRIPT ACTOR TURN CALL_ID",
	);
	assert.ok(
		transcript && actor && turn && phaseOrCall,
		"Explicit transcript, actor, turn and phase/call required",
	);
	assert.equal(
		process.argv.length,
		mode === "verify" ? 8 : 7,
		"Unexpected CLI arguments",
	);
	const bytes = fs.readFileSync(transcript),
		text = bytes.toString("utf8");
	assert.ok(
		bytes.at(-1) === 10 && Buffer.from(text).equals(bytes),
		"Native transcript must be complete UTF-8 JSONL",
	);
	const lines = text.slice(0, -1).split("\n");
	const proof =
		mode === "tool-output"
			? nativeToolOutputEvidence(lines, actor, turn, phaseOrCall)
			: mode === "verify"
				? verifyNativeReviewEvidence(
						lines,
						JSON.parse(fs.readFileSync(proofFile)),
						actor,
						turn,
						phaseOrCall,
					)
				: nativeReviewEvidence(lines, actor, turn, phaseOrCall);
	assert.ok(proof, "Missing native review evidence");
	console.log(JSON.stringify(proof));
}
