import { afterEach, describe, expect, it } from "bun:test";

import {
	createWorkspaceEditTestHarness,
	diagnostic,
	readEvents,
} from "./workspace-apply-edit-test-support.js";

const harness = createWorkspaceEditTestHarness();

afterEach(async () => {
	await harness.cleanup();
});

describe("LspClient diagnostics concurrency", () => {
	it("#given concurrent diagnostics on a cold file and an exact didOpen publish #when pull is not advertised #then one didOpen opens the file and both requests receive the current diagnostics", async () => {
		const context = await harness.makeClient(
			{
				publishDiagnostics: [
					{
						trigger: "didOpen",
						version: 1,
						diagnostics: [diagnostic("exact-current")],
						awaitClientDelivery: true,
					},
				],
			},
			{ diagnosticsFreshnessTimeoutMs: 500, versionlessPublishQuiescenceMs: 5 },
		);

		const [first, second] = await Promise.all([
			context.client.diagnostics(context.source),
			context.client.diagnostics(context.source),
		]);

		expect(first.items).toEqual([diagnostic("exact-current")]);
		expect(second.items).toEqual([diagnostic("exact-current")]);
		expect(
			readEvents(context.events).filter(
				(event) => event.type === "clientNotification" && event.method === "textDocument/didOpen",
			),
		).toHaveLength(1);
	});
});
