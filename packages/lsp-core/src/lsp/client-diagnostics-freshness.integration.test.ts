import { writeFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "bun:test";

import {
	createWorkspaceEditTestHarness,
	diagnostic,
	readEvents,
	waitForEventCount,
} from "./workspace-apply-edit-test-support.js";

const harness = createWorkspaceEditTestHarness();

afterEach(async () => {
	await harness.cleanup();
});

describe("LspClient diagnostics freshness", () => {
	it("#given a versionless publish that arrives after the current change #when no newer eligible publish arrives before quiescence #then diagnostics wait for that quiescence window and return the versionless payload", async () => {
		const context = await harness.makeClient(
			{
				publishDiagnostics: [
					{
						trigger: "didChange",
						diagnostics: [diagnostic("post-generation-versionless")],
						awaitClientDelivery: true,
					},
				],
			},
			{ diagnosticsFreshnessTimeoutMs: 80, versionlessPublishQuiescenceMs: 20 },
		);
		await context.client.openFile(context.source);
		const versionlessDelivery = waitForEventCount(
			context.events,
			(event) => event.type === "clientResponse" && event.method === "workspace/configuration",
			1,
		);
		const startedAt = Date.now();
		writeFileSync(context.source, "const after = 1;\n", "utf-8");
		await context.client.openFile(context.source);
		expect(await versionlessDelivery).toHaveLength(1);

		const result = await context.client.diagnostics(context.source);
		const elapsedMs = Date.now() - startedAt;

		expect(result.items).toEqual([diagnostic("post-generation-versionless")]);
		expect(elapsedMs).toBeGreaterThanOrEqual(15);
	});

	it("#given only a pre-generation versionless publish #when a newer local version asks for diagnostics #then the stale versionless publish is ignored and the request does not resolve clean", async () => {
		const context = await harness.makeClient(
			{
				publishDiagnostics: [
					{
						trigger: "didOpen",
						diagnostics: [diagnostic("pre-generation-versionless")],
					},
				],
			},
			{ diagnosticsFreshnessTimeoutMs: 300, versionlessPublishQuiescenceMs: 5 },
		);
		await context.client.openFile(context.source);
		expect((await context.client.diagnostics(context.source)).items).toEqual([diagnostic("pre-generation-versionless")]);
		writeFileSync(context.source, "const after = 1;\n", "utf-8");
		await context.client.openFile(context.source);

		const result = await context.client.diagnostics(context.source);

		expect(result.items).toEqual([]);
		expect(result.transientError?.kind).toBe("freshness_timeout");
	});

	it("#given stale and future publish versions #when diagnostics target the current version #then neither stale nor future diagnostics satisfy the request", async () => {
		const stale = await harness.makeClient(
			{
				publishDiagnostics: [
					{
						trigger: "didChange",
						version: 1,
						diagnostics: [diagnostic("stale")],
						awaitClientDelivery: true,
					},
				],
			},
			{ diagnosticsFreshnessTimeoutMs: 100, versionlessPublishQuiescenceMs: 5 },
		);
		await stale.client.openFile(stale.source);
		const staleDelivery = waitForEventCount(
			stale.events,
			(event) => event.type === "clientResponse" && event.method === "workspace/configuration",
			1,
		);
		writeFileSync(stale.source, "const stale = 1;\n", "utf-8");
		await stale.client.openFile(stale.source);
		expect(await staleDelivery).toHaveLength(1);

		const staleResult = await stale.client.diagnostics(stale.source);

		expect(staleResult.items).toEqual([]);
		expect(staleResult.transientError?.kind).toBe("freshness_timeout");

		await harness.cleanup();

		const future = await harness.makeClient(
			{
				publishDiagnostics: [
					{
						trigger: "didChange",
						version: 3,
						diagnostics: [diagnostic("future")],
						awaitClientDelivery: true,
					},
				],
			},
			{ diagnosticsFreshnessTimeoutMs: 100, versionlessPublishQuiescenceMs: 5 },
		);
		await future.client.openFile(future.source);
		const futureDelivery = waitForEventCount(
			future.events,
			(event) => event.type === "clientResponse" && event.method === "workspace/configuration",
			1,
		);
		writeFileSync(future.source, "const future = 1;\n", "utf-8");
		await future.client.openFile(future.source);
		expect(await futureDelivery).toHaveLength(1);

		const futureResult = await future.client.diagnostics(future.source);

		expect(futureResult.items).toEqual([]);
		expect(futureResult.transientError?.kind).toBe("freshness_timeout");
	});

	it("#given a pull response overtaken by a later local change #when the stale full report returns first #then diagnostics restart within the same request and resolve from the current version", async () => {
		const context = await harness.makeClient(
			{
				capabilities: { diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } },
				diagnosticResponses: [
					{
						delayMs: 200,
						report: { kind: "full", resultId: "v1", items: [diagnostic("pull-stale")] },
					},
					{
						report: { kind: "full", resultId: "v2", items: [diagnostic("pull-fresh")] },
					},
				],
			},
			{ diagnosticsFreshnessTimeoutMs: 800, versionlessPublishQuiescenceMs: 5 },
		);
		await context.client.openFile(context.source);

		const pending = context.client.diagnostics(context.source);
		await waitForEventCount(
			context.events,
			(event) => event.type === "clientRequest" && event.method === "textDocument/diagnostic",
			1,
		);
		writeFileSync(context.source, "const pull_fresh = 1;\n", "utf-8");
		await context.client.openFile(context.source);

		const result = await pending;

		expect(result.items).toEqual([diagnostic("pull-fresh")]);
		expect(
			readEvents(context.events).filter(
				(event) => event.type === "clientRequest" && event.method === "textDocument/diagnostic",
			),
		).toHaveLength(2);
	});

	it("#given a full pull report followed by an unchanged report for the same version and resultId #when diagnostics repeat without a local change #then the cached full items are reused", async () => {
		const context = await harness.makeClient(
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
			{ diagnosticsFreshnessTimeoutMs: 500, versionlessPublishQuiescenceMs: 5 },
		);
		await context.client.openFile(context.source);

		const first = await context.client.diagnostics(context.source);
		const second = await context.client.diagnostics(context.source);

		expect(first.items).toEqual([diagnostic("cached-full")]);
		expect(second.items).toEqual([diagnostic("cached-full")]);
	});

	it("#given a server that claims pull support but closes instead of answering #when diagnostics run #then the transport failure is not labeled clean", async () => {
		const context = await harness.makeClient(
			{
				capabilities: { diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } },
				diagnosticResponses: [{ action: "close" }],
			},
			{ diagnosticsFreshnessTimeoutMs: 500, versionlessPublishQuiescenceMs: 5 },
		);
		await context.client.openFile(context.source);

		await expect(context.client.diagnostics(context.source)).rejects.toThrow(/exited|closed/i);
	});

	it("#given an advertised pull method that is explicitly unsupported and a matching push publish #when diagnostics run #then the client falls back to push diagnostics", async () => {
		const context = await harness.makeClient(
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
			{ diagnosticsFreshnessTimeoutMs: 500, versionlessPublishQuiescenceMs: 5 },
		);

		const result = await context.client.diagnostics(context.source);

		expect(result.items).toEqual([diagnostic("push-fallback")]);
	});

	it("#given a diagnostic pull request times out #when the fake server keeps it pending #then the client sends cancel for the LSP request id", async () => {
		const context = await harness.makeClient(
			{
				capabilities: { diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } },
				diagnosticResponses: [{ action: "hang" }],
			},
			{ requestTimeoutMs: 30, diagnosticsFreshnessTimeoutMs: 50, versionlessPublishQuiescenceMs: 5 },
		);

		const result = await context.client.diagnostics(context.source);
		const [cancel] = await waitForEventCount(
			context.events,
			(event) => event.type === "clientNotification" && event.method === "$/cancelRequest",
			1,
		);
		const events = readEvents(context.events);
		const request = events.find((event) => event.type === "clientRequest" && event.method === "textDocument/diagnostic");

		expect(result.transientError?.kind).toBe("freshness_timeout");
		expect(cancel?.params).toEqual({ id: request?.id });
	});

	it("#given a server without pull support that never publishes diagnostics #when diagnostics run on a clean file #then the request resolves clean after the freshness window instead of reporting a timeout", async () => {
		const context = await harness.makeClient(
			{},
			{ diagnosticsFreshnessTimeoutMs: 60, versionlessPublishQuiescenceMs: 5 },
		);

		const startedAt = Date.now();
		const result = await context.client.diagnostics(context.source);
		const elapsedMs = Date.now() - startedAt;

		expect(result.transientError).toBeUndefined();
		expect(result.items).toEqual([]);
		// The full freshness window is still honored so a slow publisher can win.
		expect(elapsedMs).toBeGreaterThanOrEqual(45);
	});

	it("#given a pull-supported server that cached diagnostics for an older document version #when the file changes and a later pull is rejected as unsupported without any publish #then the fallback resolves empty instead of returning the stale cached diagnostics", async () => {
		const context = await harness.makeClient(
			{
				capabilities: { diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } },
				diagnosticResponses: [
					{ report: { kind: "full", resultId: "v1", items: [diagnostic("stale-pull")] } },
					{ error: { code: -32601, message: "Method not found" } },
				],
			},
			{ diagnosticsFreshnessTimeoutMs: 500, versionlessPublishQuiescenceMs: 5 },
		);

		const first = await context.client.diagnostics(context.source);
		expect(first.items).toEqual([diagnostic("stale-pull")]);

		writeFileSync(context.source, "const changed = 1;\n");
		await context.client.openFile(context.source);

		const second = await context.client.diagnostics(context.source);
		expect(second.transientError).toBeUndefined();
		expect(second.items).toEqual([]);
	});

	it("#given a pull-supported server with a current cached pull report #when a later pull is rejected as unsupported without any publish and the document is unchanged #then the fallback resolves with the current cached diagnostics", async () => {
		const context = await harness.makeClient(
			{
				capabilities: { diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } },
				diagnosticResponses: [
					{ report: { kind: "full", resultId: "v1", items: [diagnostic("cached-full")] } },
					{ error: { code: -32601, message: "Method not found" } },
				],
			},
			{ diagnosticsFreshnessTimeoutMs: 500, versionlessPublishQuiescenceMs: 5 },
		);

		const first = await context.client.diagnostics(context.source);
		expect(first.items).toEqual([diagnostic("cached-full")]);

		const second = await context.client.diagnostics(context.source);
		expect(second.transientError).toBeUndefined();
		expect(second.items).toEqual([diagnostic("cached-full")]);
	});

});
