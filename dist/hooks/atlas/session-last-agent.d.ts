type SessionMessagesClient = {
    session: {
        messages: (input: {
            path: {
                id: string;
            };
        }) => Promise<unknown>;
    };
};
export declare function getLastAgentFromSession(sessionID: string, client?: SessionMessagesClient): Promise<string | null>;
export {};
