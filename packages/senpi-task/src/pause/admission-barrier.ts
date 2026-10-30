import type { RunPauseOwner, RunRef } from "./ports"

export type AdmissionState =
  | { readonly kind: "open" }
  | { readonly kind: "closed"; readonly pauseSeq: number }
  | { readonly kind: "resuming"; readonly pauseSeq: number; readonly resumeId: string }

export type ResumeCredential = {
  readonly pauseSeq: number
  readonly resumeId: string
}

export type AdmissionParticipant = {
  readonly key: string
  readonly runRef: RunRef
}

export type AdmissionCheck = { readonly kind: "allowed" } | { readonly kind: "held"; readonly pauseSeq: number }
export type AdmissionTicket = {
  creating(taskId?: string): void
  update(participant: AdmissionParticipant): void
  check(): AdmissionCheck
  commit(): { readonly kind: "launch" } | { readonly kind: "start_paused"; readonly owner: RunPauseOwner }
  leave(): void
}

type RootBarrier = {
  state: AdmissionState
  highWater: number
  credential?: ResumeCredential
  readonly tickets: Map<object, AdmissionParticipant>
  readonly creations: Map<object, string>
  readonly creationWaiters: Set<() => void>
}

export class AdmissionBarrier {
  readonly #roots = new Map<string, RootBarrier>()

  #root(id: string): RootBarrier {
    let root = this.#roots.get(id)
    if (root === undefined) {
      root = { state: { kind: "open" }, highWater: 0, tickets: new Map(), creations: new Map(), creationWaiters: new Set() }
      this.#roots.set(id, root)
    }
    return root
  }

  state(id: string): AdmissionState {
    return this.#root(id).state
  }

  inFlight(id: string): readonly AdmissionParticipant[] {
    return [...this.#root(id).tickets.values()]
  }

  enter(id: string, participant: AdmissionParticipant, credential?: ResumeCredential):
    | { readonly kind: "entered"; readonly ticket: AdmissionTicket }
    | { readonly kind: "held"; readonly pauseSeq: number } {
    const root = this.#root(id)
    const enteredSeq = root.highWater
    const permitted = (): boolean => (credential === undefined || root.credential === credential)
      && (root.state.kind === "open"
      || (root.state.kind === "resuming" && root.credential === credential
        && credential?.pauseSeq === root.state.pauseSeq && credential.resumeId === root.state.resumeId))
    if (!permitted()) return { kind: "held", pauseSeq: root.highWater }
    const key = {}
    root.tickets.set(key, participant)
    const check = (): AdmissionCheck => enteredSeq === root.highWater && permitted()
      ? { kind: "allowed" } : { kind: "held", pauseSeq: root.highWater }
    return { kind: "entered", ticket: {
      creating: taskId => { if (root.tickets.has(key)) root.creations.set(key, taskId ?? participant.key) },
      update: next => {
        if (root.tickets.has(key)) {
          participant = next
          root.tickets.set(key, next)
        }
      },
      check,
      commit: () => {
        const admission = check()
        return admission.kind === "allowed" ? { kind: "launch" } : {
          kind: "start_paused",
          owner: { parentSessionId: id, parentPauseSeq: admission.pauseSeq, runRef: participant.runRef },
        }
      },
      leave: () => {
        root.tickets.delete(key)
        if (root.creations.delete(key) && root.creations.size === 0) {
          for (const resolve of root.creationWaiters) resolve()
          root.creationWaiters.clear()
        }
      },
    } }
  }

  creationsSettled(id: string): Promise<void> {
    const root = this.#root(id)
    return root.creations.size === 0 ? Promise.resolve() : new Promise(resolve => { root.creationWaiters.add(resolve) })
  }

  isCreating(id: string, taskId: string): boolean {
    return [...this.#root(id).creations.values()].includes(taskId)
  }

  close(id: string, pauseSeq: number): readonly AdmissionParticipant[] {
    const root = this.#root(id)
    if (root.highWater >= pauseSeq) return this.inFlight(id)
    root.highWater = pauseSeq
    root.state = { kind: "closed", pauseSeq }
    delete root.credential
    return this.inFlight(id)
  }

  resume(id: string, pauseSeq: number, resumeId: string): ResumeCredential {
    const root = this.#root(id)
    if (root.state.kind === "open" || root.state.pauseSeq !== pauseSeq) throw new Error("stale pause sequence")
    if (root.state.kind === "resuming" && root.state.resumeId === resumeId && root.credential !== undefined) return root.credential
    const credential = Object.freeze({ pauseSeq, resumeId })
    root.state = { kind: "resuming", pauseSeq, resumeId }
    root.credential = credential
    return credential
  }

  release(id: string, credential: ResumeCredential): boolean {
    const root = this.#root(id)
    if (root.state.kind !== "resuming" || root.credential !== credential) return false
    root.state = { kind: "open" }
    return true
  }

  restore(id: string, state: AdmissionState, transaction: { readonly newestSeq: number; readonly superseded: boolean }): void {
    const root = this.#root(id)
    delete root.credential
    root.highWater = transaction.newestSeq
    root.state = state.kind !== "open" && (transaction.superseded || state.pauseSeq !== transaction.newestSeq)
      ? { kind: "closed", pauseSeq: transaction.newestSeq } : state
    if (root.state.kind === "resuming") root.credential = Object.freeze({
      pauseSeq: root.state.pauseSeq, resumeId: root.state.resumeId,
    })
  }
}
