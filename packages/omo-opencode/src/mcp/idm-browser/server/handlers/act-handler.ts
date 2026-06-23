import type { BrowserPool } from "../../pool"
import type { ActionCache } from "../../primitives"
import { act } from "../../primitives"

export type ActParams = {
  instruction: string
  timeout_ms?: number
  no_cache?: boolean
  sessionId?: string
  accountId?: string
}

export async function handleAct(pool: BrowserPool, cache: ActionCache | null, params: ActParams) {
  const session = await pool.acquire(params.sessionId)
  const result = await act(session.page, params.instruction, cache, {
    timeoutMs: params.timeout_ms,
    noCache: params.no_cache,
  })

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ sessionId: session.id, ...result }, null, 2),
    }],
    isError: !result.success,
  }
}
