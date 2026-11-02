import { describe, expect, test } from "bun:test"
import { isRetryableModelError, shouldRetryError } from "./model-error-classifier"
import { classifyRuntimeFallbackError, isRuntimeFallbackRetryableError } from "./runtime-fallback-error-classifier"

const RUNTIME_RETRY_ON_ERRORS = [429, 500, 502, 503, 504] as const

type ErrorInfo = { readonly name?: string; readonly message?: string; readonly statusCode?: number }

const TEMPORARY_LIMITS: ReadonlyArray<readonly [string, ErrorInfo]> = [
  ["OpenCode Go monthly limit (#8296)", { statusCode: 429, message: "Monthly usage limit reached. It will reset in 2 days 8 hours" }],
  ["Z.AI weekly/monthly exhaustion (#7161)", { name: "AI_APICallError", message: "Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-09-30 00:00:00" }],
  ["Anthropic subscription session limit", { message: "You've hit your session limit · resets 3pm (Asia/Seoul)" }],
  ["Anthropic subscription weekly limit", { message: "You've hit your weekly limit · resets 5am (Asia/Seoul)" }],
  ["Anthropic subscription 5-hour limit", { message: "5-hour limit reached ∙ resets 3pm" }],
  ["Anthropic subscription model weekly limit", { message: "You've hit your Fable weekly limit · resets Oct 2, 9am" }],
  ["Claude usage limit marker", { message: "Claude AI usage limit reached|1759075200" }],
  ["Codex usage_limit_reached body", { name: "AI_APICallError", message: '{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached"}}' }],
  ["Copilot quota 429", { statusCode: 429, message: "GitHub Copilot quota exceeded (HTTP 429): the plan's included usage or its additional-usage limit is used up, so premium models are refused until it resets or the limit is raised." }],
  ["GLM daily call limit", { statusCode: 429, message: "Daily call limit for this API key has been reached. Limit will reset at midnight UTC." }],
  ["GLM account in arrears", { statusCode: 429, message: "Your account is in arrears, please recharge and try again." }],
  ["quota reset window", { message: "quota will reset after 1 hour" }],
  ["billing-period quota", { message: "quota exceeded for this billing period" }],
  ["insufficient credits", { message: "insufficient credits to complete this request" }],
  ["subscription quota", { message: "Subscription quota exceeded. You can continue using free models." }],
  ["QuotaExceededError name", { name: "QuotaExceededError" }],
  ["InsufficientCreditsError name", { name: "InsufficientCreditsError" }],
  ["FreeUsageLimitError name", { name: "FreeUsageLimitError" }],
  ["Zhipu 5-hour cap", { message: "已达到 5 小时的使用上限" }],
  ["localized insufficient quota", { message: "额度不足" }],
  ["localized insufficient balance", { message: "账户余额不足" }],
  ["localized free quota exhausted", { message: "免费额度已耗尽" }],
]

describe("model-error-classifier usage and quota limits", () => {
  for (const [label, error] of TEMPORARY_LIMITS) {
    test(`#given ${label} #when classified #then it advances the fallback chain in both classifiers`, () => {
      //#when
      const modelFallback = shouldRetryError(error)
      const runtimeType = classifyRuntimeFallbackError(error)
      const runtimeFallback = isRuntimeFallbackRetryableError(error, RUNTIME_RETRY_ON_ERRORS)

      //#then
      expect({ modelFallback, runtimeType, runtimeFallback }).toEqual({
        modelFallback: true,
        runtimeType: "quota_exceeded",
        runtimeFallback: true,
      })
    })
  }

  test("#given a rate restriction under a fair-use policy #when classified #then both classifiers advance the chain", () => {
    //#given
    const error = { statusCode: 429, message: "Request blocked under Fair Use Policy. Your request rate has been restricted." }

    //#when
    const results = [isRetryableModelError(error), isRuntimeFallbackRetryableError(error, RUNTIME_RETRY_ON_ERRORS)]

    //#then
    expect(results).toEqual([true, true])
  })

  test("#given a terminal quota the provider marks as permanent #when classified #then both classifiers stop", () => {
    //#given
    const errors = [
      { message: "Terminal quota exhausted for this account. Upgrade the plan to continue." },
      { message: "Hard billing limit reached for this organization." },
    ]

    //#when
    const results = errors.map((error) => [
      shouldRetryError(error),
      classifyRuntimeFallbackError(error),
      isRuntimeFallbackRetryableError(error, RUNTIME_RETRY_ON_ERRORS),
    ])

    //#then
    expect(results).toEqual([
      [false, "abort", false],
      [false, "abort", false],
    ])
  })

  test("#given a context-limit or rejected-credential message #when classified #then it is not read as a usage limit", () => {
    //#given
    const errors = [
      { message: "prompt is too long: context limit reached for this model" },
      { statusCode: 401, message: "Unauthorized" },
    ]

    //#when
    const results = errors.map((error) => [shouldRetryError(error), classifyRuntimeFallbackError(error)])

    //#then
    expect(results).toEqual([
      [false, undefined],
      [false, undefined],
    ])
  })
})
