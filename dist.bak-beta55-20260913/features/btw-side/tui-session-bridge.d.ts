import type { TuiPluginApi, TuiPromptRef } from "@opencode-ai/plugin/tui";
import type { BtwPromptRef, BtwSideControllerDependencies } from "./tui-controller-types";
export declare function unwrapTuiData<T>(response: {
    data?: T;
    error?: unknown;
}, message: string): T;
export declare function currentTuiSessionID(api: TuiPluginApi): string | undefined;
export declare function isCurrentTuiSession(api: TuiPluginApi, sessionID: string | undefined): boolean;
export declare function adaptTuiPromptRef(promptRef: TuiPromptRef): BtwPromptRef;
export declare function parentTuiStatusLabel(api: TuiPluginApi, parentSessionID: string): string;
export declare function createBtwControllerDependencies(api: TuiPluginApi): BtwSideControllerDependencies;
