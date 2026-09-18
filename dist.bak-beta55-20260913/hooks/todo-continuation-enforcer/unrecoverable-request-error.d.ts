/**
 * A malformed-request error the provider will reject identically on every retry, for
 * example the Anthropic 400 raised when a compaction request carries a `tool_use`
 * block without its `tool_result`. Re-injecting a continuation directive after one of
 * these rebuilds the same request and wedges the session, so the loop must stop.
 * Deliberately narrow: only a request-shape status code paired with an explicit
 * `isRetryable: false` from the provider counts.
 */
export declare function isUnrecoverableRequestError(error: unknown): boolean;
