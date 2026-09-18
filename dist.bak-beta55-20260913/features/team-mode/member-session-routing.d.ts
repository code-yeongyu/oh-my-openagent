import type { RuntimeStateMember } from "./types";
export type TeamMemberPromptBody = {
    parts: Array<{
        type: "text";
        text: string;
    }>;
    agent?: string;
    model?: {
        providerID: string;
        modelID: string;
    };
    variant?: string;
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    options?: Record<string, unknown>;
};
export declare function applyMemberSessionRouting(sessionID: string, member: RuntimeStateMember): void;
export declare function buildMemberPromptBody(member: RuntimeStateMember, text: string): TeamMemberPromptBody;
