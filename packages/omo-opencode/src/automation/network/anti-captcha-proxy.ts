export type ResolveAntiCaptchaProxyOptions = {
  env?: Record<string, string | undefined>
  endpoint?: string
}

export function resolveAntiCaptchaProxyUrl(opts: ResolveAntiCaptchaProxyOptions = {}): string | undefined {
  const env = opts.env ?? process.env
  const endpoint = opts.endpoint ?? "pr.oxylabs.io:7777"

  const explicit = env.ANTI_CAPTCHA_PROXY_URL?.trim()
  if (explicit) return explicit

  const auth = env.OXYLABS_AUTH?.trim()
  if (!auth) return undefined
  const sepIdx = auth.indexOf(":")
  if (sepIdx < 1 || sepIdx === auth.length - 1) return undefined
  const user = auth.slice(0, sepIdx)
  const pass = auth.slice(sepIdx + 1)
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${endpoint}`
}
