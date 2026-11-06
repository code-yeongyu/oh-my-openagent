import type { InFlightReads } from "@oh-my-opencode/memory-core"

import type { MemoryIdentityContext } from "./context"
import type { ShutdownDrain, ShutdownDrainInput } from "./shutdown-drain"
import type { MemoryWiringOptions } from "./wiring-types"

interface Settles {
  settled(): Promise<void>
}

export interface MemorySessionShutdownParts {
  readonly shutdownDrain: ShutdownDrain
  readonly maintenance: Settles & { dispose(): void }
  readonly reflectionLive: Settles & { shutdown(identity: string | undefined): void }
  readonly corpusCache: Settles
  readonly promptCache: Settles
  readonly launches: Settles
  /** Every memory hook, bind-time reconcile and detached dream request still running (hook-work.ts). */
  readonly work: InFlightReads
  readonly sessions: MemoryWiringOptions["sessions"]
  readonly kibitzerRef: { readonly current?: { onSessionShutdown(sessionId: string): Promise<void> } }
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  readonly factsWiringFor: (identity: MemoryIdentityContext) => { readonly cancelActive?: () => Promise<unknown> }
  readonly resetSession: (sessionId: string) => void
}

export async function runMemorySessionShutdown(parts: MemorySessionShutdownParts, input: ShutdownDrainInput): Promise<void> {
  const drain = parts.shutdownDrain
  // Background packing is never worth holding an exit for: stop it before the drain.
  parts.maintenance.dispose()
  // The journal flush runs FIRST, before the pre-drain awaits can consume the fixed budget:
  // the transcript bytes are already on disk (append writes immediately, flush is fsync), so
  // one first-position flush captures everything and the drain must never re-run it.
  const journalFlushed = await drain.flushJournal(input)
  // dispose() stops a running pass but does not wait for it, and the bind/settle status refreshes
  // run git in the identity dir unawaited. Work still running there holds its files open past
  // shutdown, which Windows reports as EBUSY/EFAULT on the next remove (#10154).
  await drain.raceDetached(input, "maintenance-settle", () => parts.maintenance.settled())
  await drain.raceDetached(input, "status-settle", () => parts.reflectionLive.settled())
  // A recall ranking saves the repository's terms into its `.git` after the prompt; let that write finish.
  await drain.raceDetached(input, "recall-store-settle", () => parts.corpusCache.settled())
  await drain.raceDetached(input, "memory-block-settle", () => parts.promptCache.settled())
  parts.reflectionLive.shutdown(parts.sessions.get(input.sessionId)?.context?.identity)
  // senpi awaits this handler with no host cap, so neither cleanup may be awaited past the
  // drain deadline: both are started and raced against it, and whichever loses keeps running
  // detached (the Kibitzer wake lease and the sidecar directory lock are still released).
  const kibitzer = parts.kibitzerRef.current
  if (kibitzer !== undefined) {
    await drain.raceDetached(input, "kibitzer-shutdown", () => kibitzer.onSessionShutdown(input.sessionId))
  }
  const identity = parts.resolveContext(input.sessionId)
  if (identity !== undefined) {
    const facts = parts.factsWiringFor(identity)
    if (facts.cancelActive !== undefined) {
      await drain.raceDetached(input, "facts-cancel", async () => { await facts.cancelActive?.() })
    }
  }
  await drain.run(input, { journalFlushed })
  // A reflection launch runs its child under the identity dir too. It is awaited on what budget is
  // left: a run that outlives it keeps going detached (by design), and it never displaces the
  // drain's own steps (#10154).
  await drain.raceDetached(input, "reflection-launch-settle", () => parts.launches.settled())
  // A hook (a prompt turn, a settle), a memory tool call or a detached bind/dream request still reading the identity
  // repo keeps a git child there past shutdown (#11135). It is awaited last, after the Kibitzer and facts cleanups that
  // release what such work may be waiting on, and only on the budget the steps above left: work that stalls cannot
  // keep the drain's own steps from running. It then settles again what that work may have started.
  await drain.raceDetached(input, "memory-work-settle", async () => {
    await parts.work.settled()
    await Promise.all([parts.reflectionLive.settled(), parts.corpusCache.settled(), parts.promptCache.settled()])
  })
  parts.resetSession(input.sessionId)
}
