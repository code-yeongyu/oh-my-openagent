import type { TelemetryDiagnosticInput, TelemetryEnv } from "@oh-my-opencode/telemetry-core"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { automatedRunReason } from "./omo-native-session"
import { recordOmoNativeConsent, readOmoNativeConsent } from "./omo-native-consent"
import { createOmoNativeProductConfig, getOmoNativeStateDir } from "./product-identity"
import { isTelemetryClientEnabled } from "@oh-my-opencode/telemetry-core/injected"

const SOURCE = "omo-native-notice"
const TITLE = "Anonymous telemetry"
const QUESTION =
  "OmO Native sends anonymous usage telemetry (no prompts, code, file paths, or account data) to PostHog in the United States (https://us.i.posthog.com) and to the OmO telemetry collector (https://t.omo.dev) to improve the product. " +
  'Turn it off any time with DO_NOT_TRACK=1, or set "telemetry": { "enabled": false } in ~/.omo/omo.jsonc. ' +
  "Details: https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/legal/privacy-policy.md\n\nAllow anonymous usage telemetry?"

type ConsentUi = {
  confirm(title: string, message: string): Promise<boolean>
}

export type OmoNativeNoticeOptions = {
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  readonly env?: TelemetryEnv
  readonly stateDir?: string
}

export type OmoNativeNoticeRegistration = {
  register(pi: SenpiExtensionAPI, ctx: ComponentContext): void
}

/**
 * The first-run consent question (#14920 wave B): an interactive session with a confirm dialog is
 * asked once; the answer is persisted before any telemetry decision reads it. A session with no
 * dialog (headless, print, RPC) asks nothing and writes nothing, so such runs count as not
 * consented. The question is skipped when the machine already opted out through the env matrix or
 * runs automated, because that user has already decided.
 */
export function createOmoNativeNoticeRegistration(options: OmoNativeNoticeOptions = {}): OmoNativeNoticeRegistration {
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

  const mayAsk = (): boolean => {
    try {
      return (
        automatedRunReason(env) === undefined &&
        isTelemetryClientEnabled({ env, product: createOmoNativeProductConfig() })
      )
    } catch {
      return false
    }
  }

  return {
    register(pi, _ctx) {
      pi.on("session_start", (_payload, eventCtx) => {
        const ui = consentUi(eventCtx)
        if (ui === undefined) return
        if (readOmoNativeConsent(stateDir) !== undefined) return
        if (!mayAsk()) return
        return (async () => {
          let allowed: boolean
          try {
            allowed = await ui.confirm(TITLE, QUESTION)
          } catch (error) {
            reportOnce(error)
            return
          }
          recordOmoNativeConsent(stateDir, allowed ? "accepted" : "declined", (input) =>
            reportOnce(input.error ?? input),
          )
        })()
      })
    },
  }
}

function consentUi(value: unknown): ConsentUi | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const ui = (value as Record<string, unknown>)["ui"]
  if (typeof ui !== "object" || ui === null) return undefined
  const confirm = (ui as Record<string, unknown>)["confirm"]
  return typeof confirm === "function" ? { confirm: (title, message) => (confirm as (t: string, m: string) => Promise<boolean>)(title, message) } : undefined
}
