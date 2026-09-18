export interface NormalizeSDKResponseOptions {
    /** Return the raw response when data is missing, except when the fallback requires an array. */
    preferResponseOnMissingData?: boolean;
}
export declare function normalizeSDKResponse<TData>(response: unknown, fallback: TData, options?: NormalizeSDKResponseOptions): TData;
