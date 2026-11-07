// The compiled entry's boot-time memory-sync claim (#11997), run right before senpi's CLI is imported. senpi's CLI
// first guards the cwd, then releases a coordinated start's filler pipes while the private-descriptor table is still
// in the environment, and only then captures that table. The claim captures it too, so it runs the same two steps
// first, from the same engine modules the CLI imports (each runs once per process). The specifiers are relative
// literals for the reasons compile-entry.ts gives for the CLI import: the exports map omits these modules, and Bun's
// bundler only traces literal import() arguments.
export async function claimMemorySyncAtBoot(): Promise<void> {
  try {
    await import("../../node_modules/@code-yeongyu/senpi/dist/valid-cwd.js")
    await import("../../node_modules/@code-yeongyu/senpi/dist/private-fd-startup-release.js")
    const { claimMemorySyncAtBoot: claim } = await import("../omo-senpi/src/components/memory/desktop-sync/bootClaim")
    claim()
  } catch (error) {
    // The memory component's registration still selects once when the first session opens.
    process.stderr.write(`omo: memory sync could not start at boot: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}
