import type { PluginInput } from "@opencode-ai/plugin";
import type { SessionState } from "./types";
type CurrentTask = {
    readonly key: string;
    readonly label: string;
} | null;
type ReminderDecision = {
    readonly leadReminder: string;
    readonly followupReminder: string | null;
    readonly isFinalWaveTask: boolean;
    readonly isMissingFinalWaveVerdict: boolean;
    readonly isRejectedFinalWaveVerdict: boolean;
    readonly shouldPauseForApproval: boolean;
};
export declare function buildSubagentCompletionReminder(input: {
    readonly ctx: PluginInput;
    readonly planPath: string;
    readonly planName: string;
    readonly progress: {
        readonly total: number;
        readonly completed: number;
    };
    readonly preferredSessionId: string;
    readonly originalResponse: string;
    readonly currentTask: CurrentTask;
    readonly sessionState: SessionState | undefined;
    readonly isAlreadyVerified: boolean;
    readonly autoCommit: boolean;
}): Promise<ReminderDecision>;
export {};
