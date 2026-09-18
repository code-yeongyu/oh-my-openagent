import type { PluginInput } from "@opencode-ai/plugin";
import type { RalphLoopState } from "./types";
export declare function showToastBestEffort(ctx: PluginInput, body: {
    title: string;
    message: string;
    variant: "warning" | "info";
    duration: number;
}): void;
export declare function showMaxIterationsToast(ctx: PluginInput, state: RalphLoopState): void;
export declare function showIterationToast(ctx: PluginInput, state: RalphLoopState): void;
export declare function showNoProgressToast(ctx: PluginInput): void;
export declare function showIterationCommitFailureToast(ctx: PluginInput): void;
export declare function showDispatchFailureToast(ctx: PluginInput, result: {
    readonly status: string;
    readonly error?: unknown;
}): void;
