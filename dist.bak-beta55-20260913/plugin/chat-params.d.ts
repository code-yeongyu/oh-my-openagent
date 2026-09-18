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
    maxOutputTokens?: number;
    options: Record<string, unknown>;
};
export declare function createChatParamsHandler(_args?: {
    client?: unknown;
}): (input: unknown, output: unknown) => Promise<void>;
