import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

describe("WorkspaceDocumentState drive-letter case (issue #6167)", () => {
	it.skipIf(process.platform !== "win32")(
		"#given a server publishes under a lowercase Windows drive URI #when the open document is resolved #then the diagnostics are recorded, not dropped",
		async () => {
			// given: a real open document keyed by pathToFileURL(realpath) → uppercase drive on Windows
			const dir = mkdtempSync(join(tmpdir(), "omo-lsp-uri-6167-"));
			const filePath = join(dir, "diagnostic-source.ps1");
			writeFileSync(filePath, "$value = 1\n");
			try {
				const documents = new WorkspaceDocumentState(
					async () => {},
					() => {},
					{ versionlessPublishQuiescenceMs: 0 },
				);
				await documents.openFile(filePath);
				const snapshot = documents.captureDiagnosticSnapshot(filePath);
				if (snapshot === null) throw new Error("expected an open-document snapshot");

				// PowerShell Editor Services publishes file:///c:/... while openByUri is keyed file:///C:/...
				const publishedUri = snapshot.uri.replace(
					/^(file:\/\/\/)([A-Z]):/,
					(_match, scheme: string, drive: string) => `${scheme}${drive.toLowerCase()}:`,
				);
				expect(publishedUri).not.toBe(snapshot.uri);

				const diagnostic: Diagnostic = {
					range: { start: { line: 99, character: 4 }, end: { line: 99, character: 10 } },
					severity: 1,
					message: "Missing expression after unary operator '--'.",
				};

				// when: the server-cased URI flows through recordPublishedDiagnostics, as the transport does
				documents.recordPublishedDiagnostics({ uri: publishedUri, diagnostics: [diagnostic] });

				// then: the push resolves ready for the open snapshot (the client.diagnostics() gate), not "missing"
				expect(documents.resolvePushDiagnostics(snapshot)).toEqual({ status: "ready", diagnostics: [diagnostic] });
				expect(documents.getStoredDiagnostics(publishedUri)).toEqual([diagnostic]);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);
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
