type RemoteMcpConfig = {
    readonly type: "remote";
    readonly url: string;
    readonly enabled: boolean;
    readonly headers?: Record<string, string>;
    readonly oauth: false;
};
export declare function createContext7Config(env?: Record<string, string | undefined>): RemoteMcpConfig;
export declare const context7: RemoteMcpConfig;
export {};
