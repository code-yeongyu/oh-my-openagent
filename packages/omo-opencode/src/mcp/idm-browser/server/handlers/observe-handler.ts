import type { BrowserPool } from "../../pool"
import { observeAXTree } from "../../primitives"

export type ObserveParams = {
  query?: string
  sessionId?: string
  accountId?: string
}

export async function handleObserve(pool: BrowserPool, params: ObserveParams) {
  const session = await pool.acquire(params.sessionId)
  const elements = await observeAXTree(session.page, params.query)

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ sessionId: session.id, elements, count: elements.length }, null, 2),
    }],
  }
}
