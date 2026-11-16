/** What a consent prompt asks for; denial memory is kept per kind and app. */
export type PromptKind = "foreground" | "tier" | "app_scope"

export interface PromptRequest {
  readonly kind: PromptKind
  readonly app: string
  /** How long the human has: the requesting computer call's remaining budget, at most 45 s. */
  readonly deadlineMs: number
}

export type PromptOutcome =
  | { readonly kind: "granted" }
  | { readonly kind: "denied" }
  /** The call ended while the prompt was open: its answer never lands. */
  | { readonly kind: "withdrawn" }
  | { readonly kind: "refused"; readonly code: "ControlRequired"; readonly reason: "budget" | "denied_this_turn" }

export type AppAdmission =
  | { readonly kind: "admitted" }
  | {
      readonly kind: "refused"
      readonly code: "ControlRequired"
      readonly reason: "app_scope"
      readonly detail: "user_stopped"
    }

const MAX_PROMPT_MS = 45_000
const MIN_PROMPT_MS = 8_000

/**
 * The consent store bridge's prompt side (d-loop-migration.md 'Approval UI', re-pinned per call):
 * a prompt's deadline is the requesting computer call's remaining budget capped at 45 s and is
 * refused under 8 s; a prompt never lands on an ended call; a held foreground grant is revoked on a
 * failed call, at agent end and at shutdown. A denial is not asked again until a newer user
 * message, and "Stop computer use in <app>" takes that app out of scope until then.
 */
export class ConsentPrompts {
  readonly #ask: (request: PromptRequest, signal: AbortSignal | undefined) => Promise<"granted" | "denied">
  readonly #revoke: () => Promise<void>
  readonly #denied = new Set<string>()
  readonly #stoppedApps = new Set<string>()
  #foregroundHeld = false

  constructor(deps: {
    readonly ask: (request: PromptRequest, signal: AbortSignal | undefined) => Promise<"granted" | "denied">
    readonly revoke: () => Promise<void>
  }) {
    this.#ask = deps.ask
    this.#revoke = deps.revoke
  }

  async request(call: {
    readonly kind: PromptKind
    readonly app: string
    readonly callRemainingMs: number
    readonly signal?: AbortSignal
  }): Promise<PromptOutcome> {
    const memory = `${call.kind}\u0000${call.app}`
    if (this.#denied.has(memory)) return { kind: "refused", code: "ControlRequired", reason: "denied_this_turn" }
    const deadlineMs = Math.min(MAX_PROMPT_MS, call.callRemainingMs)
    if (deadlineMs < MIN_PROMPT_MS) return { kind: "refused", code: "ControlRequired", reason: "budget" }
    const ended = (): boolean => call.signal?.aborted === true
    if (ended()) return { kind: "withdrawn" }
    const answer = await this.#ask({ kind: call.kind, app: call.app, deadlineMs }, call.signal)
    if (ended()) return { kind: "withdrawn" }
    if (answer === "denied") {
      this.#denied.add(memory)
      return { kind: "denied" }
    }
    if (call.kind === "foreground") this.#foregroundHeld = true
    return { kind: "granted" }
  }

  holdsForegroundGrant(): boolean {
    return this.#foregroundHeld
  }

  admitApp(app: string): AppAdmission {
    return this.#stoppedApps.has(app)
      ? { kind: "refused", code: "ControlRequired", reason: "app_scope", detail: "user_stopped" }
      : { kind: "admitted" }
  }

  /** The presence surface's "Stop computer use in <app>": no latch, no revoke of other grants. */
  stopApp(app: string): void {
    this.#stoppedApps.add(app)
  }

  /** A newer user message: denial memory and per-app stops end. */
  onUserMessage(): void {
    this.#denied.clear()
    this.#stoppedApps.clear()
  }

  onCallFailed(): Promise<void> {
    return this.#revokeHeld()
  }

  onAgentEnd(): Promise<void> {
    return this.#revokeHeld()
  }

  onShutdown(): Promise<void> {
    return this.#revokeHeld()
  }

  async #revokeHeld(): Promise<void> {
    if (!this.#foregroundHeld) return
    this.#foregroundHeld = false
    await this.#revoke()
  }
}
