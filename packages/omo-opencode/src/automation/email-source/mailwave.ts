import { BrowserSession } from "../browser-session"
import type { EmailInbox, EmailMatch, WaitForCodeOptions } from "./types"

const DEFAULT_TIMEOUT = 60_000
const DEFAULT_POLL = 3000
const DEFAULT_DOMAIN = "aula.edu.pl"

export type MailwaveDomain =
  | "aula.edu.pl"
  | "studyhub.edu.pl"
  | "globalcampus.edu.pl"
  | "skola.edu.pl"
  | "javaemail.com"
  | (string & {})

export type MailwaveFreshOptions = {
  existingSession?: BrowserSession
  domain?: MailwaveDomain
}

export class MailwaveInbox implements EmailInbox {
  readonly address: string
  private constructor(
    private readonly session: BrowserSession,
    address: string,
    private readonly ownsSession: boolean,
  ) {
    this.address = address
  }

  static async fresh(opts: MailwaveFreshOptions = {}): Promise<MailwaveInbox> {
    const session = opts.existingSession ?? (await BrowserSession.create())
    const targetDomain = opts.domain ?? DEFAULT_DOMAIN
    await session.navigate("https://mailwave.dev", { waitUntil: "networkidle" })

    let address = await waitForLandingEmail(session)
    if (!address) {
      throw new Error("MailwaveInbox: no email address found on mailwave.dev landing page")
    }

    if (!address.endsWith(`@${targetDomain}`)) {
      address = await switchDomain(session, targetDomain)
    }

    return new MailwaveInbox(session, address, !opts.existingSession)
  }

  async waitForEmail(opts: Omit<WaitForCodeOptions, "pattern">): Promise<EmailMatch> {
    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT
    const poll = opts.pollIntervalMs ?? DEFAULT_POLL
    const deadline = Date.now() + timeout

    while (Date.now() < deadline) {
      const link = await this.findMessageLink(opts.from)
      if (link) {
        await this.session.navigate(link, { waitUntil: "networkidle" })
        await new Promise((r) => setTimeout(r, 1500))
        const email = await this.parseMessage()
        if (this.matches(email, opts)) return email
      }
      await this.session.navigate("https://mailwave.dev")
      await new Promise((r) => setTimeout(r, poll))
    }
    throw new Error(`MailwaveInbox: no matching email within ${timeout}ms (from=${opts.from ?? "*"})`)
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

    throw new Error(`MailwaveInbox: code not found (vision=${opts.vision ? "tried" : "skipped"}, pattern=${pattern}, bodyLen=${email.body.length})`)
  }

  async close(): Promise<void> {
    if (this.ownsSession) await this.session.close()
  }

  private async findMessageLink(senderHint?: string): Promise<string | null> {
    const expression = senderHint
      ? `(() => { const rows = Array.from(document.querySelectorAll('.mailbox-item, tr')); const match = rows.find(r => /${senderHint.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}/i.test(r.textContent || '')); const a = match?.querySelector('a[href*="/view/"]'); return a ? a.href : null; })()`
      : `(() => { const a = document.querySelector('a[href*="/view/"]'); return a ? a.href : null; })()`
    return this.session.evaluate<string | null>(expression)
  }

  private async parseMessage(): Promise<EmailMatch> {
    return this.session.evaluate<EmailMatch>(
      `(() => {
        const f = document.querySelector('iframe');
        const body = f?.contentDocument?.body?.innerText ?? document.body.innerText;
        const headerText = document.body.innerText;
        const subject = (document.title || '').replace(' | Mail Wave','').trim();
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

async function waitForLandingEmail(session: BrowserSession): Promise<string | null> {
  const expr = `(() => {
    const main = document.querySelector('#mainEmail');
    if (main && main.value) return main.value;
    const fromInput = Array.from(document.querySelectorAll('input')).find(x => x.value && x.value.includes('@'));
    if (fromInput) return fromInput.value;
    const m = (document.body?.innerText ?? '').match(/[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+/);
    return m ? m[0] : null;
  })()`
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const value = await session.evaluate<string | null>(expr)
    if (value) return value
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

async function switchDomain(session: BrowserSession, targetDomain: string): Promise<string> {
  const domainLit = JSON.stringify(targetDomain)
  await session.evaluate(
    `(() => { const c = document.querySelector('#acceptCookie'); if (c && c.offsetParent !== null) c.click(); })()`,
  )
  await session.click("#change_email_btn")

  const setupExpr = `(() => {
    const domain = ${domainLit};
    const sel = document.querySelector('#name_domain');
    if (!sel) return false;
    sel.value = domain;
    if (window.jQuery) window.jQuery(sel).val(domain).trigger('change');
    else sel.dispatchEvent(new Event('change', { bubbles: true }));
    const aliasInput = document.querySelector('#random_code_input');
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(aliasInput), 'value')?.set;
    const alias = 'idm' + Math.random().toString(36).slice(2, 10);
    setter?.call(aliasInput, alias);
    aliasInput.dispatchEvent(new Event('input', { bubbles: true }));
    aliasInput.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`
  const ok = await session.evaluate<boolean>(setupExpr)
  if (!ok) {
    throw new Error(`MailwaveInbox: change_email modal did not expose #name_domain`)
  }

  await session.click("#change_email")

  const verifyExpr = `(() => {
    const domain = ${domainLit};
    const main = document.querySelector('#mainEmail');
    return main && main.value && main.value.endsWith('@' + domain) ? main.value : null;
  })()`
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    const value = await session.evaluate<string | null>(verifyExpr)
    if (value) return value
    await new Promise((r) => setTimeout(r, 400))
  }

  throw new Error(`MailwaveInbox: failed to switch domain to ${targetDomain}`)
}
