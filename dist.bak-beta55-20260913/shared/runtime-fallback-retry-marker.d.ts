export declare const OMO_RUNTIME_FALLBACK_RETRY_MARKER = "<!-- OMO_RUNTIME_FALLBACK_RETRY -->";
type RuntimeFallbackRetryTextPartLike = {
    type?: string;
    text?: string;
};
export declare function hasRuntimeFallbackRetryMarker(text: string): boolean;
export declare function createRuntimeFallbackRetryTextPart(text: string): {
    type: "text";
    synthetic: true;
    metadata: {
        compaction_continue: true;
    };
    text: string;
};
export declare function isRuntimeFallbackRetryTextParts(parts: readonly RuntimeFallbackRetryTextPartLike[] | undefined): boolean;
export {};
