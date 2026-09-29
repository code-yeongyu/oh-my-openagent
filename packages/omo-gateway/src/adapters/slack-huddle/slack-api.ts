// The workspace Web API calls the huddle surface needs.
//
// The session is a member credential. It is used to identify the account, to find the huddle's
// thread, and once to hand the browser its cookie - and it is never logged, never written anywhere
// by us, and never placed in an error message.

import { recordOf } from "./json"
import { VoiceFatal } from "./voice-contract"

export type SlackSession = { readonly token: string; readonly cookie: string }

/** `d=...` either way: some credential stores keep the cookie name, some keep only the value. */
export const cookieHeader = (cookie: string): string => (cookie.includes("=") ? cookie : `d=${cookie}`)

/** The value alone, for handing the browser a cookie named `d`. */
export const cookieValue = (cookie: string): string => {
  const marker = cookie.indexOf("=")
  return marker < 0 ? cookie : cookie.slice(marker + 1)
}

export type Identity = { readonly team_id: string; readonly user_id: string }

export class SlackWebApi {
  private readonly session: SlackSession
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(input: { readonly session: SlackSession; readonly baseUrl: string; readonly fetchImpl?: typeof fetch }) {
    this.session = input.session
    this.baseUrl = input.baseUrl
    this.fetchImpl = input.fetchImpl ?? fetch
  }

  async call(method: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8", cookie: cookieHeader(this.session.cookie) },
      body: new URLSearchParams({ token: this.session.token, ...params }),
    })
    if (!response.ok) throw new VoiceFatal(`${method} answered HTTP ${response.status}`)
    const body = recordOf(await response.json())
    if (body.ok !== true) throw new VoiceFatal(`${method} refused the request (${String(body.error ?? "unknown")})`)
    return body
  }

  /** Who this session is, and a check that it belongs to the workspace this surface serves. */
  async identify(expectedTeam: string): Promise<Identity> {
    const body = await this.call("auth.test")
    const team_id = typeof body.team_id === "string" ? body.team_id : null
    const user_id = typeof body.user_id === "string" ? body.user_id : null
    if (team_id === null || user_id === null) throw new VoiceFatal("this workspace session cannot be used for a call")
    if (team_id !== expectedTeam) throw new VoiceFatal("the session belongs to a different workspace than this surface")
    return { team_id, user_id }
  }

  /** The call's own thread in the chat: where its transcript and summary belong. */
  async findHuddleThread(chat_id: string): Promise<string | null> {
    const body = await this.call("conversations.history", { channel: chat_id, limit: "10" })
    const messages = body.messages
    if (!Array.isArray(messages)) return null
    for (const raw of messages) {
      const message = recordOf(raw)
      if (message.subtype === "huddle_thread" && typeof message.ts === "string") return message.ts
    }
    return null
  }
}
