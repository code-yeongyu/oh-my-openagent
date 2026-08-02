import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "bun:test";

import type { Diagnostic } from "./types.js";
import { WorkspaceDocumentState } from "./workspace-document-state.js";
import type { WorkspaceMutation } from "./workspace-edit.js";

describe("WorkspaceDocumentState watched-file bounds", () => {
	it("#given more closed-file mutations than one batch #when synchronized #then every notification stays bounded", async () => {
		const notifications: unknown[] = [];
		const documents = new WorkspaceDocumentState(
			async (method, params) => {
				if (method === "workspace/didChangeWatchedFiles") notifications.push(params);
			},
			() => {},
			{ versionlessPublishQuiescenceMs: 0 },
		);
		const changedPaths = Array.from({ length: 129 }, (_, index) => `/workspace/file-${index}.ts`);
		const operations: WorkspaceMutation[] = changedPaths.map((path) => ({
			kind: "create",
			path,
			replaced: false,
		}));

		await documents.synchronize({ operations, changedPaths });

		expect(notifications).toHaveLength(2);
		expect(notificationChanges(notifications[0])).toHaveLength(128);
		expect(notificationChanges(notifications[1])).toHaveLength(1);
	});

	it("#given changed closed files #when synchronized #then sends bounded changed watched-file notifications", async () => {
		const notifications: unknown[] = [];
		const documents = new WorkspaceDocumentState(
			async (method, params) => {
				if (method === "workspace/didChangeWatchedFiles") notifications.push(params);
			},
			() => {},
			{ versionlessPublishQuiescenceMs: 0 },
		);
		const changedPaths = Array.from({ length: 129 }, (_, index) => `/workspace/file-${index}.ts`);
		const operations: WorkspaceMutation[] = changedPaths.map((path) => ({
			kind: "text",
			path,
			beforeText: "before",
			afterText: "after",
		}));

		await documents.synchronize({ operations, changedPaths });

		expect(notifications).toHaveLength(2);
		expect(notificationChanges(notifications[0])).toHaveLength(128);
		expect(notificationChanges(notifications[1])).toHaveLength(1);
		expect(notificationTypes(notifications[0])).toEqual(Array.from({ length: 128 }, () => 2));
		expect(notificationTypes(notifications[1])).toEqual([2]);
	});
});

describe("WorkspaceDocumentState published diagnostic URIs", () => {
	it("#given TypeScript normalizes a Windows drive URI #when diagnostics are published #then the opened document receives them", async () => {
		if (process.platform !== "win32") return;
		const workspace = mkdtempSync(join(tmpdir(), "lsp-document-uri-"));
		const source = join(workspace, "source.ts");
		writeFileSync(source, "const value: string = 1;\n", "utf-8");
		const diagnostics: Diagnostic[] = [
			{
				range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
				message: "Type 'number' is not assignable to type 'string'.",
			},
		];
		const documents = new WorkspaceDocumentState(
			async () => {},
			() => {},
			{ versionlessPublishQuiescenceMs: 0 },
		);

		try {
			await documents.openFile(source);
			const openedUri = pathToFileURL(source).href;
			const publishedUri = openedUri.replace(
				/^file:\/\/\/([A-Z]):/,
				(_match, drive: string) => `file:///${drive.toLowerCase()}%3A`,
			);
			documents.recordPublishedDiagnostics({ uri: publishedUri, diagnostics });
			const snapshot = documents.captureDiagnosticSnapshot(source);

			expect(snapshot).not.toBeNull();
			if (snapshot === null) return;
			expect(documents.resolvePushDiagnostics(snapshot)).toEqual({ status: "ready", diagnostics });
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});
});

function notificationChanges(value: unknown): readonly unknown[] {
	if (typeof value !== "object" || value === null || !("changes" in value) || !Array.isArray(value.changes)) return [];
	return value.changes;
}

function notificationTypes(value: unknown): readonly unknown[] {
	return notificationChanges(value).map((change) => {
		if (typeof change !== "object" || change === null || !("type" in change)) return undefined;
		return change.type;
	});
}
