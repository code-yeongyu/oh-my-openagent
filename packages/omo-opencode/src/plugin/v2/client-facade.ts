import type { V2PluginContext } from "./types"

/**
 * Facade: V1 `@opencode-ai/sdk` client shape over the OpenCode V2 session API.
 *
 * OMO internals are written against the V1 SDK (path-style inputs,
 * `{ data }` response envelopes). The V2 client uses flat inputs and returns
 * values directly. This module translates in both directions so the ~100
 * internal `ctx.client.*` call sites keep working unchanged under V2.
 *
 * Conventions:
 * - V1 inputs: `{ path: { id }, body: {...}, query: {...} }`
 * - V1 outputs: `{ data: ... }` for single results, raw arrays for lists.
 * - Anything V2 does not offer maps to a documented degradation instead of
 *   silently fabricating data: `session.todo` -> empty list, `tui.showToast`
 *   -> no-op, `session.status` -> idle/idle approximation.
 */

type V1PathInput = {
  path: { id: string; messageID?: string }
  body?: Record<string, unknown>
  query?: Record<string, unknown>
}

function toV1Envelope<T>(data: T): { data: T } {
  return { data }
}

function sessionIDOf(input: V1PathInput): string {
  return input.path.id
}

export type V1CompatClient = ReturnType<typeof createV1CompatClient>

export function createV1CompatClient(v2: V2PluginContext) {
  const sessionV2 = v2.session

  const callPrompt = async (input: V1PathInput): Promise<{ data: unknown }> => {
    const body = input.body ?? {}
    const parts = Array.isArray(body["parts"]) ? (body["parts"] as Array<Record<string, unknown>>) : []
    const text =
      typeof body["text"] === "string"
        ? (body["text"] as string)
        : parts
            .filter((part) => part["type"] === "text" && typeof part["text"] === "string")
            .map((part) => part["text"] as string)
            .join("")
    const promptInput: Record<string, unknown> = {
      sessionID: sessionIDOf(input),
      text,
      delivery: "queue",
    }
    if (typeof body["agent"] === "string") promptInput["agent"] = body["agent"]
    const model = body["model"]
    if (
      typeof model === "object" &&
      model !== null &&
      typeof (model as Record<string, unknown>)["providerID"] === "string" &&
      typeof (model as Record<string, unknown>)["modelID"] === "string"
    ) {
      promptInput["model"] = {
        providerID: (model as Record<string, string>)["providerID"],
        id: (model as Record<string, string>)["modelID"],
      }
    }
    const result = await sessionV2.prompt(promptInput as Parameters<typeof sessionV2.prompt>[0])
    return toV1Envelope(result)
  }

  const session = {
    get: async (input: V1PathInput) => {
      const info = await sessionV2.get({ sessionID: sessionIDOf(input) })
      return toV1Envelope(info)
    },
    list: async (_input?: V1PathInput) => {
      const response = await sessionV2.list()
      const data =
        response && typeof response === "object" && Array.isArray((response as { data?: unknown }).data)
          ? (response as { data: unknown[] }).data
          : Array.isArray(response)
            ? response
            : []
      return { data }
    },
    create: async (input?: V1PathInput) => {
      const body = (input?.body ?? {}) as Record<string, unknown>
      const info = await sessionV2.create(
        Object.keys(body).length > 0 ? { ...body } : undefined,
      )
      return toV1Envelope(info)
    },
    delete: async (input: V1PathInput) => {
      await sessionV2.remove({ sessionID: sessionIDOf(input) })
      return { data: undefined }
    },
    /** V2 renamed `messages` -> `context` and changed the message shape. */
    messages: async (input: V1PathInput) => {
      const messages = await sessionV2.context({ sessionID: sessionIDOf(input) })
      const list = Array.isArray(messages)
        ? messages
        : messages && typeof messages === "object" && Array.isArray((messages as { data?: unknown }).data)
          ? (messages as { data: unknown[] }).data
          : []
      return toV1Envelope(list)
    },
    message: async (input: V1PathInput) => {
      const messageID = input.path.messageID
      if (!messageID) return toV1Envelope(undefined)
      const message = await sessionV2.message({
        sessionID: sessionIDOf(input),
        messageID,
      })
      return toV1Envelope(message)
    },
    /**
     * V2 has no todo API at all. Call sites treat "empty todo list" as
     * "nothing to enforce", which is the documented degradation.
     */
    todo: async (_input: V1PathInput) => toV1Envelope({ data: [] }),
    abort: async (input: V1PathInput) => {
      const result = await sessionV2.interrupt({ sessionID: sessionIDOf(input), continue: false })
      return toV1Envelope(result)
    },
    /** V2 `compact` replaces V1 `summarize`. */
    summarize: async (input: V1PathInput) => {
      const result = await sessionV2.compact({ sessionID: sessionIDOf(input) })
      return toV1Envelope(result)
    },
    /** V2 has no per-session status endpoint; sessions are idle between runs. */
    status: async (input: V1PathInput) =>
      toV1Envelope({ id: sessionIDOf(input), status: { type: "idle" } }),
    /** V2 has no children endpoint; background/subagent sessions are flat. */
    children: async (_input: V1PathInput) => toV1Envelope({ data: [] }),
    prompt: callPrompt,
    promptAsync: callPrompt,
  }

  const tui = {
    /** V2 moved toasts to the CLI plugin surface; the server API has none. */
    showToast: async (_input: { body: Record<string, unknown> }) => {
      return { data: undefined }
    },
  }

  const config = {
    get: async (_input?: Record<string, unknown>) => toV1Envelope(undefined),
  }

  const provider = {
    list: async (_input?: Record<string, unknown>) => {
      const response = await v2.catalog.provider.list()
      const data =
        response && typeof response === "object" && Array.isArray((response as { data?: unknown }).data)
          ? (response as { data: unknown[] }).data
          : Array.isArray(response)
            ? response
            : []
      return { data }
    },
  }

  const app = {
    agents: async () => {
      const response = await v2.agent.list()
      const data =
        response && typeof response === "object" && Array.isArray((response as { data?: unknown }).data)
          ? (response as { data: unknown[] }).data
          : Array.isArray(response)
            ? response
            : []
      return { data }
    },
    skills: async () => {
      const response = await v2.skill.list()
      const data =
        response && typeof response === "object" && Array.isArray((response as { data?: unknown }).data)
          ? (response as { data: unknown[] }).data
          : Array.isArray(response)
            ? response
            : []
      return { data }
    },
  }

  const event = {
    subscribe: v2.event.subscribe as unknown as () => AsyncIterable<Record<string, unknown>>,
  }

  return {
    session,
    tui,
    config,
    provider,
    app,
    event,
  }
}
