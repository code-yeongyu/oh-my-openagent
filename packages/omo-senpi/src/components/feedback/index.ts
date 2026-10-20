import { join } from "node:path"

import { deferUntilAfterFirstPaint } from "../../extension/startup-deferral"
import type { OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { createOmoNativeProductConfig } from "../telemetry/product-identity"
import { createCrashMarker, isProcessAlive, type AbnormalExit, type CrashMarkerIo } from "./crash-marker"
import type { FeedbackDraft, FeedbackKind, UploadRedactor } from "./draft"
import { feedbackRuntimeLoadFailure, loadFeedbackRuntime, type FeedbackRuntimeLoader, type FeedbackRuntimeModule } from "./runtime-loader"
import type { FeedbackCommandUi, FeedbackCore, FeedbackSessionLike } from "./runtime"
import type { ReportTransport, SubmitResult } from "./submit"

export const FEEDBACK_PREPARE_RPC_METHOD = "omo.feedback.prepare"
export const FEEDBACK_SUBMIT_RPC_METHOD = "omo.feedback.submit"
const DEFAULT_API_ORIGIN = "https://api.omo.dev"

export interface FeedbackComponentOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly transport?: ReportTransport
  readonly stateDir?: string
  readonly omoVersion?: string
  readonly senpiVersion?: string
  readonly channel?: string
  readonly now?: () => Date
  readonly loadRuntime?: FeedbackRuntimeLoader
  readonly crashMarker?: Partial<CrashMarkerIo>
  readonly watchStopSignals?: (stop: () => void) => void
}

const CRASH_PROMPT =
  "OmO stopped unexpectedly last time. Send a problem report to the OmO team? You see exactly what is sent before anything goes."
const SEND_CRASH_REPORT = "Send a report"
const NOT_NOW = "Not now"
const DONT_ASK_AGAIN = "Don't ask again"

const crashSectionText = (exits: readonly AbnormalExit[]): string =>
  exits.map((exit) => `An OmO session started ${exit.startedAt} ended without a clean exit.`).join("\n")

// SIGHUP (terminal closed) and SIGTERM are deliberate stops, not crashes. Once the listener is gone the signal is raised
// again so the process still ends the way it would have without it.
const watchProcessStopSignals = (stop: () => void): void => {
  for (const signal of ["SIGHUP", "SIGTERM"] as const) {
    process.once(signal, () => {
      stop()
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal)
    })
  }
}

type SessionLike = FeedbackSessionLike

const hostRedactor = (pi: SenpiExtensionAPI): UploadRedactor | undefined => {
  const redact = pi.redactForUpload
  if (redact === undefined) return undefined
  return (text) => {
    const result = redact(text)
    return { text: result.text, count: Object.values(result.counts).reduce((sum, n) => sum + n, 0) }
  }
}

const sessionIdOf = (ctx: SessionLike | undefined): string | undefined => {
  try {
    return ctx?.sessionManager?.getSessionId?.()
  } catch {
    return undefined
  }
}

export const FEEDBACK_UNAVAILABLE = "Feedback needs an OmO runtime that can remove secrets before upload. Update OmO and try again."

export function createFeedbackComponent(options: FeedbackComponentOptions = {}): OmoSenpiComponent {
  return {
    name: "feedback",
    register(pi, componentCtx) {
      const env = options.env ?? process.env
      const now = options.now ?? (() => new Date())
      const omoVersion = options.omoVersion ?? createOmoNativeProductConfig().packageVersion
      const senpiVersion = options.senpiVersion ?? pi.hostVersion ?? "unknown"
      const channel = options.channel ?? (omoVersion.includes("-") ? "beta" : "latest")
      const stateDir = () => options.stateDir ?? join(resolveAgentHome({ env }), "omo-senpi")
      const crashMarker = createCrashMarker(stateDir, {
        pid: options.crashMarker?.pid ?? process.pid,
        isAlive: options.crashMarker?.isAlive ?? isProcessAlive,
        now: options.crashMarker?.now ?? now,
      })
      let trackingThisProcess = false
      const liveSessions = new Map<string, SessionLike>()
      let latestSessionId: string | undefined
      pi.on("session_start", (_payload, ctx) => {
        if (!trackingThisProcess && Reflect.get(Object(ctx), "hasUI") === true && env.OMO_NATIVE_SURFACE !== "desktop") {
          trackingThisProcess = true
          trackThisProcess(ctx)
        }
        const id = sessionIdOf(ctx as SessionLike | undefined)
        if (id === undefined) return
        liveSessions.set(id, ctx as SessionLike)
        latestSessionId = id
      })
      pi.on("session_shutdown", (payload, ctx) => {
        if (Reflect.get(Object(payload), "reason") === "quit") crashMarker.markStopped()
        const id = sessionIdOf(ctx as SessionLike | undefined)
        if (id === undefined) return
        liveSessions.delete(id)
        if (latestSessionId === id) latestSessionId = [...liveSessions.keys()].at(-1)
      })
      const sessionForRpc = (input: unknown): SessionLike | undefined => {
        const requested: unknown = Reflect.get(Object(input), "sessionId")
        if (requested === null) return undefined
        if (typeof requested === "string") return liveSessions.get(requested)
        return latestSessionId === undefined ? undefined : liveSessions.get(latestSessionId)
      }

      const loadRuntime = options.loadRuntime ?? loadFeedbackRuntime
      let runtimeModule: FeedbackRuntimeModule | undefined
      const runtimeOf = async (): Promise<FeedbackRuntimeModule> => {
        if (runtimeModule !== undefined) return runtimeModule
        try {
          runtimeModule = await loadRuntime()
        } catch (error) {
          throw new Error(feedbackRuntimeLoadFailure(error))
        }
        return runtimeModule
      }
      let core: FeedbackCore | undefined
      const coreOf = async (): Promise<FeedbackCore> => {
        if (core !== undefined) return core
        const runtime = await runtimeOf()
        core ??= runtime.createFeedbackCore({
          env,
          now,
          omoVersion,
          senpiVersion,
          channel,
          stateDir,
          apiOrigin: () => env.OMO_SERVICE_API_URL ?? DEFAULT_API_ORIGIN,
          transport: options.transport ?? ((url, init) => fetch(url, init)),
        })
        return core
      }

      const prepare = async (session: SessionLike | undefined, input: unknown): Promise<FeedbackDraft | { kind: "unavailable"; reason: string }> => {
        const redact = hostRedactor(pi)
        if (redact === undefined) return { kind: "unavailable", reason: FEEDBACK_UNAVAILABLE }
        return (await coreOf()).prepare(session, input, redact)
      }

      const submit = async (input: unknown): Promise<SubmitResult> => {
        const redact = hostRedactor(pi)
        if (redact === undefined) return { kind: "refused", reason: "unavailable" }
        return (await coreOf()).submit(input, redact)
      }

      pi.rpc?.handle?.(FEEDBACK_PREPARE_RPC_METHOD, (input) => prepare(sessionForRpc(input), input))
      pi.rpc?.handle?.(FEEDBACK_SUBMIT_RPC_METHOD, submit)

      const runCommand = async (kind: FeedbackKind, args: string, ctx: unknown, input: unknown = {}): Promise<void> => {
        const ui = Reflect.get(Object(ctx), "ui") as FeedbackCommandUi | undefined
        if (ui === undefined) return
        const redact = hostRedactor(pi)
        if (redact === undefined) {
          ui.notify(FEEDBACK_UNAVAILABLE, "warning")
          return
        }
        let runtime: FeedbackRuntimeModule
        try {
          runtime = await runtimeOf()
        } catch (error) {
          ui.notify(error instanceof Error ? error.message : String(error), "error")
          return
        }
        await runtime.runFeedbackCommand({
          kind,
          args,
          ui,
          prepare: async () => (await coreOf()).prepare(ctx as SessionLike, input, redact),
          submit,
        })
      }

      const askAboutAbnormalExit = async (exits: readonly AbnormalExit[], ctx: unknown): Promise<void> => {
        const ui = Reflect.get(Object(ctx), "ui") as FeedbackCommandUi | undefined
        if (ui === undefined) return
        const choice = await ui.select(CRASH_PROMPT, [SEND_CRASH_REPORT, NOT_NOW, DONT_ASK_AGAIN])
        if (choice === DONT_ASK_AGAIN) {
          crashMarker.disableAsking()
          ui.notify("OmO won't ask again. You can still report a problem anytime with /bug.", "info")
          return
        }
        if (choice !== SEND_CRASH_REPORT) return
        await runCommand("bug", "", ctx, { sections: [{ id: "crash", text: crashSectionText(exits) }] })
      }

      function trackThisProcess(ctx: unknown): void {
        let exits: AbnormalExit[]
        try {
          exits = crashMarker.takeAbnormalExits()
          crashMarker.markRunning()
        } catch (error) {
          componentCtx.logger.warn("omo-senpi feedback could not record this session for crash reports", error)
          return
        }
        ;(options.watchStopSignals ?? watchProcessStopSignals)(() => crashMarker.markStopped())
        if (exits.length === 0 || crashMarker.askingDisabled()) return
        deferUntilAfterFirstPaint(componentCtx, "feedback crash report prompt", () => askAboutAbnormalExit(exits, ctx))
      }

      pi.registerCommand("feedback", {
        description: "Send feedback or an idea to the OmO team",
        argumentHint: "[your feedback]",
        handler: (args: string, ctx: unknown) => runCommand("feedback", args, ctx),
      })
      pi.registerCommand("bug", {
        description: "Report a problem to the OmO team",
        argumentHint: "[what went wrong]",
        handler: (args: string, ctx: unknown) => runCommand("bug", args, ctx),
      })
    },
  }
}

