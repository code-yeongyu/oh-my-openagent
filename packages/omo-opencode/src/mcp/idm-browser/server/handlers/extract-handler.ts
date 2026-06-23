import type { BrowserPool } from "../../pool"
import { extract } from "../../primitives"

export type ExtractParams = {
  selector?: string
  attribute?: string
  format?: "text" | "html" | "json"
  sessionId?: string
  accountId?: string
}

export async function handleExtract(pool: BrowserPool, params: ExtractParams) {
  const session = await pool.acquire(params.sessionId)
  const result = await extract(session.page, {
    selector: params.selector,
    attribute: params.attribute,
    format: params.format,
  })

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ sessionId: session.id, ...result }, null, 2),
    }],
  }
}
