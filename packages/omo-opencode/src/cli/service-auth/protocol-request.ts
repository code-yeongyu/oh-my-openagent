import { refuseIfLocalOnly } from "@oh-my-opencode/device-service-core/local-only"
import { z } from "zod"
import { ApiRefusal, limitSchema, nonempty, RequestFailure, SignInError } from "./protocol"

// The service's one HTTP entry point (fetch), kept apart from the credential schemas in protocol.ts so a module that
// only reads or validates credentials never reaches the network.

class InvalidApiResponse extends SignInError {
  constructor(readonly status: number) {
    super("The service returned an invalid error response.")
  }
}

const envelopeSchema = z.object({
  error: z.object({
    code: nonempty,
    message: z.string(),
    retryable: z.boolean(),
    requestId: z.string(),
    detail: z.unknown().optional(),
  }),
})

export async function requestApi(api: string, path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  refuseIfLocalOnly("service-auth/protocol-request.ts requestApi")
  let response: Response
  let body: unknown
  try {
    response = await fetch(`${api}${path}`, {
      ...init,
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    })
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error
    const code: unknown = cause instanceof Error ? Reflect.get(cause, "code") : undefined
    // Certificate checks and explicitly connect/handshake-phase failures precede HTTP.
    // Generic resets and timeouts do not prove which phase failed.
    throw new RequestFailure(
      typeof code === "string" &&
        [
          "ENOTFOUND",
          "ECONNREFUSED",
          "ENETUNREACH",
          "EHOSTUNREACH",
          "EAI_AGAIN",
          "ConnectionRefused",
          "EADDRNOTAVAIL",
          "ENETDOWN",
          "EHOSTDOWN",
          "UND_ERR_CONNECT_TIMEOUT",
          "ERR_TLS_HANDSHAKE_TIMEOUT",
          "DEPTH_ZERO_SELF_SIGNED_CERT",
          "CERT_HAS_EXPIRED",
          "ERR_TLS_CERT_ALTNAME_INVALID",
          "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
          "SELF_SIGNED_CERT_IN_CHAIN",
          "CERT_NOT_YET_VALID",
          "UNABLE_TO_GET_ISSUER_CERT",
          "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
          "CERT_SIGNATURE_FAILURE",
          "CERT_UNTRUSTED",
          "CERT_REJECTED",
        ].includes(code),
    )
  }
  if (response.status === 204) return null
  try {
    body = await response.json()
  } catch {
    throw new RequestFailure(false, response.status)
  }
  if (response.ok) return body
  const envelope = envelopeSchema.safeParse(body)
  if (!envelope.success) throw new InvalidApiResponse(response.status)
  const error = envelope.data.error
  const detail = limitSchema.safeParse(error.detail)
  throw new ApiRefusal(
    error.code,
    response.status,
    error.code === "entitlement_required" && detail.success ? detail.data : undefined,
    response.headers.get("retry-after"),
  )
}
