import { join } from "node:path"

import type { OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { createOmoNativeProductConfig } from "../telemetry/product-identity"
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
    register(pi) {
      const env = options.env ?? process.env
      const now = options.now ?? (() => new Date())
      const omoVersion = options.omoVersion ?? createOmoNativeProductConfig().packageVersion
      const senpiVersion = options.senpiVersion ?? pi.hostVersion ?? "unknown"
      const channel = options.channel ?? (omoVersion.includes("-") ? "beta" : "latest")
      const liveSessions = new Map<string, SessionLike>()
      let latestSessionId: string | undefined
      pi.on("session_start", (_payload, ctx) => {
        const id = sessionIdOf(ctx as SessionLike | undefined)
        if (id === undefined) return
        liveSessions.set(id, ctx as SessionLike)
        latestSessionId = id
      })
      pi.on("session_shutdown", (_payload, ctx) => {
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
          stateDir: () => options.stateDir ?? join(resolveAgentHome({ env }), "omo-senpi"),
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

      const runCommand = async (kind: FeedbackKind, args: string, ctx: unknown): Promise<void> => {
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
          prepare: async () => (await coreOf()).prepare(ctx as SessionLike, {}, redact),
          submit,
        })
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

