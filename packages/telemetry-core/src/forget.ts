import type { TelemetryEnv } from "./types"

/** The first-party collector. `OMO_TELEMETRY_ENDPOINT` overrides it, as it does for the OTLP sender. */
export const DEFAULT_TELEMETRY_COLLECTOR_ENDPOINT = "https://t.omo.dev"

const FORGET_PATH = "/v1/forget"
const FORGET_TIMEOUT_MS = 10_000
const HEX_64 = /^[0-9a-f]{64}$/

export type RequestTelemetryForgetInput = {
  /** The random 64-hex install id; possession of it is what authorizes the deletion. */
  readonly installId: string
  /**
   * The PostHog distinct id this install sent before the collector existed. History imported from
   * PostHog is matched only by it, so the collector's forget job needs it to reach those rows.
   */
  readonly legacyDistinctId?: string
  readonly env?: TelemetryEnv
  readonly fetchFn?: typeof fetch
  readonly timeoutMs?: number
}

export type TelemetryForgetResult =
  | { readonly status: "sent"; readonly httpStatus: number; readonly response: unknown }
  | { readonly status: "skipped"; readonly reason: "invalid_install_id" }
  | { readonly status: "failed"; readonly reason: "http"; readonly httpStatus: number; readonly response: unknown }
  | { readonly status: "failed"; readonly reason: "network" }

export function resolveTelemetryCollectorEndpoint(env: TelemetryEnv): string {
  const override = env["OMO_TELEMETRY_ENDPOINT"]?.trim()
  const base = override !== undefined && override.length > 0 ? override : DEFAULT_TELEMETRY_COLLECTOR_ENDPOINT
  return base.replace(/\/+$/, "")
}

/**
 * Ask the collector to forget this install (plan D-N: `POST /v1/forget`, plain JSON).
 *
 * This is an explicit deletion request, not telemetry, so the opt-out variables do not block it: a
 * user who opted out must still be able to delete what was sent before. Opting out never sends one.
 * Neither id is logged or sent anywhere else; a missing or malformed install id sends nothing, and a
 * legacy id that is not a 64-hex distinct id is dropped rather than sent.
 */
export async function requestTelemetryForget(input: RequestTelemetryForgetInput): Promise<TelemetryForgetResult> {
  if (!HEX_64.test(input.installId)) return { status: "skipped", reason: "invalid_install_id" }

  const body: { install_id: string; legacy_distinct_id?: string } = { install_id: input.installId }
  if (input.legacyDistinctId !== undefined && HEX_64.test(input.legacyDistinctId)) {
    body.legacy_distinct_id = input.legacyDistinctId
  }

  const fetchFn = input.fetchFn ?? fetch
  let response: Response
  try {
    response = await fetchFn(`${resolveTelemetryCollectorEndpoint(input.env ?? process.env)}${FORGET_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(input.timeoutMs ?? FORGET_TIMEOUT_MS),
    })
  } catch {
    // The caller reports the failure; the error text may echo the request, so it is not kept.
    return { status: "failed", reason: "network" }
  }

  const parsed = await readJson(response)
  return response.ok
    ? { status: "sent", httpStatus: response.status, response: parsed }
    : { status: "failed", reason: "http", httpStatus: response.status, response: parsed }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    // A non-JSON body carries nothing the caller can print; the status alone is the outcome.
    return undefined
  }
}
