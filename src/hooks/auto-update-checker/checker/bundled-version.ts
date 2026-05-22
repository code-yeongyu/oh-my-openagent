import packageJson from "../../../../package.json" with { type: "json" }

// Reads the version baked into the bundle at build time. Unlike `getCachedVersion()`,
// this never reflects a stale package.json from a cache directory — it always matches
// the build that emitted `dist/index.js`, so the startup banner stays consistent with
// `--version` even when the OpenCode plugin cache lags behind. Issue #4211.
export function getBundledVersion(): string {
  return packageJson.version
}
