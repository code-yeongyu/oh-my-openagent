import type { PluginInput } from "@opencode-ai/plugin";
import type { BackgroundManager } from "../../features/background-agent";
import type { SessionState } from "./types";
export declare function injectBoulderContinuation(input: {
    ctx: PluginInput;
    sessionID: string;
    planName: string;
    remaining: number;
    total: number;
    agent?: string;
    worktreePath?: string;
    backgroundManager?: BackgroundManager;
    sessionState: SessionState;
}): Promise<void>;
