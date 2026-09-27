import type { Plugin } from "@opencode/plugin"

import { log } from "../shared/logger"

type V2Context = Plugin.Context

type V1Handler = (input: unknown, output?: unknown) => Promise<void> | void

export type V1HookMap = Record<string, unknown>

function asHandler(value: unknown): V1Handler | undefined {
  return typeof value === "function" ? value as V1Handler : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function textParts(parts: unknown): string {
  if (!Array.isArray(parts)) return ""
  return parts
    .map((part) => {
      if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") return ""
      return part.text
    })
    .filter((text) => text.length > 0)
    .join("\n")
}

function systemText(system: readonly { type?: string; text?: string }[]): string[] {
  return system.map((part) => (typeof part.text === "string" ? part.text : ""))
}

async function safeCall(name: string, action: () => Promise<void> | void): Promise<void> {
  try {
    await action()
  } catch (error) {
    log("[oh-my-openagent] v2 hook failed", {
      hook: name,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Registers OpenCode V2 hooks that forward one mutable event into the
 * existing V1 `(input, output)` handlers.
 */
export async function registerV1Hooks(ctx: V2Context, hooks: V1HookMap): Promise<() => void> {
  const controller = new AbortController()
  const chatMessage = asHandler(hooks["chat.message"])
  const chatParams = asHandler(hooks["chat.params"])
  const chatHeaders = asHandler(hooks["chat.headers"])
  const systemTransform = asHandler(hooks["experimental.chat.system.transform"])
  const messagesTransform = asHandler(hooks["experimental.chat.messages.transform"])
  const compacting = asHandler(hooks["experimental.session.compacting"])
  const toolBefore = asHandler(hooks["tool.execute.before"])
  const toolAfter = asHandler(hooks["tool.execute.after"])
  const eventHandler = asHandler(hooks.event)
  const shellEnv = asHandler(hooks["shell.env"])
  const permissionAsk = asHandler(hooks["permission.ask"])

  if (chatMessage) {
    await ctx.session.hook("prompt", (event) => {
      return safeCall("chat.message", async () => {
        const parts: Array<{ type: string; text?: string }> = [{ type: "text", text: event.prompt.text }]
        const output = { message: {}, parts }
        await chatMessage({ sessionID: event.sessionID }, output)
        event.prompt.text = textParts(output.parts)
      })
    })
  }

  if (systemTransform || messagesTransform || chatParams) {
    await ctx.session.hook("context", (event) => {
      return safeCall("context", async () => {
        if (systemTransform) {
          const output = { system: systemText(event.system) }
          await systemTransform({
            sessionID: event.sessionID,
            model: { id: event.model.id, providerID: event.model.providerID },
          }, output)
          event.system.splice(0, event.system.length, ...output.system.map((text) => ({ type: "text" as const, text })))
        }
        if (messagesTransform) {
          const output = { messages: event.messages }
          await messagesTransform({}, output)
          event.messages.splice(0, event.messages.length, ...output.messages)
        }
        if (chatParams) {
          const output: {
            temperature?: number
            topP?: number
            topK?: number
            maxOutputTokens?: number
            options: Record<string, unknown>
          } = { options: {} }
          await chatParams({
            sessionID: event.sessionID,
            agent: { name: String(event.agent) },
            model: { providerID: event.model.providerID, modelID: event.model.id },
            provider: { id: event.model.providerID },
            message: { variant: event.model.variant },
          }, output)
          if (output.temperature !== undefined) event.options.temperature = output.temperature
          if (output.topP !== undefined) event.options.topP = output.topP
          if (output.topK !== undefined) event.options.topK = output.topK
          if (output.maxOutputTokens !== undefined) event.options.maxTokens = output.maxOutputTokens
          Object.assign(event.options, output.options)
        }
      })
    })
  }

  if (chatHeaders) {
    await ctx.session.hook("model.request", (event) => {
      return safeCall("chat.headers", async () => {
        const output = { headers: event.headers }
        await chatHeaders({
          sessionID: event.sessionID,
          provider: { id: event.model.providerID },
          message: {},
        }, output)
      })
    })
  }

  if (compacting) {
    await ctx.session.hook("compaction", (event) => {
      return safeCall("session.compacting", async () => {
        const output = { context: [] as string[] }
        await compacting({ sessionID: event.sessionID }, output)
        for (const text of output.context) {
          event.system.push({ type: "text", text })
        }
      })
    })
  }

  if (toolBefore) {
    await ctx.tool.hook("execute.before", (event) => {
      return safeCall("tool.execute.before", async () => {
        const input = { tool: event.tool, sessionID: event.sessionID, callID: event.id }
        const output = { args: isRecord(event.input) ? event.input : {} }
        await toolBefore(input, output)
        event.tool = input.tool
        event.input = output.args
      })
    })
  }

  if (toolAfter) {
    await ctx.tool.hook("execute.after", (event) => {
      return safeCall("tool.execute.after", async () => {
        if (event.status !== "completed") return
        const content = typeof event.result.content === "string"
          ? event.result.content
          : JSON.stringify(event.result.content ?? "")
        const output = {
          title: "",
          output: content,
          metadata: { ...(event.result.metadata ?? {}) },
        }
        await toolAfter({
          tool: event.tool,
          sessionID: event.sessionID,
          callID: event.id,
          args: event.input,
        }, output)
        event.result = {
          ...event.result,
          content: output.output,
          metadata: output.metadata,
        }
      })
    })
  }

  if (shellEnv && ctx.shell) {
    await ctx.shell.hook("create.before", (event) => {
      return safeCall("shell.env", async () => {
        const output = { env: event.env }
        await shellEnv({}, output)
      })
    })
  }

  if (permissionAsk && ctx.permission) {
    await ctx.permission.hook("evaluate", (event) => {
      return safeCall("permission.ask", async () => {
        const output = { effect: event.effect, message: event.message }
        await permissionAsk({
          sessionID: event.sessionID,
          action: event.action,
          resources: event.resources,
        }, output)
        if (output.effect === "allow" || output.effect === "deny" || output.effect === "ask") {
          event.effect = output.effect
        }
        if (typeof output.message === "string") event.message = output.message
      })
    })
  }

  if (eventHandler) {
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          await safeCall("event", () => eventHandler({ event }))
        }
      } catch (error) {
        if (controller.signal.aborted) return
        log("[oh-my-openagent] event subscription failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()
  }

  if (asHandler(hooks["experimental.compaction.autocontinue"])) {
    log("[oh-my-openagent] experimental.compaction.autocontinue has no OpenCode V2 hook; continuation after compaction stays off")
  }

  return () => {
    controller.abort()
  }
}
