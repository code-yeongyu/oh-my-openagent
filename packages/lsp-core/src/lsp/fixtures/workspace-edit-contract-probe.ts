import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
	createWorkspaceEditTestHarness,
	diagnostic,
	readEvents,
	renameTextEdit,
	waitForEventCount,
} from "../workspace-apply-edit-test-support.js";
import { workspaceEditContractFailureEvidence } from "../workspace-edit-contract-evidence.js";

class WorkspaceEditContractProbeError extends Error {
	override readonly name = "WorkspaceEditContractProbeError";
}

function requireProbe(condition: boolean, message: string): asserts condition {
	if (!condition) throw new WorkspaceEditContractProbeError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function applyResponses(eventsPath: string): readonly unknown[] {
	return readEvents(eventsPath)
		.filter((event) => event.type === "clientResponse" && event.method === "workspace/applyEdit")
		.map((event) => event.result);
}

function isRejectedApply(value: unknown): boolean {
	return isRecord(value) && value["applied"] === false && typeof value["failureReason"] === "string";
}

function didChangeVersions(eventsPath: string): readonly number[] {
	const versions: number[] = [];
	for (const event of readEvents(eventsPath)) {
		if (event.type !== "clientNotification" || event.method !== "textDocument/didChange") continue;
		if (!isRecord(event.params)) continue;
		const textDocument = event.params["textDocument"];
		if (!isRecord(textDocument) || typeof textDocument["version"] !== "number") continue;
		versions.push(textDocument["version"]);
	}
	return versions;
}

const outputPath = process.argv[2];
if (!outputPath) throw new WorkspaceEditContractProbeError("output path is required");

const harness = createWorkspaceEditTestHarness();
try {
	const success = await harness.makeClient({
		renameSteps: [{ applyEdit: renameTextEdit("before", "after", { version: 1 }), renameResult: "same" }],
		diagnostics: [diagnostic("todo3-fresh")],
	});
	let successWrites = 0;
	success.client.setWorkspaceEditIo({
		writeFile(path, content) {
			successWrites += 1;
			writeFileSync(path, content, "utf-8");
		},
	});
	await success.client.openFile(success.source);
	const successResult = await success.client.rename(success.source, 1, 6, "after");
	const successResponses = applyResponses(success.events);
	const successVersions = didChangeVersions(success.events);
	const successUri = pathToFileURL(realpathSync(success.source)).href;
	const successEvidence = {
		serverAppliedRename:
			successResponses.length === 1 && isRecord(successResponses[0]) && successResponses[0]["applied"] === true,
		recordedResultReused: successResult.edit !== null && successResult.apply.success && successWrites === 1,
		writeCount: successWrites,
		secondWritePrevented: successWrites === 1 && successVersions.length === 1,
		synchronizedDocumentVersion: success.client.getOpenDocumentVersion(success.source) ?? null,
		didChangeVersions: successVersions,
		immediateDiagnostics: success.client
			.getStoredDiagnostics(successUri)
			.some((entry) => entry.message === "todo3-fresh"),
		finalContent: readFileSync(success.source, "utf-8"),
	};
	requireProbe(successEvidence.serverAppliedRename, "successful server apply was not reported truthfully");
	requireProbe(successEvidence.recordedResultReused, "rename did not reuse the recorded server result");
	requireProbe(successEvidence.secondWritePrevented, "server edit was written or synchronized more than once");
	requireProbe(successEvidence.synchronizedDocumentVersion === 2, "open document version did not advance to 2");
	requireProbe(successEvidence.immediateDiagnostics, "fresh diagnostics were not visible immediately after applyEdit");
	requireProbe(successEvidence.finalContent === "const after = 1;\n", "successful rename produced unexpected bytes");

	const unscoped = await harness.makeClient({
		unscopedApplyEdit: renameTextEdit("before", "after", { version: 1 }),
	});
	const unscopedResponses = await waitForEventCount(
		unscoped.events,
		(event) => event.type === "clientResponse" && event.method === "workspace/applyEdit",
		1,
	);
	const unscopedFailure = unscopedResponses[0]?.result;
	requireProbe(isRejectedApply(unscopedFailure), "unscoped applyEdit was not rejected");
	requireProbe(readFileSync(unscoped.source, "utf-8") === "const before = 1;\n", "unscoped failure mutated bytes");

	const concurrent = await harness.makeClient({
		renameSteps: [
			{
				applyEdit: renameTextEdit("before", "after", { version: 1 }),
				applyConcurrently: true,
				renameResult: "same",
			},
		],
	});
	let concurrentWrites = 0;
	concurrent.client.setWorkspaceEditIo({
		writeFile(path, content) {
			concurrentWrites += 1;
			writeFileSync(path, content, "utf-8");
		},
	});
	await concurrent.client.openFile(concurrent.source);
	const concurrentResult = await concurrent.client.rename(concurrent.source, 1, 6, "after");
	const concurrentFailure = applyResponses(concurrent.events).find(isRejectedApply);
	requireProbe(concurrentResult.apply.success, "the winning concurrent applyEdit did not complete");
	requireProbe(concurrentWrites === 1, "concurrent applyEdit wrote more than once");
	requireProbe(isRejectedApply(concurrentFailure), "concurrent applyEdit loser was not rejected");

	const mismatched = await harness.makeClient({
		renameSteps: [{ applyEdit: renameTextEdit("before", "after", { version: 9 }), renameResult: "same" }],
	});
	await mismatched.client.openFile(mismatched.source);
	const mismatchedResult = await mismatched.client.rename(mismatched.source, 1, 6, "after");
	const mismatchedFailure = applyResponses(mismatched.events).find(isRejectedApply);
	requireProbe(!mismatchedResult.apply.success, "mismatched document version unexpectedly succeeded");
	requireProbe(isRejectedApply(mismatchedFailure), "mismatched version was not rejected over applyEdit");
	requireProbe(readFileSync(mismatched.source, "utf-8") === "const before = 1;\n", "version failure mutated bytes");

	const preGate = await harness.makeClient({
		renameSteps: [
			{
				applyEdit: renameTextEdit("before", "after", { version: 1 }),
				applyDelayMs: 100,
				renameResult: "same",
			},
		],
	});
	const controller = new AbortController();
	await preGate.client.openFile(preGate.source);
	const pendingRename = preGate.client.rename(preGate.source, 1, 6, "after", controller.signal);
	await waitForEventCount(
		preGate.events,
		(event) => event.type === "clientRequest" && event.method === "textDocument/rename",
		1,
		);
		controller.abort();
		const preGateError = await pendingRename.then(
			() => null,
			(error: unknown) => error,
		);
		const preGateMessage = preGateError instanceof Error ? preGateError.message : String(preGateError);
		const preGateFailure = {
			success: false,
			filesModified: [],
			totalEdits: 0,
			errors: [preGateMessage],
		};
		requireProbe(preGateError !== null, "pre-gate cancellation unexpectedly succeeded");
		requireProbe(
			preGateFailure.errors.some((message) => /cancel|abort/i.test(message)),
			"pre-gate cancellation returned the wrong failure",
		);
		requireProbe(readFileSync(preGate.source, "utf-8") === "const before = 1;\n", "pre-gate cancellation mutated bytes");

	const failureCases = {
			unscoped: workspaceEditContractFailureEvidence(unscopedFailure, unscoped.workspace),
			concurrent: workspaceEditContractFailureEvidence(concurrentFailure, concurrent.workspace),
			mismatched: workspaceEditContractFailureEvidence(mismatchedFailure, mismatched.workspace),
			preGate: workspaceEditContractFailureEvidence(preGateFailure, preGate.workspace),
		};
	writeFileSync(
		outputPath,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				success: successEvidence,
				failureCases,
				failureHashes: {
					unscoped: failureCases.unscoped.sha256,
					concurrent: failureCases.concurrent.sha256,
					mismatched: failureCases.mismatched.sha256,
					preGate: failureCases.preGate.sha256,
				},
			},
			null,
			2,
		)}\n`,
		"utf-8",
	);
} finally {
	await harness.cleanup();
}
