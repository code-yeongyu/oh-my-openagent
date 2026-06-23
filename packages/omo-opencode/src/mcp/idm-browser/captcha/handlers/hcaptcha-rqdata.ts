import type { Page } from "playwright-core"

export type HCaptchaRqdataOptions = {
  timeoutMs?: number
}

const GETCAPTCHA_PATTERN = /\/getcaptcha\/[a-f0-9-]+\/?(?:$|[?#])/i

export async function extractHCaptchaRqdata(page: Page, opts: HCaptchaRqdataOptions = {}): Promise<string | null> {
  const fromRequest = await extractFromGetcaptchaRequest(page, opts.timeoutMs ?? 5_000)
  if (fromRequest) return fromRequest

  const fromRespKey = await page.evaluate(() => {
    const hcaptcha = (window as unknown as { hcaptcha?: { getRespKey?: () => string | null } }).hcaptcha
    return hcaptcha?.getRespKey?.() ?? null
  }).catch(() => null)
  if (fromRespKey) return fromRespKey

  return page.evaluate(() => {
    const el = document.querySelector("[data-rqdata], [data-hcaptcha-rqdata]") as HTMLElement | null
    return el?.getAttribute("data-rqdata") ?? el?.getAttribute("data-hcaptcha-rqdata") ?? null
  }).catch(() => null)
}

async function extractFromGetcaptchaRequest(page: Page, timeoutMs: number): Promise<string | null> {
  const request = await page.waitForRequest((candidate) => GETCAPTCHA_PATTERN.test(candidate.url()), { timeout: timeoutMs })
    .catch(() => null)
  const body = request?.postData()
  if (!body) return null
  return new URLSearchParams(body).get("rqdata")
}
