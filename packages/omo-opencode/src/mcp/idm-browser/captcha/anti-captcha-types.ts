export type AntiCaptchaTaskType =
  | "HCaptchaTask"
  | "HCaptchaEnterpriseTask"
  | "RecaptchaV2Task"
  | "RecaptchaV2EnterpriseTask"
  | "RecaptchaV3Task"
  | "TurnstileTask"
  | "FunCaptchaTask"
  | "GeeTestTask"
  | "AntiBotCookieTask"

export type AntiCaptchaProxyConfig = {
  proxyType: "http" | "https" | "socks4" | "socks5"
  proxyAddress: string
  proxyPort: number
  proxyLogin?: string
  proxyPassword?: string
}

export type AntiCaptchaSolution = {
  gRecaptchaResponse?: string
  token?: string
  userAgent?: string
  respKey?: string
  challenge?: string
  validate?: string
  seccode?: string
  captchaId?: string
  lotNumber?: string
  passToken?: string
  genTime?: string
  cookies?: Array<{ name: string; value: string }>
}

export type AntiCaptchaCreateTaskInput = {
  apiKey: string
  type: AntiCaptchaTaskType
  websiteURL: string
  websiteKey?: string
  isInvisible?: boolean
  userAgent?: string
  enterprisePayload?: Record<string, unknown>
  recaptchaDataSValue?: string
  pageAction?: string
  minScore?: number
  funcaptchaApiJSSubdomain?: string
  data?: string
  proxy?: AntiCaptchaProxyConfig
  cookies?: string
  geetest?: { challenge?: string; gt?: string; geetestApiServerSubdomain?: string; version?: 3 | 4; initParameters?: Record<string, unknown> }
  proxyUrl?: string
}

export type AntiCaptchaCreateTaskResponse = {
  errorId: number
  errorCode?: string
  errorDescription?: string
  taskId?: string | number
}

export type AntiCaptchaTaskResultResponse = {
  errorId: number
  errorCode?: string
  errorDescription?: string
  status?: "ready" | "processing"
  solution?: AntiCaptchaSolution
  cost?: string
  ip?: string
  createTime?: number
  endTime?: number
  solveCount?: number
}

export type AntiCaptchaBalanceResponse = {
  errorId: number
  errorCode?: string
  errorDescription?: string
  balance?: number
}

export type AntiCaptchaPollOptions = {
  apiKey: string
  taskId: string | number
  proxyUrl?: string
  timeoutMs?: number
  pollIntervalMs?: number
}
