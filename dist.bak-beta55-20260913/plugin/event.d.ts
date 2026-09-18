import type { OhMyOpenCodeConfig } from "../config";
import type { CreatedHooks } from "../create-hooks";
import type { Managers } from "../create-managers";
import type { PluginContext } from "./types";
import type { EventInput, FirstMessageVariantGate } from "./event-types";
export { extractErrorMessage } from "./event-error-utils";
export declare function createEventHandler(args: {
    ctx: PluginContext;
    pluginConfig: OhMyOpenCodeConfig;
    firstMessageVariantGate: FirstMessageVariantGate;
    managers: Managers;
    hooks: CreatedHooks;
}): (input: EventInput) => Promise<void>;
