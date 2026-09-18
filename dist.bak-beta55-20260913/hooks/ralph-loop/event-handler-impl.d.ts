import type { PluginInput } from "@opencode-ai/plugin";
import type { RalphLoopEventHandlerOptions } from "./event-handler-types";
type RalphLoopEvent = {
    readonly type: string;
    readonly properties?: unknown;
};
export declare function createRalphLoopEventHandlerImpl(ctx: PluginInput, options: RalphLoopEventHandlerOptions): ({ event }: {
    readonly event: RalphLoopEvent;
}) => Promise<void>;
export {};
