import type { EmailInbox, EmailMatch, WaitForCodeOptions } from "./types"

const MAILTM_BASE_URL = "https://api.mail.tm"
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_POLL_MS = 3_000

type MailTmDomain = {
  domain: string
}

type MailTmDomainsResponse = {
  "hydra:member"?: MailTmDomain[]
}

type MailTmAccountResponse = {
  "@id"?: string
  address?: string
}

type MailTmTokenResponse = {
  token?: string
}

type MailTmMessageListItem = {
  id: string
  subject?: string
  intro?: string
  from?: { address?: string; name?: string }
  createdAt?: string
}

type MailTmMessageResponse = {
  text?: string
  html?: string[] | string
  subject?: string
  from?: { address?: string; name?: string }
  createdAt?: string
}

export type MailTmFreshOptions = {
  baseUrl?: string
  domain?: string
}

export class MailTmInbox implements EmailInbox {
  readonly address: string
  private readonly baseUrl: string
  private readonly token: string
  private readonly accountId?: string
  private readonly seenMessageIds = new Set<string>()

  private constructor(opts: { address: string; token: string; baseUrl: string; accountId?: string }) {
    this.address = opts.address
    this.token = opts.token
    this.baseUrl = opts.baseUrl
    this.accountId = opts.accountId
  }

  static async fresh(opts: MailTmFreshOptions = {}): Promise<MailTmInbox> {
    const baseUrl = (opts.baseUrl ?? MAILTM_BASE_URL).replace(/\/+$/, "")
    const domain = opts.domain ?? await pickDomain(baseUrl)
    const address = buildAddress(domain)
    const password = buildPassword()

    const accountRes = await fetch(`${baseUrl}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, password }),
    })
    if (!accountRes.ok) {
      const text = await accountRes.text().catch(() => "")
      throw new Error(`MailTmInbox.fresh create failed: ${accountRes.status} ${text.slice(0, 200)}`)
    }
    const account = await accountRes.json() as MailTmAccountResponse

    const tokenRes = await fetch(`${baseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, password }),
    })
    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => "")
      throw new Error(`MailTmInbox.fresh token failed: ${tokenRes.status} ${text.slice(0, 200)}`)
    }
    const tokenBody = await tokenRes.json() as MailTmTokenResponse
    if (!tokenBody.token) {
      throw new Error("MailTmInbox.fresh token missing in response")
    }

    return new MailTmInbox({
      address,
      token: tokenBody.token,
      baseUrl,
      accountId: account["@id"]?.split("/").pop(),
    })
  }

  async waitForCode(opts: WaitForCodeOptions): Promise<string> {
    const pattern = opts.pattern ?? buildOtpPattern(opts.codeLength)
    const match = await this.pollUntilMatch({
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      pollIntervalMs: opts.pollIntervalMs ?? DEFAULT_POLL_MS,
      from: opts.from,
      subject: opts.subject,
      pattern,
    })
    const code = match.body.match(pattern) ?? match.subject.match(pattern)
    if (!code) {
      throw new Error(`MailTmInbox.waitForCode: no code match in matched message (${match.subject})`)
    }
    return code[0]
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
    if (!this.accountId) return
    await fetch(`${this.baseUrl}/accounts/${this.accountId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.token}` },
    }).catch(() => undefined)
  }

  private async pollUntilMatch(opts: {
    timeoutMs: number
    pollIntervalMs: number
    from?: string
    subject?: string
    pattern?: RegExp
  }): Promise<EmailMatch> {
    const deadline = Date.now() + opts.timeoutMs
    while (Date.now() < deadline) {
      const messages = await this.fetchMessages()
      for (const message of messages) {
        if (this.seenMessageIds.has(message.id)) continue
        if (opts.from && !messageMatches(message.from?.address, message.from?.name, message.subject, opts.from)) continue
        if (opts.subject && !containsIgnoreCase(message.subject, opts.subject)) continue

        this.seenMessageIds.add(message.id)
        const full = await this.fetchMessage(message.id)
        if (opts.pattern && !opts.pattern.test(full.body) && !opts.pattern.test(full.subject)) continue
        return full
      }
      await sleep(opts.pollIntervalMs)
    }
    throw new Error(`MailTmInbox.pollUntilMatch: timeout after ${opts.timeoutMs}ms (address=${this.address})`)
  }

  private async fetchMessages(): Promise<MailTmMessageListItem[]> {
    const res = await fetch(`${this.baseUrl}/messages?page=1`, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`MailTmInbox.fetchMessages failed: ${res.status} ${text.slice(0, 200)}`)
    }
    return await res.json() as MailTmMessageListItem[]
  }

  private async fetchMessage(id: string): Promise<EmailMatch> {
    const res = await fetch(`${this.baseUrl}/messages/${id}`, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`MailTmInbox.fetchMessage failed: ${res.status} ${text.slice(0, 200)}`)
    }
    const body = await res.json() as MailTmMessageResponse
    return {
      body: body.text ?? normalizeHtml(body.html),
      subject: body.subject ?? "",
      from: body.from?.address ?? body.from?.name ?? "",
      receivedAt: toEpochSeconds(body.createdAt),
    }
  }
}

async function pickDomain(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/domains`)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`MailTmInbox.pickDomain failed: ${res.status} ${text.slice(0, 200)}`)
  }
  const body = await res.json() as MailTmDomainsResponse
  const domain = body["hydra:member"]?.find((item) => item.domain)?.domain
  if (!domain) {
    throw new Error("MailTmInbox.pickDomain: no active domain returned")
  }
  return domain
}

function buildAddress(domain: string): string {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`
  return `mailtm${suffix}@${domain}`
}

function buildPassword(): string {
  return `MailTm${Math.random().toString(36).slice(2, 10)}!Aa9`
}

function buildOtpPattern(codeLength?: number): RegExp {
  if (codeLength && codeLength >= 4 && codeLength <= 10) {
    return new RegExp(`\\b[0-9A-Z-]{${codeLength},${codeLength + 2}}\\b`)
  }
  return /\b(?:\d{4,8}|[A-Z0-9]{3}-[A-Z0-9]{3})\b/
}

function messageMatches(address: string | undefined, name: string | undefined, subject: string | undefined, needle: string): boolean {
  return containsIgnoreCase(address, needle) || containsIgnoreCase(name, needle) || containsIgnoreCase(subject, needle)
}

function containsIgnoreCase(actual: string | undefined, needle: string): boolean {
  if (!actual) return false
  return actual.toLowerCase().includes(needle.toLowerCase())
}

function normalizeHtml(input: string[] | string | undefined): string {
  if (Array.isArray(input)) return input.join("\n")
  return input ?? ""
}

function toEpochSeconds(input: string | undefined): number {
  if (!input) return Math.floor(Date.now() / 1000)
  const ts = Date.parse(input)
  if (Number.isFinite(ts)) return Math.floor(ts / 1000)
  return Math.floor(Date.now() / 1000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
