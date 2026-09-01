import type { CapturedConversation, DreamOrigin } from "@oh-my-opencode/memory-core"

import { computeUnreflectedVolumeFast, loadConversations as defaultLoadConversations, selectLoadedConversations, type LoadedConversation } from "./dream-selector"
import { evaluateDreamGates, readLastDreamAtMs, type DreamTriggerSettings } from "./dream-trigger-gates"
import type { DreamFireOutcome, DreamTriggerSession, ManualDreamRequest } from "./dream-trigger"

export async function fireDream(input: {
  readonly session: DreamTriggerSession
  readonly origin: DreamOrigin
  readonly settings: DreamTriggerSettings
  readonly request: ManualDreamRequest & {
    readonly signal?: AbortSignal
    readonly deadlineAt?: number
  }
  readonly now: () => number
  readonly warnLaunchFailure: (error: unknown) => void
  readonly loadConversations?: (transcriptsDir: string) => Promise<readonly LoadedConversation[]>
}): Promise<DreamFireOutcome> {
  const { session, origin, settings, request, now } = input
  const shouldLoadConversations = origin !== "pressure" && request.conversationIds === undefined
  const loadConversations = input.loadConversations ?? ((transcriptsDir: string) =>
    defaultLoadConversations(transcriptsDir, Math.max(settings.autoSelectMax * 4, 8)))
  let loadedConversations: readonly LoadedConversation[] | undefined
  const getLoadedConversations = async (): Promise<readonly LoadedConversation[]> => {
    loadedConversations ??= await loadConversations(session.identityPaths.transcripts)
    return loadedConversations
  }
  const stopped = () =>
    isAborted(request.signal)
    || (request.deadlineAt !== undefined && now() >= request.deadlineAt)
  const decision = await evaluateDreamGates(origin, settings, {
    nowMs: now(),
    lastDreamAtMs: () => readLastDreamAtMs(session.identityPaths.runtime),
    unreflectedBytes: async () => {
      if (!shouldLoadConversations) return 0
      return computeUnreflectedVolumeFast({
        transcriptsDir: session.identityPaths.transcripts,
        currentConversationId: session.conversationId,
        autoSelectMax: settings.autoSelectMax,
        autoSelectMaxBytes: settings.autoSelectMaxChars,
        now: () => new Date(now()),
      })
    },
  })
  if (!decision.allowed) return { fired: false, rejection: decision.rejection }
  if (stopped()) return { fired: false, rejection: "aborted" }
  const selected = origin === "pressure"
    ? []
    : request.conversationIds === undefined
      ? selectLoadedConversations(await getLoadedConversations(), {
          transcriptsDir: session.identityPaths.transcripts,
          currentConversationId: session.conversationId,
          autoSelectMax: settings.autoSelectMax,
          autoSelectMaxBytes: settings.autoSelectMaxChars,
          now: () => new Date(now()),
        }, { ...(request.focus === undefined ? {} : { focus: request.focus }) }).conversationIds
      : request.conversationIds
  if (stopped()) return { fired: false, rejection: "aborted" }
  const conversationIds: string[] = []
  const snapshots: CapturedConversation[] = []
  for (const conversationId of selected) {
    if (stopped()) return { fired: false, rejection: "aborted" }
    let snapshot
    try {
      snapshot = await (await session.getJournal(conversationId)).captureReflectionSnapshot(request.signal)
    } catch (error) {
      if (stopped()) return { fired: false, rejection: "aborted" }
      throw error
    }
    if (stopped()) return { fired: false, rejection: "aborted" }
    if (snapshot === null) continue
    conversationIds.push(conversationId)
    snapshots.push({ conversationId, snapshot })
  }
  if (origin !== "pressure" && conversationIds.length === 0) return { fired: false, rejection: "no_unreflected_content" }
  if (stopped()) return { fired: false, rejection: "aborted" }
  let result
  try {
    result = await session.store.tryReserve({
      trigger: "dream",
      origin,
      conversationIds,
      snapshots,
      ...(request.focus === undefined ? {} : { focus: request.focus }),
      ...(request.targetDoc === undefined ? {} : { targetDoc: request.targetDoc }),
    }, request.signal)
  } catch (error) {
    if (stopped()) return { fired: false, rejection: "aborted" }
    throw error
  }
  if (stopped()) return { fired: false, rejection: "aborted" }
  if (result.status === "active") {
    if (stopped()) return { fired: false, rejection: "aborted" }
    try {
      session.launch(result.run)
    } catch (error: unknown) {
      input.warnLaunchFailure(error)
    }
  }
  return { fired: true, runId: result.run.runId, status: result.status }
}

/** Live read of the drain signal: AbortSignal.aborted mutates externally, so it is never narrowed. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}
