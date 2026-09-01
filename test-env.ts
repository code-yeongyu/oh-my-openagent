/// <reference types="bun-types" />
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Preloaded ahead of test-setup.ts on purpose.
//
// packages/omo-opencode/src/shared/opencode-storage-paths.ts evaluates OPENCODE_STORAGE at
// import time, and RULES_INJECTOR_STORAGE derives from it. ES imports hoist above every
// statement in a module body, so test-setup.ts cannot redirect those paths from its own
// body - the constants are already frozen by the time its first line runs. The redirect
// therefore has to happen in an earlier preload.
//
// This also makes `bun test --parallel` safe: each worker is a separate process, so a
// per-process directory means workers no longer share one cache/storage tree and stop
// deleting each other's fixtures in beforeEach/afterEach.
const xdgRoot = mkdtempSync(join(tmpdir(), "omo-test-xdg-"))
process.env.XDG_DATA_HOME = join(xdgRoot, "data")
process.env.XDG_CACHE_HOME = join(xdgRoot, "cache")
