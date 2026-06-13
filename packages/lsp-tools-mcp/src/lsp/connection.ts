import { pathToFileURL } from "node:url";

import { LspClientTransport } from "./transport.js";

const INITIALIZE_SETTLE_MS = 300;

export class LspClientConnection extends LspClientTransport {
	async initialize(): Promise<void> {
		const rootUri = pathToFileURL(this.root).href;
		await this.sendRequest(
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
							honorsChangeAnnotations: true,
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
						applyEdit: true,
						workspaceEdit: {
							documentChanges: true,
						},
					},
				},
				initializationOptions: this.server.initialization,
			},
			{ timeoutMs: this.initializeTimeoutMs },
		);
		await this.sendNotification("initialized");
		await this.sendNotification("workspace/didChangeConfiguration", {
			settings: { json: { validate: { enable: true } } },
		});
		// Some servers accept initialized before their diagnostics/indexing handlers are ready.
		await new Promise((r) => setTimeout(r, INITIALIZE_SETTLE_MS));
	}
}
