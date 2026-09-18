import { classifyRuntimeFallbackError, extractRuntimeFallbackAutoRetrySignal, getRuntimeFallbackErrorMessage, getRuntimeFallbackErrorName, getRuntimeFallbackRetryableSignal, getRuntimeFallbackStatusCode } from "@oh-my-opencode/model-core";
export declare const extractAutoRetrySignal: typeof extractRuntimeFallbackAutoRetrySignal;
export declare const getErrorMessage: typeof getRuntimeFallbackErrorMessage;
export declare const extractStatusCode: typeof getRuntimeFallbackStatusCode;
export declare const extractErrorName: typeof getRuntimeFallbackErrorName;
export declare const extractRetryableSignal: typeof getRuntimeFallbackRetryableSignal;
export declare const classifyErrorType: typeof classifyRuntimeFallbackError;
export declare function containsErrorContent(parts: Array<{
    type?: string;
    text?: string;
}> | undefined): {
    hasError: boolean;
    errorMessage?: string;
};
export declare function isRetryableError(error: unknown, retryOnErrors: number[]): boolean;
