import { log } from "../../../shared/logger"
import type { ProbeProvider } from "../providers/provider-types"

const DELETE_PATH = "/api/v0/chat_session/delete"
const DELETE_TIMEOUT_MS = 5_000

export type SessionDeleteResult = {
  ok: boolean
  status?: number
  reason?: string
}

export type SessionDeleteInput = {
  provider: ProbeProvider
  baseUrl: string
  chatSessionId: string
  requestId: string
  onComplete?: (result: SessionDeleteResult) => void
  scheduler?: (fn: () => void) => void
}

export type DrainResult = {
  drained: number
  pending_at_drain: number
  timed_out: boolean
}

const inflight = new Set<Promise<void>>()

function defaultScheduler(fn: () => void): void {
  queueMicrotask(fn)
}

export function enqueueSessionDelete(input: SessionDeleteInput): void {
  const sched = input.scheduler ?? defaultScheduler
  const completion = new Promise<void>((resolve) => {
    sched(() => {
      void fireDelete(input).finally(resolve)
    })
  })
  inflight.add(completion)
  void completion.finally(() => inflight.delete(completion))
}

export async function drainSessionDeletes(
  timeoutMs = 5_000,
): Promise<DrainResult> {
  const initial = inflight.size
  if (initial === 0) {
    return { drained: 0, pending_at_drain: 0, timed_out: false }
  }
  const all = Promise.allSettled([...inflight])
  let timedOut = false
  await Promise.race([
    all,
    new Promise<void>((resolve) => {
      setTimeout(() => {
        timedOut = true
        resolve()
      }, timeoutMs)
    }),
  ])
  return {
    drained: initial - inflight.size,
    pending_at_drain: initial,
    timed_out: timedOut,
  }
}

export function getInflightSessionDeleteCountForTests(): number {
  return inflight.size
}

export function resetSessionDeleteInflightForTests(): void {
  inflight.clear()
}

async function fireDelete(input: SessionDeleteInput): Promise<void> {
  const url = `${input.baseUrl.replace(/\/$/, "")}${DELETE_PATH}`
  try {
    const res = await input.provider.dispatchProbe({
      url,
      method: "POST",
      headers: {},
      body: JSON.stringify({ chat_session_id: input.chatSessionId }),
      timeout_ms: DELETE_TIMEOUT_MS,
      forward_as_is: false,
      metadata: {
        session_id: `oai-cleanup-${input.requestId}`,
        exchange_sequence: 99,
      },
    })
    if (res.status >= 200 && res.status < 300) {
      log(
        `openai-compat-cleanup: chat_session/delete ok [rid=${input.requestId}] status=${res.status}`,
      )
      input.onComplete?.({ ok: true, status: res.status })
      return
    }
    log(
      `openai-compat-cleanup: chat_session/delete non-2xx [rid=${input.requestId}] status=${res.status}`,
    )
    input.onComplete?.({
      ok: false,
      status: res.status,
      reason: `HTTP ${res.status}`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log(
      `openai-compat-cleanup: chat_session/delete threw [rid=${input.requestId}] err=${msg}`,
    )
    input.onComplete?.({ ok: false, reason: msg })
  }
}
