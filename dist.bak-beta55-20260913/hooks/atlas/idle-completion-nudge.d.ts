import type { PluginInput } from "@opencode-ai/plugin";
import type { BoulderState } from "../../features/boulder-state";
import type { AtlasHookOptions, SessionState } from "./types";
export declare function handleCompletedBoulderIdle(input: {
    ctx: PluginInput;
    options?: AtlasHookOptions;
    sessionID: string;
    sessionState: SessionState;
    boulderState: BoulderState;
}): Promise<void>;
