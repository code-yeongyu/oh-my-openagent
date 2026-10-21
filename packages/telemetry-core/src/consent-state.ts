import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { writeFileAtomically } from "@oh-my-opencode/utils/atomic-write"

import type { TelemetryEnv } from "./types"

/**
 * The one place that answers "did this machine say yes to anonymous usage stats".
 *
 * The answer is per machine, so it lives beside the rest of the omo state rather than in a
 * config file a project could carry between repositories. Telemetry is opt-in: a machine that
 * never answered reads as "unanswered", which resolves to disabled, so a fresh install and a
 * hand-written broken file both land on the safe side.
 */

export const TELEMETRY_CONSENT_STATE_FILE = "telemetry.json"

/** Owner read/write only. The answer is not a secret, but it is one person's choice on one machine. */
export const TELEMETRY_CONSENT_FILE_MODE = 0o600

/** Points the answer at another file. This is how a test and a sandbox stay off the real `~/.omo`. */
export const TELEMETRY_CONSENT_FILE_ENV = "OMO_TELEMETRY_CONSENT_FILE"

export type TelemetryConsentState = {
  readonly enabled: boolean
  readonly answered_at?: string
  readonly version: 1
}

export type ResolveTelemetryConsentStatePathOptions = {
  readonly env?: TelemetryEnv
}

/**
 * The canonical answer path: `~/.omo/state/telemetry.json`, or wherever `OMO_TELEMETRY_CONSENT_FILE`
 * points. `HOME` before `USERPROFILE` before `os.homedir()` mirrors how the rest of the repo finds a
 * home directory, so a relocated `HOME` relocates the answer with it.
 */
export function resolveTelemetryConsentStatePath(
  options: ResolveTelemetryConsentStatePathOptions = {},
): string {
  const env = options.env ?? process.env
  const override = env[TELEMETRY_CONSENT_FILE_ENV]?.trim()
  if (override) return override
  const home = env["HOME"]?.trim() || env["USERPROFILE"]?.trim() || homedir()
  return join(home, ".omo", "state", TELEMETRY_CONSENT_STATE_FILE)
}

/**
 * The machine's answer, or `undefined` when nobody has answered yet. A file that cannot be read or
 * parsed reads as unanswered on purpose: it resolves to disabled rather than to whatever a damaged
 * byte sequence happens to look like.
 */
export function readTelemetryConsentState(
  stateFilePath: string,
): TelemetryConsentState | undefined {
  if (!existsSync(stateFilePath)) return undefined
  try {
    const parsed: unknown = JSON.parse(readFileSync(stateFilePath, "utf-8"))
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    const { enabled, answered_at, version } = parsed as Record<string, unknown>
    if (typeof enabled !== "boolean") return undefined
    return {
      enabled,
      version: 1,
      ...(typeof answered_at === "string" ? { answered_at } : {}),
    }
  } catch {
    return undefined
  }
}

/** `true` when the machine answered yes, `false` when it answered no or has not answered at all. */
export function readTelemetryConsentEnabled(stateFilePath: string): boolean {
  return readTelemetryConsentState(stateFilePath)?.enabled === true
}

/**
 * Records the answer. Returns whether it landed, because a launch must never fail over a file it
 * only wanted to write: the mode is tightened after the atomic write, since the write itself lands
 * under the process umask.
 */
export function writeTelemetryConsentState(
  stateFilePath: string,
  state: { readonly enabled: boolean; readonly answered_at?: string },
): boolean {
  const next: TelemetryConsentState = {
    enabled: state.enabled,
    version: 1,
    answered_at: state.answered_at ?? new Date().toISOString(),
  }
  try {
    mkdirSync(dirname(stateFilePath), { recursive: true })
    writeFileAtomically(stateFilePath, `${JSON.stringify(next, null, 2)}\n`)
    chmodSync(stateFilePath, TELEMETRY_CONSENT_FILE_MODE)
    return true
  } catch {
    return false
  }
}