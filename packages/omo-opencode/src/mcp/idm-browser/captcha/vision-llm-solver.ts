import type { Page } from "playwright-core"
import type { DetectedChallenge } from "./detect"
import type { SolverFn } from "./chain"

export type VisionLlmOptions = {
  baseUrl?: string
  apiKey?: string
  model?: string
}

const DEFAULT_VISION_BASE = process.env.DS2API_BASE_URL ?? "http://127.0.0.1:5001"
const DEFAULT_VISION_KEY = process.env.DS2API_ADMIN_KEY ?? ""
const DEFAULT_VISION_MODEL = process.env.DS2API_VISION_MODEL ?? "deepseek-v4-vision"

type VisionGridDecision = {
  targets: number[]
  submit?: boolean
  reasoning?: string
}

export function buildVisionLlmSolver(visionOpts: VisionLlmOptions): SolverFn {
  const baseUrl = (visionOpts.baseUrl ?? DEFAULT_VISION_BASE).replace(/\/+$/, "")
  const apiKey = visionOpts.apiKey ?? DEFAULT_VISION_KEY
  const model = visionOpts.model ?? DEFAULT_VISION_MODEL

  let priorReasoning: string | undefined

  return async (page: Page, challenge: DetectedChallenge): Promise<boolean> => {
    if (!apiKey) {
      throw new Error("vision-llm solver: missing apiKey (set DS2API_ADMIN_KEY or pass visionLlm.apiKey)")
    }
    const challengeFrameSelector = pickChallengeSelector(challenge)
    const targetHandle = await page.$(challengeFrameSelector)
    const screenshotBuffer = targetHandle
      ? await targetHandle.screenshot({ type: "jpeg", quality: 75 })
      : await page.screenshot({ type: "jpeg", quality: 75, fullPage: false })

    const promptText = await extractVisualPrompt(page)
    const dataUrl = `data:image/jpeg;base64,${screenshotBuffer.toString("base64")}`
    const reply = await chatVision(baseUrl, apiKey, model, promptText, dataUrl, priorReasoning)
    if (reply.reasoning) {
      logVisionReasoning(reply.reasoning)
      priorReasoning = reply.reasoning
    }
    const decision = parseGridDecision(reply.content)
    if (!decision || decision.targets.length === 0) return false

    return clickGridTargets(page, challengeFrameSelector, decision)
  }
}

function logVisionReasoning(reasoning: string): void {
  if (process.env.IDM_DEBUG === "true" || process.env.IDM_DEBUG_VISION === "true") {
    console.error(`[vision-llm reasoning]\n${reasoning.slice(0, 800)}`)
  }
}

function pickChallengeSelector(challenge: DetectedChallenge): string {
  if (challenge.kind === "hcaptcha_checkbox" || challenge.kind === "hcaptcha_image_grid") {
    return "iframe[src*='hcaptcha.com'][title*='hallenge' i], iframe[src*='hcaptcha.com'][title*='Sfida' i]"
  }
  return challenge.selector ?? "body"
}

async function extractVisualPrompt(page: Page): Promise<string> {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("h1, h2, h3, p, div, span"))
      .map((el) => (el.textContent ?? "").trim())
      .filter((t) => t.length > 6 && t.length < 200)
    const re = /(trascina[^.]*|trova\s+tutt[^.]*|seleziona\s+[^.]*|select\s+all[^.]*|find\s+all[^.]*|drag\s+the[^.]*)/i
    for (const t of candidates) {
      const m = t.match(re)
      if (m) return m[0].trim()
    }
    return ""
  })
}

async function clickGridTargets(page: Page, frameSelector: string, decision: VisionGridDecision): Promise<boolean> {
  const cells = await page.$$(`${frameSelector} img, ${frameSelector} canvas, [role='button'] img, [role='button'] canvas`)
  if (cells.length === 0) return false

  for (const idx of decision.targets) {
    if (idx < 0 || idx >= cells.length) continue
    try {
      await cells[idx]?.click({ delay: 120, force: false })
      await page.waitForTimeout(280 + Math.floor(Math.random() * 200))
    } catch {
      void 0
    }
  }

  if (decision.submit) {
    const submitBtn = await page.$("button[type='submit'], button:has-text('Verifica'), button:has-text('Verify'), button:has-text('Invia')")
    if (submitBtn) {
      await submitBtn.click().catch(() => undefined)
    }
  }

  return true
}

type VisionChatReply = { content: string; reasoning?: string }

async function chatVision(
  baseUrl: string,
  apiKey: string,
  model: string,
  promptText: string,
  dataUrl: string,
  priorReasoning?: string,
): Promise<VisionChatReply> {
  const reasoningPrefix = priorReasoning
    ? `Your prior reasoning attempt was:\n<prior-reasoning>\n${priorReasoning}\n</prior-reasoning>\nUse it to refine the next decision.\n\n`
    : ""

  const userText =
    reasoningPrefix +
    `You are solving an image-grid CAPTCHA challenge.\nPrompt shown to user: ${JSON.stringify(promptText || "(none extracted)")}\n\n` +
    `The screenshot shows a grid of small images (typically 9 cells in a 3x3 layout, indexed 0..8 row-major).\n` +
    `Decide which cells match the prompt.\n` +
    `Reply ONLY with strict JSON of shape: {"targets": number[], "submit": boolean, "reasoning": string}.\n` +
    `targets = zero-indexed cell indices to click. submit = whether a submit button should be clicked after.`

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 600,
      messages: [
        { role: "system", content: "You are a strict CAPTCHA-solving assistant. Reply only with the JSON the user asks for." },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`vision-llm solver: ${res.status} ${text.slice(0, 200)}`)
  }
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
  }
  const message = body.choices?.[0]?.message
  return {
    content: message?.content ?? "",
    reasoning: message?.reasoning_content ?? extractEmbeddedThinking(message?.content ?? ""),
  }
}

function extractEmbeddedThinking(content: string): string | undefined {
  const match = content.match(/<thinking>([\s\S]*?)<\/thinking>/i)
  return match ? match[1]?.trim() : undefined
}

function parseGridDecision(text: string): VisionGridDecision | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0]) as VisionGridDecision
    if (!Array.isArray(obj.targets)) return null
    obj.targets = obj.targets.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    return obj
  } catch {
    return null
  }
}
