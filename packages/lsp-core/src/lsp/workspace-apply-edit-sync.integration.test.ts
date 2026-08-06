import { existsSync, readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "bun:test";

import type { WorkspaceEdit } from "./types.js";
import {
	createWorkspaceEditTestHarness,
	readEvents,
	renameTextEdit,
} from "./workspace-apply-edit-test-support.js";

const harness = createWorkspaceEditTestHarness();

afterEach(async () => {
	await harness.cleanup();
});

describe("LspClient workspace edit synchronization", () => {
	it("#given an open edited document #when applyEdit commits #then didChange precedes didSave with the next version", async () => {
		const context = await harness.makeClient({
			renameSteps: [{ applyEdit: renameTextEdit("before", "after", { version: 1 }), renameResult: "same" }],
		});
		await context.client.openFile(context.source);

		await context.client.rename(context.source, 1, 6, "after");

		const notifications = readEvents(context.events).filter((event) => event.type === "clientNotification");
		const changeIndex = notifications.findIndex((event) => event.method === "textDocument/didChange");
		const saveIndex = notifications.findIndex((event) => event.method === "textDocument/didSave");
		expect(changeIndex).toBeGreaterThan(-1);
		expect(saveIndex).toBeGreaterThan(changeIndex);
		expect(notifications[changeIndex]?.params).toMatchObject({ textDocument: { version: 2 } });
	});

	it("#given an open file resource rename #when applyEdit commits #then didClose and didOpen move document state", async () => {
		const edit: WorkspaceEdit = {
			documentChanges: [{ kind: "rename", oldUri: "file:///placeholder", newUri: "file:///destination" }],
		};
		const context = await harness.makeClient({ renameSteps: [{ applyEdit: edit, renameResult: "null" }] });
		await context.client.openFile(context.source);

		const result = await context.client.rename(context.source, 1, 6, "after");

		expect(result.apply.success).toBe(true);
		expect(existsSync(context.source)).toBe(false);
		expect(readFileSync(context.destination, "utf-8")).toBe("const before = 1;\n");
		expect(context.client.getOpenDocumentVersion(context.source)).toBeUndefined();
		expect(context.client.getOpenDocumentVersion(context.destination)).toBe(1);
		const methods = readEvents(context.events).map((event) => event.method);
		expect(methods.indexOf("textDocument/didClose")).toBeLessThan(methods.lastIndexOf("textDocument/didOpen"));
	});

	it("#given an open file deletion #when applyEdit commits #then didClose removes document state", async () => {
		const edit: WorkspaceEdit = { documentChanges: [{ kind: "delete", uri: "file:///placeholder" }] };
		const context = await harness.makeClient({ renameSteps: [{ applyEdit: edit, renameResult: "null" }] });
		await context.client.openFile(context.source);

		const result = await context.client.rename(context.source, 1, 6, "after");

		expect(result.apply.success).toBe(true);
		expect(existsSync(context.source)).toBe(false);
		expect(context.client.getOpenDocumentVersion(context.source)).toBeUndefined();
		expect(readEvents(context.events).some((event) => event.method === "textDocument/didClose")).toBe(true);
	});

	it("#given a closed edited file #when applyEdit commits #then one changed watched-file event is emitted", async () => {
		const edit = renameTextEdit("closed", "after_", { version: null, uri: "file:///closed" });
		const context = await harness.makeClient({ renameSteps: [{ applyEdit: edit, renameResult: "null" }] });
		await context.client.openFile(context.source);

		const result = await context.client.rename(context.source, 1, 6, "after");

		expect(result.apply.success).toBe(true);
		expect(readFileSync(context.closed, "utf-8")).toBe("const after_ = 1;\n");
		const watched = readEvents(context.events).find(
			(event) => event.type === "clientNotification" && event.method === "workspace/didChangeWatchedFiles",
		);
		expect(watched?.params).toEqual({ changes: [{ uri: pathToFileURL(realpathSync(context.closed)).href, type: 2 }] });
	});

	it("#given a new closed file #when applyEdit creates it #then one created watched-file event is emitted", async () => {
		const edit: WorkspaceEdit = { documentChanges: [{ kind: "create", uri: "file:///created" }] };
		const context = await harness.makeClient({ renameSteps: [{ applyEdit: edit, renameResult: "null" }] });
		await context.client.openFile(context.source);

		const result = await context.client.rename(context.source, 1, 6, "after");

		expect(result.apply.success).toBe(true);
		expect(readFileSync(context.created, "utf-8")).toBe("");
		const watched = readEvents(context.events).find(
			(event) => event.type === "clientNotification" && event.method === "workspace/didChangeWatchedFiles",
		);
		expect(watched?.params).toEqual({ changes: [{ uri: pathToFileURL(realpathSync(context.created)).href, type: 1 }] });
	});

	it("#given an open file overwritten by create #when applyEdit commits #then didClose and didOpen reset its state", async () => {
		const edit: WorkspaceEdit = {
			documentChanges: [{ kind: "create", uri: "file:///closed", options: { overwrite: true } }],
		};
		const context = await harness.makeClient({ renameSteps: [{ applyEdit: edit, renameResult: "null" }] });
		await context.client.openFile(context.source);
		await context.client.openFile(context.closed);

		const result = await context.client.rename(context.source, 1, 6, "after");

		expect(result.apply.success).toBe(true);
		expect(readFileSync(context.closed, "utf-8")).toBe("");
		expect(context.client.getOpenDocumentVersion(context.closed)).toBe(1);
		const methods = readEvents(context.events).map((event) => event.method);
		expect(methods.indexOf("textDocument/didClose")).toBeLessThan(methods.lastIndexOf("textDocument/didOpen"));
	});
});
