import { pathToFileURL } from "node:url";

import { LspClientTransport } from "./transport.js";

interface InitializeCapabilities {
	readonly diagnosticProvider?: unknown;
}

function supportsDiagnosticPull(capabilities: InitializeCapabilities | undefined): boolean {
	if (capabilities === undefined) return false;
	return Object.hasOwn(capabilities, "diagnosticProvider");
}

export class LspClientConnection extends LspClientTransport {
	async initialize(): Promise<void> {
		const rootUri = pathToFileURL(this.root).href;
		const result = await this.sendRequest<{ readonly capabilities?: InitializeCapabilities }>(
			"initialize",
			{
				processId: process.pid,
				rootUri,
				rootPath: this.root,
				workspaceFolders: [{ uri: rootUri, name: "workspace" }],
				capabilities: {
					textDocument: {
						hover: { contentFormat: ["markdown", "plaintext"] },
						definition: { linkSupport: true },
						references: {},
						documentSymbol: { hierarchicalDocumentSymbolSupport: true },
						publishDiagnostics: {},
						rename: {
							prepareSupport: true,
							prepareSupportDefaultBehavior: 1,
						},
						codeAction: {
							codeActionLiteralSupport: {
								codeActionKind: {
									valueSet: [
										"quickfix",
										"refactor",
										"refactor.extract",
										"refactor.inline",
										"refactor.rewrite",
										"source",
										"source.organizeImports",
										"source.fixAll",
									],
								},
							},
							isPreferredSupport: true,
							disabledSupport: true,
							dataSupport: true,
							resolveSupport: {
								properties: ["edit", "command"],
							},
						},
					},
					workspace: {
						symbol: {},
						workspaceFolders: true,
						configuration: true,
						...(this.hasWorkspaceApplyEditHandler() ? { applyEdit: true } : {}),
						workspaceEdit: {
							documentChanges: true,
							resourceOperations: ["create", "rename", "delete"],
						},
					},
				},
				initializationOptions: this.server.initialization,
			},
			{ timeoutMs: this.initializeTimeoutMs },
		);
		this.setDiagnosticPullSupported(supportsDiagnosticPull(result?.capabilities));
		await this.sendNotification("initialized");
		await this.sendNotification("workspace/didChangeConfiguration", {
			settings: { json: { validate: { enable: true } } },
		});
	}
}
