import { BrowserSession } from "../browser-session"
import type { EmailInbox, EmailMatch, WaitForCodeOptions } from "./types"

const DEFAULT_TIMEOUT = 120_000
const DEFAULT_POLL = 4000

export type EmailnatorFreshOptions = {
  existingSession?: BrowserSession
}

export class EmailnatorInbox implements EmailInbox {
  readonly address: string
  private readonly mailboxUrl: string

  private constructor(
    private readonly session: BrowserSession,
    address: string,
    private readonly ownsSession: boolean,
  ) {
    this.address = address
    this.mailboxUrl = `https://www.emailnator.com/mailbox/#${address}`
  }

  static async fresh(opts: EmailnatorFreshOptions = {}): Promise<EmailnatorInbox> {
    const session = opts.existingSession ?? (await BrowserSession.create())
    await session.navigate("https://www.emailnator.com/", { waitUntil: "domcontentloaded" })
    await dismissCookieConsent(session)
    await selectDotGmailOnly(session)
    await regenerateEmail(session)

    const address = await readGeneratedEmail(session)
    if (!address) {
      throw new Error("EmailnatorInbox: no email address found on emailnator.com")
    }
    if (!address.endsWith("@gmail.com")) {
      throw new Error(`EmailnatorInbox: expected @gmail.com address, got ${address}`)
    }

    await clickGoButton(session)
    return new EmailnatorInbox(session, address, !opts.existingSession)
  }

  async waitForEmail(opts: Omit<WaitForCodeOptions, "pattern">): Promise<EmailMatch> {
    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT
    const poll = opts.pollIntervalMs ?? DEFAULT_POLL
    const deadline = Date.now() + timeout

    let iter = 0
    while (Date.now() < deadline) {
      iter++
      const link = await this.findMessageLink(opts.from)
      const inboxRowCount = await this.getInboxRowCount()
      console.error(`[emailnator] iter=${iter} address=${this.address} rowCount=${inboxRowCount} matchedLink=${link ? "yes" : "no"}`)
      if (link) {
        await this.session.navigate(link, { waitUntil: "load" })
        await waitForIframeBody(this.session, 8000)
        const email = await this.parseMessage()
        if (email.body.length > 0 && this.matches(email, opts)) return email
      }
      await this.session.navigate(this.mailboxUrl, { waitUntil: "domcontentloaded" })
      await new Promise((r) => setTimeout(r, 1500))
      await tryClickGoButton(this.session)
      await new Promise((r) => setTimeout(r, poll))
    }
    throw new Error(`EmailnatorInbox: no matching email within ${timeout}ms (from=${opts.from ?? "*"})`)
  }

  async waitForCode(opts: WaitForCodeOptions): Promise<string> {
    const email = await this.waitForEmail(opts)
    const pattern = opts.pattern ?? /\b\d{6}\b/

    const directMatch = email.body.match(pattern)
    if (directMatch) return directMatch[1] ?? directMatch[0]

    if (opts.vision) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const shot = await this.session.screenshot()
          const result = await opts.vision.extractCode(shot, {
            length: opts.codeLength,
            sender: opts.from,
          })
          if (result.found && result.code && /^\d+$/.test(result.code)) {
            return result.code
          }
        } catch {
          void 0
        }
        await new Promise((r) => setTimeout(r, 1500))
      }
    }

    throw new Error(`EmailnatorInbox: code not found (vision=${opts.vision ? "tried" : "skipped"}, pattern=${pattern}, bodyLen=${email.body.length})`)
  }

  async close(): Promise<void> {
    if (this.ownsSession) await this.session.close()
  }

  private async getInboxRowCount(): Promise<number> {
    return this.session.evaluate<number>(`document.querySelectorAll('tr a[href*="/mailbox/"]').length`)
  }

  private async findMessageLink(senderHint?: string): Promise<string | null> {
    const escaped = senderHint ? senderHint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : null
    const expression = escaped
      ? `(function() { const rows = Array.from(document.querySelectorAll('tr')); const match = rows.find(r => /${escaped}/i.test(r.textContent || '')); const a = match?.querySelector('a[href*="/mailbox/"]'); return a ? a.href : null; })()`
      : `(function() { const a = document.querySelector('tr a[href*="/mailbox/"]'); return a ? a.href : null; })()`
    return this.session.evaluate<string | null>(expression)
  }

  private async parseMessage(): Promise<EmailMatch> {
    return this.session.evaluate<EmailMatch>(
      `(function() {
        const f = document.querySelector('iframe');
        const body = f?.contentDocument?.body?.innerText ?? document.body.innerText;
        const headerText = document.body.innerText;
        const subject = (document.title || '').trim();
        const fromMatch = headerText.match(/From:\\s*([^\\n]+)/) || headerText.match(/[<(]([^<>()@\\s]+@[^<>()@\\s]+)[>)]/);
        const from = fromMatch ? fromMatch[1].trim() : '';
        return { body, subject, from, receivedAt: Date.now() };
      })()`,
    )
  }

  private matches(email: EmailMatch, opts: Omit<WaitForCodeOptions, "pattern">): boolean {
    if (opts.from && !email.from.toLowerCase().includes(opts.from.toLowerCase()) && !email.subject.toLowerCase().includes(opts.from.toLowerCase()) && !email.body.toLowerCase().includes(opts.from.toLowerCase())) {
      return false
    }
    if (opts.subject && !email.subject.toLowerCase().includes(opts.subject.toLowerCase())) {
      return false
    }
    return true
  }
}

async function dismissCookieConsent(session: BrowserSession): Promise<void> {
  try {
    await session.click("button.fc-cta-consent")
  } catch {
    void 0
  }
  await new Promise((r) => setTimeout(r, 1000))
}

export const SWITCHES_TO_UNCHECK = ["custom-switch-domain", "custom-switch-plusGmail", "custom-switch-googleMail"] as const
export const DOT_GMAIL_SWITCH = "custom-switch-dotGmail"

async function selectDotGmailOnly(session: BrowserSession): Promise<void> {
  const result = await session.evaluate<{ uncheckedCount: number; dotGmailChecked: boolean }>(
    `(function() {
      const idsToUncheck = ${JSON.stringify(SWITCHES_TO_UNCHECK)};
      let uncheckedCount = 0;
      for (const id of idsToUncheck) {
        const cb = document.getElementById(id);
        // Use click() not .checked=false — Bootstrap switches need the click event to fire change handlers
        if (cb && cb.checked) { cb.click(); uncheckedCount++; }
      }
      return { uncheckedCount, dotGmailChecked: document.getElementById('${DOT_GMAIL_SWITCH}')?.checked === true };
    })()`,
  )
  if (!result.dotGmailChecked) {
    throw new Error("EmailnatorInbox: custom-switch-dotGmail is not checked after toggling switches")
  }
  await new Promise((r) => setTimeout(r, 500))
}

async function regenerateEmail(session: BrowserSession): Promise<void> {
  const clicked = await session.evaluate<boolean>(
    `(function() {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Generate New');
      if (btn) { btn.click(); return true; }
      return false;
    })()`,
  )
  if (!clicked) {
    throw new Error("EmailnatorInbox: 'Generate New' button not found")
  }
  await new Promise((r) => setTimeout(r, 1800))
}

async function readGeneratedEmail(session: BrowserSession): Promise<string | null> {
  const expr = `(function() {
    const named = document.querySelector('input[placeholder="Email Address"]');
    if (named && named.value && named.value.includes('@')) return named.value;
    const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
    const match = inputs.find(x => x.value && x.value.includes('@'));
    return match ? match.value : null;
  })()`
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const value = await session.evaluate<string | null>(expr)
    if (value && value.includes("@")) return value
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

async function waitForIframeBody(session: BrowserSession, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const expr = `(function() {
    const f = document.querySelector('iframe');
    const txt = f?.contentDocument?.body?.innerText ?? document.body.innerText;
    return (txt || '').trim().length;
  })()`
  while (Date.now() < deadline) {
    const len = await session.evaluate<number>(expr)
    if (len > 50) return
    await new Promise((r) => setTimeout(r, 400))
  }
}

async function clickGoButton(session: BrowserSession): Promise<void> {
  const clicked = await session.evaluate<boolean>(GO_BUTTON_CLICK_EXPR)
  if (!clicked) {
    throw new Error("EmailnatorInbox: 'Go !' button not found")
  }
  await new Promise((r) => setTimeout(r, 3000))
}

async function tryClickGoButton(session: BrowserSession): Promise<boolean> {
  const clicked = await session.evaluate<boolean>(GO_BUTTON_CLICK_EXPR)
  if (clicked) await new Promise((r) => setTimeout(r, 1500))
  return clicked
}

const GO_BUTTON_CLICK_EXPR = `(function() {
  const btns = Array.from(document.querySelectorAll('button'));
  const go = btns.find(b => b.textContent?.trim() === 'Go !');
  if (go) { go.click(); return true; }
  return false;
})()`
