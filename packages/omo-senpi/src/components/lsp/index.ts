import { reportToolHookStatus } from "../../extension/tool-hook-status";
import type { PostEditDiagnosticsOutcome } from "@oh-my-opencode/lsp-core/post-edit";
import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types";
import {
	lsp_diagnostics,
	lsp_find_references,
	lsp_goto_definition,
	lsp_prepare_rename,
	lsp_rename,
	lsp_symbols,
} from "./adapter/descriptors.js";
import { getConfigNotices } from "./adapter/migration-notices.js";
import { callPackagedDaemonTool, clearPackagedDaemonToolClientCache } from "./daemon-tool-client.js";
import {
	appendPostEditDiagnostics,
	createLspPostEditSessionState,
	POST_EDIT_DIAGNOSTICS_WIDGET_KEY,
	shouldRunPostEditDiagnostics,
	syncPostEditDiagnosticsWidget,
	type DiagnosticsRunner,
	type LspPostEditSessionState,
	type ToolResultLike,
} from "./post-edit-diagnostics.js";

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

interface LspComponentOptions {
	readonly postEdit?: {
		readonly runDiagnostics?: DiagnosticsRunner;
		readonly state?: LspPostEditSessionState;
	};
}

const DEFAULT_POST_EDIT_SESSION_STATE = createLspPostEditSessionState();

export { createLspPostEditSessionState };

export function createLspComponent(options: LspComponentOptions = {}): OmoSenpiComponent {
	const postEditState = options.postEdit?.state ?? createLspPostEditSessionState();
	const runPostEditDiagnostics = options.postEdit?.runDiagnostics ?? runLspDiagnosticsForPostEdit;
	return {
		name: "lsp",
		register(pi, ctx) {
			registerLspFlags(pi);
			if (ctx.config.getFlag(LSP_TOOLS_ENABLED_FLAG) === false) return;

			for (const notice of getConfigNotices()) {
				ctx.logger.warn(
					"omo-senpi ignored project-local LSP commands; move custom commands to the user .pi config",
					notice,
				);
			}

			registerLspTools(pi);

			if (ctx.config.getFlag(LSP_POST_EDIT_DIAGNOSTICS_ENABLED_FLAG) !== false) {
				pi.on("tool_result", (event, eventCtx) =>
					handlePostEditDiagnosticsToolResult(event, eventCtx, runPostEditDiagnostics, postEditState),
				);
				pi.on("session_start", (_event, eventCtx) => {
					postEditState.onSessionStart(sessionIdFromContext(eventCtx));
				});
				pi.on("session_compact", (_event, eventCtx) => {
					postEditState.reset(sessionIdFromContext(eventCtx));
				});
			}

			pi.on("session_shutdown", (_event, eventCtx) => {
				postEditState.delete(sessionIdFromContext(eventCtx));
				clearPackagedDaemonToolClientCache();
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
		pi.registerTool(withPackagedDaemonRuntime(tool));
	}
}

type LspTool = {
	readonly name: string;
	execute(
		toolCallId: string,
		rawParams: unknown,
		signal?: AbortSignal,
		onUpdate?: unknown,
		ctx?: unknown,
	): Promise<unknown>;
};

function withPackagedDaemonRuntime<TTool extends LspTool>(tool: TTool): TTool {
	return {
		...tool,
		async execute(
			toolCallId: string,
			rawParams: unknown,
			signal?: AbortSignal,
			onUpdate?: unknown,
			ctx?: unknown,
		): Promise<unknown> {
			const args = isRecord(rawParams) ? rawParams : {};
			return callPackagedDaemonTool(tool.name, args, signal === undefined ? {} : { signal });
		},
	};
}

export async function handlePostEditDiagnosticsToolResult(
	event: unknown,
	ctx?: unknown,
	runDiagnostics: DiagnosticsRunner = runLspDiagnosticsForPostEdit,
	state: LspPostEditSessionState = DEFAULT_POST_EDIT_SESSION_STATE,
): Promise<ToolResultHandlerResult | undefined> {
	if (!isToolResultLike(event)) return undefined;
	if (shouldRunPostEditDiagnostics(event)) {
		reportToolHookStatus(ctx, "(OmO) Checking LSP Diagnostics");
	}
	const result = await appendPostEditDiagnostics(event, runDiagnostics, state.getOrCreate(sessionIdFromContext(ctx)));
	syncPostEditDiagnosticsWidget((key, content, options) => {
		if (isWidgetContext(ctx)) {
			ctx.ui?.setWidget?.(key, content, options);
		}
	}, result);
	return result?.content ? { content: result.content } : undefined;
}

async function runLspDiagnosticsForPostEdit(filePath: string): Promise<PostEditDiagnosticsOutcome> {
	const result = await callPackagedDaemonTool("lsp_diagnostics", { filePath, severity: "error" });
	return postEditOutcomeFromDaemonResult(result);
}

function postEditOutcomeFromDaemonResult(result: {
	readonly content: readonly { readonly type: string; readonly text?: string }[];
	readonly details?: unknown;
}): PostEditDiagnosticsOutcome {
	const availability = notConfiguredAvailability(result.details);
	if (availability !== undefined) return { kind: "not_configured", extension: availability.extension };
	return result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function notConfiguredAvailability(details: unknown): { readonly extension: string } | undefined {
	if (!isRecord(details)) return undefined;
	const availability = details["availability"];
	if (!isRecord(availability)) return undefined;
	if (availability["kind"] !== "not_configured") return undefined;
	const extension = availability["extension"];
	return typeof extension === "string" && extension.length > 0 ? { extension } : undefined;
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

function sessionIdFromContext(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	const sessionManager = value["sessionManager"];
	if (!isRecord(sessionManager)) return undefined;
	const getSessionId = sessionManager["getSessionId"];
	if (typeof getSessionId !== "function") return undefined;
	const sessionId: unknown = Reflect.apply(getSessionId, sessionManager, []);
	return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
