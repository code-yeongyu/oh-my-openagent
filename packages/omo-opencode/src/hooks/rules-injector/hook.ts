import type { PluginInput } from "@opencode-ai/plugin";
import { contextCollector } from "../../features/context-injector";
import { createDynamicTruncator } from "../../shared/dynamic-truncator";
import { resolveSessionEventID } from "../../shared/event-session-id";
import {
	createSessionCacheStore,
	createSessionRuleScanCacheStore,
} from "./cache";
import { clearParsedRuleCache, createRuleInjectionProcessor } from "./injector";
import { getRuleInjectionFilePath } from "./output-path";
import { clearProjectRootCache } from "./project-root-finder";
import { createTranscriptHydrationStore } from "./transcript-hydration";

interface ToolExecuteInput {
	tool: string;
	sessionID: string;
	callID: string;
}

interface ToolExecuteOutput {
	title: string;
	output: string;
	metadata: unknown;
}

interface ToolExecuteBeforeOutput {
	args: unknown;
}

interface EventInput {
	event: {
		type: string;
		properties?: unknown;
	};
}

const TRACKED_TOOLS = ["read", "write", "edit", "multiedit"];

function getFilePathFromArgs(args: unknown): string | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const record = args as Record<string, unknown>;
	const candidate = record.filePath ?? record.path ?? record.file_path;
	return typeof candidate === "string" && candidate.length > 0
		? candidate
		: undefined;
}

export function createRulesInjectorHook(
	ctx: PluginInput,
	modelCacheState?: { anthropicContext1MEnabled: boolean },
	options?: { skipClaudeUserRules?: boolean },
) {
	const truncator = createDynamicTruncator(ctx, modelCacheState);
	const { getSessionCache, clearSessionCache } = createSessionCacheStore();
	const { getSessionRuleScanCache, clearSessionRuleScanCache } =
		createSessionRuleScanCacheStore();
	const transcriptHydration = createTranscriptHydrationStore({
		client: ctx.client,
	});
	const { processFilePathForInjection } = createRuleInjectionProcessor({
		workspaceDirectory: ctx.directory,
		truncator,
		getSessionCache,
		getSessionRuleScanCache,
		transcriptHydration,
		ruleFinderOptions: options?.skipClaudeUserRules
			? { skipClaudeUserRules: true }
			: undefined,
	});

	function clearSessionState(sessionID: string): void {
		clearSessionCache(sessionID);
		clearSessionRuleScanCache(sessionID);
		transcriptHydration.clearSession(sessionID);
		clearParsedRuleCache();
	}

	const toolExecuteAfter = async (
		input: ToolExecuteInput,
		output: ToolExecuteOutput,
	) => {
		const toolName = input.tool.toLowerCase();

		if (TRACKED_TOOLS.includes(toolName)) {
			const filePath = getRuleInjectionFilePath(output);
			if (!filePath) return;
			await processFilePathForInjection(filePath, input.sessionID, output);
			return;
		}
	};

	const toolExecuteBefore = async (
		input: ToolExecuteInput,
		output: ToolExecuteBeforeOutput,
	): Promise<void> => {
		const toolName = input.tool.toLowerCase();

		if (!TRACKED_TOOLS.includes(toolName)) return;

		const filePath = getFilePathFromArgs(output.args);
		if (!filePath) return;

		await processFilePathForInjection(
			filePath,
			input.sessionID,
			{ title: "", output: "", metadata: undefined },
			(entry) => {
				contextCollector.register(input.sessionID, {
					id: entry.id,
					source: "rules-injector",
					content: entry.content,
					priority: "critical",
					metadata: { registeredAt: "tool.execute.before" },
				});
			},
		);
	};

	const eventHandler = async ({ event }: EventInput) => {
		const props = event.properties as Record<string, unknown> | undefined;

		if (event.type === "session.deleted") {
			const sessionID = resolveSessionEventID(props);
			if (sessionID) {
				clearSessionState(sessionID);
			}
			clearProjectRootCache();
		}

		if (event.type === "session.compacted") {
			const sessionID = resolveSessionEventID(props);
			if (sessionID) {
				clearSessionState(sessionID);
			}
			clearProjectRootCache();
		}
	};

	return {
		"tool.execute.before": toolExecuteBefore,
		"tool.execute.after": toolExecuteAfter,
		event: eventHandler,
	};
}
