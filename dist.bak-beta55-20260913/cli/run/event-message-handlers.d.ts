import type { EventState } from "./event-state";
import type { EventPayload, RunContext } from "./types";
export declare function handleMessagePartUpdated(ctx: RunContext, payload: EventPayload, state: EventState): void;
export declare function handleMessagePartDelta(ctx: RunContext, payload: EventPayload, state: EventState): void;
export declare function handleMessageUpdated(ctx: RunContext, payload: EventPayload, state: EventState): void;
