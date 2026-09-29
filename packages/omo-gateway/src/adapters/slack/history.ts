// The catch-up backstop: conversations.history of every listened chat since the cursor,
// search.messages for mentions of the gateway account (user tokens; bot tokens cannot search), and
// conversations.replies of every bound or own thread. conversations.replies always returns the thread
// root whatever `oldest` says, so replies are filtered to ts > oldest or every pass would replay roots.
import { SlackApiError, SlackAuthError, type SlackApi } from "./api"
import { isJson, isTs, parseMessage, tsAfter, type Json, type SlackMessage } from "./wire"

const PAGE = 200
const MAX_PAGES = 25
const SEARCH_COUNT = 50
const SKIPPED = new Set(["not_in_channel", "channel_not_found", "thread_not_found", "missing_scope", "not_allowed_token_type"])

export type HistoryOptions = { api: SlackApi; log: (line: string) => void; canSearch: boolean }

function cursorOf(reply: Json): string | null {
  const meta = isJson(reply.response_metadata) ? reply.response_metadata : null
  return meta !== null && typeof meta.next_cursor === "string" && meta.next_cursor !== "" ? meta.next_cursor : null
}

const byTs = (a: SlackMessage, b: SlackMessage): number => Number(a.ts) - Number(b.ts)

export class SlackHistory {
  constructor(private readonly options: HistoryOptions) {}

  private async pages(method: string, params: Record<string, string>, pick: (reply: Json) => unknown[]): Promise<unknown[] | null> {
    const out: unknown[] = []
    let cursor: string | null = null
    for (let page = 0; page < MAX_PAGES; page += 1) {
      let reply: Json
      try {
        reply = await this.options.api.call(method, { ...params, limit: PAGE, ...(cursor === null ? {} : { cursor }) })
      } catch (error) {
        if (error instanceof SlackAuthError) throw error
        const code = error instanceof SlackApiError ? error.error : error instanceof Error ? error.message : String(error)
        if (!SKIPPED.has(code)) this.options.log(`slack ${method} ${params.channel ?? ""} skipped: ${code}`)
        return out.length === 0 ? null : out
      }
      out.push(...pick(reply))
      cursor = cursorOf(reply)
      if (cursor === null) return out
    }
    this.options.log(`slack ${method} ${params.channel ?? ""}: stopped after ${MAX_PAGES} pages`)
    return out
  }

  /** Channel ids to read when no chats were configured: every DM, group DM and joined channel. */
  async conversations(): Promise<readonly string[]> {
    const raw = await this.pages("users.conversations", { types: "im,mpim,public_channel,private_channel", exclude_archived: "true" }, (reply) =>
      Array.isArray(reply.channels) ? reply.channels : [],
    )
    return (raw ?? []).flatMap((entry) => (isJson(entry) && typeof entry.id === "string" ? [entry.id] : []))
  }

  async channel(channel: string, oldest: string): Promise<SlackMessage[]> {
    const raw = await this.pages("conversations.history", { channel, oldest, include_all_metadata: "true" }, (reply) => (Array.isArray(reply.messages) ? reply.messages : []))
    return (raw ?? []).flatMap((entry) => parseMessage(entry, channel) ?? []).sort(byTs)
  }

  async thread(channel: string, thread_ts: string, oldest: string): Promise<SlackMessage[]> {
    const raw = await this.pages("conversations.replies", { channel, ts: thread_ts, oldest, include_all_metadata: "true" }, (reply) =>
      Array.isArray(reply.messages) ? reply.messages : [],
    )
    return (raw ?? [])
      .flatMap((entry) => parseMessage(entry, channel) ?? [])
      .filter((message) => tsAfter(message.ts, oldest))
      .sort(byTs)
  }

  async mentions(self_user_id: string, oldest: string): Promise<SlackMessage[]> {
    if (!this.options.canSearch) return []
    let reply: Json
    try {
      reply = await this.options.api.call("search.messages", { query: `<@${self_user_id}>`, sort: "timestamp", sort_dir: "desc", count: SEARCH_COUNT })
    } catch (error) {
      if (error instanceof SlackAuthError) throw error
      this.options.log(`slack search.messages skipped: ${error instanceof Error ? error.message : String(error)}`)
      return []
    }
    const messages = isJson(reply.messages) && Array.isArray(reply.messages.matches) ? reply.messages.matches : []
    return messages
      .flatMap((match) => {
        if (!isJson(match) || !isJson(match.channel) || typeof match.channel.id !== "string") return []
        const parsed = parseMessage({ ...match, channel: match.channel.id, thread_ts: threadFromPermalink(match.permalink) })
        return parsed === null ? [] : [parsed]
      })
      .filter((message) => tsAfter(message.ts, oldest))
      .sort(byTs)
  }
}

function threadFromPermalink(permalink: unknown): string | undefined {
  if (typeof permalink !== "string") return undefined
  try {
    const thread = new URL(permalink).searchParams.get("thread_ts")
    return isTs(thread) ? thread : undefined
  } catch {
    return undefined
  }
}
