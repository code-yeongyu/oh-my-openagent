import type { Page } from "playwright-core"
import type { ChallengeKind } from "../types"
import { detectChallenge, type DetectedChallenge } from "./detect"

export type SolverName =
  | "skip"
  | "playwright-captcha"
  | "whisper-audio"
  | "vision-llm"
  | "manual"
  | "capsolver"
  | "anti-captcha"

export type SolveAttempt = {
  solver: SolverName
  error?: string
  durationMs: number
}

export type SolveResult = {
  solved: boolean
  solver: SolverName
  challenge: DetectedChallenge
  error?: string
  durationMs: number
  attempts?: SolveAttempt[]
}

export type SolverFn = (page: Page, challenge: DetectedChallenge) => Promise<boolean>

const HCAPTCHA_PREFERENCE: SolverName[] = ["anti-captcha", "vision-llm", "manual"]
const RECAPTCHA_V2_PREFERENCE: SolverName[] = ["capsolver", "anti-captcha", "vision-llm", "manual"]
const RECAPTCHA_V3_INVISIBLE_PREFERENCE: SolverName[] = ["skip", "capsolver", "anti-captcha"]
const RECAPTCHA_V3_EXECUTABLE_PREFERENCE: SolverName[] = ["capsolver", "anti-captcha", "vision-llm", "manual"]
const TURNSTILE_PREFERENCE: SolverName[] = ["capsolver", "skip", "anti-captcha", "manual"]
const CLOUDFLARE_INTERSTITIAL_PREFERENCE: SolverName[] = ["skip", "capsolver", "anti-captcha"]
const FUNCAPTCHA_PREFERENCE: SolverName[] = ["anti-captcha", "vision-llm", "manual"]
const GEETEST_PREFERENCE: SolverName[] = ["capsolver", "anti-captcha", "vision-llm", "manual"]
const FRIENDLY_CAPTCHA_PREFERENCE: SolverName[] = ["capsolver", "anti-captcha", "manual"]
const IMAGE_GRID_PUZZLE_PREFERENCE: SolverName[] = ["vision-llm", "anti-captcha", "capsolver", "manual"]
const VISION_FIRST: SolverName[] = ["vision-llm", "capsolver", "manual"]
const CAPSOLVER_FIRST: SolverName[] = ["capsolver", "vision-llm", "manual"]
const CAPSOLVER_ONLY: SolverName[] = ["capsolver", "manual"]
const VISION_ONLY: SolverName[] = ["vision-llm", "manual"]

export const SOLVER_PREFERENCE: Record<ChallengeKind, SolverName[]> = {
  cloudflare_interstitial: CLOUDFLARE_INTERSTITIAL_PREFERENCE,
  cloudflare_turnstile: TURNSTILE_PREFERENCE,
  recaptcha_v2_checkbox: RECAPTCHA_V2_PREFERENCE,
  recaptcha_v2_image: RECAPTCHA_V2_PREFERENCE,
  recaptcha_v3_invisible: RECAPTCHA_V3_INVISIBLE_PREFERENCE,
  recaptcha_v3_executable: RECAPTCHA_V3_EXECUTABLE_PREFERENCE,
  recaptcha_enterprise: RECAPTCHA_V2_PREFERENCE,
  recaptcha_enterprise_invisible: ["capsolver", "anti-captcha", "manual"],
  hcaptcha_checkbox: HCAPTCHA_PREFERENCE,
  hcaptcha_image_grid: HCAPTCHA_PREFERENCE,
  hcaptcha_turbo: HCAPTCHA_PREFERENCE,
  hcaptcha_enterprise: HCAPTCHA_PREFERENCE,
  multi_layered_firebase_recaptcha_hcaptcha: ["capsolver", "anti-captcha", "vision-llm", "manual"],
  datadome: VISION_FIRST,
  datadome_slider: CAPSOLVER_FIRST,
  emoji_puzzle: VISION_ONLY,
  arkose_funcaptcha: FUNCAPTCHA_PREFERENCE,
  image_grid_puzzle: IMAGE_GRID_PUZZLE_PREFERENCE,
  aws_waf: CAPSOLVER_FIRST,
  geetest_v3: GEETEST_PREFERENCE,
  geetest_v4: GEETEST_PREFERENCE,
  mtcaptcha: CAPSOLVER_FIRST,
  kasada: CAPSOLVER_ONLY,
  akamai_bmp: CAPSOLVER_ONLY,
  akamai_web: CAPSOLVER_ONLY,
  imperva: CAPSOLVER_ONLY,
  binance_captcha: CAPSOLVER_FIRST,
  duolingo: CAPSOLVER_FIRST,
  friendly_captcha: FRIENDLY_CAPTCHA_PREFERENCE,
  cybersiara: CAPSOLVER_FIRST,
  image_text_ocr: VISION_FIRST,
}

export async function solveCaptchaChain(
  page: Page,
  enabledSolvers: SolverName[],
  solverRegistry: Map<SolverName, SolverFn>,
): Promise<SolveResult | null> {
  const challenge = await detectChallenge(page)
  if (!challenge) return null

  const preferredOrder = SOLVER_PREFERENCE[challenge.kind] ?? ["manual"]
  const orderedSolvers = preferredOrder.filter(s => enabledSolvers.includes(s))

  const attempts: Array<{ solver: SolverName; error?: string; durationMs: number }> = []
  for (const solverName of orderedSolvers) {
    const solver = solverRegistry.get(solverName)
    if (!solver) continue

    const start = Date.now()
    try {
      const solved = await solver(page, challenge)
      const durationMs = Date.now() - start
      attempts.push({ solver: solverName, durationMs })
      if (solved) {
        return { solved: true, solver: solverName, challenge, durationMs, attempts }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      attempts.push({ solver: solverName, error: message, durationMs: Date.now() - start })
    }
  }

  const lastAttempt = attempts[attempts.length - 1]
  return {
    solved: false,
    solver: lastAttempt?.solver ?? "manual",
    challenge,
    error: `All ${attempts.length} solver(s) exhausted: ${attempts.map(a => `${a.solver}${a.error ? "(err)" : "(false)"}`).join(", ")}`,
    durationMs: attempts.reduce((s, a) => s + a.durationMs, 0),
    attempts,
  }
}
