import type { PluginInput } from "@opencode-ai/plugin";
import type { RalphLoopEventHandlerOptions } from "./event-handler-types";
import { type EventHandlerRuntime } from "./event-handler-idle";
export declare function handleRuntimeErrorEvent(ctx: PluginInput, options: RalphLoopEventHandlerOptions, runtime: EventHandlerRuntime, props: Record<string, unknown> | undefined, sessionID: string): Promise<void>;
