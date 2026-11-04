export declare class JsonCanonicalizationError extends Error {
    readonly valueType: string;
    constructor(valueType: string);
}
export declare const canonicalizeJson: (value: unknown) => string;
