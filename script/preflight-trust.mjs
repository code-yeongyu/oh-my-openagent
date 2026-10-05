import { setTimeout } from "node:timers/promises"
import { pathToFileURL } from "node:url"

const ATTEMPTS = 6
const MAX_DELAY_MS = 30_000
const CONFIG_STATUSES = new Set([400, 401, 403])

// npm exchanges return credentials on success. Only failure bodies are diagnostic,
// and credential-shaped values must never reach Actions annotations.
function safeDetail(text) {
  return text.replace(/"(?:token|access_token|id_token|value)"\s*:\s*"[^"]*"/gi, '"credential":"[redacted]"')
    .replace(/\b(?:npm_[A-Za-z0-9]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, "[redacted]")
    .replace(/[\r\n\x00-\x1f]/g, " ").slice(0, 2000)
}

export async function requestWithRetry(label, url, init, { request = fetch, sleep = setTimeout, log = console.error } = {}) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let response
    let detail
    let status
    let transient
    let configuration = false
    try {
      response = await request(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) })
      if (response.ok) return response
      status = `HTTP ${response.status}`
      detail = safeDetail(await response.text())
      configuration = CONFIG_STATUSES.has(response.status) || (response.status === 404 && /no trusted publisher|trusted publisher[^\n]*(?:not found|not configured|mismatch)/i.test(detail))
      transient = !configuration && ([408, 404, 429].includes(response.status) || response.status >= 500)
    } catch (error) {
      status = `transport ${error.cause?.code ?? error.code ?? error.name}`
      detail = safeDetail(error.cause?.message ?? error.message)
      transient = true
    }
    const diagnostic = `${label} ${status}: ${detail} (attempt ${attempt}/${ATTEMPTS})`
    log(diagnostic)
    if (!transient || attempt === ATTEMPTS) {
      const error = new Error(diagnostic)
      error.configuration = configuration
      throw error
    }
    const retryAfter = Number(response?.headers.get("retry-after")) * 1000
    const backoff = 1000 * 2 ** (attempt - 1)
    await sleep(Math.min(MAX_DELAY_MS, Math.max(backoff, Number.isFinite(retryAfter) ? retryAfter : 0)))
  }
}

export async function verifyPublisher(pkg, token, options = {}) {
  const log = options.log ?? console.error
  try {
    const response = await requestWithRetry(pkg, `https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(pkg)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    }, options)
    // Discard issued credentials without logging or storing them.
    await response.body?.cancel()
    log(`OK ${pkg}`)
  } catch (error) {
    if (error.configuration) {
      log(`Configure https://www.npmjs.com/package/${pkg}/access - Provider: GitHub Actions; Organization: code-yeongyu; Repository: oh-my-openagent; Workflow filename: publish.yml. See docs/reference/omo-ai-publishing.md.`)
    }
    throw error
  }
}

export async function main(packages, env = process.env) {
  if (!packages.length) throw new Error("No release packages selected")
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw new Error("GitHub OIDC request credentials are missing")
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL)
  url.searchParams.set("audience", "npm:registry.npmjs.org")
  const response = await requestWithRetry("GitHub OIDC", url, {
    headers: { Authorization: `bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
  })
  const { value } = await response.json()
  if (typeof value !== "string" || !value) throw new Error("GitHub OIDC HTTP 200: response has no token")
  for (const pkg of packages) await verifyPublisher(pkg, value)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`::error::${error.message}`)
    process.exitCode = 1
  })
}
