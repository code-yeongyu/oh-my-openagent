import type { Duplex } from "node:stream"

import type { CommandResult, SnapshotBody } from "../../../remote/types"
import type { OmoValue } from "../failure"

// What the launch, attach, extension-session, run and loop calls answer (first-party design 6.2, 6.9, 6.11). None
// carries a credential: a launched process's key went to its private descriptor and is not part of any answer.
type Stop = { readonly stop: () => Promise<void> }

export type Launched = { readonly exit_code: number; readonly session?: string }
export type PrintEvent = Readonly<Record<string, unknown>>
export type RpcServing = ({ readonly address: string; readonly pid: number } | { readonly stdio: Duplex }) & Stop
export type HostServing = { readonly socket: string; readonly pid: number } & Stop

/** threads.attach: a handle over one session, its endpoint closed when the attach ends (design 6.2, T1c). */
export type Attached = {
  readonly snapshot: SnapshotBody
  readonly events: AsyncIterable<Readonly<Record<string, unknown>>>
  readonly read: () => Promise<OmoValue<SnapshotBody>>
  readonly pending: () => Promise<OmoValue<readonly { readonly id: string; readonly kind: string }[]>>
  readonly answer: (id: string, answer: unknown) => Promise<OmoValue<CommandResult>>
  readonly command: (record: Readonly<Record<string, unknown>>) => Promise<OmoValue<CommandResult>>
  readonly serveEndpoint: () => Promise<OmoValue<{ readonly socket: string }>>
  readonly detach: () => Promise<void>
}

export type SessionOps = {
  readonly extensions: readonly {
    readonly name: string
    readonly ops: readonly { readonly op: string; readonly parameters: Readonly<Record<string, unknown>> }[]
  }[]
}

export type RunEvent = Readonly<Record<string, unknown>>
export type RunCompleted = {
  readonly session_id: string
  readonly success: boolean
  readonly duration_ms: number
  readonly message_count: number
  readonly summary: string
}

export type LoopAnswer = Readonly<Record<string, unknown>>
export type LoopBinding = { readonly session_id: string; readonly cwd: string }
