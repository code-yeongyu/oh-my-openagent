export interface TokenInfo {
    input: number;
    output: number;
    reasoning: number;
    cache: {
        read: number;
        write: number;
    };
}
export interface CachedCompactionState {
    providerID: string;
    modelID: string;
    tokens: TokenInfo;
}
export interface PreemptiveCompactionClient {
    session: {
        messages: (input: {
            path: {
                id: string;
            };
            query?: {
                directory: string;
            };
        }) => Promise<unknown>;
        summarize: (input: {
            path: {
                id: string;
            };
            body: {
                providerID: string;
                modelID: string;
                auto?: boolean;
            };
            query: {
                directory: string;
            };
        }) => Promise<unknown>;
    };
    tui: {
        showToast: (input: {
            body: {
                title: string;
                message: string;
                variant: "warning";
                duration: number;
            };
        }) => Promise<unknown>;
    };
}
export interface PreemptiveCompactionContext {
    client: PreemptiveCompactionClient;
    directory: string;
}
