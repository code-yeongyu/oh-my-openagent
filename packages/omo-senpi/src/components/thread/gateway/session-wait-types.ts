export type SessionWaitKind = "held" | "waiting"

/** A session the carrier found held or waiting for a person (A2.6, A3.2.8); a held session is not woken again. */
export type SessionWaitState = {
  readonly durable_id: string
  readonly wait: SessionWaitKind
  readonly hold_kinds: readonly string[]
  /** The session file's size when the state was written; a different size allows one new probe. */
  readonly file_size: number
  readonly written_at: number
}

/** What a queued row of the session waits on (A2.6, A2.11): a hold, a person's answer, or its wake. */
export type QueuedWaitingOn = { readonly kind: "hold" | "approval" | "wake" }

export type SessionWaitStore = {
  readonly write: (request: Omit<SessionWaitState, "written_at">) => Promise<void>
  readonly read: (request: { readonly durable_id: string }) => Promise<SessionWaitState | null>
  readonly clear: (request: { readonly durable_id: string }) => Promise<void>
  readonly waitingOn: (request: { readonly durable_id: string }) => Promise<QueuedWaitingOn | null>
}

export type IntakePair = { readonly sender_device: string; readonly session_id: string }
export type IntakeMark = IntakePair & { readonly last_command_id: string }

/** A session holding intake rows that a sweep may wake: the devices whose rows are open, and whether same-device rows wait too. */
export type OpenIntakeSession = {
  readonly durable_id: string
  readonly devices: readonly string[]
  readonly local: boolean
}

export type IntakeMarkStore = {
  /** A NEW committed intake row (never a deduplicated answer): its command id becomes the pair's newest (A5.3). */
  readonly record: (request: IntakePair & { readonly command_id: string; readonly ledger_id?: string }) => Promise<void>
  /** The command id an intake row was committed under. */
  readonly commandFor: (request: { readonly ledger_id: string }) => Promise<string | null>
  /** Whether an open intake row of this sender device was committed under this command id. */
  readonly openForCommand: (request: {
    readonly sender_device: string
    readonly command_id: string
  }) => Promise<boolean>
  /** Every marked pair, applied or not. */
  readonly marked: () => Promise<readonly IntakePair[]>
  /** Every pair that still holds an intake row not yet applied, with the newest command the consumer answered queued. */
  readonly pending: () => Promise<readonly IntakeMark[]>
  /** One transaction: when the pair holds no open intake row, its mark is removed and the newest command returned. */
  readonly drained: (
    request: IntakePair,
  ) => Promise<{ readonly drained: true; readonly last_command_id: string } | { readonly drained: false }>
  readonly openSessions: () => Promise<readonly OpenIntakeSession[]>
}

export type SessionWork = { readonly queued: number; readonly claimed: number; readonly unapplied: number }
