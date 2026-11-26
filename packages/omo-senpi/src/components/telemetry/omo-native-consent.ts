import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readFileSync } from "node:fs"

import type { TelemetryDiagnosticInput } from "@oh-my-opencode/telemetry-core"

import { getOmoNativeStateDir } from "./product-identity"

const SOURCE = "omo-native-consent"
const CONSENT_MARKER_FILE_NAME = "consent-answer"
const CONSENT_MARKER_VERSION = 1

export type OmoNativeConsentAnswer = "accepted" | "declined"

type ConsentMarker = {
  readonly v: number
  readonly answer: OmoNativeConsentAnswer
}

/**
 * The persisted first-run answer (#14920 wave B): telemetry is allowed only when this reads
 * `accepted`. An absent, unreadable, corrupt or future-version marker is "not consented", and a
 * run with no UI to ask in (headless, print, RPC) never writes one, so such runs count as not
 * consented.
 */
export function readOmoNativeConsent(stateDir: string): OmoNativeConsentAnswer | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(stateDir, CONSENT_MARKER_FILE_NAME), "utf8")) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined
    const { v, answer } = parsed as Record<string, unknown>
    if (v !== CONSENT_MARKER_VERSION) return undefined
    return answer === "accepted" || answer === "declined" ? answer : undefined
  } catch {
    return undefined
  }
}

/** The gate's question: only an explicit recorded `accepted` allows telemetry. */
export function isOmoNativeConsentAccepted(stateDir: string): boolean {
  return readOmoNativeConsent(stateDir) === "accepted"
}

/**
 * Persists the first-run answer exactly once: the marker is created with `wx`, so the first
 * answer wins and a concurrent asker loses the race cleanly. Returns whether this call created
 * the marker.
 */
export function recordOmoNativeConsent(
  stateDir: string,
  answer: OmoNativeConsentAnswer,
  diagnostics?: (input: TelemetryDiagnosticInput) => void,
): boolean {
  const marker: ConsentMarker = { v: CONSENT_MARKER_VERSION, answer }
  try {
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(join(stateDir, CONSENT_MARKER_FILE_NAME), `${JSON.stringify(marker)}\n`, {
      flag: "wx",
      mode: 0o600,
    })
    return true
  } catch (error) {
    if (!isFileExistsError(error)) {
      diagnostics?.({
        event: "telemetry_consent_failed",
        source: SOURCE,
        error,
        errorKind: error instanceof Error ? "error" : "non_error",
      })
    }
    return false
  }
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "EEXIST"
}
