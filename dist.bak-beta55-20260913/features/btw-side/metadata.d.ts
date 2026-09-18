export declare const BTW_SIDE_METADATA_KEY = "omo_btw_side";
export declare const BTW_SIDE_METADATA_VERSION = 1;
export type BtwSideMetadata = {
    version: typeof BTW_SIDE_METADATA_VERSION;
    parent_session_id: string;
    boundary_message_id: string;
};
export declare function createBtwSideMetadata(args: {
    parentSessionID: string;
    boundaryMessageID: string;
}): BtwSideMetadata;
export declare function parseBtwSideMetadata(value: unknown): BtwSideMetadata | undefined;
export declare function getBtwSideMetadata(session: {
    metadata?: Record<string, unknown>;
} | undefined): BtwSideMetadata | undefined;
