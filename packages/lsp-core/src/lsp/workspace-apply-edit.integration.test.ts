import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "bun:test";

import {
	createWorkspaceEditTestHarness,
	diagnostic,
	readEvents,
	renameTextEdit,
} from "./workspace-apply-edit-test-support.js";

const harness = createWorkspaceEditTestHarness();

afterEach(async () => {
	await harness.cleanup();
});

describe("LspClient workspace/applyEdit", () => {
	it("#given a server-applied edit returned again by rename #when rename completes #then one write is reused truthfully", async () => {
		const context = await harness.makeClient({
			renameSteps: [{ applyEdit: renameTextEdit("before", "after", { version: 1 }), renameResult: "same" }],
			diagnostics: [diagnostic("fresh")],
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
		expect(result.apply.totalEdits).toBe(1);
		expect(writes).toBe(1);
		expect(readFileSync(context.source, "utf-8")).toBe("const after = 1;\n");
		expect(context.client.getOpenDocumentVersion(context.source)).toBe(2);
		expect(context.client.getStoredDiagnostics(pathToFileURL(realpathSync(context.source)).href)).toEqual([
			diagnostic("fresh"),
		]);
		const responses = readEvents(context.events).filter(
			(event) => event.type === "clientResponse" && event.method === "workspace/applyEdit",
		);
		expect(responses).toHaveLength(1);
		expect(responses[0]?.result).toEqual({ applied: true });
	});

	it("#given a server-applied edit and a null rename result #when rename completes #then the recorded result is reused", async () => {
		const context = await harness.makeClient({
			renameSteps: [{ applyEdit: renameTextEdit("before", "after", { version: 1 }), renameResult: "null" }],
		});
		await context.client.openFile(context.source);

		const result = await context.client.rename(context.source, 1, 6, "after");

		expect(result.edit).toBeNull();
		expect(result.apply.success).toBe(true);
		expect(readFileSync(context.source, "utf-8")).toBe("const after = 1;\n");
	});

	it("#given two versioned server edits #when applied sequentially #then the synchronized version accepts the second edit", async () => {
		const context = await harness.makeClient({
			renameSteps: [
				{ applyEdit: renameTextEdit("before", "first_", { version: 1 }), renameResult: "same" },
				{ applyEdit: renameTextEdit("first_", "second", { version: 2 }), renameResult: "same" },
			],
		});
		await context.client.openFile(context.source);

		const first = await context.client.rename(context.source, 1, 6, "first_");
		const second = await context.client.rename(context.source, 1, 6, "second");

		expect(first.apply.success).toBe(true);
		expect(second.apply.success).toBe(true);
		expect(context.client.getOpenDocumentVersion(context.source)).toBe(3);
		expect(readFileSync(context.source, "utf-8")).toBe("const second = 1;\n");
	});

	it("#given a mismatched document version #when the server requests applyEdit #then mutation is rejected truthfully", async () => {
		const context = await harness.makeClient({
			renameSteps: [{ applyEdit: renameTextEdit("before", "after", { version: 9 }), renameResult: "same" }],
		});
		await context.client.openFile(context.source);

		const result = await context.client.rename(context.source, 1, 6, "after");

		expect(result.apply.success).toBe(false);
		expect(result.apply.errors.join("\n")).toContain("document version");
		expect(readFileSync(context.source, "utf-8")).toBe("const before = 1;\n");
		const response = readEvents(context.events).find(
			(event) => event.type === "clientResponse" && event.method === "workspace/applyEdit",
		);
		expect(response?.result).toEqual({
			applied: false,
			failureReason: expect.stringContaining("document version"),
			failedChange: 0,
		});
	});

	it("#given a server-applied edit and a different rename result #when rename completes #then conflict is reported without a second mutation", async () => {
		const context = await harness.makeClient({
			renameSteps: [
				{
					applyEdit: renameTextEdit("before", "after", { version: 1 }),
					renameResult: "different",
					differentEdit: renameTextEdit("before", "other_", { version: 1 }),
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

		expect(result.apply.success).toBe(false);
		expect(result.apply.errors.join("\n")).toContain("conflicts with server-applied workspace edit");
		expect(writes).toBe(1);
		expect(readFileSync(context.source, "utf-8")).toBe("const after = 1;\n");
	});

	it("#given a real commit I/O failure #when the server requests applyEdit #then both protocol and rename result report failure", async () => {
		const context = await harness.makeClient({
			renameSteps: [{ applyEdit: renameTextEdit("before", "after", { version: 1 }), renameResult: "same" }],
		});
		context.client.setWorkspaceEditIo({
			writeFile() {
				throw new InjectedWorkspaceIoError();
			},
		});
		await context.client.openFile(context.source);

		const result = await context.client.rename(context.source, 1, 6, "after");

		expect(result.apply.success).toBe(false);
		expect(result.apply.errors.join("\n")).toContain("I/O failure during text");
		expect(readFileSync(context.source, "utf-8")).toBe("const before = 1;\n");
		const response = readEvents(context.events).find(
			(event) => event.type === "clientResponse" && event.method === "workspace/applyEdit",
		);
		expect(response?.result).toEqual({
			applied: false,
			failureReason: expect.stringContaining("I/O failure during text"),
			failedChange: 0,
		});
	});
});

class InjectedWorkspaceIoError extends Error {
	override readonly name = "InjectedWorkspaceIoError";

	constructor() {
		super("injected workspace I/O failure");
	}
}
