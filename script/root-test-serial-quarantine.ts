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
    path: "packages/utils/src/codegraph-provision-upgrade.test.ts",
    reason: "provisions a shared codegraph install directory that concurrent workers would clobber",
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
] as const

/** Quarantined paths in workflow/bunfig order. */
export const ROOT_TEST_SERIAL_QUARANTINE_PATHS: readonly string[] =
  ROOT_TEST_SERIAL_QUARANTINE.map((entry) => entry.path)

/** The serial `bun test` argument list each parallel leg runs before its parallel pass. */
export function serialQuarantineCommand(): string {
  return `bun test ${ROOT_TEST_SERIAL_QUARANTINE_PATHS.join(" ")}`
}
