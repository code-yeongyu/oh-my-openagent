import type { V2ModelRef, V2PermissionRule, V2PluginContext } from "../context-types"
import { normalizeAction } from "../config-bridge"
import type { SessionTracker } from "../session-tracker"
import { createPromptAsync } from "./prompt-async"
import { toV1Session } from "./to-v1-session"
import { translateMessages } from "./translate-messages"
import type { V1Message } from "./v1-message-types"
import { settle, v1Error, type V1Result } from "./v1-result"

type SessionRef = { readonly path: { readonly id: string } }

type CreateBody = {
  readonly parentID?: string
  readonly title?: string
  readonly model?: { readonly providerID: string; readonly modelID?: string; readonly id?: string; readonly variant?: string }
  readonly permission?: ReadonlyArray<{ readonly permission: string; readonly action: V2PermissionRule["effect"]; readonly pattern: string }>
}

export type SessionNamespaceDeps = {
  readonly tracker: SessionTracker
  readonly warn: (message: string) => void
}

function toV2Model(model: NonNullable<CreateBody["model"]>): V2ModelRef | undefined {
  const id = model.id ?? model.modelID
  if (id === undefined) return undefined
  return { providerID: model.providerID, id, ...(model.variant ? { variant: model.variant } : {}) }
}

/**
 * `client.session.*` in the 1.x shape, on the 2.x session domain. Reads come from `session.context`
 * translated by `translateMessages`; busy state comes from the event-fed tracker. Calls with no
 * 2.x counterpart (list, children, fork, revert, ...) are not defined here and fail loudly.
 */
export function createSessionNamespace(context: V2PluginContext, deps: SessionNamespaceDeps) {
  const reported = new Set<string>()
  const report = (key: string, message: string) => {
    if (reported.has(key)) return
    reported.add(key)
    deps.warn(message)
  }
  const worktree = context.location.project.canonical

  const loadMessages = async (sessionID: string): Promise<V1Message[]> => {
    const [info, log] = await Promise.all([context.session.get({ sessionID }), context.session.context({ sessionID })])
    return translateMessages({
      messages: log,
      sessionID,
      directory: info.location.directory,
      worktree,
      initial: { agent: info.agent ?? "", ...(info.model === undefined ? {} : { model: info.model }) },
    })
  }

  return {
    messages: (args: SessionRef & { readonly query?: { readonly limit?: number } }) =>
      settle(async () => {
        const all = await loadMessages(args.path.id)
        const limit = args.query?.limit
        return typeof limit === "number" && limit > 0 ? all.slice(-limit) : all
      }),

    message: async (args: { readonly path: { readonly id: string; readonly messageID: string } }): Promise<V1Result<V1Message>> => {
      const loaded = await settle(() => loadMessages(args.path.id))
      if (loaded.error !== undefined) return loaded
      const found = loaded.data.find((message) => message.info.id === args.path.messageID)
      return found === undefined ? v1Error("NotFoundError", `Message not found: ${args.path.messageID}`) : { data: found }
    },

    get: (args: SessionRef) => settle(async () => toV1Session(await context.session.get({ sessionID: args.path.id }))),

    create: (args: { readonly body?: CreateBody; readonly query?: { readonly directory?: string } } = {}) =>
      settle(async () => {
        const body = args.body ?? {}
        const model = body.model === undefined ? undefined : toV2Model(body.model)
        const directory = args.query?.directory
        const info = await context.session.create({
          parentID: body.parentID ?? null,
          title: body.title ?? null,
          ...(model === undefined ? {} : { model }),
          ...(directory === undefined || directory === context.location.directory ? {} : { location: { directory } }),
          ...(body.permission === undefined
            ? {}
            : { permissions: body.permission.map((rule) => ({ action: normalizeAction(rule.permission), resource: rule.pattern, effect: rule.action })) }),
        })
        return toV1Session(info)
      }),

    delete: (args: SessionRef) => settle(async () => (await context.session.remove({ sessionID: args.path.id }), true)),
    abort: (args: SessionRef) => settle(async () => (await context.session.interrupt({ sessionID: args.path.id }), true)),
    summarize: (args: SessionRef & { readonly body?: unknown }) => settle(async () => (await context.session.compact({ sessionID: args.path.id }), true)),

    promptAsync: createPromptAsync(context, report),

    status: async () => ({ data: deps.tracker.statuses() }),

    todo: async (_args: SessionRef) => {
      report("todo", "session.todo: OpenCode 2.x has no todo store yet; returning an empty list")
      return { data: [] as Array<Record<string, unknown>> }
    },
  }
}
