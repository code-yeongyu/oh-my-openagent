// The ulw-loop toolkit stores every plan under `<cwd>/.omo/ulw-loop/<sessionId>/` and derives that
// `<sessionId>` from its own env (`OMO_ULW_LOOP_SESSION_ID`, `CODEX_SESSION_ID`, `CODEX_THREAD_ID`,
// `PI_SESSION_ID`). Senpi never sets any of those on the extension host process, so a status probe that
// inherits the host env resolves NO session and reads the repo-global `.omo/ulw-loop/goals.json` instead
// of this session's directory. This module resolves the host's own session identity and hands it to the
// toolkit explicitly as `--session-id`, using the toolkit's own normalization rules so both sides agree
// on the directory name (`packages/omo-codex/plugin/components/ulw-loop/src/paths.ts`). The adapter
// boundary forbids importing that package from here, so the rules — including the scoped `goals.json`
// path the status probe gates on — are mirrored and pinned by a parity test.

import { join } from "node:path"

const STATUS_ARGS = ["ulw-loop", "status", "--json"] as const
const SESSION_ID_FLAG = "--session-id"
const ULW_LOOP_DIR = ".omo/ulw-loop"
const ULW_LOOP_GOALS = "goals.json"

export function normalizeUlwLoopSessionId(sessionId: string | null | undefined): string | null {
  const trimmed = sessionId?.trim()
  if (!trimmed) return null
  const pathSegments = trimmed
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  const candidate = (pathSegments.length > 0 ? pathSegments.join("-") : trimmed)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .replace(/^[.-]+|[.-]+$/g, "")
  return candidate.length > 0 ? candidate : null
}

// Reads the session id the host attached to the event, matching how the boulder precedence check
// identifies this session. Returns the raw id; callers normalize through `resolveUlwLoopSessionScope`.
export function extractSessionId(eventCtx: unknown): string | undefined {
  if (!isRecord(eventCtx)) return undefined
  const value = eventCtx["sessionManager"]
  if (!isRecord(value) || typeof value["getSessionId"] !== "function") return undefined
  const manager = value as unknown as { getSessionId(): unknown }
  const id = manager.getSessionId()
  return typeof id === "string" ? id : undefined
}

// null means "this host cannot prove which run it owns" — callers must fail closed rather than fall
// back to the unscoped repo-global plan, which every session in the cwd can see.
export function resolveUlwLoopSessionScope(eventCtx: unknown): string | null {
  return normalizeUlwLoopSessionId(extractSessionId(eventCtx))
}

export function ulwLoopStatusArgs(normalizedSessionId: string): readonly string[] {
  return [...STATUS_ARGS, SESSION_ID_FLAG, normalizedSessionId]
}

// Mirrors toolkit `ulwLoopGoalsPath(repoRoot, { sessionId })` once the id is already normalized.
export function ulwLoopScopedGoalsPath(cwd: string, normalizedSessionId: string): string {
  return join(cwd, ULW_LOOP_DIR, normalizedSessionId, ULW_LOOP_GOALS)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
