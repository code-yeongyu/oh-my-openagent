type ServerUrlEnv = Record<string, string | undefined>;
export declare function resolveServerUrl(rawServerUrl: string | undefined, env: ServerUrlEnv, log: (message: string, data?: unknown) => void): string;
export {};
