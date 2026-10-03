import type { PermissionDeniedData } from "@oh-my-opencode/senpi-desktop-protocol";
import { DesktopEngineRpcError } from "@oh-my-opencode/senpi-desktop-service";
import {
	actionsOf,
	actionsScript,
	type ComputerActionsInput,
	isReadOnlyActions,
	parseComputerActions,
	type ScreenshotBounds,
} from "./cua-actions";
import { computerActionsToolDefinition } from "./cua-definition";
import { ComputerArgumentsError } from "./action-schema";
import { computerFailure } from "./cua-errors";
import { DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS } from "./params";
import type { ComputerHostContext } from "./session";
import { type ComputerToolDeps, type ComputerToolResult, runComputer } from "./tool";

interface StepOutcome {
	readonly index: number;
	readonly action: string;
	readonly status: "success" | "error";
	readonly code?: string;
	readonly message?: string;
	readonly permission?: PermissionDeniedData;
}

interface ActionsOutcome {
	readonly steps: readonly StepOutcome[];
	readonly bounds: ScreenshotBounds | null;
	readonly failedIndex: number | null;
}

function isActionsOutcome(value: unknown): value is ActionsOutcome {
	return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "steps"));
}

/**
 * The optional `computer_actions` tool (`computer.cuaAdapter`): gajae-code's OpenAI computer-use action schema
 * over the same desktop facade, session, stop path, and audit as the `computer` tool. It adds no input path.
 */
export function createComputerActionsTool(deps: ComputerToolDeps) {
	let bounds: ScreenshotBounds | null = null;
	return {
		...computerActionsToolDefinition,
		async execute(
			_toolCallId: string,
			input: Readonly<Record<string, unknown>>,
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			context: ComputerHostContext,
		): Promise<ComputerToolResult & { isError?: boolean }> {
			const stopHotkey = deps.handle.settings().stopHotkey;
			let params: ComputerActionsInput;
			try {
				params = parseComputerActions(input);
			} catch (error) {
				if (!(error instanceof ComputerArgumentsError)) throw error;
				const failure = computerFailure(error.code, error.reason, stopHotkey);
				return { content: [{ type: "text", text: failure.message }], details: { value: failure, isError: true }, isError: true };
			}
			const timeoutSeconds = Math.min(params.timeout ?? DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS);
			const readOnly = isReadOnlyActions(params);
			const code = actionsScript(actionsOf(params), bounds);
			let result: ComputerToolResult;
			try {
				result = await runComputer(deps, context, { code, readOnly, timeoutSeconds }, signal);
			} catch (error) {
				if (!(error instanceof Error)) throw error;
				const data = error instanceof DesktopEngineRpcError && error.data !== null && "code" in error.data
					? error.data : undefined;
				const reason = data?.code ?? Reflect.get(error, "reason") ?? Reflect.get(error, "code") ?? error.name;
				const failure = computerFailure(String(reason), error.message, stopHotkey, data?.permission);
				return { content: [{ type: "text", text: failure.message }], details: { value: failure, isError: true }, isError: true };
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
			const failure = computerFailure(failed.code ?? "Error", failed.message ?? "action failed", stopHotkey, failed.permission);
			const text = `Action ${failed.index + 1} (${failed.action}) failed. ${
				failure.permission === undefined ? failure.message : JSON.stringify(failure)
			}`;
			return {
				content: [...images, { type: "text", text }],
				details: { ...result.details, value: { ...outcome, failure }, isError: true },
				isError: true,
			};
		},
	};
}

export type ComputerActionsTool = ReturnType<typeof createComputerActionsTool>;
