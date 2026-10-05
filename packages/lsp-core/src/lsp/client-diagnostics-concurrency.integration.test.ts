import { afterEach, describe, expect, it } from "bun:test";

import { ControlledClock } from "./controlled-clock-test-support.js";

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
		// The freshness window runs on a controlled clock: this case asserts that the exact-version
		// didOpen publish satisfies BOTH requests, and the publish is what wakes them. On a real clock
		// the 500ms window is a second, competing deadline against a real fixture server over a real
		// pipe, so a starved Windows shard resolved the requests clean before the publish landed and
		// the case failed with [] (#8323). Frozen, only the publish can settle it.
		const clock = new ControlledClock();
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
			{ diagnosticsFreshnessTimeoutMs: 500, versionlessPublishQuiescenceMs: 5, timerProvider: clock },
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
