import type { BrowserPool } from "../../pool"

export type ListSessionsParams = {
  accountId?: string
}

export async function handleListSessions(pool: BrowserPool, _params: ListSessionsParams) {
  const sessions = await pool.listSessions()

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        count: sessions.length,
        sessions,
      }, null, 2),
    }],
  }
}
