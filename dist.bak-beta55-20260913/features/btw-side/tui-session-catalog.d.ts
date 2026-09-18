export type BtwCatalogSession = {
    id: string;
    title: string;
    metadata?: Record<string, unknown>;
    time: {
        created: number;
        updated: number;
    };
};
export type BtwSessionCatalog = {
    main: BtwCatalogSession;
    sides: BtwCatalogSession[];
};
type BtwSessionListInput = {
    directory: string;
    roots: false;
    limit: number;
};
type BtwSessionListResponse = {
    data?: BtwCatalogSession[];
    error?: unknown;
};
type LoadBtwSessionCatalogInput = {
    currentSessionID: string;
    directory: string;
    listSessions: (input: BtwSessionListInput) => Promise<BtwSessionListResponse>;
    initialLimit?: number;
    maximumLimit?: number;
};
export declare function classifyBtwSessionCatalog(sessions: BtwCatalogSession[], currentSessionID: string): BtwSessionCatalog | undefined;
export declare function loadBtwSessionCatalog(input: LoadBtwSessionCatalogInput): Promise<{
    catalog: BtwSessionCatalog | undefined;
    truncated: boolean;
}>;
export {};
