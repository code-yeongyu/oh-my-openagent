import type { EventState } from "./event-state";
import type { EventPayload, RunContext } from "./types";
export declare function handleToolExecute(ctx: RunContext, payload: EventPayload, state: EventState): void;
export declare function handleToolResult(ctx: RunContext, payload: EventPayload, state: EventState): void;
