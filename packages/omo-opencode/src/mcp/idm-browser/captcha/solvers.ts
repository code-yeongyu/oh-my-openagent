import type { Page } from "playwright-core"
import type { DetectedChallenge } from "./detect"
import type { SolverFn, SolverName } from "./chain"
import { createTask, pollTaskResult, type CapsolverProxyConfig } from "./capsolver-client"
import { getCapsolverHandler } from "./registry"
import { buildVisionLlmSolver, type VisionLlmOptions } from "./vision-llm-solver"
import { buildAntiCaptchaSolver, type AntiCaptchaSolverOptions } from "./anti-captcha-solver"
import type { FingerprintFamily } from "../../../automation/fingerprint"

export type CapsolverSolverOptions = {
  apiKey?: string
  family?: FingerprintFamily
  proxy?: CapsolverProxyConfig
}

export type SolverRegistryOptions = {
  visionLlm?: VisionLlmOptions
  capsolverApiKey?: string
  capsolver?: CapsolverSolverOptions
  antiCaptcha?: AntiCaptchaSolverOptions
}

export function createSolverRegistry(opts: SolverRegistryOptions = {}): Map<SolverName, SolverFn> {
  const registry = new Map<SolverName, SolverFn>()

  registry.set("skip", async (_page: Page, challenge: DetectedChallenge) => {
    const autoPassKinds = ["cloudflare_interstitial", "recaptcha_v3_invisible"]
    if (autoPassKinds.includes(challenge.kind)) {
      await new Promise((resolve) => setTimeout(resolve, 3000))
      return true
    }
    return false
  })

  const capsolverOpts: CapsolverSolverOptions = opts.capsolver ?? { apiKey: opts.capsolverApiKey }
  registry.set("vision-llm", buildVisionLlmSolver(opts.visionLlm ?? {}))
  registry.set("capsolver", buildCapsolverSolver(capsolverOpts))
  registry.set("anti-captcha", buildAntiCaptchaSolver(opts.antiCaptcha ?? {}))
  registry.set("manual", buildManualSolver())

  return registry
}

function buildCapsolverSolver(opts: CapsolverSolverOptions): SolverFn {
  return async (page: Page, challenge: DetectedChallenge): Promise<boolean> => {
    if (!opts.apiKey) return false
    if (!opts.proxy) return false
    const handler = getCapsolverHandler(challenge.kind)
    if (!handler) return false

    const extraction = await handler.extract(page)
    if (!extraction) return false

    const taskId = await createTask({
      apiKey: opts.apiKey,
      type: handler.taskType,
      websiteURL: page.url(),
      websiteKey: extraction.websiteKey,
      data: extraction.data,
      metadata: extraction.metadata,
      geetest: extraction.geetest,
      enterprise: extraction.enterprise,
      enterprisePayload: extraction.enterprisePayload,
      userAgent: opts.family?.userAgent ?? extraction.userAgent,
      isInvisible: extraction.isInvisible,
      proxy: opts.proxy,
      taskExtra: extraction.taskExtra,
    })

    const solution = await pollTaskResult(opts.apiKey, taskId, { timeoutMs: 180_000, pollIntervalMs: 3_000 })
    if (!solution) return false

    return handler.inject(page, solution)
  }
}

function buildManualSolver(): SolverFn {
  return async (_page: Page, _challenge: DetectedChallenge) => {
    if (process.env.IDM_CAPTCHA_MANUAL_FALLBACK !== "true") {
      return false
    }
    if (process.platform === "darwin") {
      const proc = Bun.spawn([
        "osascript",
        "-e",
        `display notification "CAPTCHA detected - manual solve needed" with title "IDM Browser"`,
      ])
      await proc.exited
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000))
    return false
  }
}
