/// <reference types="bun-types" />

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "bun:test"
import { runFallbackDriver } from "./task-runtime-fallback-driver"

// Every task child on Windows runs as its own `senpi --mode rpc` process, so this is where a child's own
// fallback chain (#9582) has to survive a usage limit after a tool call - including one that lands near
// the compaction threshold - without touching the user's settings file.
const isWin32 = process.platform === "win32"
const driverPath = fileURLToPath(new URL("./task-runtime-fallback-e2e.mjs", import.meta.url))
const SCENARIOS = ["user-fallback", "limit-after-tool", "limit-near-compaction"]
// Three scenarios, each a parent turn plus a child (a few seconds warm, up to 240 s each on a cold runner).
const DRIVER_TIMEOUT_MS = 900_000

test.skipIf(!isWin32)(
  "#given process-runner task children on Windows #when their model hits a usage limit after a tool call #then each answers on its own fallback chain and the settings file is untouched",
  async () => {
    // given / when / then: the shared runner validates every expected scenario and every check.
    const outDir = mkdtempSync(join(tmpdir(), "omo-runtime-fallback-win-"))
    await runFallbackDriver({
      command: process.execPath,
      args: [driverPath],
      cwd: process.cwd(),
      env: {
        ...process.env,
        TASK_RUNTIME_FALLBACK_OUT_DIR: outDir,
        TASK_RUNTIME_FALLBACK_RUNNERS: "child-process",
        TASK_RUNTIME_FALLBACK_SCENARIOS: SCENARIOS.join(","),
      },
      outDir,
      evidenceRoot: join(process.env.RUNNER_TEMP ?? tmpdir(), "omo-runtime-fallback-failures"),
      expected: SCENARIOS.map((scenario) => ({ runner: "child-process", scenario })),
      timeoutMs: DRIVER_TIMEOUT_MS,
    })
  },
  DRIVER_TIMEOUT_MS + 30_000,
)
