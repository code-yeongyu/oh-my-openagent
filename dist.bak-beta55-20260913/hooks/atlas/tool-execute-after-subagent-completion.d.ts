import type { PluginInput } from "@opencode-ai/plugin";
import { collectGitDiffStats, formatFileChanges } from "../../shared/git-worktree";
import type { PendingTaskRef, SessionState, ToolExecuteAfterInput, ToolExecuteAfterOutput } from "./types";
export declare function handleSubagentCompletionAfter(input: {
    ctx: PluginInput;
    pendingTaskRefs: Map<string, PendingTaskRef>;
    autoCommit: boolean;
    getState: (sessionID: string) => SessionState;
    collectGitDiffStats: typeof collectGitDiffStats;
    formatFileChanges: typeof formatFileChanges;
    toolInput: ToolExecuteAfterInput;
    toolOutput: ToolExecuteAfterOutput;
    metadataSessionId: string | undefined;
}): Promise<void>;
