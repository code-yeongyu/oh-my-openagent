const MODULE_RESOLUTION_ERROR_CODES = new Set(["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED"])

/**
 * Bun reports failed module resolution (dynamic `import()` and
 * `createRequire().resolve()`) by throwing a `ResolveMessage`, which is NOT an
 * `instanceof Error`. Catch blocks that rethrow non-Error values therefore
 * escalate a routine "optional dependency is absent" probe into a crash.
 */
export function isModuleResolutionFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const { code, name } = error as { code?: unknown; name?: unknown }
  if (typeof code === "string" && MODULE_RESOLUTION_ERROR_CODES.has(code)) return true
  return name === "ResolveMessage"
}
