import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { contextCwd } from "../request-context.js";
import { LspClientConnection } from "./connection.js";
import { effectiveExtension } from "./effective-extension.js";
import { getLanguageId } from "./language-mappings.js";
import { canonicalUri } from "./transport.js";
import type {
	Diagnostic,
	DocumentSymbol,
	Location,
	LocationLink,
	PrepareRenameDefaultBehavior,
	PrepareRenameResult,
	Range,
	SymbolInfo,
	WorkspaceEdit,
} from "./types.js";

const POST_OPEN_DELAY_MS = 1000;
const POST_DIAGNOSTICS_WAIT_MS = 500;
const DIAGNOSTICS_PUSH_POLL_ATTEMPTS = 10;
const DIAGNOSTICS_PUSH_POLL_INTERVAL_MS = 1000;

export class LspClient extends LspClientConnection {
	private readonly openedFiles = new Set<string>();
	private readonly documentVersions = new Map<string, number>();
	private readonly lastSyncedText = new Map<string, string>();
	private readonly diagnosticPullErrors: Error[] = [];

	getDiagnosticPullErrors(): readonly Error[] {
		return this.diagnosticPullErrors;
	}

	async openFile(filePath: string): Promise<void> {
		const absPath = resolve(contextCwd(), filePath);
		const uri = pathToFileURL(absPath).href;
		const text = readFileSync(absPath, "utf-8");

		if (!this.openedFiles.has(absPath)) {
			const ext = effectiveExtension(absPath);
			const languageId = getLanguageId(ext);
			const version = 1;

			await this.sendNotification("textDocument/didOpen", {
				textDocument: {
					uri,
					languageId,
					version,
					text,
				},
			});

			this.openedFiles.add(absPath);
			this.documentVersions.set(uri, version);
			this.lastSyncedText.set(uri, text);
			await new Promise((r) => setTimeout(r, POST_OPEN_DELAY_MS));
			return;
		}

		const prevText = this.lastSyncedText.get(uri);
		if (prevText === text) {
			return;
		}

		const nextVersion = (this.documentVersions.get(uri) ?? 1) + 1;
		this.documentVersions.set(uri, nextVersion);
		this.lastSyncedText.set(uri, text);

		await this.sendNotification("textDocument/didChange", {
			textDocument: { uri, version: nextVersion },
			contentChanges: [{ text }],
		});

		await this.sendNotification("textDocument/didSave", {
			textDocument: { uri },
			text,
		});
	}

	async definition(
		filePath: string,
		line: number,
		character: number,
	): Promise<Location | LocationLink | Array<Location | LocationLink> | null> {
		const absPath = resolve(contextCwd(), filePath);
		await this.openFile(absPath);
		return this.sendRequest<Location | LocationLink | Array<Location | LocationLink> | null>(
			"textDocument/definition",
			{
				textDocument: { uri: pathToFileURL(absPath).href },
				position: { line: line - 1, character },
			},
		);
	}

	async references(filePath: string, line: number, character: number, includeDeclaration = true): Promise<Location[]> {
		const absPath = resolve(contextCwd(), filePath);
		await this.openFile(absPath);
		return this.sendRequest<Location[]>("textDocument/references", {
			textDocument: { uri: pathToFileURL(absPath).href },
			position: { line: line - 1, character },
			context: { includeDeclaration },
		});
	}

	async documentSymbols(filePath: string): Promise<Array<DocumentSymbol | SymbolInfo>> {
		const absPath = resolve(contextCwd(), filePath);
		await this.openFile(absPath);
		return this.sendRequest<Array<DocumentSymbol | SymbolInfo>>("textDocument/documentSymbol", {
			textDocument: { uri: pathToFileURL(absPath).href },
		});
	}

	async workspaceSymbols(query: string): Promise<SymbolInfo[]> {
		return this.sendRequest<SymbolInfo[]>("workspace/symbol", { query });
	}

	private isUnsupportedDiagnosticPullError(error: unknown): boolean {
		if (!(error instanceof Error)) return false;
		const code = "code" in error && typeof error.code === "number" ? error.code : undefined;
		if (code === -32601) return true;
		return /unsupported|not supported|method not found|unknown request/i.test(error.message);
	}

	async diagnostics(filePath: string): Promise<{ items: Diagnostic[] }> {
		const absPath = resolve(contextCwd(), filePath);
		const uri = canonicalUri(pathToFileURL(absPath).href);
		await this.openFile(absPath);
		await new Promise((r) => setTimeout(r, POST_DIAGNOSTICS_WAIT_MS));

		// Poll for pushed diagnostics: on first use the language server may still
		// be loading the project (tsserver on large workspaces can take seconds),
		// so a single short wait frequently returns nothing.
		for (let attempt = 0; attempt < DIAGNOSTICS_PUSH_POLL_ATTEMPTS; attempt++) {
			const pushed = this.getStoredDiagnostics(uri);
			if (pushed.length > 0) {
				return { items: pushed };
			}
			await new Promise((r) => setTimeout(r, DIAGNOSTICS_PUSH_POLL_INTERVAL_MS));
		}

		try {
			const result = await this.sendRequest<{ items?: Diagnostic[] }>("textDocument/diagnostic", {
				textDocument: { uri },
			});
			const pulled = result.items;
			if (pulled && pulled.length > 0) {
				return { items: pulled };
			}
		} catch (error) {
			if (!this.isUnsupportedDiagnosticPullError(error)) {
				this.diagnosticPullErrors.push(error instanceof Error ? error : new Error(String(error)));
			}
		}

		return { items: this.getStoredDiagnostics(uri) };
	}

	async prepareRename(
		filePath: string,
		line: number,
		character: number,
	): Promise<PrepareRenameResult | PrepareRenameDefaultBehavior | Range | null> {
		const absPath = resolve(contextCwd(), filePath);
		await this.openFile(absPath);
		return this.sendRequest<PrepareRenameResult | PrepareRenameDefaultBehavior | Range | null>(
			"textDocument/prepareRename",
			{
				textDocument: { uri: pathToFileURL(absPath).href },
				position: { line: line - 1, character },
			},
		);
	}

	async rename(filePath: string, line: number, character: number, newName: string): Promise<WorkspaceEdit | null> {
		const absPath = resolve(contextCwd(), filePath);
		await this.openFile(absPath);
		return this.sendRequest<WorkspaceEdit | null>("textDocument/rename", {
			textDocument: { uri: pathToFileURL(absPath).href },
			position: { line: line - 1, character },
			newName,
		});
	}
}
