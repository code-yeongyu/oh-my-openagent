import { readFileSync, writeFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "bun:test";

import {
	createWorkspaceEditTestHarness,
	readEvents,
	renameTextEdit,
	waitForEventCount,
} from "./workspace-apply-edit-test-support.js";

const harness = createWorkspaceEditTestHarness();

afterEach(async () => {
	await harness.cleanup();
});

describe("LspClient workspace mutation lease", () => {
	it("#given no mutating request #when the server calls applyEdit #then the request is rejected as unscoped", async () => {
		const context = await harness.makeClient({ unscopedApplyEdit: renameTextEdit("before", "after", { version: 1 }) });

		const responses = await waitForEventCount(
			context.events,
			(event) => event.type === "clientResponse" && event.method === "workspace/applyEdit",
			1,
		);

		expect(responses[0]?.result).toEqual({
			applied: false,
			failureReason: expect.stringContaining("active workspace mutation"),
		});
		expect(readFileSync(context.source, "utf-8")).toBe("const before = 1;\n");
	});

	it("#given one valid server apply #when the server applies twice #then the repeated request is rejected", async () => {
		const context = await harness.makeClient({
			renameSteps: [
				{ applyEdit: renameTextEdit("before", "after", { version: 1 }), applyTwice: true, renameResult: "same" },
			],
		});
		await context.client.openFile(context.source);

		const result = await context.client.rename(context.source, 1, 6, "after");

		expect(result.apply.success).toBe(true);
		const responses = readEvents(context.events).filter(
			(event) => event.type === "clientResponse" && event.method === "workspace/applyEdit",
		);
		expect(responses).toHaveLength(2);
		expect(responses[0]?.result).toEqual({ applied: true });
		expect(responses[1]?.result).toEqual({
			applied: false,
			failureReason: expect.stringContaining("already handled"),
		});
		expect(readFileSync(context.source, "utf-8")).toBe("const after = 1;\n");
	});

	it("#given two concurrent server applies #when one enters commit #then the other is rejected without a second write", async () => {
		const context = await harness.makeClient({
			renameSteps: [
				{
					applyEdit: renameTextEdit("before", "after", { version: 1 }),
					applyConcurrently: true,
					renameResult: "same",
				},
			],
		});
		let writes = 0;
		context.client.setWorkspaceEditIo({
			writeFile(path, content) {
				writes += 1;
				writeFileSync(path, content, "utf-8");
			},
		});
		await context.client.openFile(context.source);

		const result = await context.client.rename(context.source, 1, 6, "after");

		expect(result.apply.success).toBe(true);
		expect(writes).toBe(1);
		const responses = readEvents(context.events).filter(
			(event) => event.type === "clientResponse" && event.method === "workspace/applyEdit",
		);
		expect(responses.map((response) => response.result)).toContainEqual({ applied: true });
		const rejection = responses.find(
			(response) => typeof response.result === "object" && response.result !== null && "failureReason" in response.result,
		);
		expect(rejection?.result).toMatchObject({ applied: false });
		expect(JSON.stringify(rejection?.result)).toMatch(/already (?:in progress|handled)/);
	});

	it("#given a rename lease is held #when another rename starts #then it is rejected without a second request", async () => {
		const context = await harness.makeClient({
			renameSteps: [
				{
					renameResult: "edit",
					renameEdit: renameTextEdit("before", "after", { version: 1 }),
					responseDelayMs: 150,
				},
			],
		});
		await context.client.openFile(context.source);
		const firstPromise = context.client.rename(context.source, 1, 6, "after");
		await waitForEventCount(
			context.events,
			(event) => event.type === "clientRequest" && event.method === "textDocument/rename",
			1,
		);

		const concurrent = await context.client.rename(context.source, 1, 6, "other_");
		const first = await firstPromise;

		expect(concurrent.apply.success).toBe(false);
		expect(concurrent.apply.errors.join("\n")).toContain("workspace mutation is already in progress");
		expect(first.apply.success).toBe(true);
		const requests = readEvents(context.events).filter(
			(event) => event.type === "clientRequest" && event.method === "textDocument/rename",
		);
		expect(requests).toHaveLength(1);
	});

	it("#given no server apply #when rename directly returns an edit #then it is applied exactly once", async () => {
		const context = await harness.makeClient({
			renameSteps: [{ renameResult: "edit", renameEdit: renameTextEdit("before", "after", { version: 1 }) }],
		});
		await context.client.openFile(context.source);

		const result = await context.client.rename(context.source, 1, 6, "after");

		expect(result.apply.success).toBe(true);
		expect(readFileSync(context.source, "utf-8")).toBe("const after = 1;\n");
		expect(readEvents(context.events).filter((event) => event.method === "workspace/applyEdit")).toHaveLength(0);
	});

	it("#given cancellation before a delayed server apply #when the rename request is aborted #then no file is mutated", async () => {
		const controller = new AbortController();
		const context = await harness.makeClient({
			renameSteps: [
				{
					applyEdit: renameTextEdit("before", "after", { version: 1 }),
					applyDelayMs: 100,
					renameResult: "same",
				},
			],
		});
		await context.client.openFile(context.source);
		const rename = context.client.rename(context.source, 1, 6, "after", controller.signal);
		await waitForEventCount(
			context.events,
			(event) => event.type === "clientRequest" && event.method === "textDocument/rename",
			1,
		);
		controller.abort();

		await expect(rename).rejects.toThrow(/cancel/i);

		const [cancel] = await waitForEventCount(
			context.events,
			(event) => event.type === "clientNotification" && event.method === "$/cancelRequest",
			1,
		);
		expect(cancel?.params).toEqual({ id: 2 });
		expect(readFileSync(context.source, "utf-8")).toBe("const before = 1;\n");
	});

	it("#given cancellation after the commit gate #when applyEdit finishes #then rename reports one completed late-abort mutation", async () => {
		const controller = new AbortController();
		const context = await harness.makeClient({
			renameSteps: [{ applyEdit: renameTextEdit("before", "after", { version: 1 }), renameResult: "same" }],
		});
		let writes = 0;
		context.client.setWorkspaceEditIo({
			writeFile(path, content) {
				writes += 1;
				writeFileSync(path, content, "utf-8");
				controller.abort();
			},
		});
		await context.client.openFile(context.source);

		const result = await context.client.rename(context.source, 1, 6, "after", controller.signal);

		expect(result.apply).toMatchObject({ success: true, lateAbort: true, totalEdits: 1 });
		expect(writes).toBe(1);
		expect(readFileSync(context.source, "utf-8")).toBe("const after = 1;\n");
	});

	it("#given lease-backed and bare clients #when initialized #then applyEdit and annotations are advertised honestly", async () => {
		const active = await harness.makeClient({});
		const inactive = await harness.makeBareConnection({});

		const activeCapabilities = initializeCapabilities(active.events);
		const inactiveCapabilities = initializeCapabilities(inactive.events);
		expect(activeCapabilities.workspace?.applyEdit).toBe(true);
		expect(inactiveCapabilities.workspace?.applyEdit).toBeUndefined();
		expect(activeCapabilities.textDocument?.rename?.honorsChangeAnnotations).toBeUndefined();
		expect(activeCapabilities.workspace?.workspaceEdit?.changeAnnotationSupport).toBeUndefined();
	});
});

interface InitializeCapabilities {
	readonly workspace?: {
		readonly applyEdit?: boolean;
		readonly workspaceEdit?: { readonly changeAnnotationSupport?: unknown };
	};
	readonly textDocument?: { readonly rename?: { readonly honorsChangeAnnotations?: boolean } };
}

function initializeCapabilities(path: string): InitializeCapabilities {
	const initialize = readEvents(path).find(
		(event) => event.type === "clientRequest" && event.method === "initialize",
	);
	return (initialize?.params as { capabilities?: InitializeCapabilities } | undefined)?.capabilities ?? {};
}
