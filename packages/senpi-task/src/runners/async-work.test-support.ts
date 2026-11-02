export const DETACHED_CELL_WAITS = {
  children: 0,
  background: [{ source: "senpi-codemode", activeCount: 1, items: [{ id: "cell-1", label: "eval cell" }] }],
  human: [],
} as const

/** A SessionLifecycle snapshot: `waits` absent means the engine reports nothing pending. */
export function lifecycleSnapshot(waits?: unknown): Record<string, unknown> {
  return {
    state: waits === undefined ? "running" : "waiting_background",
    seq: 1,
    epoch: 1,
    role: "child",
    waitingOn: waits ?? { children: 0, background: [], human: [] },
  }
}

export function lifecycleRecord(waits?: unknown): Record<string, unknown> {
  return { type: "session_lifecycle", sessionId: "child", lifecycle: lifecycleSnapshot(waits) }
}

function assistant(text: string): Record<string, unknown> {
  return { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" }
}

export function cleanTurnEnd(text: string): readonly Record<string, unknown>[] {
  const message = assistant(text)
  return [
    { type: "message_end", message },
    { type: "agent_end", willRetry: false, messages: [message] },
    { type: "agent_idle" },
  ]
}

export function wokenTurn(text: string): readonly Record<string, unknown>[] {
  return [{ type: "agent_start" }, ...cleanTurnEnd(text)]
}

export const PROGRESS_NOTE = "Waiting for the delayed eval completion notification."
export const FINAL_RESULT = "FINAL-RESULT a.txt read"
