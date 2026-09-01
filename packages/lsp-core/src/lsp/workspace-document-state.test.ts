import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "bun:test";

import type { Diagnostic } from "./types.js";
import { WorkspaceDocumentState } from "./workspace-document-state.js";
import type { WorkspaceMutation } from "./workspace-edit.js";

const workspaces: string[] = [];

afterEach(() => {
	while (workspaces.length > 0) {
		const workspace = workspaces.pop();
		if (workspace) rmSync(workspace, { recursive: true, force: true });
	}
});

function makeDocuments(): WorkspaceDocumentState {
	return new WorkspaceDocumentState(
		async () => {},
		() => {},
		{ versionlessPublishQuiescenceMs: 0 },
	);
}

function makeSourceFile(directorySegment: string): string {
	const workspace = realpathSync(mkdtempSync(join(tmpdir(), "lsp-document-uri-")));
	workspaces.push(workspace);
	const directory = join(workspace, directorySegment);
	mkdirSync(directory, { recursive: true });
	const source = join(directory, "page.ts");
	writeFileSync(source, "const value: number = 'text';\n", "utf-8");
	return source;
}

const diagnostic: Diagnostic = {
	range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
	severity: 1,
	message: "Type 'string' is not assignable to type 'number'.",
};

describe("WorkspaceDocumentState published diagnostics under a re-encoded uri", () => {
	it("#given a server that percent-encodes a path segment #when it publishes #then the diagnostics reach the open document", async () => {
		const documents = makeDocuments();
		const source = makeSourceFile("(marketing)");
		await documents.openFile(source);
		const snapshot = documents.captureDiagnosticSnapshot(source);
		expect(snapshot).not.toBeNull();
		const publishedUri = snapshot!.uri.replaceAll("(", "%28").replaceAll(")", "%29");
		expect(publishedUri).not.toBe(snapshot!.uri);

		documents.recordPublishedDiagnostics({ uri: publishedUri, diagnostics: [diagnostic], version: snapshot!.version });

		expect(documents.getStoredDiagnostics(snapshot!.uri)).toEqual([diagnostic]);
		expect(documents.resolvePushDiagnostics(snapshot!)).toEqual({ status: "ready", diagnostics: [diagnostic] });
	});

	it.skipIf(process.platform !== "win32")(
		"#given a server that lowercases and percent-encodes the drive #when it publishes #then the diagnostics reach the open document",
		async () => {
			const documents = makeDocuments();
			const source = makeSourceFile("routes");
			await documents.openFile(source);
			const snapshot = documents.captureDiagnosticSnapshot(source);
			expect(snapshot).not.toBeNull();
			const publishedUri = snapshot!.uri.replace(/^file:\/\/\/([A-Za-z]):/, (_match, drive: string) => `file:///${drive.toLowerCase()}%3A`);
			expect(publishedUri).not.toBe(snapshot!.uri);

			documents.recordPublishedDiagnostics({ uri: publishedUri, diagnostics: [diagnostic], version: snapshot!.version });

			expect(documents.getStoredDiagnostics(snapshot!.uri)).toEqual([diagnostic]);
			expect(documents.resolvePushDiagnostics(snapshot!)).toEqual({ status: "ready", diagnostics: [diagnostic] });
		},
	);

	it("#given a document opened from a path the client already encodes #when the server echoes it verbatim #then the outgoing uri is unchanged", async () => {
		const documents = makeDocuments();
		const source = makeSourceFile("plain");
		await documents.openFile(source);
		const snapshot = documents.captureDiagnosticSnapshot(source);

		expect(snapshot?.uri).toBe(pathToFileURL(source).href);
	});
});

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
