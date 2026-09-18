import type { KeywordDetectorConfig } from "../../config/schema/keyword-detector";
import type { TeamModeConfig } from "../../config/schema/team-mode";
type TransformPart = {
    type: string;
    text?: string;
    synthetic?: boolean;
    [key: string]: unknown;
};
type TransformMessageInfo = {
    role: string;
    sessionID?: string;
    [key: string]: unknown;
};
type MessageWithParts = {
    info: TransformMessageInfo;
    parts: TransformPart[];
};
type TeamModeStatusInjectorInput = {
    sessionID?: string;
    [key: string]: unknown;
};
type TeamModeStatusInjectorOutput = {
    messages: MessageWithParts[];
};
export type TeamModeStatusInjectorHook = {
    "experimental.chat.messages.transform"?: (input: TeamModeStatusInjectorInput, output: TeamModeStatusInjectorOutput) => Promise<void>;
};
export declare function createTeamModeStatusInjector(config: TeamModeConfig, keywordDetectorConfig?: KeywordDetectorConfig): TeamModeStatusInjectorHook;
export {};
