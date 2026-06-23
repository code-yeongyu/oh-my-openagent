import type { EmailInbox, EmailMatch, WaitForCodeOptions } from "./types"

const SONJJ_BASE_URL = "https://app.sonjj.com"
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_POLL_MS = 3_000

export type SmailProInboxType = "gmail" | "outlook"

export type SmailProFreshOptions = {
  apiKey: string
  type?: SmailProInboxType
  baseUrl?: string
}

type RandomGmailResponse = {
  email: string
  timestamp: number
  type: string
}

type RandomOutlookResponse = {
  email: string
  password?: string
  timestamp: number
}

type InboxListItemRaw = {
  mid: string
  textSubject?: string
  textFrom?: string
  textDate?: string
  textTo?: string
}

type InboxListItem = {
  mid: string
  subject: string
  from: string
  receivedAt: number
}

type InboxListResponse = {
  messages?: InboxListItemRaw[]
}

type MessageBodyResponse = {
  body?: string
  attachments?: unknown[]
}

export class SmailProInbox implements EmailInbox {
  readonly address: string
  private readonly apiKey: string
  private readonly inboxType: SmailProInboxType
  private readonly baseUrl: string
  private readonly initializedAt: number
  private readonly seenMessageIds = new Set<string>()

  private constructor(opts: { apiKey: string; type: SmailProInboxType; baseUrl: string; address: string; initializedAt: number }) {
    this.apiKey = opts.apiKey
    this.inboxType = opts.type
    this.baseUrl = opts.baseUrl
    this.address = opts.address
    this.initializedAt = opts.initializedAt
  }

  static async fresh(opts: SmailProFreshOptions): Promise<SmailProInbox> {
    const baseUrl = (opts.baseUrl ?? SONJJ_BASE_URL).replace(/\/+$/, "")
    const type: SmailProInboxType = opts.type ?? "gmail"
    const path = type === "gmail" ? "/v1/temp_gmail/random" : "/v1/temp_outlook/random"

    const res = await fetch(`${baseUrl}${path}`, {
      headers: { "X-Api-Key": opts.apiKey },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`SmailProInbox.fresh(${type}) failed: ${res.status} ${text.slice(0, 200)}`)
    }
    const body = await res.json() as RandomGmailResponse | RandomOutlookResponse
    if (!body.email) {
      throw new Error(`SmailProInbox.fresh(${type}) returned no email`)
    }
    return new SmailProInbox({
      apiKey: opts.apiKey,
      type,
      baseUrl,
      address: body.email,
      initializedAt: typeof body.timestamp === "number" ? body.timestamp : Math.floor(Date.now() / 1000),
    })
  }

  async waitForCode(opts: WaitForCodeOptions): Promise<string> {
    const pattern = opts.pattern ?? buildOtpPattern(opts.codeLength)
    const match = await this.pollUntilMatch({
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      pollIntervalMs: opts.pollIntervalMs ?? DEFAULT_POLL_MS,
      from: opts.from,
      subject: opts.subject,
      bodyPattern: pattern,
    })
    const codeMatch = match.body.match(pattern) ?? match.subject.match(pattern)
    if (!codeMatch) {
      throw new Error(`SmailProInbox.waitForCode: matched message had no pattern hit (subject=${match.subject})`)
    }
    return codeMatch[0]
  }

  async waitForEmail(opts: Omit<WaitForCodeOptions, "pattern">): Promise<EmailMatch> {
    return this.pollUntilMatch({
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      pollIntervalMs: opts.pollIntervalMs ?? DEFAULT_POLL_MS,
      from: opts.from,
      subject: opts.subject,
    })
  }

  async close(): Promise<void> {
    return
  }

  private async pollUntilMatch(opts: {
    timeoutMs: number
    pollIntervalMs: number
    from?: string
    subject?: string
    bodyPattern?: RegExp
  }): Promise<EmailMatch> {
    const deadline = Date.now() + opts.timeoutMs
    while (Date.now() < deadline) {
      const items = await this.fetchInbox()
      for (const item of items) {
        if (this.seenMessageIds.has(item.mid)) continue
        if (opts.from && !senderOrSubjectMatches(item.from, item.subject, opts.from)) continue
        if (opts.subject && !messageFieldMatches(item.subject, opts.subject)) continue

        this.seenMessageIds.add(item.mid)
        const messageBody = await this.fetchMessageBody(item.mid)
        const candidate: EmailMatch = {
          body: messageBody,
          subject: item.subject,
          from: item.from,
          receivedAt: item.receivedAt,
        }
        if (opts.bodyPattern && !opts.bodyPattern.test(candidate.body) && !opts.bodyPattern.test(candidate.subject)) {
          continue
        }
        return candidate
      }
      await sleep(opts.pollIntervalMs)
    }
    throw new Error(`SmailProInbox.pollUntilMatch: timeout after ${opts.timeoutMs}ms (address=${this.address})`)
  }

  private async fetchInbox(): Promise<InboxListItem[]> {
    const path = this.inboxType === "gmail" ? "/v1/temp_gmail/inbox" : "/v1/temp_outlook/inbox"
    const url = `${this.baseUrl}${path}?email=${encodeURIComponent(this.address)}&timestamp=${this.initializedAt}`
    const res = await fetch(url, { headers: { "X-Api-Key": this.apiKey } })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`SmailProInbox.fetchInbox failed: ${res.status} ${text.slice(0, 200)}`)
    }
    const body = await res.json() as InboxListResponse
    if (!Array.isArray(body.messages)) return []
    return body.messages.map(normalizeInboxItem)
  }

  private async fetchMessageBody(mid: string): Promise<string> {
    const path = this.inboxType === "gmail" ? "/v1/temp_gmail/message" : "/v1/temp_outlook/message"
    const url = `${this.baseUrl}${path}?email=${encodeURIComponent(this.address)}&mid=${encodeURIComponent(mid)}`
    const res = await fetch(url, { headers: { "X-Api-Key": this.apiKey } })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`SmailProInbox.fetchMessageBody failed: ${res.status} ${text.slice(0, 200)}`)
    }
    const body = await res.json() as MessageBodyResponse
    return body.body ?? ""
  }
}

function buildOtpPattern(codeLength?: number): RegExp {
  if (codeLength && codeLength >= 4 && codeLength <= 10) {
    return new RegExp(`\\b\\d{${codeLength}}\\b`)
  }
  return /\b\d{4,8}\b/
}

function messageFieldMatches(actual: string | undefined, needle: string): boolean {
  if (!actual) return false
  return actual.toLowerCase().includes(needle.toLowerCase())
}

function senderOrSubjectMatches(from: string, subject: string, needle: string): boolean {
  return messageFieldMatches(from, needle) || messageFieldMatches(subject, needle)
}

function normalizeInboxItem(raw: InboxListItemRaw): InboxListItem {
  return {
    mid: raw.mid,
    subject: raw.textSubject ?? "",
    from: raw.textFrom ?? "",
    receivedAt: parseRfc2822(raw.textDate),
  }
}

function parseRfc2822(input: string | undefined): number {
  if (!input) return Math.floor(Date.now() / 1000)
  const ts = Date.parse(input)
  if (Number.isFinite(ts)) return Math.floor(ts / 1000)
  return Math.floor(Date.now() / 1000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
