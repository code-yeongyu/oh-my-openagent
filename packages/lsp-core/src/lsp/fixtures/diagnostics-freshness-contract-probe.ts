import { writeFileSync } from "node:fs";

import {
	createWorkspaceEditTestHarness,
	diagnostic,
	readEvents,
	waitForEventCount,
} from "../workspace-apply-edit-test-support.js";

class DiagnosticsFreshnessContractProbeError extends Error {
	override readonly name = "DiagnosticsFreshnessContractProbeError";
}

function requireProbe(condition: boolean, message: string): asserts condition {
	if (!condition) throw new DiagnosticsFreshnessContractProbeError(message);
}

const outputPath = process.argv[2];
if (!outputPath) throw new DiagnosticsFreshnessContractProbeError("output path is required");

const harness = createWorkspaceEditTestHarness();

try {
	const exactCurrent = await harness.makeClient(
		{
			publishDiagnostics: [
				{
					trigger: "didOpen",
					version: 1,
					diagnostics: [diagnostic("exact-current")],
				},
			],
		},
		{ diagnosticsFreshnessTimeoutMs: 50, versionlessPublishQuiescenceMs: 5 },
	);
	const [exactFirst, exactSecond] = await Promise.all([
		exactCurrent.client.diagnostics(exactCurrent.source),
		exactCurrent.client.diagnostics(exactCurrent.source),
	]);
	const exactDidOpenCount = readEvents(exactCurrent.events).filter(
		(event) => event.type === "clientNotification" && event.method === "textDocument/didOpen",
	).length;
	const exactCurrentEvidence = {
		outcome: "exact-current",
		items: exactFirst.items.map((entry) => entry.message),
		concurrentItems: exactSecond.items.map((entry) => entry.message),
		didOpenCount: exactDidOpenCount,
		ok:
			exactDidOpenCount === 1
			&& JSON.stringify(exactFirst.items) === JSON.stringify([diagnostic("exact-current")])
			&& JSON.stringify(exactSecond.items) === JSON.stringify([diagnostic("exact-current")]),
	};
	requireProbe(exactCurrentEvidence.ok, "exact-current diagnostics did not resolve immediately with a single didOpen");

	const postGenerationVersionless = await harness.makeClient(
		{
			publishDiagnostics: [
				{
					trigger: "didChange",
					diagnostics: [diagnostic("post-generation-versionless")],
				},
			],
		},
		{ diagnosticsFreshnessTimeoutMs: 80, versionlessPublishQuiescenceMs: 20 },
	);
	await postGenerationVersionless.client.openFile(postGenerationVersionless.source);
	await waitForEventCount(
		postGenerationVersionless.events,
		(event) => event.type === "serverNotification" && event.method === "textDocument/publishDiagnostics",
		1,
	);
	writeFileSync(postGenerationVersionless.source, "const post_generation = 1;\n", "utf-8");
	await postGenerationVersionless.client.openFile(postGenerationVersionless.source);
	const versionlessStartedAt = Date.now();
	const versionlessResult = await postGenerationVersionless.client.diagnostics(postGenerationVersionless.source);
	const versionlessElapsedMs = Date.now() - versionlessStartedAt;
	const postGenerationVersionlessEvidence = {
		outcome: "post-generation-versionless",
		items: versionlessResult.items.map((entry) => entry.message),
		elapsedMs: versionlessElapsedMs,
		ok:
			JSON.stringify(versionlessResult.items) === JSON.stringify([diagnostic("post-generation-versionless")])
			&& versionlessElapsedMs >= 15,
	};
	requireProbe(
		postGenerationVersionlessEvidence.ok,
		"post-generation versionless diagnostics did not wait for quiescence before resolving",
	);

	const stale = await harness.makeClient(
		{
			publishDiagnostics: [
				{
					trigger: "didChange",
					version: 1,
					diagnostics: [diagnostic("stale")],
				},
			],
		},
		{ diagnosticsFreshnessTimeoutMs: 30, versionlessPublishQuiescenceMs: 5 },
	);
	await stale.client.openFile(stale.source);
	writeFileSync(stale.source, "const stale = 1;\n", "utf-8");
	await stale.client.openFile(stale.source);
	const staleResult = await stale.client.diagnostics(stale.source);
	const staleEvidence = {
		outcome: "stale",
		items: staleResult.items.map((entry) => entry.message),
		transientError: staleResult.transientError ?? null,
		ok: staleResult.items.length === 0 && staleResult.transientError?.kind === "freshness_timeout",
	};
	requireProbe(staleEvidence.ok, "stale diagnostics unexpectedly satisfied the current request");

	const future = await harness.makeClient(
		{
			publishDiagnostics: [
				{
					trigger: "didChange",
					version: 3,
					diagnostics: [diagnostic("future")],
				},
			],
		},
		{ diagnosticsFreshnessTimeoutMs: 30, versionlessPublishQuiescenceMs: 5 },
	);
	await future.client.openFile(future.source);
	writeFileSync(future.source, "const future = 1;\n", "utf-8");
	await future.client.openFile(future.source);
	const futureResult = await future.client.diagnostics(future.source);
	const futureEvidence = {
		outcome: "future",
		items: futureResult.items.map((entry) => entry.message),
		transientError: futureResult.transientError ?? null,
		ok: futureResult.items.length === 0 && futureResult.transientError?.kind === "freshness_timeout",
	};
	requireProbe(futureEvidence.ok, "future diagnostics unexpectedly satisfied the current request");

	const pullOvertaken = await harness.makeClient(
		{
			capabilities: { diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } },
			diagnosticResponses: [
				{
					delayMs: 20,
					report: { kind: "full", resultId: "v1", items: [diagnostic("pull-stale")] },
				},
				{
					report: { kind: "full", resultId: "v2", items: [diagnostic("pull-fresh")] },
				},
			],
		},
		{ diagnosticsFreshnessTimeoutMs: 80, versionlessPublishQuiescenceMs: 5 },
	);
	await pullOvertaken.client.openFile(pullOvertaken.source);
	const pendingPull = pullOvertaken.client.diagnostics(pullOvertaken.source);
	await waitForEventCount(
		pullOvertaken.events,
		(event) => event.type === "clientRequest" && event.method === "textDocument/diagnostic",
		1,
	);
	writeFileSync(pullOvertaken.source, "const pull_fresh = 1;\n", "utf-8");
	await pullOvertaken.client.openFile(pullOvertaken.source);
	const pullOvertakenResult = await pendingPull;
	const pullRequestCount = readEvents(pullOvertaken.events).filter(
		(event) => event.type === "clientRequest" && event.method === "textDocument/diagnostic",
	).length;
	const pullOvertakenEvidence = {
		outcome: "pull-overtaken",
		items: pullOvertakenResult.items.map((entry) => entry.message),
		requestCount: pullRequestCount,
		ok:
			JSON.stringify(pullOvertakenResult.items) === JSON.stringify([diagnostic("pull-fresh")])
			&& pullRequestCount === 2,
	};
	requireProbe(
		pullOvertakenEvidence.ok,
		"pull diagnostics were not invalidated and retried after a local change overtook the in-flight request",
	);

	const silent = await harness.makeClient({}, { diagnosticsFreshnessTimeoutMs: 35, versionlessPublishQuiescenceMs: 5 });
	const silentResult = await silent.client.diagnostics(silent.source);
	const silentEvidence = {
		outcome: "silent",
		items: silentResult.items.map((entry) => entry.message),
		transientError: silentResult.transientError ?? null,
		ok: silentResult.items.length === 0 && silentResult.transientError?.kind === "freshness_timeout",
	};
	requireProbe(silentEvidence.ok, "silent diagnostics were labeled clean instead of timing out transiently");

	const closedServer = await harness.makeClient(
		{
			capabilities: { diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } },
			diagnosticResponses: [{ action: "close" }],
		},
		{ diagnosticsFreshnessTimeoutMs: 50, versionlessPublishQuiescenceMs: 5 },
	);
	await closedServer.client.openFile(closedServer.source);
	let closedServerError = "";
	try {
		await closedServer.client.diagnostics(closedServer.source);
	} catch (error) {
		closedServerError = error instanceof Error ? error.message : String(error);
	}
	const closedServerEvidence = {
		outcome: "closed-server",
		error: closedServerError,
		ok: /exited|closed/i.test(closedServerError),
	};
	requireProbe(closedServerEvidence.ok, "closed-server diagnostics failure was not surfaced as a transport error");

	const unsupportedPull = await harness.makeClient(
		{
			capabilities: { diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } },
			publishDiagnostics: [
				{
					trigger: "didOpen",
					version: 1,
					diagnostics: [diagnostic("push-fallback")],
				},
			],
			diagnosticResponses: [{ error: { code: -32601, message: "Method not found" } }],
		},
		{ diagnosticsFreshnessTimeoutMs: 50, versionlessPublishQuiescenceMs: 5 },
	);
	const unsupportedPullResult = await unsupportedPull.client.diagnostics(unsupportedPull.source);
	const unsupportedPullEvidence = {
		outcome: "unsupported-pull",
		items: unsupportedPullResult.items.map((entry) => entry.message),
		ok: JSON.stringify(unsupportedPullResult.items) === JSON.stringify([diagnostic("push-fallback")]),
	};
	requireProbe(unsupportedPullEvidence.ok, "explicitly unsupported pull did not fall back to push diagnostics");

	const unchanged = await harness.makeClient(
		{
			capabilities: { diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } },
			diagnosticResponses: [
				{
					report: { kind: "full", resultId: "same-version", items: [diagnostic("cached-full")] },
				},
				{
					report: { kind: "unchanged", resultId: "same-version" },
				},
			],
		},
		{ diagnosticsFreshnessTimeoutMs: 50, versionlessPublishQuiescenceMs: 5 },
	);
	await unchanged.client.openFile(unchanged.source);
	const unchangedFirst = await unchanged.client.diagnostics(unchanged.source);
	const unchangedSecond = await unchanged.client.diagnostics(unchanged.source);
	const unchangedEvidence = {
		outcome: "same-version-unchanged",
		firstItems: unchangedFirst.items.map((entry) => entry.message),
		secondItems: unchangedSecond.items.map((entry) => entry.message),
		ok:
			JSON.stringify(unchangedFirst.items) === JSON.stringify([diagnostic("cached-full")])
			&& JSON.stringify(unchangedSecond.items) === JSON.stringify([diagnostic("cached-full")]),
	};
	requireProbe(unchangedEvidence.ok, "unchanged pull did not reuse the cached same-version result");

	writeFileSync(
		outputPath,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				outcomes: {
					exactCurrent: exactCurrentEvidence,
					postGenerationVersionless: postGenerationVersionlessEvidence,
					stale: staleEvidence,
					future: futureEvidence,
					pullOvertaken: pullOvertakenEvidence,
					silent: silentEvidence,
					closedServer: closedServerEvidence,
					unsupportedPull: unsupportedPullEvidence,
					sameVersionUnchanged: unchangedEvidence,
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
