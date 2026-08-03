import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Diagnostic } from "./types.js";
import { normalizeDocumentUri, WorkspaceDocumentState } from "./workspace-document-state.js";
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
	it("#given drive-like POSIX file URIs #when normalized #then preserves their distinct case-sensitive keys", () => {
		expect(normalizeDocumentUri("file:///c:/project/x.ts", "linux")).toBe("file:///c:/project/x.ts");
		expect(normalizeDocumentUri("file:///C:/project/x.ts", "linux")).toBe("file:///C:/project/x.ts");
	});

	it("#given a lowercase Windows drive URI #when normalized #then folds the drive to uppercase", () => {
		expect(normalizeDocumentUri("file:///c:/project/x.ts", "win32")).toBe("file:///C:/project/x.ts");
	});

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

describe("WorkspaceDocumentState percent-encoded route-group URIs (issue #6167)", () => {
	it("#given raw and percent-encoded forms of one path #when normalized #then both fold to the same key", () => {
		const raw = pathToFileURL(join(tmpdir(), "app", "(auth)", "login.tsx")).href;
		const encoded = raw.replaceAll("(", "%28").replaceAll(")", "%29");
		expect(encoded).not.toBe(raw);
		expect(normalizeDocumentUri(encoded)).toBe(normalizeDocumentUri(raw));
	});

	it("#given a percent-encoded space #when normalized #then it folds to the raw spelling", () => {
		expect(normalizeDocumentUri("file:///srv/my%20app/x.ts", "linux")).toBe("file:///srv/my app/x.ts");
	});

	it("#given a malformed escape sequence #when normalized #then the URI is left untouched", () => {
		expect(normalizeDocumentUri("file:///srv/100%bad/x.ts", "linux")).toBe("file:///srv/100%bad/x.ts");
	});

	it("#given a server publishes a route-group path percent-encoded #when the open document is resolved #then the diagnostics are recorded, not dropped", async () => {
		// given: an open document under a route-group directory, keyed by pathToFileURL (parens left raw)
		const dir = mkdtempSync(join(tmpdir(), "omo-lsp-uri-6167-group-"));
		const groupDir = join(dir, "app", "(auth)");
		mkdirSync(groupDir, { recursive: true });
		const filePath = join(groupDir, "login.ts");
		writeFileSync(filePath, "export const value = 1\n");
		try {
			const documents = new WorkspaceDocumentState(
				async () => {},
				() => {},
				{ versionlessPublishQuiescenceMs: 0 },
			);
			await documents.openFile(filePath);
			const snapshot = documents.captureDiagnosticSnapshot(filePath);
			if (snapshot === null) throw new Error("expected an open-document snapshot");

			// typescript-language-server publishes .../%28auth%29/... while openByUri is keyed .../(auth)/...
			const publishedUri = snapshot.uri.replaceAll("(", "%28").replaceAll(")", "%29");
			expect(publishedUri).not.toBe(snapshot.uri);

			const diagnostic: Diagnostic = {
				range: { start: { line: 0, character: 13 }, end: { line: 0, character: 18 } },
				severity: 1,
				message: "Type 'number' is not assignable to type 'string'.",
			};

			// when: the encoded URI flows through recordPublishedDiagnostics, as the transport does
			documents.recordPublishedDiagnostics({ uri: publishedUri, diagnostics: [diagnostic] });

			// then: the push resolves ready for the open snapshot instead of timing out as "missing"
			expect(documents.resolvePushDiagnostics(snapshot)).toEqual({ status: "ready", diagnostics: [diagnostic] });
		} finally {
			rmSync(dir, { recursive: true, force: true });
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
