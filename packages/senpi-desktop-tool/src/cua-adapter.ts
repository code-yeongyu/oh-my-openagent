import {
	actionsOf,
	actionsScript,
	type ComputerActionsInput,
	ComputerActionsParams,
	isReadOnlyActions,
	type ScreenshotBounds,
} from "./cua-actions";
import { computerFailure } from "./cua-errors";
import { DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS } from "./params";
import { COMPUTER_PERMISSION, type PermissionRequest } from "./permission";
import type { ComputerHostContext } from "./session";
import { type ComputerToolDeps, type ComputerToolResult, runComputer } from "./tool";

export const COMPUTER_ACTIONS_TOOL_NAME = "computer_actions";

interface StepOutcome {
	readonly index: number;
	readonly action: string;
	readonly status: "success" | "error";
	readonly code?: string;
	readonly message?: string;
}

interface ActionsOutcome {
	readonly steps: readonly StepOutcome[];
	readonly bounds: ScreenshotBounds | null;
	readonly failedIndex: number | null;
}

function isActionsOutcome(value: unknown): value is ActionsOutcome {
	return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "steps"));
}

const DESCRIPTION = [
	"Drive the user's real desktop with OpenAI computer-use actions: screenshot, click, double_click, move, drag, scroll, type, keypress, wait, or a batch of them.",
	"x,y are pixels of the latest screenshot. A batch stops at the first failed action; an in-batch screenshot becomes the frame for the actions after it.",
	"Errors carry COMPUTER_* codes with a recovery hint. COMPUTER_SUSPENDED or COMPUTER_SUPERVISOR_NOT_LIVE means the user stopped you: stop and wait.",
].join("\n");

/** Rules `computer:read` / `computer:exec` apply, exactly as for the `computer` tool. */
export function computerActionsPermissionParser(
	_toolName: string,
	input: Record<string, unknown>,
	_cwd: string,
): PermissionRequest[] {
	const tier = isReadOnlyActions(input) ? "read" : "exec";
	return [{ permission: COMPUTER_PERMISSION, patterns: [tier], always: [tier] }];
}

/**
 * The optional `computer_actions` tool (`computer.cuaAdapter`): gajae-code's OpenAI computer-use action schema
 * over the same desktop facade, session, stop path, and audit as the `computer` tool. It adds no input path.
 */
export function createComputerActionsTool(deps: ComputerToolDeps) {
	let bounds: ScreenshotBounds | null = null;
	return {
		name: COMPUTER_ACTIONS_TOOL_NAME,
		label: "Computer actions",
		description: DESCRIPTION,
		exposure: "search" as const,
		searchText: "OpenAI computer-use actions: screenshot, click, type, keypress, scroll, drag, batch",
		searchKeywords: ["computer use", "cua", "openai computer", "click", "screenshot", "keypress"],
		searchGroup: "desktop",
		parameters: ComputerActionsParams,
		executionMode: "sequential" as const,
		async execute(
			_toolCallId: string,
			params: ComputerActionsInput,
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			context: ComputerHostContext,
		): Promise<ComputerToolResult & { isError?: boolean }> {
			const stopHotkey = deps.handle.settings().stopHotkey;
			const timeoutSeconds = Math.min(params.timeout ?? DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS);
			const readOnly = isReadOnlyActions(params);
			const code = actionsScript(actionsOf(params), bounds);
			let result: ComputerToolResult;
			try {
				result = await runComputer(deps, context, { code, readOnly, timeoutSeconds }, signal);
			} catch (error) {
				if (!(error instanceof Error)) throw error;
				const reason = Reflect.get(error, "reason") ?? Reflect.get(error, "code") ?? error.name;
				const failure = computerFailure(String(reason), error.message, stopHotkey);
				return { content: [{ type: "text", text: failure.message }], details: { value: failure }, isError: true };
			}
			const outcome = result.details.value;
			if (!isActionsOutcome(outcome)) return result;
			bounds = outcome.bounds;
			const images = result.content.filter((part) => part.type === "image");
			const failed = outcome.failedIndex === null ? undefined : outcome.steps[outcome.failedIndex];
			if (failed === undefined) {
				const text = `${outcome.steps.length} action(s) done: ${outcome.steps.map((step) => step.action).join(", ")}.`;
				return { ...result, content: [...images, { type: "text", text }] };
			}
			const failure = computerFailure(failed.code ?? "Error", failed.message ?? "action failed", stopHotkey);
			const text = `Action ${failed.index + 1} (${failed.action}) failed. ${failure.message}`;
			return {
				content: [...images, { type: "text", text }],
				details: { ...result.details, value: { ...outcome, failure } },
				isError: true,
			};
		},
	};
}

export type ComputerActionsTool = ReturnType<typeof createComputerActionsTool>;
