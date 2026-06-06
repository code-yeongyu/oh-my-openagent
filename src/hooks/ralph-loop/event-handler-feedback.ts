import type { PluginInput } from "@opencode-ai/plugin"
import type { RalphLoopState } from "./types"

export function showToastBestEffort(
	ctx: PluginInput,
	body: { title: string; message: string; variant: "warning" | "info"; duration: number },
): void {
	try {
		void Promise.resolve(ctx.client.tui?.showToast?.({ body })).catch((error: unknown) => {
			if (error instanceof Error) {
				return
			}
			return
		})
	} catch (error) {
		if (error instanceof Error) {
			return
		}
		return
	}
}

export function showMaxIterationsToast(
	ctx: PluginInput,
	state: RalphLoopState,
): void {
	showToastBestEffort(ctx, {
		title: "Ralph Loop Stopped",
		message: `Max iterations (${state.max_iterations}) reached without completion`,
		variant: "warning",
		duration: 5000,
	})
}

export function showIterationToast(
	ctx: PluginInput,
	state: RalphLoopState,
): void {
	showToastBestEffort(ctx, {
		title: "Ralph Loop",
		message: `Iteration ${state.iteration}/${typeof state.max_iterations === "number" ? state.max_iterations : "unbounded"}`,
		variant: "info",
		duration: 2000,
	})
}

export function showNoProgressToast(
	ctx: PluginInput,
): void {
	showToastBestEffort(ctx, {
		title: "Ralph Loop Stopped",
		message: "Last assistant turn made no model progress; loop stopped to avoid repeated internal prompts.",
		variant: "warning",
		duration: 5000,
	})
}

export function showIterationCommitFailureToast(ctx: PluginInput): void {
	showToastBestEffort(ctx, {
		title: "Ralph Loop Failed",
		message: "Dispatch succeeded but iteration commit failed",
		variant: "warning",
		duration: 5000,
	})
}

export function showDispatchFailureToast(
	ctx: PluginInput,
	result: { readonly status: string; readonly error?: unknown },
): void {
	showToastBestEffort(ctx, {
		title: "Ralph Loop Failed",
		message: result.status === "dispatch_rejected"
			? `Dispatch ${result.status}: ${String(result.error)}`
			: `Dispatch ${result.status}`,
		variant: "warning",
		duration: 5000,
	})
}
