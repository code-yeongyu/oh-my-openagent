/**
 * Bun reports failed module resolution (dynamic `import()` and
 * `createRequire().resolve()`) by throwing a `ResolveMessage`, which is NOT an
 * `instanceof Error`. Catch blocks that rethrow non-Error values therefore
 * escalate a routine "optional dependency is absent" probe into a crash.
 */
export declare function isModuleResolutionFailure(error: unknown): boolean;
