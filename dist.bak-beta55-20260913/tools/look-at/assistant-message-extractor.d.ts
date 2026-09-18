export declare function extractLatestAssistantText(messages: unknown): string | null;
export interface AssistantOutcome {
    text: string | null;
    errorName: string | null;
    hasAssistant: boolean;
    completed: boolean;
}
export declare function extractLatestAssistantOutcome(messages: unknown): AssistantOutcome;
