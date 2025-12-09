import type { AutoCompactState } from "./types"

type Client = {
  session: {
    messages: (opts: { path: { id: string }; query?: { directory?: string } }) => Promise<unknown>
    summarize: (opts: {
      path: { id: string }
      body: { providerID: string; modelID: string }
      query: { directory: string }
    }) => Promise<unknown>
  }
  tui: {
    submitPrompt: (opts: { query: { directory: string } }) => Promise<unknown>
  }
}

export async function getLastAssistant(
  sessionID: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  directory: string
): Promise<Record<string, unknown> | null> {
  try {
    const resp = await (client as Client).session.messages({
      path: { id: sessionID },
      query: { directory },
    })

    const data = (resp as { data?: unknown[] }).data
    if (!Array.isArray(data)) return null

    const reversed = [...data].reverse()
    const last = reversed.find((m) => {
      const msg = m as Record<string, unknown>
      const info = msg.info as Record<string, unknown> | undefined
      return info?.role === "assistant"
    })
    if (!last) return null
    return (last as { info?: Record<string, unknown> }).info ?? null
  } catch {
    return null
  }
}

export async function executeCompact(
  sessionID: string,
  msg: Record<string, unknown>,
  autoCompactState: AutoCompactState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  directory: string
): Promise<void> {
  try {
    const providerID = msg.providerID as string | undefined
    const modelID = msg.modelID as string | undefined

    if (providerID && modelID) {
      await (client as Client).session.summarize({
        path: { id: sessionID },
        body: { providerID, modelID },
        query: { directory },
      })

      setTimeout(async () => {
        try {
          await (client as Client).tui.submitPrompt({ query: { directory } })
        } catch {}
      }, 500)
    }

    autoCompactState.pendingCompact.delete(sessionID)
    autoCompactState.errorDataBySession.delete(sessionID)
  } catch {}
}
