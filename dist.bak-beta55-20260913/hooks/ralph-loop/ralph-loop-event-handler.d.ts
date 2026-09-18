import type { PluginInput } from "@opencode-ai/plugin";
import type { RalphLoopEventHandlerOptions } from "./event-handler-types";
export declare function createRalphLoopEventHandler(ctx: PluginInput, options: RalphLoopEventHandlerOptions): ({ event }: {
    readonly event: {
        readonly type: string;
        readonly properties?: unknown;
    };
}) => Promise<void>;
