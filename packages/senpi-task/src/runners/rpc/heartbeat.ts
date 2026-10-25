import { RpcRequestTimeout } from "./errors"

export const HEARTBEAT_DEADLINE_MS = 10_000

export function unresponsiveMessage(taskId: string): string {
  return `ended: the child stopped answering for 30 s (3 heartbeats). Action: inspect task_output ${taskId}; run it again with task`
}

/** One probe at a time; only an answer resets consecutive misses, never content or a late reply. */
export function startHeartbeat<T>(input: {
  readonly intervalMs: number
  paused(): boolean
  probe(): Promise<T>
  onState(state: T): void
  onFailure(error: unknown): void
  onUnresponsive(): void
}): () => void {
  let pending = false
  let stopped = false
  let failures = 0
  let deadline: ReturnType<typeof setTimeout> | undefined
  const tick = (): void => {
    if (stopped || pending || input.paused()) return
    pending = true
    const startedAt = Date.now()
    let missed = false
    const fail = (error: unknown): void => {
      if (stopped || input.paused()) return
      input.onFailure(error)
      failures++
      if (failures === 3) {
        stopped = true
        clearInterval(interval)
        clearTimeout(deadline)
        input.onUnresponsive()
      }
    }
    const miss = (): void => {
      if (stopped || input.paused()) return
      missed = true
      fail(new RpcRequestTimeout("get_state", HEARTBEAT_DEADLINE_MS))
      // The daemon client's request has its own deadline. Keep that request single-flight
      // while counting missed ten-second probes, rather than adding requests behind it.
      if (!stopped) deadline = setTimeout(miss, HEARTBEAT_DEADLINE_MS)
    }
    deadline = setTimeout(miss, HEARTBEAT_DEADLINE_MS)
    // A detached port can throw synchronously; Promise adoption keeps the same failure path.
    const work = Promise.resolve().then(input.probe)
    void work.then((state) => {
      if (stopped || input.paused()) return
      failures = 0
      input.onState(state)
    }, (error: unknown) => {
      if (stopped || input.paused()) return
      // A request rejection after a missed probe must not count the same silence twice.
      if (!missed) fail(error)
    }).finally(() => {
      clearTimeout(deadline)
      deadline = undefined
      pending = false
      // Do not lose the tick coinciding with a timeout. Fast refusals still wait for the next interval.
      if (!stopped && failures > 0 && Date.now() - startedAt >= input.intervalMs) tick()
    })
  }
  const interval = setInterval(tick, input.intervalMs)
  interval.unref?.()
  return () => {
    stopped = true
    clearInterval(interval)
    clearTimeout(deadline)
  }
}
