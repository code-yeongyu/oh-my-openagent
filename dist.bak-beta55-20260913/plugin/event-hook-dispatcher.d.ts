import type { CreatedHooks } from "../create-hooks";
import type { EventInput, EventHookRunner } from "./event-types";
export declare function getEventSessionID(input: EventInput): string | undefined;
export declare function createEventHookRunner(): EventHookRunner;
export declare function createEventHookDispatcher(hooks: CreatedHooks, runEventHookSafely: EventHookRunner): (input: EventInput) => Promise<void>;
