import type { Page } from "playwright-core"
import type { ChallengeKind } from "../types"
import type { AntiCaptchaTaskType, AntiCaptchaSolution } from "./anti-captcha-types"

export type AntiCaptchaExtraction = {
  websiteKey?: string
  enterprisePayload?: Record<string, unknown>
  userAgent?: string
  isInvisible?: boolean
  pageAction?: string
  minScore?: number
  data?: string
  geetest?: {
    challenge?: string
    gt?: string
    geetestApiServerSubdomain?: string
    version?: 3 | 4
    initParameters?: Record<string, unknown>
  }
}

export type AntiCaptchaTaskHandler = {
  taskType: AntiCaptchaTaskType
  extract(page: Page): Promise<AntiCaptchaExtraction | null>
  inject(page: Page, solution: AntiCaptchaSolution): Promise<boolean>
}

export type AntiCaptchaRegistry = ReadonlyMap<ChallengeKind, AntiCaptchaTaskHandler>
