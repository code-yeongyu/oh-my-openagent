import type { DefaultModeConfig } from "../config/schema/default-mode";
type UltraworkRestoration = {
    getSystemTransformGuidance?: (sessionID: string, modelID?: string) => string | undefined;
};
export declare function createSystemTransformHandler(defaultMode?: DefaultModeConfig, getUltraworkMessage?: (agentName?: string, modelID?: string) => string, ultraworkRestoration?: UltraworkRestoration | null): (input: {
    sessionID?: string;
    model: {
        id: string;
        providerID: string;
        [key: string]: unknown;
    };
}, output: {
    system: string[];
}) => Promise<void>;
export {};
