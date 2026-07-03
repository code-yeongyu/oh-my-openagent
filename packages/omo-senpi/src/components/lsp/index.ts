import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types";
import { disposeDefaultLspManager, getLspManager } from "./lsp/manager-default.js";
import {
	appendPostEditDiagnostics,
	POST_EDIT_DIAGNOSTICS_WIDGET_KEY,
	syncPostEditDiagnosticsWidget,
	type DiagnosticsRunner,
	type ToolResultLike,
} from "./lsp/post-edit-diagnostics.js";
import { getAllServers } from "./lsp/server-resolution.js";
import { lsp_diagnostics } from "./lsp/tools/diagnostics.js";
import { lsp_find_references } from "./lsp/tools/find-references.js";
import { lsp_goto_definition } from "./lsp/tools/goto-definition.js";
import { lsp_prepare_rename, lsp_rename } from "./lsp/tools/rename.js";
import { lsp_symbols } from "./lsp/tools/symbols.js";

const LSP_TOOLS_ENABLED_FLAG = "omo-senpi-lsp-tools-enabled";
const LSP_POST_EDIT_DIAGNOSTICS_ENABLED_FLAG = "omo-senpi-lsp-post-edit-diagnostics-enabled";

type WidgetPlacement = "aboveEditor" | "belowEditor";

interface WidgetContext {
	readonly ui?: {
		setWidget?(key: string, content: readonly string[] | undefined, options?: { placement?: WidgetPlacement }): void;
	};
}

interface ToolResultHandlerResult {
	readonly content?: ToolResultLike["content"];
}

export function createLspComponent(): OmoSenpiComponent {
	return {
		name: "lsp",
		register(pi, ctx) {
			registerLspFlags(pi);
			if (ctx.config.getFlag(LSP_TOOLS_ENABLED_FLAG) === false) return;

			const installedServers = getAllServers().filter((server) => server.installed && !server.disabled);
			if (installedServers.length === 0) {
				ctx.logger.warn("omo-senpi lsp component inert: no installed language server is resolvable");
				return;
			}

			registerLspTools(pi);

			if (ctx.config.getFlag(LSP_POST_EDIT_DIAGNOSTICS_ENABLED_FLAG) !== false) {
				pi.on("tool_result", (event, eventCtx) => handlePostEditDiagnosticsToolResult(event, eventCtx));
			}

			pi.on("session_shutdown", async () => {
				await disposeDefaultLspManager();
			});
		},
	};
}

function registerLspFlags(pi: SenpiExtensionAPI): void {
	pi.registerFlag(LSP_TOOLS_ENABLED_FLAG, {
		type: "boolean",
		default: true,
		description: "Enable omo-senpi LSP tools.",
	});
	pi.registerFlag(LSP_POST_EDIT_DIAGNOSTICS_ENABLED_FLAG, {
		type: "boolean",
		default: true,
		description: "Enable omo-senpi post-edit LSP diagnostics.",
	});
}

function registerLspTools(pi: SenpiExtensionAPI): void {
	for (const tool of [
		lsp_diagnostics,
		lsp_goto_definition,
		lsp_find_references,
		lsp_symbols,
		lsp_prepare_rename,
		lsp_rename,
	]) {
		pi.registerTool(tool);
	}
}

export async function handlePostEditDiagnosticsToolResult(
	event: unknown,
	ctx?: unknown,
	runDiagnostics: DiagnosticsRunner = runLspDiagnosticsForPostEdit,
): Promise<ToolResultHandlerResult | undefined> {
	if (!isToolResultLike(event)) return undefined;
	const result = await appendPostEditDiagnostics(event, runDiagnostics);
	syncPostEditDiagnosticsWidget((key, content, options) => {
		if (isWidgetContext(ctx)) {
			ctx.ui?.setWidget?.(key, content, options);
		}
	}, result);
	return result?.content ? { content: result.content } : undefined;
}

async function runLspDiagnosticsForPostEdit(filePath: string): Promise<string> {
	const result = await lsp_diagnostics.execute(
		`omo-senpi-post-edit-diagnostics:${filePath}`,
		{ filePath, severity: "error" },
		undefined,
		undefined,
		undefined,
	);
	await disposeIdleFakeClients();
	return result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

async function disposeIdleFakeClients(): Promise<void> {
	const manager = getLspManager();
	if (manager.getSnapshot().some((snapshot) => snapshot.command[0] === "omo-senpi-fake-ls")) {
		await disposeDefaultLspManager();
	}
}

function isToolResultLike(value: unknown): value is ToolResultLike {
	if (!isRecord(value)) return false;
	return (
		typeof value["toolCallId"] === "string" &&
		typeof value["toolName"] === "string" &&
		isRecord(value["input"]) &&
		Array.isArray(value["content"]) &&
		typeof value["isError"] === "boolean"
	);
}

function isWidgetContext(value: unknown): value is WidgetContext {
	return isRecord(value) && (value["ui"] === undefined || isRecord(value["ui"]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
