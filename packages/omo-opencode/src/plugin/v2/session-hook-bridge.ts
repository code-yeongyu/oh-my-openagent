import type { Hooks } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import type { V2PluginContext, V2SessionContextHook, V2SessionPromptHook } from "./types"

/**
 * Session-hook bridge: wire V2 session hooks into the V1 handler chain that
 * createPluginModule() already returns.
 *
 * Mapping:
 * - V2 `prompt` hook  -> V1 `"chat.message"` handler. The V1 handler mutates
 *   `output.parts[]` (text parts) and `output.message.model`. We synthesize
 *   those structures from the V2 prompt draft, run the chain, then write the
 *   mutated text back into the V2 draft (`event.prompt.text`).
 * - V2 `context` hook -> V1 `"experimental.chat.system.transform"` (system
 *   strings) + `"chat.params"` (generation options). The V2 context hook is
 *   per-model-call; system changes affect only the outgoing request.
 * - V2 `model.request` hook -> V1 `"chat.headers"` handler (header record).
 */

type AnyHookFn = (input: unknown, output: unknown) => Promise<void>

type V1Hooks = {
  "chat.message"?: AnyHookFn
  "chat.params"?: AnyHookFn
  "chat.headers"?: AnyHookFn
  "experimental.chat.system.transform"?: AnyHookFn
}

function pickV1Hooks(hooks: Hooks, names: ReadonlyArray<keyof V1Hooks>): V1Hooks {
  const picked: V1Hooks = {}
  for (const name of names) {
    const handler = (hooks as Record<string, unknown>)[name]
    if (typeof handler === "function") {
      ;(picked as Record<string, unknown>)[name] = handler
    }
  }
  return picked
}

export async function registerV2SessionHooks(args: {
  readonly ctx: V2PluginContext
  readonly hooks: Hooks
}): Promise<Array<{ dispose: () => Promise<void> }>> {
  const hooks = pickV1Hooks(args.hooks, [
    "chat.message",
    "chat.params",
    "chat.headers",
    "experimental.chat.system.transform",
  ])
  const { ctx } = args
  const registrations: Array<{ dispose: () => Promise<void> }> = []

  if (hooks["chat.message"]) {
    const chatMessage = hooks["chat.message"]
    registrations.push(
      await ctx.session.hook("prompt", async (event: V2SessionPromptHook) => {
        const v1Input = {
          sessionID: event.sessionID,
          agent: undefined as string | undefined,
          model: undefined as { providerID: string; modelID: string } | undefined,
        }
        const v1Output = {
          message: {} as Record<string, unknown>,
          parts: [{ type: "text", text: event.prompt.text }] as Array<Record<string, unknown>>,
        }
        try {
          await chatMessage(v1Input, v1Output)
        } catch (error) {
          log("[v2-session-bridge] chat.message bridge failed", {
            sessionID: event.sessionID,
            error: error instanceof Error ? error.message : String(error),
          })
          return
        }
        const mutatedText = v1Output.parts
          .filter((part) => part["type"] === "text" && typeof part["text"] === "string")
          .map((part) => part["text"] as string)
          .join("")
        if (mutatedText !== event.prompt.text) {
          event.prompt.text = mutatedText
        }
      }),
    )
  }

  if (hooks["experimental.chat.system.transform"] || hooks["chat.params"]) {
    registrations.push(
      await ctx.session.hook("context", async (event: V2SessionContextHook) => {
        if (hooks["experimental.chat.system.transform"]) {
          const systemStrings = event.system.map((part) =>
            typeof part.text === "string" ? part.text : JSON.stringify(part),
          )
          try {
            await hooks["experimental.chat.system.transform"]!(
              {
                sessionID: event.sessionID,
                model: {
                  id: event.model.id,
                  providerID: event.model.providerID,
                  variant: event.model.variant,
                },
              },
              { system: systemStrings },
            )
          } catch (error) {
            log("[v2-session-bridge] system.transform bridge failed", {
              sessionID: event.sessionID,
              error: error instanceof Error ? error.message : String(error),
            })
          }
          event.system.splice(0, event.system.length, ...systemStrings.map((text) => ({ type: "text", text })))
        }
        if (hooks["chat.params"]) {
          const output = {
            temperature: undefined as number | undefined,
            topP: undefined as number | undefined,
            topK: undefined as number | undefined,
            maxOutputTokens: undefined as number | undefined,
            options: {} as Record<string, unknown>,
          }
          try {
            await hooks["chat.params"]!(
              {
                sessionID: event.sessionID,
                agent: { name: event.agent },
                model: { providerID: event.model.providerID, modelID: event.model.id },
                provider: { id: event.model.providerID },
                message: {},
              },
              output,
            )
          } catch (error) {
            log("[v2-session-bridge] chat.params bridge failed", {
              sessionID: event.sessionID,
              error: error instanceof Error ? error.message : String(error),
            })
          }
          if (output.temperature !== undefined) event.generation.temperature = output.temperature
          if (output.topP !== undefined) event.generation.topP = output.topP
          if (output.topK !== undefined) event.generation.topK = output.topK
          if (output.maxOutputTokens !== undefined) event.generation.maxTokens = output.maxOutputTokens
          for (const [key, value] of Object.entries(output.options)) {
            event.providerOptions[key] = value
          }
        }
      }),
    )
  }

  if (hooks["chat.headers"]) {
    registrations.push(
      await ctx.session.hook("model.request", async (event) => {
        const headers = { ...event.headers }
        try {
          await hooks["chat.headers"]!(
            {
              sessionID: event.sessionID,
              agent: event.agent,
              model: {
                providerID: event.model.providerID,
                modelID: event.model.id,
                variant: event.model.variant,
              },
              provider: { id: event.model.providerID },
              message: {},
            },
            { headers },
          )
        } catch (error) {
          log("[v2-session-bridge] chat.headers bridge failed", {
            sessionID: event.sessionID,
            error: error instanceof Error ? error.message : String(error),
          })
          return
        }
        for (const [key, value] of Object.entries(headers)) {
          event.headers[key] = value
        }
      }),
    )
  }

  return registrations
}
