import { isRecord } from "@oh-my-opencode/utils";
export { isRecord };
export declare function normalizeFallbackModelID(modelID: string): string;
export declare function extractErrorName(error: unknown): string | undefined;
export declare function extractErrorMessage(error: unknown): string;
export declare function extractProviderModelFromErrorMessage(message: string): {
    providerID?: string;
    modelID?: string;
};
export declare function resolveFallbackAgentName(params: {
    currentAgent?: string;
    sessionID: string;
    mainSessionID?: string;
    message: string;
}): string | undefined;
