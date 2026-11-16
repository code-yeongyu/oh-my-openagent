// The two network lookups the operator-darwin verifier makes (#13921, #13943). Every failure is a typed Refusal,
// so the run ends with one `::error::operator_darwin_artifacts refused: ...` line instead of a crash.
import { refuse } from "./operator-darwin-macho.ts"

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

// Apple's public notarization ticket service: the lookup Gatekeeper makes for a bare Mach-O, which cannot carry a
// stapled ticket. The record name is `2/<digest type>/<cdhash>`; sha256 CodeDirectories use digest type 2.
export const TICKET_URL =
  "https://api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery/production/public/records/lookup"

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}

async function json(response: Response, what: string): Promise<Record<string, unknown>> {
  try {
    return record(await response.json())
  } catch {
    return refuse(`${what} returned no JSON (HTTP ${response.status})`)
  }
}

/**
 * True when Apple serves a notarization ticket for exactly this cdhash; false when it answers that none exists.
 * Any other answer (network failure, HTTP error, a reply about another record) is refused.
 */
export function ticketLookup(fetcher: Fetch = fetch): (cdhash: string) => Promise<boolean> {
  return async (cdhash) => {
    const recordName = `2/2/${cdhash}`
    let response: Response
    try {
      response = await fetcher(TICKET_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ records: [{ recordName }] }),
      })
    } catch {
      return refuse(`could not reach Apple's notarization ticket service for cdhash ${cdhash}`)
    }
    const body = await json(response, "Apple's notarization ticket service")
    if (!response.ok) refuse(`Apple's notarization ticket service answered HTTP ${response.status} for cdhash ${cdhash}`)
    const records = Array.isArray(body.records) ? body.records.map(record) : []
    const answer = records[0]
    if (records.length !== 1 || answer?.recordName !== recordName)
      refuse(`Apple's notarization ticket service did not answer for record ${recordName}`)
    if (answer.serverErrorCode === "NOT_FOUND") return false
    if (answer.serverErrorCode !== undefined) refuse(`Apple's notarization ticket service answered ${String(answer.serverErrorCode)} for cdhash ${cdhash}`)
    return typeof record(record(answer.fields).signedTicket).value === "string"
  }
}

/** The repository role_name of a login; null when GitHub answers without one. A network failure is refused. */
export function roleLookup(repository: string, token: string, fetcher: Fetch = fetch): (login: string) => Promise<string | null> {
  return async (login) => {
    let response: Response
    try {
      response = await fetcher(`https://api.github.com/repos/${repository}/collaborators/${login}/permission`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
      })
    } catch {
      return refuse(`could not read the repository permission of ${login}`)
    }
    if (!response.ok) return null
    const role = (await json(response, "GitHub's collaborator permission API")).role_name
    return typeof role === "string" ? role : null
  }
}
