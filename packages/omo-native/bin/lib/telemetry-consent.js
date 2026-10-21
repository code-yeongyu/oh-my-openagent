import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { runtimeHome } from "./agent-dir.js"

/**
 * The launcher's half of the telemetry opt-in, a deliberate twin of
 * `packages/telemetry-core/src/consent-state.ts`.
 *
 * The launcher runs under plain Node as well as Bun, so it cannot import that TypeScript module:
 * the published package ships JS, not a build step. The duplication is the file contract only
 * (`~/.omo/state/telemetry.json`, `{ "enabled": boolean }`, mode 600) and both sides have to agree on
 * it. Changing one means changing the other, and the parity test in this directory is what proves it.
 */

/** Asks once. A plain Enter means no, which is the answer the default already assumes. */
export const TELEMETRY_CONSENT_PROMPT = "Anonymous usage stats help us focus work — turn them on? [y/N] "

/** Points the answer at another file; this is how a test or a sandbox stays off the real `~/.omo`. */
export const TELEMETRY_CONSENT_FILE_ENV = "OMO_TELEMETRY_CONSENT_FILE"

const TELEMETRY_CONSENT_FILE_MODE = 0o600

/** Where this machine's answer lives. */
export function consentStatePath(env = process.env) {
  const override = env[TELEMETRY_CONSENT_FILE_ENV]?.trim()
  if (override) return override
  return join(runtimeHome(env), ".omo", "state", "telemetry.json")
}

/** The recorded answer, or undefined when nobody has answered. A damaged file reads as unanswered. */
export function readTelemetryConsent(stateFilePath) {
  if (!existsSync(stateFilePath)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(stateFilePath, "utf8"))
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    return typeof parsed.enabled === "boolean" ? parsed.enabled : undefined
  } catch {
    return undefined
  }
}

/**
 * Records the answer and tightens the mode afterwards, because the write itself lands under the
 * process umask. Returns whether it landed: a launch must never fail over a file it only wanted to
 * write, and telemetry is off by default, so a lost write costs one more prompt rather than privacy.
 */
export function writeTelemetryConsent(stateFilePath, enabled) {
  try {
    mkdirSync(dirname(stateFilePath), { recursive: true })
    const pendingPath = `${stateFilePath}.${process.pid}.tmp`
    writeFileSync(pendingPath, `${JSON.stringify({ enabled, answered_at: new Date().toISOString(), version: 1 }, null, 2)}\n`, {
      mode: TELEMETRY_CONSENT_FILE_MODE,
    })
    renameSync(pendingPath, stateFilePath)
    chmodSync(stateFilePath, TELEMETRY_CONSENT_FILE_MODE)
    return true
  } catch {
    return false
  }
}

/**
 * An environment that already turned telemetry off has nothing to ask about, and asking would be
 * noise: the answer could not change the outcome.
 */
function telemetryDecidedInEnv(env) {
  return Boolean(env.DO_NOT_TRACK?.trim() || env.OMO_DISABLE_TELEMETRY?.trim() || env.OMO_DISABLE_POSTHOG?.trim())
}

function isYes(answer) {
  return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes"
}

/** Reads one line from a TTY. EOF answers no rather than hanging a launch forever. */
function readLine(stdin) {
  return new Promise((resolve) => {
    let buffer = ""
    const finish = () => {
      stdin.pause?.()
      resolve(buffer)
    }
    stdin.on?.("data", onData)
    stdin.on?.("end", finish)
    stdin.on?.("error", finish)
    stdin.resume?.()

    function onData(chunk) {
      buffer += String(chunk)
      const newline = buffer.indexOf("\n")
      if (newline === -1) return
      stdin.off?.("data", onData)
      stdin.off?.("end", finish)
      stdin.off?.("error", finish)
      finish()
    }
  })
}

/**
 * Asks once, on the first interactive launch, and never again. Every later launch reads the file.
 * Returns whether the user was asked, so a caller can tell a real prompt from a silent skip.
 */
export async function promptTelemetryConsentOnce(options = {}) {
  const env = options.env ?? process.env
  const stdin = options.stdin ?? process.stdin
  const stderr = options.stderr ?? process.stderr
  const stateFilePath = options.stateFilePath ?? consentStatePath(env)

  if (readTelemetryConsent(stateFilePath) !== undefined) return false
  if (stdin?.isTTY !== true || stderr?.isTTY !== true) return false
  if (telemetryDecidedInEnv(env)) return false

  stderr.write(TELEMETRY_CONSENT_PROMPT)
  const answer = await readLine(stdin)
  const enabled = isYes(answer)
  writeTelemetryConsent(stateFilePath, enabled)
  return true
}