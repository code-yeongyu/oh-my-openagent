import { describe, expect, it } from "bun:test";

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
