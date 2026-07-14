import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { LspClientConnection } from "./connection.js";
import type { LspClientTimeoutOptions } from "./transport.js";
import type {
	Diagnostic,
	DocumentSymbol,
	Location,
	LocationLink,
	PrepareRenameDefaultBehavior,
	PrepareRenameResult,
	Range,
	ResolvedServer,
	SymbolInfo,
	WorkspaceEdit,
} from "./types.js";
import { LspRequestTimeoutError } from "./errors.js";
import { WorkspaceDocumentState } from "./workspace-document-state.js";
import type { LspRenameResult, WorkspaceEditCommitIo } from "./workspace-edit-types.js";
import { WorkspaceMutationController } from "./workspace-mutation-controller.js";

const DIAGNOSTICS_FRESHNESS_TIMEOUT_MS = 3_000;
const VERSIONLESS_PUBLISH_QUIESCENCE_MS = 250;

export interface LspDiagnosticsResult {
	readonly items: Diagnostic[];
	readonly transientError?: {
		readonly kind: "freshness_timeout";
		readonly message: string;
	};
}

export interface LspClientOptions extends LspClientTimeoutOptions {
	readonly diagnosticsFreshnessTimeoutMs?: number;
	readonly versionlessPublishQuiescenceMs?: number;
}

export class LspClient extends LspClientConnection {
	private readonly diagnosticPullErrors: Error[] = [];
	private readonly documents: WorkspaceDocumentState;
	private readonly workspaceMutations: WorkspaceMutationController;
	private readonly diagnosticsFreshnessTimeoutMs: number;

	constructor(root: string, server: ResolvedServer, options: LspClientOptions = {}) {
		super(root, server, options);
		this.diagnosticsFreshnessTimeoutMs =
			options.diagnosticsFreshnessTimeoutMs ?? DIAGNOSTICS_FRESHNESS_TIMEOUT_MS;
		this.documents = new WorkspaceDocumentState(
			(method, params) => this.sendNotification(method, params),
			(uri) => this.diagnosticsStore.delete(uri),
			{
				versionlessPublishQuiescenceMs:
					options.versionlessPublishQuiescenceMs ?? VERSIONLESS_PUBLISH_QUIESCENCE_MS,
			},
		);
		this.workspaceMutations = new WorkspaceMutationController(root, this.documents);
		this.setWorkspaceApplyEditHandler((params) => this.workspaceMutations.handleApplyEdit(params));
	}

	getDiagnosticPullErrors(): readonly Error[] {
		return this.diagnosticPullErrors;
	}

	async openFile(filePath: string): Promise<void> {
		const absPath = this.resolveWorkspacePath(filePath);
		await this.documents.openFile(absPath);
	}

	getOpenDocumentVersion(filePath: string): number | undefined {
		return this.documents.getVersion(this.resolveWorkspacePath(filePath));
	}

	override getStoredDiagnostics(uri: string): Diagnostic[] {
		return [...this.documents.getStoredDiagnostics(uri)];
	}

	setWorkspaceEditIo(io: Partial<WorkspaceEditCommitIo>): void {
		this.workspaceMutations.setIo(io);
	}

	protected override handlePublishDiagnostics(params: {
		readonly uri: string;
		readonly diagnostics: readonly Diagnostic[];
		readonly version?: number;
	}): void {
		super.handlePublishDiagnostics(params);
		this.documents.recordPublishedDiagnostics(params);
	}

	async definition(
		filePath: string,
		line: number,
		character: number,
		signal?: AbortSignal,
	): Promise<Location | LocationLink | Array<Location | LocationLink> | null> {
		const absPath = this.resolveWorkspacePath(filePath);
		await this.openFile(absPath);
		const options = signal === undefined ? {} : { signal };
		return this.sendRequest<Location | LocationLink | Array<Location | LocationLink> | null>(
			"textDocument/definition",
			{
				textDocument: { uri: pathToFileURL(absPath).href },
				position: { line: line - 1, character },
			},
			options,
		);
	}

	async references(
		filePath: string,
		line: number,
		character: number,
		includeDeclaration = true,
		signal?: AbortSignal,
	): Promise<Location[]> {
		const absPath = this.resolveWorkspacePath(filePath);
		await this.openFile(absPath);
		const options = signal === undefined ? {} : { signal };
		return this.sendRequest<Location[]>("textDocument/references", {
			textDocument: { uri: pathToFileURL(absPath).href },
			position: { line: line - 1, character },
			context: { includeDeclaration },
		}, options);
	}

	async documentSymbols(filePath: string, signal?: AbortSignal): Promise<Array<DocumentSymbol | SymbolInfo>> {
		const absPath = this.resolveWorkspacePath(filePath);
		await this.openFile(absPath);
		const options = signal === undefined ? {} : { signal };
		return this.sendRequest<Array<DocumentSymbol | SymbolInfo>>("textDocument/documentSymbol", {
			textDocument: { uri: pathToFileURL(absPath).href },
		}, options);
	}

	async workspaceSymbols(query: string, signal?: AbortSignal): Promise<SymbolInfo[]> {
		const options = signal === undefined ? {} : { signal };
		return this.sendRequest<SymbolInfo[]>("workspace/symbol", { query }, options);
	}

	private isUnsupportedDiagnosticPullError(error: unknown): boolean {
		if (!(error instanceof Error)) return false;
		const code = "code" in error && typeof error.code === "number" ? error.code : undefined;
		if (code === -32601) return true;
		return /unsupported|not supported|method not found|unknown request/i.test(error.message);
	}

	private freshnessTimeout(absPath: string): LspDiagnosticsResult {
		return {
			items: [],
			transientError: {
				kind: "freshness_timeout",
				message: `Timed out waiting for fresh diagnostics for ${absPath} within ${this.diagnosticsFreshnessTimeoutMs}ms.`,
			},
		};
	}

	private parseDiagnosticPullReport(value: { items?: Diagnostic[]; kind?: string; resultId?: string }): {
		readonly type: "full";
		readonly diagnostics: readonly Diagnostic[];
		readonly resultId?: string;
	} | {
		readonly type: "unchanged";
		readonly resultId?: string;
	} {
		if (value.kind === "unchanged") {
			return {
				type: "unchanged",
				...(value.resultId === undefined ? {} : { resultId: value.resultId }),
			};
		}
		return {
			type: "full",
			diagnostics: value.items ?? [],
			...(value.resultId === undefined ? {} : { resultId: value.resultId }),
		};
	}

	async diagnostics(filePath: string, signal?: AbortSignal): Promise<LspDiagnosticsResult> {
		signal?.throwIfAborted();
		const absPath = this.resolveWorkspacePath(filePath);
		const uri = pathToFileURL(absPath).href;
		await this.openFile(absPath);
		const deadlineAt = Date.now() + this.diagnosticsFreshnessTimeoutMs;

		for (;;) {
			signal?.throwIfAborted();
			const snapshot = this.documents.captureDiagnosticSnapshot(absPath);
			if (!snapshot) return this.freshnessTimeout(absPath);
			const push = this.documents.resolvePushDiagnostics(snapshot);
			if (push.status === "ready") return { items: [...push.diagnostics] };

			let pushFallbackOnly = !this.isDiagnosticPullSupported();
			if (!pushFallbackOnly) {
				const cached = this.documents.getPullCache(snapshot);
				try {
					const remainingMs = deadlineAt - Date.now();
					if (remainingMs <= 0) return this.freshnessTimeout(absPath);
					const result = await this.sendRequest<{ items?: Diagnostic[]; kind?: string; resultId?: string }>(
						"textDocument/diagnostic",
						{
							textDocument: { uri },
							...(cached?.resultId === undefined ? {} : { previousResultId: cached.resultId }),
						},
						{ timeoutMs: remainingMs, ...(signal === undefined ? {} : { signal }) },
					);
					if (!this.documents.isCurrentSnapshot(snapshot)) continue;
					const report = this.parseDiagnosticPullReport(result);
					if (report.type === "full") {
						this.documents.recordPullDiagnostics(snapshot, {
							kind: "full",
							diagnostics: report.diagnostics,
							...(report.resultId === undefined ? {} : { resultId: report.resultId }),
						});
						return { items: [...report.diagnostics] };
					}
					if (
						cached !== null &&
						cached.documentVersion === snapshot.version &&
						cached.resultId === report.resultId
					) {
						return { items: [...cached.diagnostics] };
					}
				} catch (error) {
					if (this.isUnsupportedDiagnosticPullError(error)) {
						this.setDiagnosticPullSupported(false);
						pushFallbackOnly = true;
					} else if (error instanceof LspRequestTimeoutError) {
						pushFallbackOnly = true;
					} else {
						this.diagnosticPullErrors.push(error instanceof Error ? error : new Error(String(error)));
						throw error;
					}
				}
			}

			if (!pushFallbackOnly) continue;

			const remainingMs = deadlineAt - Date.now();
			if (remainingMs <= 0) return this.freshnessTimeout(absPath);
			const waitMs = push.status === "wait" ? Math.min(push.waitMs, remainingMs) : remainingMs;
			await waitForDiagnosticsActivity(this.documents.waitForDiagnosticsActivity(snapshot, waitMs), signal);
		}
	}

	async prepareRename(
		filePath: string,
		line: number,
		character: number,
		signal?: AbortSignal,
	): Promise<PrepareRenameResult | PrepareRenameDefaultBehavior | Range | null> {
		const absPath = this.resolveWorkspacePath(filePath);
		await this.openFile(absPath);
		const options = signal === undefined ? {} : { signal };
		return this.sendRequest<PrepareRenameResult | PrepareRenameDefaultBehavior | Range | null>(
			"textDocument/prepareRename",
			{
				textDocument: { uri: pathToFileURL(absPath).href },
				position: { line: line - 1, character },
			},
			options,
		);
	}

	async rename(
		filePath: string,
		line: number,
		character: number,
		newName: string,
		signal?: AbortSignal,
	): Promise<LspRenameResult> {
		const absPath = this.resolveWorkspacePath(filePath);
		await this.openFile(absPath);
		const acquired = this.workspaceMutations.acquire(signal);
		if (!acquired.success) return { edit: null, apply: acquired.result };
		const preCommitSignal = createPreCommitAbortSignal(signal, () =>
			this.workspaceMutations.isBeforeCommit(acquired.lease),
		);
		try {
			const renameParams = {
				textDocument: { uri: pathToFileURL(absPath).href },
				position: { line: line - 1, character },
				newName,
			};
			const edit =
				preCommitSignal === undefined
					? await this.sendRequest<WorkspaceEdit | null>("textDocument/rename", renameParams)
					: await this.sendRequest<WorkspaceEdit | null>("textDocument/rename", renameParams, {
							signal: preCommitSignal.signal,
						});
			return await this.workspaceMutations.reconcileRename(acquired.lease, edit);
		} finally {
			preCommitSignal?.dispose();
			this.workspaceMutations.release(acquired.lease);
			}
	}

	private resolveWorkspacePath(filePath: string): string {
		return resolve(this.root, filePath);
	}
}

function waitForDiagnosticsActivity(wait: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
	if (!signal) return wait;
	if (signal.aborted) return Promise.reject(abortError(signal));
	return new Promise((resolve, reject) => {
		const onAbort = (): void => {
			signal.removeEventListener("abort", onAbort);
			reject(abortError(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		wait.then(
			() => {
				signal.removeEventListener("abort", onAbort);
				resolve();
			},
			(error) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}

function createPreCommitAbortSignal(
	source: AbortSignal | undefined,
	isBeforeCommit: () => boolean,
): { readonly signal: AbortSignal; readonly dispose: () => void } | undefined {
	if (!source) return undefined;
	const controller = new AbortController();
	const onAbort = (): void => {
		if (isBeforeCommit() && !controller.signal.aborted) controller.abort(preCommitAbortReason(source));
	};
	if (source.aborted) onAbort();
	else source.addEventListener("abort", onAbort, { once: true });
	return {
		signal: controller.signal,
		dispose: () => source.removeEventListener("abort", onAbort),
	};
}

function preCommitAbortReason(source: AbortSignal): Error {
	const reason = source.reason;
	if (reason instanceof Error && reason.name !== "AbortError") return reason;
	return new Error("LSP request cancelled before workspace edit commit");
}

function abortError(signal: AbortSignal): Error {
	const reason = signal.reason;
	if (reason instanceof Error) return reason;
	const error = new Error(typeof reason === "string" ? reason : "operation cancelled");
	error.name = "AbortError";
	return error;
}
