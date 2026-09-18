import type { CommentCheckerConfig } from "../../config/schema";
import { initializeCommentCheckerCli, getCommentCheckerCliPathPromise, isCliPathUsable, processWithCli, processApplyPatchEditsWithCli } from "./cli-runner";
export declare function createCommentCheckerHooks(config?: CommentCheckerConfig, cliRunner?: {
    initializeCommentCheckerCli: typeof initializeCommentCheckerCli;
    getCommentCheckerCliPathPromise: typeof getCommentCheckerCliPathPromise;
    isCliPathUsable: typeof isCliPathUsable;
    processWithCli: typeof processWithCli;
    processApplyPatchEditsWithCli: typeof processApplyPatchEditsWithCli;
}): {
    "tool.execute.before": (input: {
        tool: string;
        sessionID: string;
        callID: string;
    }, output: {
        args: Record<string, unknown>;
    }) => Promise<void>;
    "tool.execute.after": (input: {
        tool: string;
        sessionID: string;
        callID: string;
        args?: Record<string, unknown>;
    }, output: {
        title: string;
        output: string;
        metadata: unknown;
    }) => Promise<void>;
    dispose: () => void;
};
