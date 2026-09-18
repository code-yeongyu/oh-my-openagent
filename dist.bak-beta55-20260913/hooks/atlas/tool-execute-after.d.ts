import type { PluginInput } from "@opencode-ai/plugin";
import { collectGitDiffStats, formatFileChanges } from "../../shared/git-worktree";
import type { PendingTaskRef, SessionState } from "./types";
import type { ToolExecuteAfterInput, ToolExecuteAfterOutput } from "./types";
export declare function createToolExecuteAfterHandler(input: {
    ctx: PluginInput;
    pendingFilePaths: Map<string, string>;
    pendingTaskRefs: Map<string, PendingTaskRef>;
    pendingPlanSnapshots?: Map<string, string>;
    autoCommit: boolean;
    getState: (sessionID: string) => SessionState;
    isCallerOrchestrator?: (sessionID: string | undefined) => Promise<boolean>;
    collectGitDiffStats?: typeof collectGitDiffStats;
    formatFileChanges?: typeof formatFileChanges;
}): (toolInput: ToolExecuteAfterInput, toolOutput: ToolExecuteAfterOutput | undefined) => Promise<void>;
