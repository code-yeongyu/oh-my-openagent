import type { Page } from "playwright-core"
import type { DetectedChallenge } from "../detect-types"

export async function detectAwsWaf(page: Page): Promise<DetectedChallenge | null> {
  const iframe = await page.$("iframe[src*='captcha-prod-bd.us-east-1.amazonaws.com'], iframe[src*='aws-waf.com'], iframe[src*='captcha-prod']")
  if (iframe) {
    return { kind: "aws_waf", confidence: 0.92, selector: "iframe[src*='aws-waf']" }
  }
  const container = await page.$("[id^='captcha-container'][data-aws-waf]")
  if (container) {
    return { kind: "aws_waf", confidence: 0.85, selector: "[id^='captcha-container']" }
  }
  const cookieEvidence = await page.evaluate(() => {
    return document.cookie.split(";").some((c) => c.trim().startsWith("aws-waf-token="))
  })
  if (cookieEvidence) {
    const challengeBody = await page.$("body[data-aws-waf-challenge], [data-aws-waf]")
    if (challengeBody) {
      return { kind: "aws_waf", confidence: 0.7, selector: "body" }
    }
  }
  return null
}
