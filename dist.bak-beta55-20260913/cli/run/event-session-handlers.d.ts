import type { EventState } from "./event-state";
import type { EventPayload, RunContext } from "./types";
export declare function handleSessionIdle(ctx: RunContext, payload: EventPayload, state: EventState): void;
export declare function handleSessionStatus(ctx: RunContext, payload: EventPayload, state: EventState): void;
export declare function handleSessionError(ctx: RunContext, payload: EventPayload, state: EventState): void;
