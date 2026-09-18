import type { EventState } from "./events";
import type { RunContext } from "./types";
export interface PromptStartOptions {
    timeoutMs?: number;
    pollIntervalMs?: number;
}
export declare function waitForPromptStart(ctx: RunContext, eventState: EventState, abortController: AbortController, options?: PromptStartOptions): Promise<void>;
