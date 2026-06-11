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

type RouteRegistration = {
  serverUrl: URL | undefined
  liveClient: unknown
  available: boolean | undefined
  probeTimestamp: number
  inFlightProbe: Promise<boolean> | undefined
  warnedOnce: boolean
}

const registrations = new Map<unknown, RouteRegistration>()
let lastRegistration: RouteRegistration | undefined

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
  if (lastRegistration) {
    lastRegistration.liveClient = client
  }
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
  const registration: RouteRegistration = {
    serverUrl: opts.serverUrl,
    liveClient: undefined,
    available: undefined,
    probeTimestamp: 0,
    inFlightProbe: undefined,
    warnedOnce: false,
  }
  registrations.set(opts.inProcessClient, registration)
  lastRegistration = registration
  log("[live-server-route] registered", {
    directory: opts.directory,
    hasServerUrl: !!opts.serverUrl,
    registrationCount: registrations.size,
  })
}

export function warmLiveServerProbe(): void {
  if (lastRegistration) {
    void probe(lastRegistration)
  }
}

async function probe(registration: RouteRegistration): Promise<boolean> {
  if (!registration.serverUrl) {
    registration.available = false
    return false
  }

  const probeUrl = new URL("/session", registration.serverUrl)
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
      if (!registration.warnedOnce) {
        registration.warnedOnce = true
        log("[live-server-route] listener requires auth we cannot satisfy; live wake routing disabled")
      }
      registration.available = false
      registration.probeTimestamp = Date.now()
      return false
    }

    registration.available = response.ok
    registration.probeTimestamp = Date.now()
    return registration.available
  } catch {
    registration.available = false
    registration.probeTimestamp = Date.now()
    return false
  }
}

function hasFreshProbe(registration: RouteRegistration): boolean {
  return registration.available !== undefined && Date.now() - registration.probeTimestamp < PROBE_TTL_MS
}

async function resolveAvailability(registration: RouteRegistration): Promise<boolean> {
  if (hasFreshProbe(registration)) {
    return registration.available!
  }

  if (!registration.inFlightProbe) {
    registration.inFlightProbe = probe(registration).finally(() => {
      registration.inFlightProbe = undefined
    })
  }

  return registration.inFlightProbe
}

function getOrBuildLiveClient(registration: RouteRegistration): unknown {
  if (registration.liveClient) {
    return registration.liveClient
  }
  if (!registration.serverUrl) {
    return undefined
  }
  const client = createOpencodeClientSdk({ baseUrl: registration.serverUrl.toString() })
  injectServerAuthIntoClient(client)
  registration.liveClient = client
  return registration.liveClient
}

export function tryResolveDispatchClientSync(client: unknown, sessionID: string): RouteResult | undefined {
  const registration = registrations.get(client)
  if (!registration) {
    return { client, route: "in-process", reason: "identity" }
  }

  if (liveParentWakeRoutingDisabled) {
    return { client, route: "in-process", reason: "flag" }
  }

  if (subagentSessions.has(sessionID)) {
    return { client, route: "in-process", reason: "child" }
  }

  if (!registration.serverUrl) {
    return { client, route: "in-process", reason: "unavailable" }
  }

  if (!hasFreshProbe(registration)) {
    return undefined
  }

  if (!registration.available) {
    return { client, route: "in-process", reason: "unavailable" }
  }

  const resolvedLiveClient = getOrBuildLiveClient(registration)
  if (!resolvedLiveClient) {
    return { client, route: "in-process", reason: "unavailable" }
  }

  return { client: resolvedLiveClient, route: "live", reason: "live" }
}

export async function resolveDispatchClient(client: unknown, sessionID: string): Promise<RouteResult> {
  const syncResult = tryResolveDispatchClientSync(client, sessionID)
  if (syncResult) {
    return syncResult
  }

  const registration = registrations.get(client)!
  const isAvailable = await resolveAvailability(registration)
  if (!isAvailable) {
    return { client, route: "in-process", reason: "unavailable" }
  }

  const resolvedLiveClient = getOrBuildLiveClient(registration)
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
  for (const registration of registrations.values()) {
    registration.available = false
    registration.probeTimestamp = Date.now()
  }
  log(`[live-server-route] marked unavailable: ${reason}`)
}

export function resetLiveServerRouteForTesting(): void {
  registrations.clear()
  lastRegistration = undefined
  liveParentWakeRoutingDisabled = false
  fetchImplementationForTesting = undefined
}
