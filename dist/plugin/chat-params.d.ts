export type ChatParamsInput = {
    sessionID: string;
    agent: {
        name?: string;
    };
    model: {
        providerID: string;
        modelID: string;
    };
    provider: {
        id: string;
    };
    message: {
        variant?: string;
    };
};
export type ChatParamsOutput = {
    temperature?: number;
    topP?: number;
    topK?: number;
    options: Record<string, unknown>;
};
export declare function createChatParamsHandler(args: {
    anthropicEffort: {
        "chat.params"?: (input: ChatParamsInput, output: ChatParamsOutput) => Promise<void>;
    } | null;
}): (input: unknown, output: unknown) => Promise<void>;
