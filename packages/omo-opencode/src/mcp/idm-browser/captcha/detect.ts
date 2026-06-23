import type { Page } from "playwright-core"
import { detectCloudflare } from "./detectors/cloudflare"
import { detectRecaptcha } from "./detectors/recaptcha"
import { detectMultiLayeredFirebase } from "./detectors/multi-layered-firebase"
import { detectHCaptcha } from "./detectors/hcaptcha"
import { detectDataDome } from "./detectors/datadome"
import { detectArkose } from "./detectors/arkose"
import { detectAwsWaf } from "./detectors/aws-waf"
import { detectGeetest } from "./detectors/geetest"
import { detectMtCaptcha } from "./detectors/mtcaptcha"
import { detectAkamai } from "./detectors/akamai"
import { detectImperva } from "./detectors/imperva"
import { detectFriendlyCaptcha } from "./detectors/friendly-captcha"
import { detectGenericImageGrid } from "./detectors/generic-image-grid"

export type { DetectedChallenge } from "./detect-types"

import type { DetectedChallenge } from "./detect-types"

const DETECTORS: Array<(page: Page) => Promise<DetectedChallenge | null>> = [
  detectCloudflare,
  detectRecaptcha,
  detectMultiLayeredFirebase,
  detectHCaptcha,
  detectDataDome,
  detectArkose,
  detectAwsWaf,
  detectGeetest,
  detectMtCaptcha,
  detectAkamai,
  detectImperva,
  detectFriendlyCaptcha,
  detectGenericImageGrid,
]

export async function detectChallenge(page: Page): Promise<DetectedChallenge | null> {
  for (const detect of DETECTORS) {
    const result = await detect(page)
    if (result) return result
  }
  return null
}
