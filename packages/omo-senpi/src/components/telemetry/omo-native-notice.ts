import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { TelemetryDiagnosticInput, TelemetryEnv } from "@oh-my-opencode/telemetry-core"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { isOmoNativeTelemetryEnabled } from "./omo-native-session"
import { getOmoNativeStateDir } from "./product-identity"

const SOURCE = "omo-native-notice"
const MARKER_FILE_NAME = "notice-shown"
const DOCS_URL = "https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/senpi-telemetry.md"
const NOTICE = `OmO Native sends anonymous usage telemetry (no prompts, no paths). Docs: ${DOCS_URL} - opt out: DO_NOT_TRACK=1`

type NotificationUi = {
  notify(message: string, type?: "info" | "warning" | "error"): void
}

export type OmoNativeNoticeOptions = {
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  readonly env?: TelemetryEnv
  readonly isConfigEnabled?: (cwd: string | undefined, env: TelemetryEnv) => boolean
  readonly stateDir?: string
}

export type OmoNativeNoticeRegistration = {
  register(pi: SenpiExtensionAPI, ctx: ComponentContext): void
}

export function createOmoNativeNoticeRegistration(
  options: OmoNativeNoticeOptions = {},
): OmoNativeNoticeRegistration {
  const env = options.env ?? process.env
  const stateDir = options.stateDir ?? getOmoNativeStateDir(env)
  let diagnosticEmitted = false

  const reportOnce = (error: unknown): void => {
    if (diagnosticEmitted) return
    diagnosticEmitted = true
    options.diagnostics?.({
      event: "telemetry_capture_failed",
      source: SOURCE,
      error,
      errorKind: error instanceof Error ? "error" : "non_error",
    })
  }

  return {
    register(pi, _ctx) {
      pi.on("session_start", (_payload, eventCtx) => {
        // The single consent gate: a notice marker is a telemetry file, so it is written only when telemetry is on.
        const consented = isOmoNativeTelemetryEnabled({
          isConfigEnabled: options.isConfigEnabled,
          diagnostics: (input) => reportOnce(isRecord(input) && "error" in input ? input.error : input),
        }, eventCtx, env)
        if (!consented) return
        const ui = notificationUi(eventCtx)
        if (ui === undefined || !claimNotice(stateDir, reportOnce)) return
        try {
          ui.notify(NOTICE, "info")
        } catch (error) {
          reportOnce(error)
        }
      })
    },
  }
}

function claimNotice(stateDir: string, diagnostics: (error: unknown) => void): boolean {
  try {
    mkdirSync(stateDir, { recursive: true })
  } catch (error) {
    diagnostics(error)
    return false
  }
  try {
    writeFileSync(join(stateDir, MARKER_FILE_NAME), "shown\n", { flag: "wx", mode: 0o600 })
    return true
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false
    diagnostics(error)
    return false
  }
}

function notificationUi(value: unknown): NotificationUi | undefined {
  if (!isRecord(value)) return undefined
  const ui = value["ui"]
  return isRecord(ui) && typeof ui["notify"] === "function" ? ui as NotificationUi : undefined
}

function errorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined
  const code = error["code"]
  return typeof code === "string" ? code : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
