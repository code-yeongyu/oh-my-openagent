import { reportToolHookStatus } from "../../extension/tool-hook-status";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSenpiOmoConfig } from "../config-resolution";
import { classifyPostEditFileLocation, type PostEditDiagnosticsOutcome } from "@oh-my-opencode/lsp-core/post-edit";
import { resolveAgentHome } from "../agent-home/resolve-agent-home";
import { resolveSessionAgentDir } from "../memory/session-context-resolver";
import type { createFormatterStep } from "../formatter/formatter";
import { MUTATION_TOOL_NAMES } from "../post-mutation/post-mutation";
import { createLazyValue, deferUntilAfterFirstPaint } from "../../extension/startup-deferral";
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
import { postEditOutcomeFromDaemonResult } from "./post-edit-outcome.js";

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
	readonly formatter?: ReturnType<typeof createFormatterStep>;
	readonly postEdit?: {
		readonly runDiagnostics?: DiagnosticsRunner;
		readonly state?: LspPostEditSessionState;
	};
	readonly callDaemonTool?: DaemonToolCaller;
}

const DEFAULT_POST_EDIT_SESSION_STATE = createLspPostEditSessionState();

export { createLspPostEditSessionState };

export function createLspComponent(options: LspComponentOptions = {}): OmoSenpiComponent {
	const postEditState = options.postEdit?.state ?? createLspPostEditSessionState();
	return {
		name: "lsp",
		register(pi, ctx) {
			const cwd = pi.cwd ?? process.cwd();
			const runPostEditDiagnostics = options.postEdit?.runDiagnostics ?? createLspDiagnosticsRunner(cwd, options.callDaemonTool);
			// The formatter reads omo config and the project's formatter markers off disk, and nothing
			// before the first mutation tool result can observe it: built on first use, so a session
			// that never edits a file never pays for it.
			const formatMutation = createLazyValue(async () => options.formatter ?? (await import("#omo-lsp-formatter-runtime")).createFormatterStep({
				config: loadSenpiOmoConfig({ cwd }).config.formatOnMutation,
				markers: markerCwd => listProjectMarkers(markerCwd),
				readMarker: (markerCwd, marker) => readProjectMarker(markerCwd, marker),
				logger: ctx.logger,
			}));
			registerLspFlags(pi);
			if (ctx.config.getFlag(LSP_TOOLS_ENABLED_FLAG) === false) return;

			// A startup diagnostic, not a precondition: reading both .pi configs is fs work the first
			// paint should not wait for, and the warning still reaches the same logger one tick later.
			deferUntilAfterFirstPaint(ctx, "lsp project-config notices", () => {
				for (const notice of getConfigNotices()) {
					ctx.logger.warn(
						"omo-senpi ignored project-local LSP commands; move custom commands to the user .pi config",
						notice,
					);
				}
			});

			registerLspTools(pi, cwd);

			pi.on("tool_result", async (event, eventCtx) => {
					const parsed = isToolResultLike(event) ? event : undefined;
					if (!parsed || parsed.isError || !MUTATION_TOOL_NAMES.has(parsed.toolName)) return undefined;
					const formatted = await (await formatMutation.get())(parsed, pi.cwd ?? process.cwd(), sessionIdFromContext(eventCtx));
					const afterFormat = formatted.content ? { ...parsed, content: [...parsed.content, ...formatted.content] } : parsed;
					if (formatted.error) return { content: afterFormat.content, isError: true };
					if (ctx.config.getFlag(LSP_POST_EDIT_DIAGNOSTICS_ENABLED_FLAG) === false) return formatted.content ? { content: afterFormat.content } : undefined;
					const diagnosed = await handlePostEditDiagnosticsToolResult(afterFormat, eventCtx, runPostEditDiagnostics, postEditState, pi.cwd ?? process.cwd());
					return diagnosed ?? (formatted.content ? { content: afterFormat.content } : undefined);
				});
			if (ctx.config.getFlag(LSP_POST_EDIT_DIAGNOSTICS_ENABLED_FLAG) !== false) {
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

function registerLspTools(pi: SenpiExtensionAPI, cwd: string): void {
	for (const tool of [
		lsp_diagnostics,
		lsp_goto_definition,
		lsp_find_references,
		lsp_symbols,
		lsp_prepare_rename,
		lsp_rename,
	]) {
		pi.registerTool(withPackagedDaemonRuntime(tool, cwd));
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

function withPackagedDaemonRuntime<TTool extends LspTool>(tool: TTool, cwd: string): TTool {
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
			return callPackagedDaemonTool(tool.name, args, { cwd, ...(signal === undefined ? {} : { signal }) });
		},
	};
}

export async function handlePostEditDiagnosticsToolResult(
	event: unknown,
	ctx?: unknown,
	runDiagnostics: DiagnosticsRunner = createLspDiagnosticsRunner(process.cwd()),
	state: LspPostEditSessionState = DEFAULT_POST_EDIT_SESSION_STATE,
	cwd: string = process.cwd(),
): Promise<ToolResultHandlerResult | undefined> {
	if (!isToolResultLike(event)) return undefined;
	if (shouldRunPostEditDiagnostics(event)) {
		reportToolHookStatus(ctx, "(OmO) Checking LSP Diagnostics");
	}
	const agentDirs = [resolveSessionAgentDir(ctx) ?? resolveAgentHome({ env: process.env })];
	const locateFile = (filePath: string) => classifyPostEditFileLocation(filePath, { cwd, agentDirs });
	const result = await appendPostEditDiagnostics(event, runDiagnostics, state.getOrCreate(sessionIdFromContext(ctx)), locateFile);
	syncPostEditDiagnosticsWidget((key, content, options) => {
		if (isWidgetContext(ctx)) {
			ctx.ui?.setWidget?.(key, content, options);
		}
	}, result);
	return result?.content ? { content: result.content } : undefined;
}

type DaemonToolCaller = typeof callPackagedDaemonTool;

export function createLspDiagnosticsRunner(cwd: string, callDaemonTool: DaemonToolCaller = callPackagedDaemonTool): DiagnosticsRunner {
	return async (filePath: string): Promise<PostEditDiagnosticsOutcome> => {
		const result = await callDaemonTool("lsp_diagnostics", { filePath, severity: "error" }, { cwd });
		return postEditOutcomeFromDaemonResult(result);
	};
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

function listProjectMarkers(cwd: string): string[] {
	try { return readdirSync(cwd) } catch { return [] }
}
function readProjectMarker(cwd: string, marker: string): string {
	try { return readFileSync(join(cwd, marker), "utf8") } catch { return "" }
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
