import type { BrowserPool } from "../../pool"
import {
  solveCaptchaChain,
  createSolverRegistry,
  resolveCapsolverKey,
  convertBrowserProxyToCapsolver,
  convertBrowserProxyToAntiCaptcha,
  type SolverName,
} from "../../captcha"
import type { CapsolverProxyConfig } from "../../captcha"
import type { AntiCaptchaProxyConfig } from "../../captcha/anti-captcha-types"
import { resolveDs2apiConfig, type ResolveDs2apiConfigOptions } from "../../../../shared"
import { resolveAntiCaptchaKey, type ResolveAntiCaptchaKeyOptions } from "../../../../automation/network/anti-captcha-key"
import { resolveAntiCaptchaProxyUrl, type ResolveAntiCaptchaProxyOptions } from "../../../../automation/network/anti-captcha-proxy"
import { getSessionFamily } from "../../../../automation/fingerprint-binding"
import type { FingerprintFamily } from "../../../../automation/fingerprint"

export type SolveCaptchaParams = {
  sessionId?: string
  accountId?: string
}

export type ResolveSolveCaptchaOptions = ResolveDs2apiConfigOptions & {
  antiCaptcha?: ResolveAntiCaptchaKeyOptions & ResolveAntiCaptchaProxyOptions
}

export function resolveSolveCaptchaRegistryOptions(opts: ResolveSolveCaptchaOptions = {}) {
  const ds2api = resolveDs2apiConfig(opts)
  const antiCaptchaKey = resolveAntiCaptchaKey(opts.antiCaptcha)
  const antiCaptchaProxy = resolveAntiCaptchaProxyUrl(opts.antiCaptcha)
  return {
    visionLlm: {
      baseUrl: ds2api.baseUrl,
      apiKey: ds2api.proxyKey ?? ds2api.adminKey,
      model: ds2api.visionModel,
    },
    capsolverApiKey: resolveCapsolverKey(),
    antiCaptcha: {
      apiKey: antiCaptchaKey,
      proxyUrl: antiCaptchaProxy,
    },
  }
}

export async function handleSolveCaptcha(pool: BrowserPool, params: SolveCaptchaParams) {
  const session = await pool.acquire(params.sessionId)
  const baseOptions = resolveSolveCaptchaRegistryOptions()
  const family = getSessionFamily(session.id)
  const capsolverProxy = convertBrowserProxyToCapsolver(session.proxy)
  const antiCaptchaProxy = await convertBrowserProxyToAntiCaptcha(session.proxy)
  const options = withSessionContext(baseOptions, family, capsolverProxy, antiCaptchaProxy)
  const registry = createSolverRegistry(options)

  const enabledSolvers: SolverName[] = resolveEnabledSolvers(options.antiCaptcha.apiKey, options.capsolverApiKey, capsolverProxy, antiCaptchaProxy)
  const result = await solveCaptchaChain(session.page, enabledSolvers, registry)

  if (!result) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ sessionId: session.id, detected: false }) }],
    }
  }

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ sessionId: session.id, ...result }, null, 2),
    }],
    isError: !result.solved,
  }
}

function resolveEnabledSolvers(
  antiCaptchaKey: string | undefined,
  capsolverKey: string | undefined,
  capsolverProxy: CapsolverProxyConfig | null,
  antiCaptchaProxy: AntiCaptchaProxyConfig | null,
): SolverName[] {
  const base: SolverName[] = ["skip", "vision-llm"]
  if (capsolverProxy && capsolverKey) base.push("capsolver")
  if (antiCaptchaProxy && antiCaptchaKey) base.push("anti-captcha")
  if (process.env.IDM_CAPTCHA_MANUAL_FALLBACK === "true") base.push("manual")
  return base
}

type ResolvedRegistryOptions = ReturnType<typeof resolveSolveCaptchaRegistryOptions>

type SessionAwareRegistryOptions = Omit<ResolvedRegistryOptions, "antiCaptcha"> & {
  antiCaptcha: ResolvedRegistryOptions["antiCaptcha"] & { family?: FingerprintFamily; proxy?: AntiCaptchaProxyConfig }
  capsolver?: { apiKey?: string; family?: FingerprintFamily; proxy?: CapsolverProxyConfig }
}

function withSessionContext(
  opts: ResolvedRegistryOptions,
  family: FingerprintFamily | undefined,
  capsolverProxy: CapsolverProxyConfig | null,
  antiCaptchaProxy: AntiCaptchaProxyConfig | null,
): SessionAwareRegistryOptions {
  return {
    ...opts,
    capsolver: { apiKey: opts.capsolverApiKey, family, proxy: capsolverProxy ?? undefined },
    antiCaptcha: { ...opts.antiCaptcha, family, proxy: antiCaptchaProxy ?? undefined },
  }
}
