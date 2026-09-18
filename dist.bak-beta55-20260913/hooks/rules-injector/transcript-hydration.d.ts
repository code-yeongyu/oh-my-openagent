export interface TranscriptHydrationDeps {
    readonly client: TranscriptHydrationClient;
}
export interface TranscriptHydrationStore {
    hydrateSession(sessionID: string): Promise<ReadonlySet<string>>;
    getHydratedRelativePaths(sessionID: string): ReadonlySet<string>;
    clearSession(sessionID: string): void;
}
interface TranscriptHydrationClient {
    readonly session: {
        readonly messages: (args: {
            readonly path: {
                readonly id: string;
            };
        }) => Promise<{
            readonly data?: unknown;
        }>;
    };
}
/**
 * Builds an in-memory store keyed by sessionID that lazily scans the session
 * transcript for `[Rule: <relativePath>]` markers and exposes the set of
 * already-injected rule relative paths. The store is consulted by the
 * injector before emitting a rule so a process that lost its persisted cache
 * file but whose model context still contains prior `[Rule: ...]` markers
 * does not re-inject duplicates.
 */
export declare function createTranscriptHydrationStore(deps: TranscriptHydrationDeps): TranscriptHydrationStore;
export {};
