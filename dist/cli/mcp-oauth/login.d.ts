export interface LoginOptions {
    serverUrl?: string;
    clientId?: string;
    scopes?: string[];
}
export declare function login(serverName: string, options: LoginOptions): Promise<number>;
