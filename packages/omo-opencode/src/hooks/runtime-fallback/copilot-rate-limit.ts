import { extractStatusCode } from "./error-classifier"
import { isRecord } from "../../shared/record-type-guard"

export const GITHUB_COPILOT_429_MAX_RETRIES = 4

const GITHUB_COPILOT_PROVIDER = "github-copilot"
const BACKOFF_BASE_MS = 1_000
const BACKOFF_MAX_MS = 30_000
const BACKOFF_JITTER_RATIO = 0.25
const COOLDOWN_MS = 5 * 60 * 1_000

export type GitHubCopilotRateLimitState = {
  retryCount: number
  retryNotBefore: number
  cooldownUntil: number
  lastRateLimitAt: number
}

type GitHubCopilotRateLimitInput = {
  readonly error: unknown
  readonly model: string | undefined
  readonly now: number
  readonly random: () => number
}

export type GitHubCopilotRateLimitDecision =
  | { readonly kind: "not-copilot-429" }
  | { readonly kind: "backoff"; readonly delayMs: number; readonly retryCount: number }
  | { readonly kind: "cooldown"; readonly cooldownUntil: number; readonly retryCount: number }

type HeaderAccessor = {
  readonly get: (name: string) => unknown
}

const rateLimitStates = new WeakMap<object, GitHubCopilotRateLimitState>()

export function createGitHubCopilotRateLimitState(): GitHubCopilotRateLimitState {
  return {
    retryCount: 0,
    retryNotBefore: 0,
    cooldownUntil: 0,
    lastRateLimitAt: 0,
  }
}

export function getGitHubCopilotRateLimitState(owner: object): GitHubCopilotRateLimitState {
  const existing = rateLimitStates.get(owner)
  if (existing) return existing

  const state = createGitHubCopilotRateLimitState()
  rateLimitStates.set(owner, state)
  return state
}

export function clearGitHubCopilotRateLimitState(owner: object): void {
  rateLimitStates.delete(owner)
}

export function isGitHubCopilotModel(model: string | undefined): boolean {
  return model?.toLowerCase().startsWith(`${GITHUB_COPILOT_PROVIDER}/`) ?? false
}

function isGitHubCopilotProvider(value: unknown): boolean {
  return typeof value === "string" && value.toLowerCase() === GITHUB_COPILOT_PROVIDER
}

function getNestedRecord(value: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const nested = value?.[key]
  return isRecord(nested) ? nested : undefined
}

function hasGitHubCopilotProvider(error: unknown): boolean {
  if (!isRecord(error)) return false

  const data = getNestedRecord(error, "data")
  const nestedError = getNestedRecord(error, "error")
  const nestedErrorData = getNestedRecord(nestedError, "data")
  return isGitHubCopilotProvider(error.providerID)
    || isGitHubCopilotProvider(data?.providerID)
    || isGitHubCopilotProvider(nestedError?.providerID)
    || isGitHubCopilotProvider(nestedErrorData?.providerID)
}

function isHeaderAccessor(value: unknown): value is HeaderAccessor {
  return isRecord(value) && typeof value.get === "function"
}

function readRetryAfterHeader(headers: unknown): string | number | undefined {
  if (isHeaderAccessor(headers)) {
    const value = headers.get("retry-after")
    if (typeof value === "string" || typeof value === "number") return value
  }

  if (!isRecord(headers)) return undefined

  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== "retry-after") continue
    if (typeof value === "string" || typeof value === "number") return value
  }

  return undefined
}

function getRetryAfterHeader(error: unknown): string | number | undefined {
  if (!isRecord(error)) return undefined

  const data = getNestedRecord(error, "data")
  const response = getNestedRecord(error, "response")
  const nestedError = getNestedRecord(error, "error")
  const nestedErrorData = getNestedRecord(nestedError, "data")
  const nestedErrorResponse = getNestedRecord(nestedError, "response")
  const headerSources = [
    error.headers,
    data?.headers,
    response?.headers,
    nestedError?.headers,
    nestedErrorData?.headers,
    nestedErrorResponse?.headers,
  ]

  for (const headers of headerSources) {
    const retryAfter = readRetryAfterHeader(headers)
    if (retryAfter !== undefined) return retryAfter
  }

  return undefined
}

export function parseGitHubCopilotRetryAfterMs(error: unknown, now: number): number | undefined {
  const retryAfter = getRetryAfterHeader(error)
  if (typeof retryAfter === "number") {
    return Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.ceil(retryAfter * 1_000) : undefined
  }
  if (typeof retryAfter !== "string") return undefined

  const trimmed = retryAfter.trim()
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number.parseFloat(trimmed)
    return Number.isFinite(seconds) ? Math.ceil(seconds * 1_000) : undefined
  }

  const retryAt = Date.parse(trimmed)
  return Number.isNaN(retryAt) ? undefined : Math.max(0, retryAt - now)
}

function normalizeRandom(random: number): number {
  if (!Number.isFinite(random)) return 0
  return Math.min(1, Math.max(0, random))
}

function getBackoffDelayMs(retryCount: number, retryAfterMs: number | undefined, random: number): number {
  const exponentialDelayMs = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (retryCount - 1))
  const jitterMs = Math.floor(exponentialDelayMs * BACKOFF_JITTER_RATIO * normalizeRandom(random))
  return Math.max(retryAfterMs ?? 0, exponentialDelayMs) + jitterMs
}

export function isGitHubCopilotRateLimitCooldown(state: GitHubCopilotRateLimitState, now: number): boolean {
  return state.cooldownUntil > now
}

export function isGitHubCopilotRetryPending(
  state: GitHubCopilotRateLimitState,
  model: string | undefined,
  now: number,
): boolean {
  return isGitHubCopilotModel(model) && state.retryNotBefore > now
}

export function filterGitHubCopilotModelsInCooldown(
  fallbackModels: readonly string[],
  state: GitHubCopilotRateLimitState,
  now: number,
): string[] {
  if (!isGitHubCopilotRateLimitCooldown(state, now)) return [...fallbackModels]
  return fallbackModels.filter((model) => !isGitHubCopilotModel(model))
}

export function applyGitHubCopilotRateLimit(
  state: GitHubCopilotRateLimitState,
  input: GitHubCopilotRateLimitInput,
): GitHubCopilotRateLimitDecision {
  if (extractStatusCode(input.error, [429]) !== 429 || (!isGitHubCopilotModel(input.model) && !hasGitHubCopilotProvider(input.error))) {
    return { kind: "not-copilot-429" }
  }

  const retryAfterMs = parseGitHubCopilotRetryAfterMs(input.error, input.now)
  if (isGitHubCopilotRateLimitCooldown(state, input.now)) {
    return { kind: "cooldown", cooldownUntil: state.cooldownUntil, retryCount: state.retryCount }
  }

  if (input.now - state.lastRateLimitAt >= COOLDOWN_MS) {
    state.retryCount = 0
  }
  state.lastRateLimitAt = input.now

  if (state.retryCount >= GITHUB_COPILOT_429_MAX_RETRIES) {
    const cooldownMs = Math.max(COOLDOWN_MS, retryAfterMs ?? 0)
    state.cooldownUntil = Math.max(state.cooldownUntil, input.now + cooldownMs)
    state.retryNotBefore = state.cooldownUntil
    return { kind: "cooldown", cooldownUntil: state.cooldownUntil, retryCount: state.retryCount }
  }

  state.retryCount += 1
  const backoffDelayMs = getBackoffDelayMs(state.retryCount, retryAfterMs, input.random())
  state.retryNotBefore = Math.max(state.retryNotBefore, input.now + backoffDelayMs)
  return {
    kind: "backoff",
    delayMs: state.retryNotBefore - input.now,
    retryCount: state.retryCount,
  }
}

type GitHubCopilotRetryWaitInput = {
  readonly state: GitHubCopilotRateLimitState
  readonly model: string
  readonly sessionID: string
  readonly sessionRetryInFlight: Set<string>
}

export async function waitForGitHubCopilotRetry(input: GitHubCopilotRetryWaitInput): Promise<boolean> {
  const delayMs = isGitHubCopilotModel(input.model)
    ? Math.max(0, input.state.retryNotBefore - Date.now())
    : 0
  if (delayMs === 0) return true
  if (input.sessionRetryInFlight.has(input.sessionID)) return false

  input.sessionRetryInFlight.add(input.sessionID)
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
    return true
  } finally {
    input.sessionRetryInFlight.delete(input.sessionID)
  }
}
