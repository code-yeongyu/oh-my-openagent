import { rmSync } from "node:fs"

import type { LatchStore } from "./host-latch.ts"

/** Where a `hand.resume` request came from; only `console` is attended. */
export type OriginClass = "console" | "sshd_pty" | "agent_child" | "remote_launched" | "unreadable"

export interface OriginFacts {
  /** False when the requester's process chain or environment could not be read. */
  readonly readable: boolean
  /** The requester and its ancestors, nearest first. */
  readonly ancestors: readonly { readonly pid: number; readonly name: string }[]
  readonly env: Readonly<Record<string, string | undefined>>
  /** Pids of the uid's omo brain processes (their session lock files). */
  readonly brainPids: ReadonlySet<number>
  /** The requester was started by a remote command (a relay or bunshin dispatch). */
  readonly remoteLaunched: boolean
}

/** Any read failure, a pty under sshd, the agent's child shell or a remotely launched process is unattended. */
export function classifyOrigin(facts: OriginFacts): OriginClass {
  if (!facts.readable) return "unreadable"
  if (
    facts.ancestors.some((process) => process.name === "sshd") ||
    facts.env.SSH_CONNECTION !== undefined ||
    facts.env.SSH_TTY !== undefined
  )
    return "sshd_pty"
  if (facts.ancestors.some((process) => facts.brainPids.has(process.pid))) return "agent_child"
  if (facts.remoteLaunched) return "remote_launched"
  return "console"
}

export type ResumeOutcome =
  | { readonly kind: "resumed"; readonly origin: "console" }
  | {
      readonly kind: "refused"
      readonly code: "ControlRequired"
      readonly reason: "origin_unattended"
      readonly origin: Exclude<OriginClass, "console">
    }

export interface ResumeDeps {
  readonly origin: OriginClass
  /** Who asked: the desktop UI, `/computer resume` or the `--resume` CLI. */
  readonly peer: string
  /** The live host's latch; absent when no host is live (`--resume` under `file_only`). */
  readonly latch?: LatchStore
  /** The live engine's `stopPath.resume`, which lifts the stop marker. */
  readonly engine?: { resume(): Promise<void> }
  readonly stopMarker: string
  readonly audit: (line: Readonly<Record<string, unknown>>) => void
}

/**
 * `hand.resume`, the ONE lift verb (desktop UI, `/computer resume`, `--resume`). An unattended
 * origin is refused `ControlRequired{origin_unattended}` with nothing changed. Otherwise the host
 * latch (memory and file) is cleared BEFORE the marker, so a crash between the two leaves the hand
 * stopped, never half-lifted. With no live host only the marker is removed: the persisted host
 * latch stays, because a host restart lifts nothing.
 */
export async function handResume(deps: ResumeDeps): Promise<ResumeOutcome> {
  if (deps.origin !== "console") {
    deps.audit({
      kind: "grant",
      grant: { kind: "lift", verdict: "deny" },
      peer: deps.peer,
      origin: deps.origin,
      reason: "origin_unattended",
    })
    return { kind: "refused", code: "ControlRequired", reason: "origin_unattended", origin: deps.origin }
  }
  if (deps.latch !== undefined) deps.latch.set({ suspended: false, stopEpoch: deps.latch.get().stopEpoch })
  if (deps.engine === undefined) rmSync(deps.stopMarker, { force: true })
  else await deps.engine.resume()
  deps.audit({ kind: "grant", grant: { kind: "lift", verdict: "allow" }, peer: deps.peer, origin: "console" })
  return { kind: "resumed", origin: "console" }
}
