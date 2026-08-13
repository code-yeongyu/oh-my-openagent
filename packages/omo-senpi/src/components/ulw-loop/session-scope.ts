// Session identity for Senpi ulw-loop state. The CLI scopes ulw-loop state under
// `.omo/ulw-loop/<session-id>/` when a `--session-id` or `OMO_ULW_LOOP_SESSION_ID`
// is present, and falls back to the cwd-global `.omo/ulw-loop/` otherwise. Two
// independent Senpi instances in one working directory must never see each other's
// run, so this adapter resolves a stable per-session scope from the host's
// sessionManager and prefixes it with `senpi-` to avoid accidental collision with
// Codex thread ids that also feed the same env var.

export const ULW_LOOP_SESSION_ENV_KEY = "OMO_ULW_LOOP_SESSION_ID"

export const SENPI_SESSION_PREFIX = "senpi-"

// Same normalization contract as the CLI's normalizeUlwLoopSessionId: never emit a
// path separator, drop empty/`.`/`..` segments, collapse invalid characters.
export function normalizeSenpiUlwScopeId(sessionId: string): string | null {
  const trimmed = sessionId.trim()
  if (trimmed.length === 0) return null
  const segments = trimmed.split(/[\\/]+/).filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  const candidate = (segments.length > 0 ? segments.join("-") : trimmed)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .replace(/^[.-]+|[.-]+$/g, "")
  return candidate.length > 0 ? `${SENPI_SESSION_PREFIX}${candidate}` : null
}

export function extractSenpiSessionId(eventCtx: unknown): string | undefined {
  if (!isRecord(eventCtx)) return undefined
  const value = eventCtx["sessionManager"]
  if (!isRecord(value) || typeof value["getSessionId"] !== "function") return undefined
  const manager = value as unknown as { getSessionId(): unknown }
  const id = manager.getSessionId()
  return typeof id === "string" ? id : undefined
}

// Resolve the ulw-loop scope id for the current session, or null when the host
// provides no session identity. null means fail-closed: the adapter must not fall
// back to reading the cwd-global state, which may belong to another session.
export function resolveSenpiUlwSessionId(eventCtx: unknown): string | null {
  const sessionId = extractSenpiSessionId(eventCtx)
  if (sessionId === undefined) return null
  return normalizeSenpiUlwScopeId(sessionId)
}

// Owns the `OMO_ULW_LOOP_SESSION_ID` lifecycle for the extension process so that
// child shells spawned by the model (bash/interactive_bash) resolve ulw-loop CLI
// commands into the current session's scoped state directory automatically.
// The previous value is preserved and restored on switch/shutdown only while the
// current value is still the one this manager wrote.
export class SenpiUlwSessionScope {
  private previousValue: string | undefined
  private activeScope: string | null = null

  activate(scopeId: string | null): void {
    if (scopeId === null) {
      this.clear()
      return
    }
    const current = process.env[ULW_LOOP_SESSION_ENV_KEY]
    if (this.activeScope === null && current !== scopeId) {
      this.previousValue = current
    }
    this.activeScope = scopeId
    process.env[ULW_LOOP_SESSION_ENV_KEY] = scopeId
  }

  clear(): void {
    if (this.activeScope === null) return
    if (process.env[ULW_LOOP_SESSION_ENV_KEY] === this.activeScope) {
      if (this.previousValue === undefined) {
        delete process.env[ULW_LOOP_SESSION_ENV_KEY]
      } else {
        process.env[ULW_LOOP_SESSION_ENV_KEY] = this.previousValue
      }
    }
    this.previousValue = undefined
    this.activeScope = null
  }

  dispose(): void {
    this.clear()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
