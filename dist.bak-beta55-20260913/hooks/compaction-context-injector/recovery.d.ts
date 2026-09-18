import type { CompactionContextClient } from "./types";
import type { TailMonitorState } from "./tail-monitor";
export declare function createRecoveryLogic(ctx: CompactionContextClient | undefined, getTailState: (sessionID: string) => TailMonitorState): {
    recoverCheckpointedAgentConfig: (sessionID: string, reason: "compaction.autocontinue" | "session.compacted" | "no-text-tail") => Promise<boolean>;
    maybeWarnAboutNoTextTail: (sessionID: string) => Promise<void>;
};
