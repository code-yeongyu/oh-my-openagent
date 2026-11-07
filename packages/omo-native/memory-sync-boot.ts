import { bootDiag, handleSnapshot, privateFdState } from "./boot-diag"

// The compiled entry's boot-time memory-sync claim (#11997), run right before senpi's CLI is imported. senpi's CLI
// first guards the cwd, then releases a coordinated start's filler pipes while the private-descriptor table is still
// in the environment, and only then captures that table. The claim captures it too, so it runs the same two steps
// first, from the same engine modules the CLI imports (each runs once per process). The specifiers are relative
// literals for the reasons compile-entry.ts gives for the CLI import: the exports map omits these modules, and Bun's
// bundler only traces literal import() arguments.
export async function claimMemorySyncAtBoot(): Promise<void> {
  try {
    bootDiag("claim-start", { handles: handleSnapshot(), SENPI_PRIVATE_FDS: process.env.SENPI_PRIVATE_FDS ?? "<unset>" })
    await import("../../node_modules/@code-yeongyu/senpi/dist/valid-cwd.js")
    await import("../../node_modules/@code-yeongyu/senpi/dist/private-fd-startup-release.js")
    bootDiag("filler-release-done", { handles: handleSnapshot(), startupEvents: process.env.SENPI_RPC_HOST_STARTUP_EVENTS ?? "<unset>" })
    const { claimMemorySyncAtBoot: claim } = await import("../omo-senpi/src/components/memory/desktop-sync/bootClaim")
    bootDiag("private-fds-captured", { state: privateFdState(), envAfterCapture: process.env.SENPI_PRIVATE_FDS ?? "<unset>" })
    claim()
    bootDiag("claim-called", { stateAfterTake: privateFdState() })
    const started = performance.now()
    const host = Reflect.get(globalThis, Symbol.for("omo.memory-sync.host-selection.v10")) as { selection?: Promise<{ kind: string; reason?: string }> } | undefined
    if (host?.selection === undefined) bootDiag("claim-memo-missing")
    else void host.selection.then(
      settled => bootDiag("claim-settled", { kind: settled.kind, reason: settled.reason ?? null, afterMs: Math.round(performance.now() - started) }),
      error => bootDiag("claim-rejected", { error: String(error) }),
    )
  } catch (error) {
    bootDiag("claim-error", { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), stack: error instanceof Error ? error.stack?.split("\n").slice(0, 4) : null })
    // The memory component's registration still selects once when the first session opens.
    process.stderr.write(`omo: memory sync could not start at boot: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}
