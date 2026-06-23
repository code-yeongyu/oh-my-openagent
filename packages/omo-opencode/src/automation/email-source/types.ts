export type EmailMatch = {
  body: string
  subject: string
  from: string
  receivedAt: number
}

export type WaitForCodeOptions = {
  pattern?: RegExp
  from?: string
  subject?: string
  timeoutMs?: number
  pollIntervalMs?: number
  vision?: VisionOtpExtractor
  codeLength?: number
}

export interface VisionOtpExtractor {
  extractCode(
    image: Buffer | string,
    opts?: { length?: number; sender?: string },
  ): Promise<{ found: boolean; code?: string; confidence?: number; reasoning?: string }>
}

export interface EmailInbox {
  readonly address: string
  waitForCode(opts: WaitForCodeOptions): Promise<string>
  waitForEmail(opts: Omit<WaitForCodeOptions, "pattern">): Promise<EmailMatch>
  close(): Promise<void>
}
