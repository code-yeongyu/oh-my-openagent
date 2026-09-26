import type { Plugin } from "@opencode/plugin"
import { isRecord } from "@oh-my-opencode/utils"
import { log } from "../shared/logger"
import type { V2Event, V2EventBus } from "./event-bus"

// Structural subset of the V1 Hooks surface consumed by this bridge.
// Method syntax is deliberate: bivariant params keep real V1 handlers
// assignable here without touching the V1 hook system.
export interface V1BridgeHooks {
  "tool.execute.before"?(
    input: { tool: string; sessionID: string; callID: string },
    output: { args: Record<string, unknown> },
  ): Promise<void> | void
  "tool.execute.after"?(
    input: { tool: string; sessionID: string; callID: string; args?: unknown },
    output: { title: string; output: string; metadata: Record<string, unknown> },
  ): Promise<void> | void
  event?(input: { event: { type: string; properties: unknown } }): Promise<void> | void
  "chat.message"?(
    input: { sessionID: string; messageID?: string },
    output: {
      message: Record<string, unknown>
      parts: Array<{ type: string; text?: string; [key: string]: unknown }>
    },
  ): Promise<void> | void
  "experimental.chat.messages.transform"?(
    input: Record<string, never>,
    output: {
      messages: Array<{
        info: { role: string; sessionID: string; [key: string]: unknown }
        parts: Array<{ type: string; text?: string; [key: string]: unknown }>
      }>
    },
  ): Promise<void> | void
  "experimental.chat.system.transform"?(
    input: { sessionID?: string; model: { id: string; providerID: string } },
    output: { system: string[] },
  ): Promise<void> | void
  "experimental.session.compacting"?(
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ): Promise<void> | void
  // Presence-checked only: model-switching has no V2 equivalent (see registerChatParamsBridge).
  "chat.params"?(input: unknown, output: unknown): Promise<void> | void
}

export type V2HookBridgeContext = Pick<Plugin.Context, "session" | "tool">

export interface HookRegistration {
  dispose(): Promise<void>
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function textOfPart(part: unknown): string | undefined {
  if (!isRecord(part)) return undefined
  return part["type"] === "text" && typeof part["text"] === "string" ? part["text"] : undefined
}

function joinPartTexts(parts: readonly unknown[]): string {
  const texts: string[] = []
  for (const part of parts) {
    const text = textOfPart(part)
    if (text !== undefined) texts.push(text)
  }
  return texts.join("\n")
}

// V2 result.content (string | text/file parts) to the V1 output string.
// File parts have no V1 equivalent, so they degrade to JSON.
function resultContentToOutput(content: string | readonly unknown[] | undefined): string {
  if (content === undefined) return ""
  if (typeof content === "string") return content
  const chunks: string[] = []
  for (const part of content) {
    const text = textOfPart(part)
    chunks.push(text ?? JSON.stringify(part))
  }
  return chunks.join("\n")
}

function extractDelta(before: string, after: string): string | undefined {
  if (after === before) return undefined
  if (before.length > 0 && after.startsWith(before)) return after.slice(before.length)
  if (before.length > 0 && after.endsWith(before)) return after.slice(0, after.length - before.length)
  return after
}

function readEventData(event: V2Event): Record<string, unknown> {
  const data = (event as { data?: unknown }).data
  return isRecord(data) ? data : {}
}

function readEventSessionID(data: Record<string, unknown>): string | undefined {
  for (const key of ["sessionID", "id"]) {
    const value = data[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  const info = data["info"]
  if (isRecord(info) && typeof info["id"] === "string") return info["id"]
  return undefined
}

function minimalSessionInfo(data: Record<string, unknown>, sessionID: string): Record<string, unknown> {
  const now = Date.now()
  return {
    id: sessionID,
    projectID: readString(data["projectID"]),
    directory: readString(data["directory"]),
    title: readString(data["title"]),
    version: "",
    time: { created: typeof data["created"] === "number" ? data["created"] : now, updated: now },
  }
}

export async function registerToolHooks(
  tool: Plugin.Context["tool"],
  v1hooks: V1BridgeHooks,
): Promise<HookRegistration[]> {
  const registrations: HookRegistration[] = []
  const before = v1hooks["tool.execute.before"]
  if (before) {
    registrations.push(
      await tool.hook("execute.before", async (input) => {
        try {
          const original = input.input
          const output = { args: (isRecord(original) ? { ...original } : original) as Record<string, unknown> }
          await before({ tool: input.tool, sessionID: input.sessionID, callID: input.id }, output)
          input.input = output.args
          // V1 may rename input.tool (mcp_ strip); V2 tool name is readonly, so it stays local.
        } catch (error) {
          // Blocking V1 guards (throw to abort) degrade to log: a throwing bridge must never break the session.
          log("[omo-v2][hook-bridge] tool.execute.before bridge failed", {
            tool: input.tool,
            sessionID: input.sessionID,
            error: error instanceof Error ? error : String(error),
          })
        }
      }),
    )
  }
  const after = v1hooks["tool.execute.after"]
  if (after) {
    registrations.push(
      await tool.hook("execute.after", async (input) => {
        try {
          // Error status is skipped: V1 after-hooks assume successful output, and feeding
          // error text through truncators/validators would corrupt the error path.
          if (input.status !== "completed") return
          const output = {
            title: "",
            output: resultContentToOutput(input.result.content),
            metadata: isRecord(input.result.metadata) ? { ...input.result.metadata } : {},
          }
          await after(
            { tool: input.tool, sessionID: input.sessionID, callID: input.id, args: input.input },
            output,
          )
          // Result fields are readonly: replace the object to write mutations back.
          input.result = { ...input.result, content: output.output, metadata: { ...output.metadata } }
          // V2 Result has no title field: title mutations are dropped.
        } catch (error) {
          log("[omo-v2][hook-bridge] tool.execute.after bridge failed", {
            tool: input.tool,
            sessionID: input.sessionID,
            error: error instanceof Error ? error : String(error),
          })
        }
      }),
    )
  }
  return registrations
}

export async function registerEventBridge(
  _v2ctx: V2HookBridgeContext,
  bus: V2EventBus,
  v1hooks: V1BridgeHooks,
): Promise<HookRegistration[]> {
  // v2ctx is reserved for future direct subscriptions; fan-out goes through the shared bus (single subscribe loop).
  const onEvent = v1hooks["event"]
  if (!onEvent) return []
  const offs: Array<() => void> = []
  const subscribe = (
    v2type: string,
    translate: (data: Record<string, unknown>) => { type: string; properties: unknown } | undefined,
  ): void => {
    offs.push(
      bus.on(v2type, async (event) => {
        try {
          const translated = translate(readEventData(event))
          if (!translated) return
          await onEvent({ event: translated })
        } catch (error) {
          log("[omo-v2][hook-bridge] event bridge failed", {
            v2type,
            error: error instanceof Error ? error : String(error),
          })
        }
      }),
    )
  }
  subscribe("session.created", (data) => {
    const sessionID = readEventSessionID(data)
    if (!sessionID) return undefined
    return { type: "session.created", properties: { info: minimalSessionInfo(data, sessionID) } }
  })
  subscribe("session.deleted", (data) => {
    const sessionID = readEventSessionID(data)
    if (!sessionID) return undefined
    return { type: "session.deleted", properties: { info: minimalSessionInfo(data, sessionID) } }
  })
  subscribe("session.idle", (data) => {
    const sessionID = readEventSessionID(data)
    if (!sessionID) return undefined
    return { type: "session.idle", properties: { sessionID } }
  })
  // V1 event.ts handles session.status (normalizeSessionStatusToIdle synthesizes idle from it).
  subscribe("session.status", (data) => {
    const sessionID = readEventSessionID(data)
    const status = isRecord(data["status"]) ? data["status"] : undefined
    if (!sessionID || !status) return undefined
    if (status["type"] === "idle") return { type: "session.status", properties: { sessionID, status: { type: "idle" } } }
    if (status["type"] === "busy") return { type: "session.status", properties: { sessionID, status: { type: "busy" } } }
    if (status["type"] === "retry") {
      return {
        type: "session.status",
        properties: {
          sessionID,
          status: {
            type: "retry",
            attempt: typeof status["attempt"] === "number" ? status["attempt"] : 0,
            message: readString(status["message"]),
            next: typeof status["next"] === "number" ? status["next"] : 0,
          },
        },
      }
    }
    return undefined
  })
  subscribe("session.execution.failed", (data) => {
    const sessionID = readEventSessionID(data)
    if (!sessionID) return undefined
    return {
      type: "session.error",
      properties: data["error"] === undefined ? { sessionID } : { sessionID, error: data["error"] },
    }
  })
  // V1 consumers match permission.ask/asked/updated/requested; forward under the V2 name.
  subscribe("permission.asked", (data) => {
    const sessionID = readEventSessionID(data)
    if (!sessionID) return undefined
    return { type: "permission.asked", properties: { sessionID, ...data } }
  })
  // session.tool.called/success/failed stay with the tool hooks; there is no V1 session.status-less equivalent to feed.
  return offs.map((off) => ({
    dispose: async () => {
      off()
    },
  }))
}

export async function registerPromptHook(
  session: Plugin.Context["session"],
  v1hooks: V1BridgeHooks,
): Promise<HookRegistration[]> {
  const chatMessage = v1hooks["chat.message"]
  if (!chatMessage) return []
  const registration = await session.hook("prompt", async (input) => {
    try {
      const original = input.prompt.text
      const parts = [
        {
          type: "text",
          text: original,
          id: input.messageID,
          sessionID: input.sessionID,
          messageID: input.messageID,
        },
      ]
      const output = { message: { id: input.messageID }, parts }
      await chatMessage({ sessionID: input.sessionID, messageID: input.messageID }, output)
      // V1 chat.message handlers append to the text part: port exactly that diff.
      const firstText = output.parts.find((part) => part.type === "text" && typeof part.text === "string")
      if (firstText?.text !== undefined && firstText.text !== original) input.prompt.text = firstText.text
      // Pushed parts (e.g. synthetic markers) have no V2 prompt sink and are dropped.
      if (output.parts.length > parts.length) {
        log("[omo-v2][hook-bridge] prompt bridge dropped pushed parts (no V2 sink)", {
          sessionID: input.sessionID,
          dropped: output.parts.length - parts.length,
        })
      }
    } catch (error) {
      log("[omo-v2][hook-bridge] prompt bridge failed", {
        sessionID: input.sessionID,
        error: error instanceof Error ? error : String(error),
      })
    }
  })
  return [registration]
}

function appendUserDelta(
  messages: Array<{ role: string; content?: unknown }>,
  index: number,
  delta: string,
  sessionID: string,
): void {
  const target = messages[index] as { content?: unknown } | undefined
  if (target && Array.isArray(target.content)) {
    target.content.push({ type: "text", text: delta })
    return
  }
  log("[omo-v2][hook-bridge] context delta dropped (target content not appendable)", { sessionID, index })
}

export async function registerContextHooks(
  session: Plugin.Context["session"],
  v1hooks: V1BridgeHooks,
): Promise<HookRegistration[]> {
  const registrations: HookRegistration[] = []
  const messagesTransform = v1hooks["experimental.chat.messages.transform"]
  if (messagesTransform) {
    registrations.push(
      await session.hook("context", async (input) => {
        try {
          const views = input.messages.map((message) => ({
            info: {
              role: message.role === "assistant" ? "assistant" : "user",
              sessionID: input.sessionID,
            },
            parts: [{ type: "text", text: joinPartTexts(message.content) }],
          }))
          const before = views.map((view) => joinPartTexts(view.parts))
          const output = { messages: views }
          await messagesTransform({}, output)
          const after = output.messages.map((view) => joinPartTexts(view.parts))
          let lastUserIndex = -1
          for (let index = 0; index < input.messages.length; index++) {
            if (input.messages[index]?.role === "user") lastUserIndex = index
          }
          const shared = Math.min(before.length, after.length)
          for (let index = 0; index < shared; index++) {
            const delta = extractDelta(before[index] ?? "", after[index] ?? "")
            if (!delta) continue
            const role = input.messages[index]?.role
            if (role === "system") {
              input.system.push({ type: "text", text: delta })
            } else if (index === lastUserIndex) {
              appendUserDelta(
                input.messages as Array<{ role: string; content?: unknown }>,
                index,
                delta,
                input.sessionID,
              )
            } else {
              // Assistant/tool-content edits (e.g. pair validation removals) are not expressible here.
              log("[omo-v2][hook-bridge] context delta dropped (no V2 sink for role)", {
                sessionID: input.sessionID,
                role,
                index,
              })
            }
          }
          // Appended V1 turns (injected reminders) sink into the system prompt.
          for (let index = shared; index < after.length; index++) {
            const text = after[index] ?? ""
            if (!text) continue
            input.system.push({ type: "text", text })
            log("[omo-v2][hook-bridge] appended V1 turn sunk into V2 system", {
              sessionID: input.sessionID,
              index,
            })
          }
        } catch (error) {
          log("[omo-v2][hook-bridge] context bridge failed", {
            sessionID: input.sessionID,
            error: error instanceof Error ? error : String(error),
          })
        }
      }),
    )
  }
  const systemTransform = v1hooks["experimental.chat.system.transform"]
  if (systemTransform) {
    registrations.push(
      await session.hook("context", async (input) => {
        try {
          const seed = input.system.map((part) => textOfPart(part)).filter((text) => text !== undefined)
          const seen = new Set(seed)
          const output = { system: [...seed] }
          const model: Record<string, unknown> = isRecord(input.model) ? input.model : {}
          await systemTransform(
            {
              sessionID: input.sessionID,
              model: {
                id: readString(model["id"]),
                providerID: readString(model["providerID"]),
              },
            },
            output,
          )
          // Only appended entries port back; in-place rewrites of seeded entries have no sink.
          for (const entry of output.system) {
            if (typeof entry === "string" && entry.length > 0 && !seen.has(entry)) {
              seen.add(entry)
              input.system.push({ type: "text", text: entry })
            }
          }
        } catch (error) {
          log("[omo-v2][hook-bridge] system transform bridge failed", {
            sessionID: input.sessionID,
            error: error instanceof Error ? error : String(error),
          })
        }
      }),
    )
  }
  return registrations
}

export async function registerCompactionHook(
  session: Plugin.Context["session"],
  v1hooks: V1BridgeHooks,
): Promise<HookRegistration[]> {
  const compacting = v1hooks["experimental.session.compacting"]
  if (!compacting) return []
  const registration = await session.hook("compaction", async (input) => {
    try {
      const output: { context: string[]; prompt?: string } = { context: [] }
      await compacting({ sessionID: input.sessionID }, output)
      // Only a full prompt replacement maps onto result.summary (skip-model path).
      // Bare context augmentation has no V2 sink: setting summary from fragments
      // would discard the real compaction, so it is logged and skipped.
      if (output.prompt) {
        const summary = [output.prompt, ...output.context].filter((part) => part.length > 0).join("\n\n")
        if (summary.length > 0) input.result = { summary }
      } else if (output.context.length > 0) {
        log("[omo-v2][hook-bridge] compaction context augmentation dropped (no V2 sink)", {
          sessionID: input.sessionID,
          entries: output.context.length,
        })
      }
    } catch (error) {
      log("[omo-v2][hook-bridge] compaction bridge failed", {
        sessionID: input.sessionID,
        error: error instanceof Error ? error : String(error),
      })
    }
  })
  return [registration]
}

// Documented no-op (plan, hook-bridge section): V1 chat.params handlers switch models,
// but model is readonly in the V2 context hook. Only generation options are mutable there,
// and replaying model switches as option tweaks would be wrong, so skipping beats mis-porting.
export function registerChatParamsBridge(v1hooks: V1BridgeHooks): void {
  if (v1hooks["chat.params"]) {
    log("[omo-v2][hook-bridge] chat.params skipped (model readonly in V2 context hook; no faithful sink)")
  }
}

// Deferred to the setup-v2 layer: commands register under the same names (guards move
// into execute), and tool.definition is handled during tool-bridge registration.
export function listDeferredBridges(): string[] {
  return ["command.execute.before", "tool.definition"]
}

export interface HookBridgeRegistrations {
  deferred: string[]
  disposeAll(): Promise<void>
}

export async function registerHookBridge(
  v2ctx: V2HookBridgeContext,
  bus: V2EventBus,
  v1hooks: V1BridgeHooks,
): Promise<HookBridgeRegistrations> {
  const registrations: HookRegistration[] = []
  const collect = async (step: string, run: () => Promise<HookRegistration[]>): Promise<void> => {
    try {
      registrations.push(...(await run()))
    } catch (error) {
      log("[omo-v2][hook-bridge] registration failed", {
        step,
        error: error instanceof Error ? error : String(error),
      })
    }
  }
  await collect("tool", () => registerToolHooks(v2ctx.tool, v1hooks))
  await collect("event", () => registerEventBridge(v2ctx, bus, v1hooks))
  await collect("prompt", () => registerPromptHook(v2ctx.session, v1hooks))
  await collect("context", () => registerContextHooks(v2ctx.session, v1hooks))
  await collect("compaction", () => registerCompactionHook(v2ctx.session, v1hooks))
  registerChatParamsBridge(v1hooks)
  return {
    deferred: listDeferredBridges(),
    disposeAll: async () => {
      for (const registration of registrations) {
        try {
          await registration.dispose()
        } catch (error) {
          log("[omo-v2][hook-bridge] dispose failed", {
            error: error instanceof Error ? error : String(error),
          })
        }
      }
    },
  }
}
