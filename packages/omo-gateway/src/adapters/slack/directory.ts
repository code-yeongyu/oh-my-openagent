import { SlackAuthError, type AuthLatch, type SlackApi } from "./api"
import type { Author, Identity, Speaker } from "./events"
import { isJson } from "./wire"

const THREAD_CAP = 300
const MESSAGE_CAP = 4096

function capped<K, V>(map: Map<K, V>, limit: number): void {
  while (map.size > limit) {
    const oldest = map.keys().next()
    if (oldest.done === true) return
    map.delete(oldest.value)
  }
}

/**
 * Who the adapter is (auth.test, checked against the configured workspace), who wrote a message
 * (users.info, cached), and which thread a message lives in (remembered from every message seen or
 * sent, so a reaction on a thread reply carries its thread_id).
 */
export class SlackDirectory {
  private identity: Promise<Identity> | null = null
  private readonly authors = new Map<string, Promise<Author>>()
  private readonly threadOfMessage = new Map<string, string | null>()
  private readonly ownThreads = new Map<string, { chat_id: string; thread_id: string }>()

  constructor(
    private readonly api: SlackApi,
    private readonly latch: AuthLatch,
    private readonly account_id: string,
    private readonly log: (line: string) => void,
  ) {}

  self(): Promise<Identity> {
    this.identity ??= this.api.call("auth.test").then((auth) => {
      const team_id = typeof auth.team_id === "string" ? auth.team_id : ""
      const user_id = typeof auth.user_id === "string" ? auth.user_id : ""
      if (team_id !== this.account_id || user_id === "") {
        throw this.latch.trip(new SlackAuthError("auth.test", "team_mismatch"))
      }
      const url = typeof auth.url === "string" && auth.url !== "" ? auth.url : "https://slack.com/"
      return { team_id, user_id, bot_id: typeof auth.bot_id === "string" ? auth.bot_id : null, url }
    })
    this.identity.catch(() => {
      this.identity = null
    })
    return this.identity
  }

  author(speaker: Speaker): Promise<Author> {
    if (speaker.user === null) return Promise.resolve({ display: speaker.username ?? speaker.bot_id ?? "bot", is_bot: true })
    const user = speaker.user
    const cached = this.authors.get(user)
    if (cached !== undefined) return cached.then((found) => (speaker.bot_id === null ? found : { ...found, is_bot: true }))
    const lookup = this.api.call("users.info", { user }).then(
      (reply) => {
        const info = isJson(reply.user) ? reply.user : {}
        const profile = isJson(info.profile) ? info.profile : {}
        const pick = [profile.display_name, info.real_name, info.name].find((name) => typeof name === "string" && name !== "")
        return { display: typeof pick === "string" ? pick : user, is_bot: info.is_bot === true || info.is_app_user === true }
      },
      (error: unknown) => {
        if (error instanceof SlackAuthError) throw error
        this.log(`slack users.info ${user} failed: ${error instanceof Error ? error.message : String(error)}`)
        this.authors.delete(user)
        return { display: user, is_bot: false }
      },
    )
    this.authors.set(user, lookup)
    capped(this.authors, MESSAGE_CAP)
    return lookup.then((found) => (speaker.bot_id === null ? found : { ...found, is_bot: true }))
  }

  rememberMessage(channel: string, ts: string, thread_id: string | null): void {
    this.threadOfMessage.set(`${channel}:${ts}`, thread_id)
    capped(this.threadOfMessage, MESSAGE_CAP)
  }

  threadOf(channel: string, ts: string): string | null {
    return this.threadOfMessage.get(`${channel}:${ts}`) ?? null
  }

  /** A thread the gateway posted in: catchUp reads its replies even when no binding lists it. */
  rememberOwnThread(chat_id: string, thread_id: string): void {
    this.ownThreads.set(`${chat_id}:${thread_id}`, { chat_id, thread_id })
    capped(this.ownThreads, THREAD_CAP)
  }

  ownThreadKeys(): readonly { chat_id: string; thread_id: string }[] {
    return [...this.ownThreads.values()]
  }
}
