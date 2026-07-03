import type { TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "../../types.ts";
import { isReadToolResult } from "../../types.ts";
import { injectDirectoryContext } from "./core/inject-directory-context.ts";
import { InjectionCache } from "./core/injection-cache.ts";
import { getSessionKey } from "./core/session-key.ts";
import {
	buildDebugRecord,
	clearStatus,
	clearWidget,
	type InjectedFileMeta,
	updateStatus,
	updateWidget,
} from "./ui/reporter.ts";

const FLAG_DISABLE = "no-nested-agents";
const COMMAND_TOGGLE = "nested-agents";
const ENTRY_TYPE_DEBUG = "nested-agents-md:debug";

export default function nestedAgentsMd(pi: ExtensionAPI): void {
	pi.registerFlag(FLAG_DISABLE, {
		description: "Disable nested AGENTS.md context injection.",
		type: "boolean",
		default: false,
	});

	const cache = new InjectionCache();
	const filesPerSession = new Map<string, Map<string, InjectedFileMeta>>();
	const errorsPerSession = new Map<string, boolean>();
	// Widget visibility is extension-scoped because command registration currently has no session-local state hook.
	let widgetVisible = false;
	let disabled = false;

	pi.on("session_start", async (_event, ctx) => {
		disabled = pi.getFlag(FLAG_DISABLE) === true;
		if (disabled) {
			clearStatus(ctx);
			clearWidget(ctx);
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		if (disabled) return undefined;
		if (!isReadToolResult(event) || event.isError) return undefined;
		const filePath = event.input.path;
		if (typeof filePath !== "string" || filePath.length === 0) return undefined;
		const hasText = event.content.some((block) => block.type === "text");
		if (!hasText) return undefined;

		const sessionKey = getSessionKey(ctx);
		const result = await injectDirectoryContext({
			filePath,
			rootDir: ctx.cwd,
			cache,
			sessionKey,
		});

		const errorsRecorded = errorsPerSession.get(sessionKey) === true;
		const hasErrors = errorsRecorded || result.errors.length > 0;
		if (result.errors.length > 0) errorsPerSession.set(sessionKey, true);

		if (!result.injectedText) {
			updateStatus(ctx, cache, sessionKey, hasErrors);
			return undefined;
		}

		let metaMap = filesPerSession.get(sessionKey);
		if (!metaMap) {
			metaMap = new Map();
			filesPerSession.set(sessionKey, metaMap);
		}
		for (const file of result.injectedFiles) {
			metaMap.set(file.absolutePath, {
				absolutePath: file.absolutePath,
				truncated: file.truncated,
			});
		}

		updateStatus(ctx, cache, sessionKey, hasErrors);
		if (widgetVisible) updateWidget(ctx, true, [...metaMap.values()]);

		const textBlock: TextContent = { type: "text", text: result.injectedText };
		return { content: [...event.content, textBlock] };
	});

	pi.on("session_compact", async (_event, ctx) => {
		const sessionKey = getSessionKey(ctx);
		cache.clearSession(sessionKey);
		filesPerSession.delete(sessionKey);
		errorsPerSession.delete(sessionKey);
		updateStatus(ctx, cache, sessionKey, false);
		if (widgetVisible) updateWidget(ctx, true, []);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const sessionKey = getSessionKey(ctx);
		cache.clearSession(sessionKey);
		filesPerSession.delete(sessionKey);
		errorsPerSession.delete(sessionKey);
	});

	pi.registerCommand(COMMAND_TOGGLE, {
		description: "Toggle the nested AGENTS.md context widget and dump cache state.",
		handler: async (_args, ctx) => {
			if (disabled) {
				ctx.ui.notify("nested-agents-md is disabled via --no-nested-agents", "info");
				return;
			}
			widgetVisible = !widgetVisible;
			const sessionKey = getSessionKey(ctx);
			const files = [...(filesPerSession.get(sessionKey)?.values() ?? [])];
			updateWidget(ctx, widgetVisible, files);
			pi.appendEntry(ENTRY_TYPE_DEBUG, buildDebugRecord({ cache, sessionKey, files }));
			ctx.ui.notify(
				widgetVisible ? "Nested AGENTS.md context widget shown" : "Nested AGENTS.md context widget hidden",
				"info",
			);
		},
	});
}
