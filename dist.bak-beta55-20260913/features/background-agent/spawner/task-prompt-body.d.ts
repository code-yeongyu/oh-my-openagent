import type { LaunchInput } from "../types";
type PromptModel = LaunchInput["model"];
type TaskPromptBodyOptions = {
    readonly kind: "launch";
    readonly agent: string;
    readonly model: PromptModel;
    readonly system: LaunchInput["skillContent"];
    readonly prompt: string;
    readonly includeTeamToolDenylist: boolean;
} | {
    readonly kind: "resume";
    readonly agent: string;
    readonly model: PromptModel;
    readonly prompt: string;
    readonly includeTeamToolDenylist: boolean;
};
export type TaskPromptBody = {
    readonly agent: string;
    readonly model?: {
        readonly providerID: string;
        readonly modelID: string;
    };
    readonly variant?: string;
    readonly system?: string | undefined;
    readonly tools: Record<string, boolean>;
    readonly parts: Array<{
        readonly type: "text";
        readonly text: string;
        readonly synthetic?: boolean;
    }>;
};
export declare function buildTaskPromptBody(options: TaskPromptBodyOptions): TaskPromptBody;
export {};
