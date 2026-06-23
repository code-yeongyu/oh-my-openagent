const CAPSOLVER_BASE = "https://api.capsolver.com"

export type CapsolverTaskType =
  | "FunCaptchaTask"
  | "FunCaptchaClassification"
  | "HCaptchaTask"
  | "HCaptchaTurboTask"
  | "HCaptchaEnterpriseTask"
  | "HCaptchaClassification"
  | "ReCaptchaV2Task"
  | "ReCaptchaV2EnterpriseTask"
  | "ReCaptchaV3Task"
  | "ReCaptchaV3EnterpriseTask"
  | "AntiTurnstileTaskProxyless"
  | "AntiCloudflareTask"
  | "AntiAwsWafTask"
  | "DatadomeSliderTask"
  | "GeeTestTask"
  | "GeeTestV4Task"
  | "MtCaptchaTask"
  | "AntiKasadaTask"
  | "AntiAkamaiBMPTask"
  | "AntiAkamaiWebTask"
  | "AntiImpervaTask"
  | "BinanceCaptchaTask"
  | "DuoLingoTask"
  | "FriendlyCaptchaTask"
  | "CyberSiAraTask"
  | "ImageToTextTask"
  | "VisionEngineTask"

export type CapsolverTurnstileMetadata = {
  action?: string
  cdata?: string
}

export type CapsolverGeeTestPayload = {
  challenge?: string
  gt?: string
  geetestApiServerSubdomain?: string
}

export type CapsolverEnterprisePayload = {
  s?: string
  pageAction?: string
  enterprisePayload?: Record<string, unknown>
}

export type CapsolverProxyConfig = {
  proxyType: "http" | "https" | "socks4" | "socks5"
  proxyAddress: string
  proxyPort: number
  proxyLogin?: string
  proxyPassword?: string
}

export type CapsolverCookie = {
  name: string
  value: string
  domain?: string
  path?: string
  expires?: number
  secure?: boolean
  httpOnly?: boolean
  sameSite?: "Strict" | "Lax" | "None"
}

export type CreateTaskInput = {
  apiKey: string
  type: CapsolverTaskType
  websiteURL: string
  websiteKey?: string
  data?: string
  metadata?: CapsolverTurnstileMetadata
  geetest?: CapsolverGeeTestPayload
  enterprise?: CapsolverEnterprisePayload
  enterprisePayload?: Record<string, unknown>
  proxy?: CapsolverProxyConfig
  userAgent?: string
  isInvisible?: boolean
  cookies?: CapsolverCookie[]
  body?: string
  htmlPageBase64?: string
  taskExtra?: Record<string, unknown>
}

export type CreateTaskResponse = {
  errorId: number
  errorCode?: string
  errorDescription?: string
  taskId?: string
}

export type GetTaskResultResponse = {
  errorId: number
  errorCode?: string
  errorDescription?: string
  status?: "ready" | "processing" | "idle" | "failed"
  solution?: {
    token?: string
    gRecaptchaResponse?: string
    cookies?: CapsolverCookie[]
    userAgent?: string
    headers?: Record<string, string>
    challenge?: string
    validate?: string
    seccode?: string
    captcha_id?: string
    captcha_output?: string
    gen_time?: string
    lot_number?: string
    pass_token?: string
    text?: string
  }
}

export async function createTask(input: CreateTaskInput): Promise<string> {
  const taskBody = buildTaskBody(input)
  const res = await fetch(`${CAPSOLVER_BASE}/createTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: input.apiKey, task: taskBody }),
  })
  const body = (await res.json().catch(() => ({}))) as CreateTaskResponse
  if (body.errorId !== 0 || !body.taskId) {
    const code = body.errorCode ?? `HTTP_${res.status}`
    const desc = body.errorDescription ?? "(no body)"
    throw new Error(`capsolver createTask: ${code} ${desc}`)
  }
  return body.taskId
}

function buildTaskBody(input: CreateTaskInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    type: input.type,
    websiteURL: input.websiteURL,
  }
  if (input.websiteKey !== undefined) body.websiteKey = input.websiteKey
  if (input.userAgent !== undefined) body.userAgent = input.userAgent
  if (input.isInvisible !== undefined) body.isInvisible = input.isInvisible
  if (input.proxy) Object.assign(body, input.proxy)
  if (input.cookies !== undefined) body.cookies = input.cookies
  if (input.body !== undefined) body.body = input.body
  if (input.htmlPageBase64 !== undefined) body.htmlPageBase64 = input.htmlPageBase64
  if (input.data !== undefined) body.data = input.data

  if (input.type === "AntiTurnstileTaskProxyless" && input.metadata) {
    const meta: Record<string, string> = {}
    if (input.metadata.action) meta.action = input.metadata.action
    if (input.metadata.cdata) meta.cdata = input.metadata.cdata
    if (Object.keys(meta).length > 0) body.metadata = meta
  }

  if (input.geetest) {
    if (input.geetest.challenge) body.challenge = input.geetest.challenge
    if (input.geetest.gt) body.gt = input.geetest.gt
    if (input.geetest.geetestApiServerSubdomain) {
      body.geetestApiServerSubdomain = input.geetest.geetestApiServerSubdomain
    }
  }

  if (input.enterprise) {
    if (input.enterprise.s) body.s = input.enterprise.s
    if (input.enterprise.pageAction) body.pageAction = input.enterprise.pageAction
    if (input.enterprise.enterprisePayload) {
      body.enterprisePayload = input.enterprise.enterprisePayload
    }
  }

  if (input.enterprisePayload) body.enterprisePayload = input.enterprisePayload

  if (input.taskExtra) Object.assign(body, input.taskExtra)
  return body
}

export async function pollTaskResult(
  apiKey: string,
  taskId: string,
  opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<GetTaskResultResponse["solution"]> {
  const timeout = opts.timeoutMs ?? 180_000
  const interval = opts.pollIntervalMs ?? 3_000
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const res = await fetch(`${CAPSOLVER_BASE}/getTaskResult`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, taskId }),
    })
    const body = (await res.json().catch(() => ({}))) as GetTaskResultResponse
    if (body.errorId !== 0) {
      const code = body.errorCode ?? `HTTP_${res.status}`
      const desc = body.errorDescription ?? "(no body)"
      throw new Error(`capsolver getTaskResult: ${code} ${desc}`)
    }
    if (body.status === "ready" && body.solution) {
      return body.solution
    }
    if (body.status === "failed") {
      throw new Error(`capsolver task failed: ${body.errorCode ?? "no detail"}`)
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`capsolver: timeout after ${timeout}ms (taskId=${taskId})`)
}
