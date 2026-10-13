import type { V2ModelRef, V2PluginContext } from "../context-types"
import { settle } from "./v1-result"

type PromptPart = {
  readonly type: string
  readonly text?: string
  readonly synthetic?: boolean
  readonly [key: string]: unknown
}

export type PromptAsyncArgs = {
  readonly path: { readonly id: string }
  readonly body?: {
    readonly agent?: string
    readonly model?: { readonly providerID: string; readonly modelID: string }
    readonly variant?: string
    readonly noReply?: boolean
    readonly tools?: unknown
    readonly system?: unknown
    readonly parts?: ReadonlyArray<PromptPart>
  }
  readonly query?: unknown
}

type PromptBody = NonNullable<PromptAsyncArgs["body"]>
export type Report = (key: string, message: string) => void

function sameModel(left: V2ModelRef, right: V2ModelRef | undefined): boolean {
  return right !== undefined && left.providerID === right.providerID && left.id === right.id && left.variant === right.variant
}

function targetModel(body: PromptBody, current: V2ModelRef | undefined): V2ModelRef | undefined {
  if (body.model !== undefined) {
    return { providerID: body.model.providerID, id: body.model.modelID, ...(body.variant === undefined ? {} : { variant: body.variant }) }
  }
  if (body.variant !== undefined && current !== undefined) return { ...current, variant: body.variant }
  return undefined
}

/** 2.x prompts carry text only; the session's agent and model are switched beforehand when they differ. */
async function switchIfNeeded(context: V2PluginContext, sessionID: string, body: PromptBody): Promise<void> {
  if (body.agent === undefined && body.model === undefined && body.variant === undefined) return
  const current = await context.session.get({ sessionID })
  if (body.agent !== undefined && body.agent !== current.agent) await context.session.switchAgent({ sessionID, agent: body.agent })
  const target = targetModel(body, current.model)
  if (target !== undefined && !sameModel(target, current.model)) await context.session.switchModel({ sessionID, model: target })
}

/**
 * The 1.x `session.promptAsync`: queues the text on the session and starts a turn unless `noReply`.
 * A prompt whose text parts are all synthetic is sent as a synthetic message so it stays out of the
 * user's turn history, matching how 1.x flagged injected context.
 */
export function createPromptAsync(context: V2PluginContext, report: Report) {
  return (args: PromptAsyncArgs) =>
    settle(async () => {
      const sessionID = args.path.id
      const body = args.body ?? {}
      if (body.tools !== undefined) report("prompt.tools", 'promptAsync: per-prompt "tools" restrictions are not supported on OpenCode 2.x and were ignored')
      if (body.system !== undefined) report("prompt.system", 'promptAsync: per-prompt "system" text is not supported on OpenCode 2.x and was ignored')
      const parts = body.parts ?? []
      for (const part of parts) {
        if (part.type !== "text") report(`prompt.part.${part.type}`, `promptAsync: "${part.type}" parts are not supported on OpenCode 2.x and were dropped`)
      }
      const textParts = parts.filter((part) => part.type === "text" && typeof part.text === "string")
      if (textParts.length === 0) throw new Error("promptAsync needs at least one text part on OpenCode 2.x")

      await switchIfNeeded(context, sessionID, body)
      const input = { sessionID, text: textParts.map((part) => part.text).join("\n\n"), delivery: "queue" as const, resume: body.noReply !== true }
      if (textParts.every((part) => part.synthetic === true)) await context.session.synthetic(input)
      else await context.session.prompt(input)
    })
}
