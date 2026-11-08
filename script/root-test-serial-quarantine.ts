// Single source of truth for the root-test files that must run in one serial
// process before the rest of the suite runs under `bun test --parallel`.
//
// Every CI leg that parallelizes the root suite runs this exact list serially
// first, then parallelizes the remainder with a bunfig whose pathIgnorePatterns
// contain these same paths. Three legs (Windows shard 2, Linux, macOS) consume
// the list, so it lives here instead of being pasted into each one; the
// contract test in script/ci-root-test-partition.test.ts pins the workflow
// commands and both bunfig configs against this array.
//
// Entries are removed only when the underlying isolation requirement is fixed
// at its root, never to make a leg faster.

export interface SerialQuarantineEntry {
  /** Repo-relative test path, exactly as bun test and pathIgnorePatterns spell it. */
  readonly path: string
  /** Why this file cannot share a process pool with the rest of the suite. */
  readonly reason: string
}

export const ROOT_TEST_SERIAL_QUARANTINE: readonly SerialQuarantineEntry[] = [
  {
    path: "packages/senpi-task/src/runners/rpc-process.windows.test.ts",
    reason: "spawns a real console probe process and asserts on its exclusive console handles",
  },
  {
    path: "packages/senpi-task/src/__adversarial__/chaos-bench.test.ts",
    reason: "a saturation benchmark whose timings degrade once workers compete for the same cores",
  },
  {
    path: "packages/omo-codex/src/install/install-codex-legacy-agent-purge.test.ts",
    reason: "purges legacy agent state from a shared installer root",
  },
  {
    path: "script/codex-installer-version.test.ts",
    reason: "reads the single installer version stamp the other installer suites rewrite",
  },
  {
    path: "packages/shared-skills/provenance-gate.test.ts",
    reason: "walks the whole shared-skills tree and is starved by concurrent filesystem load",
  },
  {
    path: "packages/omo-codex/src/install/install-codex-mcp-manifest.test.ts",
    reason: "hit its timeout under real --parallel on the manifest cache path (run 32053350172)",
  },
  {
    path: "packages/senpi-task/src/dag/scheduler.test.ts",
    reason: "wave-ordering assertions are timing sensitive under a saturated scheduler",
  },
  {
    path: "packages/omo-native/test/payload.test.ts",
    reason: "runs a real omo-native plugin build that mutates shared plugin build inputs",
  },
  {
    path: "script/build-omo-binary.test.ts",
    reason: "runs a real omo-native plugin staging build against the same shared plugin tree",
  },
  {
    path: "packages/senpi-task/src/team/member-extension/residency.test.ts",
    reason: "cold real-process member revival is starved by concurrent Windows filesystem load under --parallel (run 34958448646)",
  },
  {
    path: "script/omob-refresh.test.ts",
    reason: "each case runs a real `bun build --compile` behind two spawned processes; identical work measured 11.6s/12.1s/12.8s/14.3s/15.5s/21.3s and then blew its 30s spawn budget at 38.3s and 54.6s inside one Windows --parallel leg (runs 34980957714, 34962017319)",
  },
  {
    path: "script/release-version.test.ts",
    reason: "five sequential Git Bash spawns of the publish workflow's metadata step; one spawn exhausted its 10s budget under Windows --parallel while the test's own work is string parsing (run 34962017319)",
  },
  {
    path: "packages/senpi-task/src/store/record-lock.test.ts",
    reason: "task record lock waits are timed (a 1s per-holder budget, a 100ms hand-on chain) against real live and dead child processes; run alone so the kernel32/libproc start-identity proof runs on every OS without --parallel CPU starvation",
  },
  {
    path: "packages/senpi-task/src/store/record-lock-reap-window.test.ts",
    reason: "steps the record lock reaper against live child processes and a 1s per-holder wait; same timing sensitivity as record-lock.test.ts",
  },
  {
    path: "packages/senpi-task/src/runners/rpc-host/durable-json.test.ts",
    reason: "spies the node:fs module namespace (openSync/renameSync/fsyncSync) process-wide while it runs; kept out of the shared pool so no concurrent file observes the spies, and so the win32 no-directory-fsync branch runs on windows-latest",
  },
] as const

/** Quarantined paths in workflow/bunfig order. */
export const ROOT_TEST_SERIAL_QUARANTINE_PATHS: readonly string[] =
  ROOT_TEST_SERIAL_QUARANTINE.map((entry) => entry.path)

/**
 * Per-file test budget for the sequential POSIX legs. Bun applies a preload's setDefaultTimeout to
 * the first file only, so every multi-file `bun test` in CI passes the flag explicitly; this is the
 * POSIX value, matched by test-setup.ts (20s) and the Windows wrapper (30s).
 */
export const POSIX_TEST_TIMEOUT_MS = 20_000

/** The serial `bun test` argument list each parallel leg runs before its parallel pass. */
export function serialQuarantineCommand(): string {
  return `bun test --timeout ${POSIX_TEST_TIMEOUT_MS} ${ROOT_TEST_SERIAL_QUARANTINE_PATHS.join(" ")}`
}
