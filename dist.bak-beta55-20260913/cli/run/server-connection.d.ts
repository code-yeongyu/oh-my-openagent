import type { ServerConnection } from "./types";
export type ServerConnectionOptions = {
    port?: number;
    attach?: string;
    signal: AbortSignal;
};
type OpencodeServer<TClient> = {
    client: TClient;
    server: {
        url: string;
        close: () => void;
    };
};
export type ServerConnectionDeps<TClient> = {
    createOpencode: (options: {
        signal: AbortSignal;
        port: number;
        hostname: string;
    }) => Promise<OpencodeServer<TClient>>;
    createOpencodeClient: (options: {
        baseUrl: string;
    }) => TClient;
    injectServerAuthIntoClient: (client: TClient) => void;
    isPortAvailable: (port: number, hostname?: string) => Promise<boolean>;
    getAvailableServerPort: (preferredPort?: number, hostname?: string) => Promise<{
        port: number;
        wasAutoSelected: boolean;
    }>;
    withWorkingOpencodePath: (startServer: () => Promise<OpencodeServer<TClient>>) => Promise<OpencodeServer<TClient>>;
};
export declare function createServerConnectionWithDeps<TClient>(options: ServerConnectionOptions, deps: ServerConnectionDeps<TClient>): Promise<{
    client: TClient;
    cleanup: () => void;
}>;
export declare function createServerConnection(options: ServerConnectionOptions): Promise<ServerConnection>;
export {};
