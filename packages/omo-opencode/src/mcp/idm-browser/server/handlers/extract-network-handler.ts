import type { BrowserPool } from "../../pool"

export type ExtractNetworkParams = {
  filter?: "all" | "xhr" | "fetch" | "document"
  clear?: boolean
  include_bodies?: boolean
  sessionId?: string
  accountId?: string
}

export async function handleExtractNetwork(pool: BrowserPool, params: ExtractNetworkParams) {
  const session = await pool.acquire(params.sessionId)
  const filter = params.filter ?? "all"
  session.tap.setBodyCapture(params.include_bodies ?? false)

  let requests
  if (filter === "all") {
    requests = session.tap.getAll()
  } else if (filter === "xhr" || filter === "fetch") {
    requests = session.tap.getByType(filter)
  } else {
    requests = session.tap.getByType("document")
  }

  if (params.clear) {
    session.tap.clear()
  }

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ sessionId: session.id, requests, count: requests.length }, null, 2),
    }],
  }
}
