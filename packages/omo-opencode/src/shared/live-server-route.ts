import { createOpencodeClient as createOpencodeClientSdk } from "@opencode-ai/sdk"
import { subagentSessions } from "../features/claude-code-session-state/state"
import { getServerBasicAuthHeader, injectServerAuthIntoClient } from "./opencode-server-auth"
import { log } from "./logger"

export const LIVE_ROUTE_DISPATCH_LOG = "[live-server-route] dispatch via live listener"
export const LIVE_ROUTE_UNAVAILABLE_LOG = "[live-server-route] route unavailable; using in-process client"

const PROBE_TTL_MS = 60_000
const PROBE_ABORT_MS = 1_500

type RouteResult = {
  client: unknown
  route: "live" | "in-process"
  reason: "identity" | "flag" | "child" | "unavailable" | "live"
}

let serverUrl: URL | undefined
let inProcessClient: unknown
let liveClient: unknown
let initialized = false

let available: boolean | undefined
let probeTimestamp = 0
let inFlightProbe: Promise<boolean> | undefined
let warnedOnce = false

let liveParentWakeRoutingDisabled = false

type FetchImpl = typeof fetch
let fetchImplementationForTesting: FetchImpl | undefined

export function _setFetchImplementationForTesting(impl: FetchImpl | undefined): void {
  fetchImplementationForTesting = impl
}

function getFetch(): FetchImpl {
  return fetchImplementationForTesting ?? fetch
}

export function _setLiveClientForTesting(client: unknown): void {
  liveClient = client
}

export function setLiveParentWakeRoutingDisabled(disabled: boolean): void {
  liveParentWakeRoutingDisabled = disabled
}

export function isLiveParentWakeRoutingDisabled(): boolean {
  return liveParentWakeRoutingDisabled
}

export function initLiveServerRoute(opts: {
  serverUrl: URL | undefined
  directory: string
  inProcessClient: unknown
}): void {
  serverUrl = opts.serverUrl
  inProcessClient = opts.inProcessClient
  initialized = true
  available = undefined
  probeTimestamp = 0
  inFlightProbe = undefined
  warnedOnce = false
  liveClient = undefined
  log("[live-server-route] registered", { directory: opts.directory, hasServerUrl: !!opts.serverUrl })
}

export function warmLiveServerProbe(): void {
  void probe()
}

async function probe(): Promise<boolean> {
  if (!serverUrl) {
    available = false
    return false
  }

  const probeUrl = new URL("/session", serverUrl)
  const authHeader = getServerBasicAuthHeader()
  const headers: Record<string, string> = authHeader ? { Authorization: authHeader } : {}

  try {
    const controller = new AbortController()
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("probe timeout")), PROBE_ABORT_MS)
    )
    const timeoutId = setTimeout(() => controller.abort(), PROBE_ABORT_MS)
    let response: Response
    try {
      response = await Promise.race([
        getFetch()(probeUrl, { headers, signal: controller.signal }),
        timeoutPromise,
      ])
    } finally {
      clearTimeout(timeoutId)
    }

    if (response.status === 401 || response.status === 403) {
      if (!warnedOnce) {
        warnedOnce = true
        log("[live-server-route] listener requires auth we cannot satisfy; live wake routing disabled")
      }
      available = false
      probeTimestamp = Date.now()
      return false
    }

    available = response.ok
    probeTimestamp = Date.now()
    return available
  } catch {
    available = false
    probeTimestamp = Date.now()
    return false
  }
}

function hasFreshProbe(): boolean {
  return available !== undefined && Date.now() - probeTimestamp < PROBE_TTL_MS
}

async function resolveAvailability(): Promise<boolean> {
  if (hasFreshProbe()) {
    return available!
  }

  if (!inFlightProbe) {
    inFlightProbe = probe().finally(() => {
      inFlightProbe = undefined
    })
  }

  return inFlightProbe
}

function getOrBuildLiveClient(): unknown {
  if (liveClient) {
    return liveClient
  }
  if (!serverUrl) {
    return undefined
  }
  const client = createOpencodeClientSdk({ baseUrl: serverUrl.toString() })
  injectServerAuthIntoClient(client)
  liveClient = client
  return liveClient
}

export async function resolveDispatchClient(client: unknown, sessionID: string): Promise<RouteResult> {
  if (!initialized || client !== inProcessClient) {
    return { client, route: "in-process", reason: "identity" }
  }

  if (liveParentWakeRoutingDisabled) {
    return { client, route: "in-process", reason: "flag" }
  }

  if (subagentSessions.has(sessionID)) {
    return { client, route: "in-process", reason: "child" }
  }

  if (!serverUrl) {
    return { client, route: "in-process", reason: "unavailable" }
  }

  const isAvailable = await resolveAvailability()
  if (!isAvailable) {
    return { client, route: "in-process", reason: "unavailable" }
  }

  const resolvedLiveClient = getOrBuildLiveClient()
  if (!resolvedLiveClient) {
    return { client, route: "in-process", reason: "unavailable" }
  }

  return { client: resolvedLiveClient, route: "live", reason: "live" }
}

export function isPreSendConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  if (error.name === "AbortError") {
    return false
  }

  const CONNECTION_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"])

  const self = error as NodeJS.ErrnoException
  if (self.code && CONNECTION_CODES.has(self.code)) {
    return true
  }

  const cause = (error as { cause?: unknown }).cause
  if (cause && typeof cause === "object" && cause !== null) {
    const causeCode = (cause as NodeJS.ErrnoException).code
    if (causeCode && CONNECTION_CODES.has(causeCode)) {
      return true
    }
  }

  if (error instanceof TypeError) {
    const msg = error.message
    if (msg.includes("fetch failed") || msg.includes("Unable to connect")) {
      return true
    }
  }

  return false
}

export function markLiveRouteUnavailable(reason: string): void {
  available = false
  probeTimestamp = Date.now()
  log(`[live-server-route] marked unavailable: ${reason}`)
}

export function resetLiveServerRouteForTesting(): void {
  serverUrl = undefined
  inProcessClient = undefined
  liveClient = undefined
  initialized = false
  available = undefined
  probeTimestamp = 0
  inFlightProbe = undefined
  warnedOnce = false
  liveParentWakeRoutingDisabled = false
  fetchImplementationForTesting = undefined
}
