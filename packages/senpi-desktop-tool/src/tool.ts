import { computerPreludeAssets } from "@oh-my-opencode/senpi-desktop-prelude";
import {
	type AuditRecord,
	type ComputerCallStep,
	type ComputerDisplay,
	type ComputerScreenshot,
	isReadOnlyComputerCall,
} from "@oh-my-opencode/senpi-desktop-protocol";
import { type ExecuteTool, runComputerCode } from "@oh-my-opencode/senpi-desktop-service";
import type { ComputerHandle } from "./activation";
import { ComputerParams, type ComputerToolParams, DEFAULT_TIMEOUT_SECONDS } from "./params";
import { type ComputerHostContext, runSnapshot } from "./session";

export const COMPUTER_TOOL_NAME = "computer";

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
	content: ComputerDisplay[];
	details: ComputerToolDetails;
}

const SEARCH_KEYWORDS = [
	"computer use",
	"computer-use",
	"cua",
	"desktop",
	"gui",
	"screenshot",
	"click",
	"type",
	"keyboard",
	"mouse",
	"window",
	"accessibility",
	"ax",
	"clipboard",
	"automation",
] as const;

const DESCRIPTION = [
	"Drive the user's real desktop: windows, screenshots, native mouse and keyboard input, the OS accessibility (AX) tree, and the clipboard. Not a browser.",
	'- `{action:"call", chain}` runs one desktop helper, optionally followed by one call on the window/element it returns, e.g. `[{method:"window",args:[{app:"Code"}]},{method:"screenshot"}]`.',
	'- `{action:"run", code, read_only?, timeout?}` runs a JavaScript async function body with `desktop`, `wait`, `assert`, and `tool` in scope; `read_only: true` blocks input.',
	'- `{action:"capabilities"}` reports backend, permissions, `stopPath`, and `focusGuard`. `{action:"close"}` ends the desktop session.',
	"In eval cells prefer the `computer` global, which wraps these actions. Pointer x,y are pixels of the latest screenshot of the same target.",
].join("\n");

/** Oh-my-pi's `computer-safety.md` bullets, taken from the prelude asset so the rules have one source. */
const SAFETY_GUIDELINES = computerPreludeAssets.safety
	.split("\n")
	.filter((line) => line.startsWith("- "))
	.map((line) => line.slice(2));

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
		name: COMPUTER_TOOL_NAME,
		label: "Computer",
		description: DESCRIPTION,
		exposure: "search" as const,
		searchText:
			"Operate the real desktop: screenshots, clicks, typing, key chords, window list, accessibility tree, clipboard; macOS/Linux/Windows",
		searchKeywords: SEARCH_KEYWORDS,
		searchGroup: "desktop",
		promptSnippet: "Operate the real desktop: screenshots, native input, accessibility tree, clipboard",
		promptGuidelines: SAFETY_GUIDELINES,
		kernelPrelude: computerPreludeAssets,
		parameters: ComputerParams,
		executionMode: "sequential" as const,
		async execute(
			_toolCallId: string,
			params: ComputerToolParams,
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			context: ComputerHostContext,
		): Promise<ComputerToolResult> {
			switch (params.action) {
				case "call": {
					// Classifies (and rejects unknown or unchainable methods) before anything reaches the engine.
					const readOnly = isReadOnlyComputerCall(params.chain);
					const code = renderCallChain(params.chain);
					return run(context, { code, readOnly, timeoutSeconds: DEFAULT_TIMEOUT_SECONDS }, signal);
				}
				case "run": {
					const timeoutSeconds = params.timeout ?? DEFAULT_TIMEOUT_SECONDS;
					return run(context, { code: params.code, readOnly: params.read_only === true, timeoutSeconds }, signal);
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

export type ComputerTool = ReturnType<typeof createComputerTool>;
