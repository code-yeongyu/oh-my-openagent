import { GitHubReadDeferred } from "./transport"
import { GitHubPrWatchHost } from "./github"
import { PrWatchRegistry } from "./registry"
import { recordPrWatchEvents, recordPrWatchReadFailure, stopPrWatch, type PrWatchSnapshot } from "./state"
import { prWatchTransitions } from "./transitions"

export class PrWatchReactor {
  constructor(private readonly registry: PrWatchRegistry, private readonly host: GitHubPrWatchHost) {}

  async pass(now: number): Promise<void> {
    const before = this.registry.read()
    const captured = Object.values(before.registrations).filter((registration) => registration.active).map((row) => ({ ...row }))
    const references = [...new Set(captured.map((registration) => registration.reference))]
    if (!references.length) return
    let fingerprints
    try {
      fingerprints = await this.host.fingerprints(references, before.snapshots, now)
    } catch (error) {
      if (error instanceof GitHubReadDeferred) return
      await this.registry.transaction((state) => {
        for (const registration of captured) recordPrWatchReadFailure(state, registration, now, error instanceof Error ? error.message : "unreadable fingerprint")
      })
      return
    }
    for (const reference of references) {
      const fingerprint = fingerprints.find((row) => row.key === reference)
      if (fingerprint?.result === "rate_limited") continue
      const previous = before.snapshots[reference]
      const candidate: PrWatchSnapshot = { ...previous, transition: (previous?.transition ?? 0) + 1 }
      try {
        // Host methods have no response cache: these reads necessarily follow this pass's fingerprint.
        if (!previous?.details || !fingerprint || fingerprint.refreshStatus) {
          candidate.details = await this.host.details(reference)
          if (fingerprint?.result === "ok") candidate.statusFingerprint = fingerprint.statusFingerprint
        }
        if (!previous?.activity || !fingerprint || fingerprint.refreshRemarks) {
          candidate.activity = await this.host.activity(reference)
          candidate.lastRemarksReadAt = now
          if (fingerprint?.result === "ok") candidate.remarksFingerprint = fingerprint.remarksFingerprint
        }
        await this.registry.transaction((state) => {
          const registrations = captured.filter((registration) => registration.reference === reference)
          state.snapshots[reference] = candidate
          for (const capturedRegistration of registrations) {
            const live = state.registrations[capturedRegistration.id]
            if (!live?.active || live.generation !== capturedRegistration.generation) continue
            delete live.unreadableSince
            if (candidate.details?.state === "MERGED" || candidate.details?.state === "CLOSED") {
              stopPrWatch(state, live.id, `pr_${candidate.details.state.toLowerCase()}`)
              continue
            }
            recordPrWatchEvents(state, capturedRegistration, prWatchTransitions(previous, candidate, live))
          }
        })
      } catch (error) {
        if (error instanceof GitHubReadDeferred) return
        await this.registry.transaction((state) => {
          for (const registration of captured.filter((registration) => registration.reference === reference)) {
            recordPrWatchReadFailure(state, registration, now, error instanceof Error ? error.message : "unreadable PR data")
          }
        })
      }
    }
  }
}
