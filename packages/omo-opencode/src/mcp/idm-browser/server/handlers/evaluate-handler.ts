import type { BrowserPool } from "../../pool"

export type EvaluateParams = {
  expression: string
  arg?: unknown
  sessionId?: string
  accountId?: string
}

export async function handleEvaluate(pool: BrowserPool, params: EvaluateParams) {
  const session = await pool.acquire(params.sessionId)

  try {
    const result = await session.page.evaluate(params.expression)

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          sessionId: session.id,
          result,
          success: true,
        }, null, 2),
      }],
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          sessionId: session.id,
          success: false,
          error: message,
        }, null, 2),
      }],
      isError: true,
    }
  }
}
