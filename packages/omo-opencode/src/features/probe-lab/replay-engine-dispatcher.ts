import type { ProbeLabContext } from "./probe-lab-context"
import type { ProbeRequest, ProbeResponse } from "./providers/provider-types"
import type { FingerprintProfile, ProbeExchange } from "./types"
import { createCamoufoxDriver } from "./replay-engine-camoufox-driver"
import { createCurlCffiDriver } from "./replay-engine-curl-cffi-driver"

export type ReplayEngine = "bun_fetch" | "camoufox" | "curl_cffi" | "nodriver" | "go_utls" | "custom"

export type ReplayResult = {
  status: number
  headers: Record<string, string>
  body: string
  timing_ms: number
}

export type ReplayDispatchInput = {
  ctx: ProbeLabContext
  original: ProbeExchange
  sessionId: string
  headers: Record<string, string>
  body: string | Uint8Array | null
  fingerprintProfileId?: string
}

export async function dispatchReplay(
  input: ReplayDispatchInput,
): Promise<ReplayResult> {
  const engine = resolveEngine(input.ctx, input.fingerprintProfileId)
  if (engine === "camoufox") return dispatchCamoufox(input)
  if (engine === "curl_cffi") return dispatchCurlCffi(input)
  if (engine === "nodriver" || engine === "go_utls" || engine === "custom") {
    throw new Error(`engine '${engine}' deferred to v1.0`)
  }
  return dispatchBunFetch(input)
}

function resolveEngine(ctx: ProbeLabContext, fingerprintProfileId?: string): ReplayEngine {
  if (!fingerprintProfileId) return "bun_fetch"
  const profile = ctx.store.getFingerprintProfile(fingerprintProfileId) as FingerprintProfile | null
  if (!profile) throw new Error(`fingerprint profile not found: ${fingerprintProfileId}`)
  return (profile.engine as ReplayEngine) ?? "bun_fetch"
}

async function dispatchBunFetch(input: ReplayDispatchInput): Promise<ReplayResult> {
  const session = input.ctx.store.getSession(input.original.session_id)
  const started = performance.now()
  if (session?.provider_id) {
    input.ctx.providerRegistry.loadAll()
    const provider = input.ctx.providerRegistry.get(session.provider_id)
    if (!provider) throw new Error(`provider not found: ${session.provider_id}`)
    return fromProvider(await provider.dispatchProbe(toProviderRequest(input)))
  }
  const fetchBody = toBunFetchBody(input.body)
  const res = await fetch(input.original.url, { method: input.original.method, headers: input.headers, body: fetchBody })
  return { status: res.status, headers: headersToRecord(res.headers), body: await res.text(), timing_ms: Math.round(performance.now() - started) }
}

async function dispatchCamoufox(input: ReplayDispatchInput): Promise<ReplayResult> {
  const driver = getCamoufoxDriver()
  return driver({ url: input.original.url, method: input.original.method, headers: input.headers, body: input.body })
}

async function dispatchCurlCffi(input: ReplayDispatchInput): Promise<ReplayResult> {
  const driver = getCurlCffiDriver()
  return driver({ url: input.original.url, method: input.original.method, headers: input.headers, body: input.body })
}

export async function dispatchViaCurlCffi(req: { url: string; method: string; headers: Record<string, string>; body: string | Uint8Array | null; proxy?: string | null }): Promise<ReplayResult> {
  return getCurlCffiDriver()(req)
}

export async function dispatchViaCamoufox(req: { url: string; method: string; headers: Record<string, string>; body: string | Uint8Array | null; proxy?: string | null }): Promise<ReplayResult> {
  return getCamoufoxDriver()(req)
}

export type EngineDriver = (req: { url: string; method: string; headers: Record<string, string>; body: string | Uint8Array | null; proxy?: string | null }) => Promise<ReplayResult>

let camoufoxDriver: EngineDriver | null = null
let curlCffiDriver: EngineDriver | null = null
let camoufoxAutoTried = false
let curlCffiAutoTried = false

export function __setCamoufoxDriverForTest(driver: EngineDriver | null): void {
  camoufoxDriver = driver
  camoufoxAutoTried = false
}

export function __setCurlCffiDriverForTest(driver: EngineDriver | null): void {
  curlCffiDriver = driver
  curlCffiAutoTried = false
}

function getCamoufoxDriver(): EngineDriver {
  if (camoufoxDriver) return camoufoxDriver
  if (process.env.IDM_PROBE_LAB_CAMOUFOX_AUTO === "1" && !camoufoxAutoTried) {
    camoufoxAutoTried = true
    camoufoxDriver = createCamoufoxDriver()
    return camoufoxDriver
  }
  return defaultDeferred("camoufox")
}

function getCurlCffiDriver(): EngineDriver {
  if (curlCffiDriver) return curlCffiDriver
  if (process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO === "1" && !curlCffiAutoTried) {
    curlCffiAutoTried = true
    curlCffiDriver = createCurlCffiDriver()
    return curlCffiDriver
  }
  return defaultDeferred("curl_cffi")
}

function defaultDeferred(engine: string): EngineDriver {
  const setterName = engine === "camoufox" ? "__setCamoufoxDriverForTest" : "__setCurlCffiDriverForTest"
  return async () => {
    throw new Error(
      `engine '${engine}' requires a production driver registration. v1.0 ships the adapter shell + mock-test seam; production driver wiring is operator-side. Register a driver via ${setterName}() at runtime (see src/features/probe-lab/SKILL.md \"Production driver wiring\" section).`,
    )
  }
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}

function toProviderRequest(input: ReplayDispatchInput): ProbeRequest {
  return { url: input.original.url, method: input.original.method, headers: input.headers, body: input.body ?? undefined, timeout_ms: 30_000, forward_as_is: true, metadata: { session_id: input.sessionId, exchange_sequence: 1 } }
}

function fromProvider(response: ProbeResponse): ReplayResult {
  return { status: response.status, headers: response.headers, body: response.body, timing_ms: response.timing.total_ms }
}

function toBunFetchBody(body: string | Uint8Array | null): BodyInit | undefined {
  if (body == null) return undefined
  if (typeof body === "string") return body
  const ab = new ArrayBuffer(body.byteLength)
  new Uint8Array(ab).set(body)
  return new Blob([ab])
}
