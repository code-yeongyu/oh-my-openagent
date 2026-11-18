// The two network lookups the operator-darwin verifier makes (#13921, #13943). Every failure is a typed Refusal,
// so the run ends with one `::error::operator_darwin_artifacts refused: ...` line instead of a crash, and every
// lookup is bounded per call, the response body included (#13964).
import { refuse } from "./operator-darwin-macho.ts"

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

// Apple's public notarization ticket service: the lookup Gatekeeper makes for a bare Mach-O, which cannot carry a
// stapled ticket. The record name is `2/<digest type>/<cdhash>`; sha256 CodeDirectories use digest type 2.
export const TICKET_URL =
  "https://api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery/production/public/records/lookup"

// Each lookup gets this long, reading the body included, so a stalled connection cannot hold the job for hours.
const LOOKUP_TIMEOUT_MS = 30_000

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}

type Answer = { readonly status: number; readonly ok: boolean; readonly body: Record<string, unknown> }

/**
 * One bounded request: headers AND body must arrive within `timeoutMs`. The abort is checked before any other
 * failure, so a stall anywhere is refused as "did not answer within <n> ms", never as a parse error.
 */
async function boundedJson(
  fetcher: Fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  service: string,
  subject: string,
): Promise<Answer> {
  const signal = AbortSignal.timeout(timeoutMs)
  const late = () => refuse(`${service} did not answer within ${timeoutMs} ms for ${subject}`)
  let response: Response
  try {
    response = await fetcher(url, { ...init, signal })
  } catch {
    return signal.aborted ? late() : refuse(`could not reach ${service} for ${subject}`)
  }
  let text: string
  try {
    text = await response.text()
  } catch {
    return signal.aborted ? late() : refuse(`${service} broke off its answer for ${subject}`)
  }
  if (signal.aborted) late()
  if (!response.ok) return { status: response.status, ok: false, body: {} }
  try {
    return { status: response.status, ok: true, body: record(JSON.parse(text)) }
  } catch {
    return refuse(`${service} returned no JSON (HTTP ${response.status}) for ${subject}`)
  }
}

/**
 * True when Apple serves a notarization ticket for exactly this cdhash; false when it answers that none exists.
 * Any other answer (network failure, timeout, HTTP error, a reply about another record) is refused.
 */
export function ticketLookup(
  fetcher: Fetch = fetch,
  timeoutMs = LOOKUP_TIMEOUT_MS,
): (cdhash: string) => Promise<boolean> {
  return async (cdhash) => {
    const recordName = `2/2/${cdhash}`
    const service = "Apple's notarization ticket service"
    const answer = await boundedJson(
      fetcher,
      TICKET_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ records: [{ recordName }] }),
      },
      timeoutMs,
      service,
      `cdhash ${cdhash}`,
    )
    if (!answer.ok) refuse(`${service} answered HTTP ${answer.status} for cdhash ${cdhash}`)
    const records = Array.isArray(answer.body.records) ? answer.body.records.map(record) : []
    const first = records[0]
    if (records.length !== 1 || first?.recordName !== recordName)
      refuse(`${service} did not answer for record ${recordName}`)
    if (first.serverErrorCode === "NOT_FOUND") return false
    if (first.serverErrorCode !== undefined)
      refuse(`${service} answered ${String(first.serverErrorCode)} for cdhash ${cdhash}`)
    return typeof record(record(first.fields).signedTicket).value === "string"
  }
}

/** The repository role_name of a login; null when GitHub answers without one. A network failure or timeout is refused. */
export function roleLookup(
  repository: string,
  token: string,
  fetcher: Fetch = fetch,
  timeoutMs = LOOKUP_TIMEOUT_MS,
): (login: string) => Promise<string | null> {
  return async (login) => {
    const answer = await boundedJson(
      fetcher,
      `https://api.github.com/repos/${repository}/collaborators/${login}/permission`,
      { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } },
      timeoutMs,
      "GitHub's collaborator permission API",
      login,
    )
    const role = answer.body.role_name
    return answer.ok && typeof role === "string" ? role : null
  }
}
