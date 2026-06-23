/// <reference lib="dom" />
import type { Page } from "playwright-core"
import { BotBlockedError } from "../types"

export type BlockSignal = {
  kind: string
  evidence: { statusCode?: number; title?: string; bodySnippet?: string }
}

const BLOCK_PATTERNS = [
  { regex: /access denied/i, kind: "access_denied" },
  { regex: /blocked/i, kind: "ip_blocked" },
  { regex: /403 forbidden/i, kind: "403_forbidden" },
  { regex: /captcha/i, kind: "captcha_wall" },
  { regex: /please verify/i, kind: "verification_required" },
  { regex: /unusual traffic/i, kind: "rate_limited" },
  { regex: /bot detected/i, kind: "bot_detected" },
]

export async function detectBotBlock(page: Page, profileDir: string): Promise<BlockSignal | null> {
  const title = await page.title()
  const bodyText = await page.evaluate(() => document.body?.textContent?.slice(0, 500) ?? "")

  for (const pattern of BLOCK_PATTERNS) {
    if (pattern.regex.test(title) || pattern.regex.test(bodyText)) {
      return {
        kind: pattern.kind,
        evidence: { title, bodySnippet: bodyText.slice(0, 200) },
      }
    }
  }

  return null
}

export async function throwIfBlocked(page: Page, profileDir: string): Promise<void> {
  const block = await detectBotBlock(page, profileDir)
  if (block) {
    throw new BotBlockedError(block.kind, profileDir, { headers: {} })
  }
}
