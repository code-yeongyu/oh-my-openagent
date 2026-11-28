import type { SenpiExtensionAPI } from "../../extension/types"
import type { ThreadCreationRecord } from "./gateway/store-extension-facade"
import { INITIAL_SKILLS_CONTEXT_KEY } from "./initial-skills"

/**
 * The hosting device's half of the creation record (#15221 row 25). thread_create puts its opener on the
 * `open_session` context (`opened_by`: the opener's thread and device); the new session copies it into a durable entry
 * (`omo-opened-by`) on its first start and records the creation in its own device's store on every start, so a thread
 * knows its opener where it runs, also after a restart re-opens it without the context. The store keeps one row per
 * pair, so recording again changes nothing.
 */
export const OPENED_BY_CONTEXT_KEY = "opened_by"
export const OPENED_BY_ENTRY = "omo-opened-by"

export type OpenedBy = { readonly thread: string; readonly device: string }

/** The `open_session` context a create sends on either leg: its initial skills and its opener, each only when present. */
export function openContext(
  initialSkills: readonly string[] | undefined,
  openedBy: OpenedBy | undefined,
): { readonly context: Record<string, string> } | Record<string, never> {
  const context: Record<string, string> = {}
  if (initialSkills !== undefined && initialSkills.length > 0)
    context[INITIAL_SKILLS_CONTEXT_KEY] = JSON.stringify(initialSkills)
  if (openedBy !== undefined)
    context[OPENED_BY_CONTEXT_KEY] = JSON.stringify({ thread: openedBy.thread, device: openedBy.device })
  return Object.keys(context).length === 0 ? {} : { context }
}

export type OpenedByDeps = {
  readonly store: () => { readonly recordThreadCreation: (record: ThreadCreationRecord) => Promise<void> }
  /** This device's id; absent when the device has none (no account), and the row then names no hosting device. */
  readonly thisDevice: () => Promise<string | undefined>
  readonly log?: (line: string) => void
}

function openedByFrom(value: unknown): OpenedBy | undefined {
  let parsed = value
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value)
    } catch {
      return undefined
    }
  }
  if (typeof parsed !== "object" || parsed === null) return undefined
  const { thread, device } = parsed as { readonly thread?: unknown; readonly device?: unknown }
  return typeof thread === "string" && thread.length > 0 && typeof device === "string" && device.length > 0
    ? { thread, device }
    : undefined
}

type SessionView = {
  readonly sessionManager?: { readonly getEntries?: () => readonly unknown[]; readonly getSessionId?: () => string }
}

function persisted(eventCtx: SessionView | undefined): OpenedBy | undefined {
  const entries = eventCtx?.sessionManager?.getEntries?.() ?? []
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as { readonly type?: unknown; readonly customType?: unknown; readonly data?: unknown }
    if (entry?.type === "custom" && entry.customType === OPENED_BY_ENTRY) return openedByFrom(entry.data)
  }
  return undefined
}

export function registerOpenedBy(pi: SenpiExtensionAPI, deps: OpenedByDeps): void {
  pi.on("session_start", async (_event, eventCtx) => {
    const view = eventCtx as SessionView | undefined
    const own = view?.sessionManager?.getSessionId?.()
    const kept = persisted(view)
    const opener =
      kept ??
      openedByFrom((pi.sessionContext as Readonly<Record<string, unknown>> | undefined)?.[OPENED_BY_CONTEXT_KEY])
    if (own === undefined || opener === undefined || opener.thread === own) return
    if (kept === undefined) pi.appendEntry?.(OPENED_BY_ENTRY, opener)
    try {
      const hostingDevice = await deps.thisDevice()
      await deps.store().recordThreadCreation({
        creator_durable_id: opener.thread,
        created_durable_id: own,
        creator_device: opener.device,
        ...(hostingDevice === undefined ? {} : { created_device: hostingDevice }),
      })
    } catch (error) {
      deps.log?.(
        `thread: the opener of this session (${opener.thread}) was not recorded on this device: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })
}
