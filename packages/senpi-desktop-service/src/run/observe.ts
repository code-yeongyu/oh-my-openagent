import { DesktopEngineRpcError } from "../service/rpc-client";
import { ComputerRunError, type RunScope } from "./context";
import { expectResult, isObserveResult } from "./engine-results";
import type { AxOptions } from "./handles";
import { displayScreenshot, type ScreenshotOptions, type ScreenshotResult } from "./screenshot";

export type ObserveOptions = ScreenshotOptions & AxOptions;

export interface ObservationResult extends ScreenshotResult {
	readonly ax: string;
	readonly nodeCount: number;
	readonly truncated: boolean;
}

/** One engine request, with screenshot output before AX text and no split-call fallback. */
export async function observeWindow(
	scope: RunScope,
	target: string,
	options: ObserveOptions = {},
): Promise<ObservationResult> {
	const { snapshot, output } = scope.context;
	const caps = {
		maxWidth: snapshot.captureMaxWidth,
		maxHeight: snapshot.captureMaxHeight,
		maxBytes: snapshot.captureMaxBytes,
	};
	const { all, maxDepth, maxNodes } = options;
	let result: unknown;
	try {
		result = await scope.call("observe", { target, caps, ax: { all, maxDepth, maxNodes } });
	} catch (error) {
		if (error instanceof DesktopEngineRpcError && error.rpcCode === -32601) {
			throw new ComputerRunError("unavailable", "observe is unavailable in this desktop engine; update the engine to use atomic observation");
		}
		throw error;
	}
	const observed = expectResult("observe", result, isObserveResult);
	const capture = displayScreenshot(scope, observed, options);
	if (options.silent !== true) output.text(observed.ax);
	return { ...capture, ax: observed.ax, nodeCount: observed.nodeCount, truncated: observed.truncated };
}
