import type { Caller, FakeSlackState } from "./fake-state"

export type Reply = Record<string, unknown>
export type MethodContext = {
  state: FakeSlackState
  caller: Caller
  params: URLSearchParams
  origin: string
  metadataFromUsers: boolean
  broadcast(event: Record<string, unknown>): void
  counters: {
    rtmConnects: number
    socketOpens: number
    statuses: { channel: string; thread_ts: string; status: string }[]
    /** how many more files.info answers leave out a completed share (Slack shares asynchronously) */
    hiddenShares: number
  }
}

export const fail = (error: string): Reply => ({ ok: false, error })
export const p = (ctx: MethodContext, name: string): string => ctx.params.get(name) ?? ""

export function parseBlocks(raw: string): unknown[] | null | "invalid" {
  if (raw === "") return null
  try {
    const blocks: unknown = JSON.parse(raw)
    return Array.isArray(blocks) ? blocks : "invalid"
  } catch {
    return "invalid"
  }
}
