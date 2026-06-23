import type { Page } from "playwright-core"
import type { DetectedChallenge } from "./detect"
import type { SolverFn } from "./chain"
import { createAntiCaptchaTask, pollAntiCaptchaTaskResult } from "./anti-captcha-client"
import { getAntiCaptchaHandler } from "./anti-captcha-registry"
import type { AntiCaptchaProxyConfig } from "./anti-captcha-types"
import type { FingerprintFamily } from "../../../automation/fingerprint"

export type AntiCaptchaSolverOptions = {
  apiKey?: string
  proxyUrl?: string
  proxy?: AntiCaptchaProxyConfig
  family?: FingerprintFamily
  timeoutMs?: number
  pollIntervalMs?: number
}

export function buildAntiCaptchaSolver(opts: AntiCaptchaSolverOptions = {}): SolverFn {
  return async (page: Page, challenge: DetectedChallenge): Promise<boolean> => {
    if (!opts.apiKey) return false
    if (!opts.proxy) return false
    const handler = getAntiCaptchaHandler(challenge.kind)
    if (!handler) return false

    const extraction = await handler.extract(page)
    if (!extraction) return false

    const taskId = await createAntiCaptchaTask({
      apiKey: opts.apiKey,
      type: handler.taskType,
      websiteURL: page.url(),
      websiteKey: extraction.websiteKey,
      isInvisible: extraction.isInvisible,
      userAgent: opts.family?.userAgent ?? extraction.userAgent,
      enterprisePayload: extraction.enterprisePayload,
      data: extraction.data,
      pageAction: extraction.pageAction,
      minScore: extraction.minScore,
      geetest: extraction.geetest,
      proxy: opts.proxy,
      proxyUrl: opts.proxyUrl,
    })

    const solution = await pollAntiCaptchaTaskResult({
      apiKey: opts.apiKey,
      taskId,
      proxyUrl: opts.proxyUrl,
      timeoutMs: opts.timeoutMs ?? 120_000,
      pollIntervalMs: opts.pollIntervalMs ?? 4_000,
    })
    if (!solution) return false

    return handler.inject(page, solution)
  }
}
