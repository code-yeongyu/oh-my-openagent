import { readFileSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { effectiveExtension } from "./effective-extension.js";
import { getLanguageId } from "./language-mappings.js";
import type { Diagnostic } from "./types.js";
import type { PlannedWorkspaceOperation, WorkspaceMutation, WorkspaceMutationDelta } from "./workspace-edit-types.js";

const WATCHED_FILE_BATCH_SIZE = 128;
const DEFAULT_VERSIONLESS_PUBLISH_QUIESCENCE_MS = 250;

type SendNotification = (method: string, params: unknown) => Promise<void>;

interface OpenDocumentState {
	readonly path: string;
	readonly uri: string;
	readonly languageId: string;
	text: string;
	version: number;
	generation: number;
	publishGeneration: number;
	lastPublish?: PublishedDiagnostics;
	pullCache?: PullDiagnosticsCache;
	waiters: Set<() => void>;
}

interface WatchedFileEvent {
	readonly uri: string;
	readonly type: 1 | 2 | 3;
}

interface PublishedDiagnostics {
	readonly diagnostics: readonly Diagnostic[];
	readonly publishGeneration: number;
	readonly documentGenerationAtArrival: number;
	readonly arrivedAt: number;
	readonly version?: number;
}

interface PullDiagnosticsCache {
	readonly documentVersion: number;
	readonly diagnostics: readonly Diagnostic[];
	readonly resultId?: string;
}

export interface DocumentVersionFailure {
	readonly changeIndex: number;
	readonly message: string;
}

export interface DiagnosticSnapshot {
	readonly path: string;
	readonly uri: string;
	readonly version: number;
	readonly documentGeneration: number;
	readonly publishGeneration: number;
}

export interface PullDiagnosticsReport {
	readonly diagnostics: readonly Diagnostic[];
	readonly kind: "full";
	readonly resultId?: string;
}

export interface PullDiagnosticsCacheHit {
	readonly documentVersion: number;
	readonly diagnostics: readonly Diagnostic[];
	readonly resultId?: string;
}

export type PushDiagnosticsResolution =
	| { readonly status: "ready"; readonly diagnostics: readonly Diagnostic[] }
	| { readonly status: "wait"; readonly waitMs: number }
	| { readonly status: "missing" };

export interface WorkspaceDocumentStateOptions {
	readonly now?: () => number;
	readonly versionlessPublishQuiescenceMs?: number;
}

function canonicalPath(filePath: string): string {
	const absolute = resolve(filePath);
	try {
		return realpathSync(absolute);
	} catch {
		return absolute;
	}
}

function isSameOrDescendant(candidate: string, parent: string): boolean {
	const suffix = relative(parent, candidate);
	return suffix === "" || (!suffix.startsWith("..") && suffix !== "..");
}

function movedPath(candidate: string, oldPath: string, newPath: string): string {
	const suffix = relative(oldPath, candidate);
	return suffix === "" ? newPath : resolve(newPath, suffix);
}

export class WorkspaceDocumentState {
	private readonly openDocuments = new Map<string, OpenDocumentState>();
	private readonly openByUri = new Map<string, OpenDocumentState>();
	private readonly openPromises = new Map<string, Promise<void>>();
	private readonly now: () => number;
	private readonly versionlessPublishQuiescenceMs: number;

	constructor(
		private readonly sendNotification: SendNotification,
		private readonly clearDiagnostics: (uri: string) => void,
		options: WorkspaceDocumentStateOptions = {},
	) {
		this.now = options.now ?? (() => Date.now());
		this.versionlessPublishQuiescenceMs =
			options.versionlessPublishQuiescenceMs ?? DEFAULT_VERSIONLESS_PUBLISH_QUIESCENCE_MS;
	}

	async openFile(filePath: string): Promise<void> {
		const path = canonicalPath(filePath);
		const existingOpen = this.openPromises.get(path);
		if (existingOpen) {
			await existingOpen;
			return this.openFile(path);
		}

		const text = readFileSync(path, "utf-8");
		const existing = this.openDocuments.get(path);
		if (!existing) return this.openDocumentSingleFlight(path, text);
		if (existing.text === text) return;
		await this.changeDocument(existing, text);
	}

	getVersion(filePath: string): number | undefined {
		return this.openDocuments.get(canonicalPath(filePath))?.version;
	}

	getStoredDiagnostics(uri: string): readonly Diagnostic[] {
		const state = this.openByUri.get(uri);
		if (!state) return [];
		return state.lastPublish?.diagnostics ?? state.pullCache?.diagnostics ?? [];
	}

	captureDiagnosticSnapshot(filePath: string): DiagnosticSnapshot | null {
		const state = this.openDocuments.get(canonicalPath(filePath));
		if (!state) return null;
		return {
			path: state.path,
			uri: state.uri,
			version: state.version,
			documentGeneration: state.generation,
			publishGeneration: state.publishGeneration,
		};
	}

	isCurrentSnapshot(snapshot: DiagnosticSnapshot): boolean {
		const state = this.openDocuments.get(snapshot.path);
		return (
			state !== undefined &&
			state.uri === snapshot.uri &&
			state.version === snapshot.version &&
			state.generation === snapshot.documentGeneration
		);
	}

	getPullCache(snapshot: DiagnosticSnapshot): PullDiagnosticsCacheHit | null {
		const state = this.openByUri.get(snapshot.uri);
		if (!state?.pullCache || state.pullCache.documentVersion !== snapshot.version) return null;
		return state.pullCache;
	}

	recordPullDiagnostics(snapshot: DiagnosticSnapshot, report: PullDiagnosticsReport): void {
		const state = this.openByUri.get(snapshot.uri);
		if (!state) return;
		state.pullCache = {
			documentVersion: snapshot.version,
			diagnostics: [...report.diagnostics],
			...(report.resultId === undefined ? {} : { resultId: report.resultId }),
		};
	}

	recordPublishedDiagnostics(params: {
		readonly uri: string;
		readonly diagnostics: readonly Diagnostic[];
		readonly version?: number;
	}): void {
		const state = this.openByUri.get(params.uri);
		if (!state) return;
		state.publishGeneration += 1;
		state.lastPublish = {
			diagnostics: [...params.diagnostics],
			publishGeneration: state.publishGeneration,
			documentGenerationAtArrival: state.generation,
			arrivedAt: this.now(),
			...(params.version === undefined ? {} : { version: params.version }),
		};
		this.notifyWaiters(state);
	}

	resolvePushDiagnostics(snapshot: DiagnosticSnapshot): PushDiagnosticsResolution {
		const state = this.openByUri.get(snapshot.uri);
		if (!state?.lastPublish) return { status: "missing" };
		const publish = state.lastPublish;
		if (publish.version !== undefined) {
			return publish.version === snapshot.version
				? { status: "ready", diagnostics: publish.diagnostics }
				: { status: "missing" };
		}
		if (publish.documentGenerationAtArrival < snapshot.documentGeneration) return { status: "missing" };
		const readyAt = publish.arrivedAt + this.versionlessPublishQuiescenceMs;
		const waitMs = Math.max(0, readyAt - this.now());
		return waitMs === 0
			? { status: "ready", diagnostics: publish.diagnostics }
			: { status: "wait", waitMs };
	}

	waitForDiagnosticsActivity(snapshot: DiagnosticSnapshot, timeoutMs: number): Promise<void> {
		const state = this.openByUri.get(snapshot.uri);
		if (!state || timeoutMs <= 0) return Promise.resolve();
		return new Promise((resolveActivity) => {
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				state.waiters.delete(finish);
				resolveActivity();
			};
			const timer = setTimeout(finish, timeoutMs);
			if (typeof timer.unref === "function") timer.unref();
			state.waiters.add(finish);
		});
	}

	validateVersions(operations: readonly PlannedWorkspaceOperation[]): DocumentVersionFailure | null {
		const versions = new Map([...this.openDocuments].map(([path, state]) => [path, state.version]));
		for (const operation of operations) {
			if (operation.kind === "text") {
				const current = versions.get(operation.path);
				if (operation.documentVersion !== null && current !== operation.documentVersion) {
					const observed = current === undefined ? "closed document" : `open document version ${current}`;
					return {
						changeIndex: operation.changeIndex,
						message: `document version ${operation.documentVersion} does not match ${observed} for ${operation.path}`,
					};
				}
				if (current !== undefined) versions.set(operation.path, current + 1);
				continue;
			}
			if (operation.kind === "rename") {
				const moved = [...versions].filter(([path]) => isSameOrDescendant(path, operation.oldPath));
				for (const [path] of moved) versions.delete(path);
				for (const [path] of moved) versions.set(movedPath(path, operation.oldPath, operation.newPath), 1);
				continue;
			}
			if (operation.kind === "delete") {
				for (const path of [...versions.keys()]) {
					if (isSameOrDescendant(path, operation.path)) versions.delete(path);
				}
				continue;
			}
			if (operation.kind === "create" && operation.replaced && versions.has(operation.path)) {
				versions.set(operation.path, 1);
			}
		}
		return null;
	}

	async synchronize(delta: WorkspaceMutationDelta): Promise<void> {
		const watched: WatchedFileEvent[] = [];
		for (const mutation of delta.operations) await this.synchronizeMutation(mutation, watched);
		for (let index = 0; index < watched.length; index += WATCHED_FILE_BATCH_SIZE) {
			await this.sendNotification("workspace/didChangeWatchedFiles", {
				changes: watched.slice(index, index + WATCHED_FILE_BATCH_SIZE),
			});
		}
	}

	private async synchronizeMutation(mutation: WorkspaceMutation, watched: WatchedFileEvent[]): Promise<void> {
		if (mutation.kind === "text") {
			const state = this.openDocuments.get(mutation.path);
			if (state) await this.changeDocument(state, mutation.afterText);
			else watched.push({ uri: pathToFileURL(mutation.path).href, type: 2 });
			return;
		}
		if (mutation.kind === "create") {
			const state = this.openDocuments.get(mutation.path);
			if (state) {
				await this.closeDocument(state);
				await this.openDocumentSingleFlight(mutation.path, readFileSync(mutation.path, "utf-8"));
			} else {
				watched.push({ uri: pathToFileURL(mutation.path).href, type: mutation.replaced ? 2 : 1 });
			}
			return;
		}
		if (mutation.kind === "rename") {
			const moved = [...this.openDocuments.values()].filter((state) =>
				isSameOrDescendant(state.path, mutation.oldPath),
			);
			for (const state of moved) await this.closeDocument(state);
			for (const state of moved) {
				const path = movedPath(state.path, mutation.oldPath, mutation.newPath);
				await this.openDocumentSingleFlight(path, readFileSync(path, "utf-8"));
			}
			if (moved.length === 0) {
				watched.push({ uri: pathToFileURL(mutation.oldPath).href, type: 3 });
				watched.push({ uri: pathToFileURL(mutation.newPath).href, type: 1 });
			}
			return;
		}
		const removed = [...this.openDocuments.values()].filter((state) =>
			isSameOrDescendant(state.path, mutation.path),
		);
		for (const state of removed) await this.closeDocument(state);
		if (removed.length === 0) watched.push({ uri: pathToFileURL(mutation.path).href, type: 3 });
	}

	private async openDocumentSingleFlight(path: string, text: string): Promise<void> {
		const existing = this.openPromises.get(path);
		if (existing) return existing;
		const open = (async () => {
			const state: OpenDocumentState = {
				path,
				uri: pathToFileURL(path).href,
				languageId: getLanguageId(effectiveExtension(path)),
				text,
				version: 1,
				generation: 1,
				publishGeneration: 0,
				waiters: new Set(),
			};
			this.openDocuments.set(path, state);
			this.openByUri.set(state.uri, state);
			this.notifyWaiters(state);
			await this.sendNotification("textDocument/didOpen", {
				textDocument: { uri: state.uri, languageId: state.languageId, version: state.version, text },
			});
		})().finally(() => {
			this.openPromises.delete(path);
		});
		this.openPromises.set(path, open);
		return open;
	}

	private async changeDocument(state: OpenDocumentState, text: string): Promise<void> {
		state.text = text;
		state.version += 1;
		state.generation += 1;
		this.clearDiagnostics(state.uri);
		this.notifyWaiters(state);
		await this.sendNotification("textDocument/didChange", {
			textDocument: { uri: state.uri, version: state.version },
			contentChanges: [{ text }],
		});
		await this.sendNotification("textDocument/didSave", { textDocument: { uri: state.uri }, text });
	}

	private async closeDocument(state: OpenDocumentState): Promise<void> {
		this.openDocuments.delete(state.path);
		this.openByUri.delete(state.uri);
		this.clearDiagnostics(state.uri);
		this.notifyWaiters(state);
		await this.sendNotification("textDocument/didClose", { textDocument: { uri: state.uri } });
	}

	private notifyWaiters(state: OpenDocumentState): void {
		for (const waiter of [...state.waiters]) waiter();
	}
}
