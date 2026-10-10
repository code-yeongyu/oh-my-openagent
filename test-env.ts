/// <reference types="bun-types" />
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { markTestInfrastructureDir } from "./test-temp-root"

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
markTestInfrastructureDir(xdgRoot)
process.env.XDG_DATA_HOME = join(xdgRoot, "data")
process.env.XDG_CACHE_HOME = join(xdgRoot, "cache")

// Memory registration sweeps its default root. os.homedir() can retain the host
// home despite test-setup's HOME override, so isolate this once in the preload,
// rather than leaking a module-load override from memory.test-support.ts.
process.env.OMO_MEMORY_HOME = join(xdgRoot, "memory")

// Keep the telemetry opt-out in the worker baseline even if a failing local
// afterEach prevents Bun from reaching the preload cleanup hook.
process.env.OMO_DISABLE_POSTHOG = "true"
