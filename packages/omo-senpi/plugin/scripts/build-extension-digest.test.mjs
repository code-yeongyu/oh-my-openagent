import { describe, expect, test } from "bun:test"
import { digestSettingsFor } from "./build-extension-core.mjs"

// #13155: the marker digest must not depend on the running node's builtinModules. Node 26 adds
// node:ffi, and a byte-identical bundle built there read as stale because the builtin list rode in
// the digested build settings. The digest records the builtin family as one stable token and
// digests only the source-derived externals, which is what freshness must track.
describe("bundle marker digest settings", () => {
  const sourceExternals = ["#omo-task-runtime", "#omo-thread-client-runtime", "#telemetry-immediate-send"]
  const node24 = ["fs", "path", "node:fs", "node:path"]
  const node26 = ["ffi", "fs", "path", "node:ffi", "node:fs", "node:path"]

  test("a newer node's extra builtins do not change the digest", () => {
    expect(digestSettingsFor([...sourceExternals, ...node24], ["fs", "path"])).toBe(
      digestSettingsFor([...sourceExternals, ...node26], ["ffi", "fs", "path"]),
    )
  })

  test("a source-derived external still changes the digest", () => {
    expect(digestSettingsFor([...sourceExternals, ...node24], ["fs", "path"])).not.toBe(
      digestSettingsFor([...sourceExternals, "#omo-new-runtime", ...node24], ["fs", "path"]),
    )
  })

  test("the builtin family is recorded as one stable token", () => {
    expect(digestSettingsFor([...sourceExternals, ...node24], ["fs", "path"])).toContain("<node-builtins>")
  })
})
