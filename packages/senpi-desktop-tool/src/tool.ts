import {
	type AuditRecord,
	type ComputerCallStep,
	type ComputerDisplay,
	type ComputerScreenshot,
	isReadOnlyComputerCall,
} from "@oh-my-opencode/senpi-desktop-protocol";
import { DesktopEngineRpcError, type ExecuteTool, runComputerCode } from "@oh-my-opencode/senpi-desktop-service";
import type { ComputerHandle } from "./activation";
import { Check } from "typebox/value";
import { actionBranches, argumentsError } from "./action-schema";
import {
	ComputerActionBranches,
	ComputerActionShape,
	type ComputerToolParams,
	DEFAULT_TIMEOUT_SECONDS,
} from "./params";
import { type ComputerHostContext, runSnapshot } from "./session";
import { computerToolDefinition } from "./tool-definition";
import { computerFailure } from "./cua-errors";

export interface ComputerToolDeps {
	readonly handle: ComputerHandle;
	/** The host tool pipeline (`pi.executeTool`) behind `tool.<name>()` inside `run` code. */
	readonly executeTool: ExecuteTool;
}

/** `details` of every `computer` result; `value` is what the eval-kernel `computer` facade returns. */
export interface ComputerToolDetails {
	readonly value?: unknown;
	readonly readOnly?: boolean;
	readonly screenshots?: readonly ComputerScreenshot[];
	readonly audit?: readonly AuditRecord[];
}

/** Structurally the agent's `AgentToolResult<ComputerToolDetails>`. */
export interface ComputerToolResult {
	isError?: boolean;
	content: ComputerDisplay[];
	details: ComputerToolDetails;
}

const BRANCHES = actionBranches(ComputerActionBranches);

/** The flat published arguments narrowed to one action's exact shape; `ComputerArgumentsError` otherwise. */
export function parseComputerParams(input: unknown): ComputerToolParams {
	if (Check(ComputerActionShape, input)) return input;
	throw argumentsError(BRANCHES, input, "computer");
}

/** `desktop.<root>(...)` and at most one handle hop; every name was validated against the tier tables first. */
function renderCallChain(chain: readonly ComputerCallStep[]): string {
	const call = (step: ComputerCallStep) => `${step.method}(...${JSON.stringify(step.args ?? [])})`;
	const [root, hop] = chain;
	if (root === undefined) throw new TypeError("renderCallChain: empty chain");
	return hop === undefined
		? `return await desktop.${call(root)};`
		: `return await (await desktop.${call(root)}).${call(hop)};`;
}

function stringify(value: unknown): string {
	return typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
}

function valueResult(value: unknown, fallback: string): ComputerToolResult {
	const text = value === undefined ? fallback : stringify(value);
	return { content: [{ type: "text", text }], details: { value } };
}

function assertNever(value: never): never {
	throw new TypeError(`unhandled computer action ${JSON.stringify(value)}`);
}

/** A `computer` run: activates the session (arming the stop chord) and runs `code` through the desktop facade. */
export async function runComputer(
	deps: ComputerToolDeps,
	context: ComputerHostContext,
	request: { readonly code: string; readonly readOnly: boolean; readonly timeoutSeconds: number },
	signal: AbortSignal | undefined,
): Promise<ComputerToolResult> {
	const { handle, executeTool } = deps;
	await handle.activate(context);
	const snapshot = runSnapshot(handle.settings(), context, request.readOnly);
	const timeoutMs = request.timeoutSeconds * 1000;
	const outcome = await runComputerCode(
		{ code: request.code, snapshot, timeoutMs, ...(signal === undefined ? {} : { signal }) },
		{ service: handle.service, executeTool },
	);
	const content = [...outcome.displays];
	if (outcome.returnValue !== undefined) content.push({ type: "text", text: stringify(outcome.returnValue) });
	if (content.length === 0) content.push({ type: "text", text: "Done." });
	return {
		content,
		details: {
			value: outcome.returnValue,
			readOnly: request.readOnly,
			screenshots: outcome.screenshots,
			audit: outcome.audit,
		},
	};
}

/**
 * The senpi `computer` tool: search-exposed, with the eval-kernel `computer` facade as its `kernelPrelude`.
 * Permission tiers are enforced only by the permission-system `tool_call` hook through
 * `computerPermissionParser`; `execute` evaluates no rule and shows no prompt of its own.
 */
export function createComputerTool(deps: ComputerToolDeps) {
	const { handle } = deps;
	const run = (
		context: ComputerHostContext,
		request: Parameters<typeof runComputer>[2],
		signal: AbortSignal | undefined,
	) => runComputer(deps, context, request, signal);

	return {
		...computerToolDefinition,
		async execute(
			_toolCallId: string,
			input: Readonly<Record<string, unknown>>,
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			context: ComputerHostContext,
		): Promise<ComputerToolResult> {
			const params = parseComputerParams(input);
			switch (params.action) {
				case "call": {
					// Classifies (and rejects unknown or unchainable methods) before anything reaches the engine.
					const readOnly = isReadOnlyComputerCall(params.chain);
					const code = renderCallChain(params.chain);
					return permissionResult(run(context, { code, readOnly, timeoutSeconds: DEFAULT_TIMEOUT_SECONDS }, signal), handle);
				}
				case "run": {
					const timeoutSeconds = params.timeout ?? DEFAULT_TIMEOUT_SECONDS;
					return permissionResult(run(context, { code: params.code, readOnly: params.read_only === true, timeoutSeconds }, signal), handle);
				}
				case "capabilities":
					await handle.activate(context);
					return valueResult(await handle.service.capabilities(), "capabilities unavailable");
				case "close":
					await handle.close();
					return valueResult(undefined, "Closed the desktop session.");
				default:
					return assertNever(params);
			}
		},
	};
}

async function permissionResult(result: Promise<ComputerToolResult>, handle: ComputerHandle): Promise<ComputerToolResult> {
	try {
		return await result;
	} catch (error) {
		if (!(error instanceof DesktopEngineRpcError) || error.data === null || !("code" in error.data) ||
			error.data.code !== "PermissionDenied") throw error;
		const failure = computerFailure(error.data.code, error.message, handle.settings().stopHotkey, error.data.permission);
		return {
			content: [{ type: "text", text: JSON.stringify(failure, null, 2) }],
			details: { value: failure },
			isError: true,
		};
	}
}

export type ComputerTool = ReturnType<typeof createComputerTool>;
