import { isRecord } from "@oh-my-opencode/utils";
export { isRecord };
export declare function isAbortedSessionError(error: unknown): boolean;
export declare function isTransportUnreachableError(error: unknown): boolean;
export declare function getErrorText(error: unknown): string;
export declare function extractErrorName(error: unknown): string | undefined;
export declare function extractErrorMessage(error: unknown): string | undefined;
export declare function extractErrorStatusCode(error: unknown): number | undefined;
interface EventPropertiesLike {
    [key: string]: unknown;
}
export declare function getSessionErrorMessage(properties: EventPropertiesLike): string | undefined;
export declare function isTerminalSessionError(errorInfo: {
    name?: string;
    message?: string;
    statusCode?: number;
}): boolean;
