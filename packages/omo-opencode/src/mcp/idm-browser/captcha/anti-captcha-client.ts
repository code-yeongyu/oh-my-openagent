import type {
  AntiCaptchaCreateTaskInput,
  AntiCaptchaCreateTaskResponse,
  AntiCaptchaTaskResultResponse,
  AntiCaptchaBalanceResponse,
  AntiCaptchaSolution,
  AntiCaptchaPollOptions,
} from "./anti-captcha-types"

const ANTI_CAPTCHA_BASE = "https://api.anti-captcha.com"

type FetchInitWithProxy = RequestInit & { proxy?: string }

function buildFetchInit(body: Record<string, unknown>, proxyUrl?: string): FetchInitWithProxy {
  const init: FetchInitWithProxy = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
  if (proxyUrl) init.proxy = proxyUrl
  return init
}

export async function createAntiCaptchaTask(input: AntiCaptchaCreateTaskInput): Promise<string> {
  const taskBody = buildTaskBody(input)
  const init = buildFetchInit({ clientKey: input.apiKey, task: taskBody }, input.proxyUrl)
  const res = await fetch(`${ANTI_CAPTCHA_BASE}/createTask`, init)
  const body = (await res.json().catch(() => ({}))) as AntiCaptchaCreateTaskResponse
  if (body.errorId !== 0 || body.taskId === undefined) {
    const code = body.errorCode ?? `HTTP_${res.status}`
    const desc = body.errorDescription ?? "(no body)"
    throw new Error(`anti-captcha createTask: ${code} ${desc}`)
  }
  return String(body.taskId)
}

function buildTaskBody(input: AntiCaptchaCreateTaskInput): Record<string, unknown> {
  const task: Record<string, unknown> = {
    type: input.type,
    websiteURL: input.websiteURL,
  }
  if (input.websiteKey !== undefined) task.websiteKey = input.websiteKey
  if (input.isInvisible !== undefined) task.isInvisible = input.isInvisible
  if (input.userAgent !== undefined) task.userAgent = input.userAgent
  if (input.enterprisePayload !== undefined) task.enterprisePayload = input.enterprisePayload
  if (input.recaptchaDataSValue !== undefined) task.recaptchaDataSValue = input.recaptchaDataSValue
  if (input.pageAction !== undefined) task.pageAction = input.pageAction
  if (input.minScore !== undefined) task.minScore = input.minScore
  if (input.funcaptchaApiJSSubdomain !== undefined) task.funcaptchaApiJSSubdomain = input.funcaptchaApiJSSubdomain
  if (input.data !== undefined) task.data = input.data
  if (input.cookies !== undefined) task.cookies = input.cookies
  if (input.proxy) Object.assign(task, input.proxy)
  if (input.geetest) {
    if (input.geetest.challenge) task.challenge = input.geetest.challenge
    if (input.geetest.gt) task.gt = input.geetest.gt
    if (input.geetest.geetestApiServerSubdomain) task.geetestApiServerSubdomain = input.geetest.geetestApiServerSubdomain
    if (input.geetest.version) task.version = input.geetest.version
    if (input.geetest.initParameters) task.initParameters = input.geetest.initParameters
  }
  return task
}

export async function pollAntiCaptchaTaskResult(opts: AntiCaptchaPollOptions): Promise<AntiCaptchaSolution | undefined> {
  const timeout = opts.timeoutMs ?? 120_000
  const interval = opts.pollIntervalMs ?? 4_000
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const init = buildFetchInit({ clientKey: opts.apiKey, taskId: opts.taskId }, opts.proxyUrl)
    const res = await fetch(`${ANTI_CAPTCHA_BASE}/getTaskResult`, init)
    const body = (await res.json().catch(() => ({}))) as AntiCaptchaTaskResultResponse
    if (body.errorId !== 0) {
      const code = body.errorCode ?? `HTTP_${res.status}`
      const desc = body.errorDescription ?? "(no body)"
      throw new Error(`anti-captcha getTaskResult: ${code} ${desc}`)
    }
    if (body.status === "ready" && body.solution) return body.solution
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`anti-captcha: timeout after ${timeout}ms (taskId=${opts.taskId})`)
}

export type GetBalanceOptions = {
  apiKey: string
  proxyUrl?: string
}

export async function getAntiCaptchaBalance(opts: GetBalanceOptions): Promise<number> {
  const init = buildFetchInit({ clientKey: opts.apiKey }, opts.proxyUrl)
  const res = await fetch(`${ANTI_CAPTCHA_BASE}/getBalance`, init)
  const body = (await res.json().catch(() => ({}))) as AntiCaptchaBalanceResponse
  if (body.errorId !== 0 || body.balance === undefined) {
    const code = body.errorCode ?? `HTTP_${res.status}`
    const desc = body.errorDescription ?? "(no body)"
    throw new Error(`anti-captcha getBalance: ${code} ${desc}`)
  }
  return body.balance
}
