export interface RunAgentListClient {
    readonly app: {
        readonly agents: () => Promise<unknown>;
    };
}
export interface RunAgentDisplayNameConfig {
    readonly agents?: Readonly<Record<string, {
        readonly displayName?: string;
    } | undefined>>;
}
export declare function resolveRunnableRunAgent(client: RunAgentListClient, resolvedAgent: string, config?: RunAgentDisplayNameConfig): Promise<string>;
