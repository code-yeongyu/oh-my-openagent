import { getServerBasicAuthHeader as resolveServerBasicAuthHeader } from "./opencode-server-auth"
import { log as writeLog } from "./logger"
import { isRecord } from "./record-type-guard"

type UnknownRecord = Record<string, unknown>
type FetchImplementation = typeof fetch
type LogImplementation = typeof writeLog
type ServerBasicAuthHeaderResolver = typeof resolveServerBasicAuthHeader

let fetchImplementationForTesting: FetchImplementation | undefined
let logImplementationForTesting: LogImplementation | undefined
let serverBasicAuthHeaderResolverForTesting: ServerBasicAuthHeaderResolver | undefined

function getFetchImplementation(): FetchImplementation {
  return fetchImplementationForTesting ?? fetch
}

function getLogImplementation(): LogImplementation {
  return logImplementationForTesting ?? writeLog
}

function getServerBasicAuthHeaderImplementation(): ServerBasicAuthHeaderResolver {
  return serverBasicAuthHeaderResolverForTesting ?? resolveServerBasicAuthHeader
}

export function _setFetchImplementationForTesting(fetchImplementation: FetchImplementation | undefined): void {
  fetchImplementationForTesting = fetchImplementation
}

export function _setLogImplementationForTesting(logImplementation: LogImplementation | undefined): void {
  logImplementationForTesting = logImplementation
}

export function _setServerBasicAuthHeaderResolverForTesting(
  resolver: ServerBasicAuthHeaderResolver | undefined,
): void {
  serverBasicAuthHeaderResolverForTesting = resolver
}

function getInternalClient(client: unknown): UnknownRecord | null {
  if (!isRecord(client)) {
    return null
  }

  const internal = client["_client"]
  return isRecord(internal) ? internal : null
}

export function getServerBaseUrl(client: unknown): string | null {
  // Try client._client.getConfig().baseUrl
  const internal = getInternalClient(client)
  if (internal) {
    const getConfig = internal["getConfig"]
    if (typeof getConfig === "function") {
      const config = getConfig()
      if (isRecord(config)) {
        const baseUrl = config["baseUrl"]
        if (typeof baseUrl === "string") {
          return baseUrl
        }
      }
    }
  }

  // Try client.session._client.getConfig().baseUrl
  if (isRecord(client)) {
    const session = client["session"]
    if (isRecord(session)) {
      const internal = session["_client"]
      if (isRecord(internal)) {
        const getConfig = internal["getConfig"]
        if (typeof getConfig === "function") {
          const config = getConfig()
          if (isRecord(config)) {
            const baseUrl = config["baseUrl"]
            if (typeof baseUrl === "string") {
              return baseUrl
            }
          }
        }
      }
    }
  }

  return null
}

export async function patchPart(
  client: unknown,
  sessionID: string,
  messageID: string,
  partID: string,
  body: Record<string, unknown>
): Promise<boolean> {
  const baseUrl = getServerBaseUrl(client)
  if (!baseUrl) {
    getLogImplementation()("[opencode-http-api] Could not extract baseUrl from client")
    return false
  }

  const auth = getServerBasicAuthHeaderImplementation()()
  if (!auth) {
    getLogImplementation()("[opencode-http-api] No auth header available")
    return false
  }

  const url = `${baseUrl}/session/${encodeURIComponent(sessionID)}/message/${encodeURIComponent(messageID)}/part/${encodeURIComponent(partID)}`

  try {
    const response = await getFetchImplementation()(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": auth,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      getLogImplementation()("[opencode-http-api] PATCH failed", { status: response.status, url })
      return false
    }

    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    getLogImplementation()("[opencode-http-api] PATCH error", { message, url })
    return false
  }
}

export async function deletePart(
  client: unknown,
  sessionID: string,
  messageID: string,
  partID: string
): Promise<boolean> {
  const baseUrl = getServerBaseUrl(client)
  if (!baseUrl) {
    getLogImplementation()("[opencode-http-api] Could not extract baseUrl from client")
    return false
  }

  const auth = getServerBasicAuthHeaderImplementation()()
  if (!auth) {
    getLogImplementation()("[opencode-http-api] No auth header available")
    return false
  }

  const url = `${baseUrl}/session/${encodeURIComponent(sessionID)}/message/${encodeURIComponent(messageID)}/part/${encodeURIComponent(partID)}`

  try {
    const response = await getFetchImplementation()(url, {
      method: "DELETE",
      headers: {
        "Authorization": auth,
      },
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      getLogImplementation()("[opencode-http-api] DELETE failed", { status: response.status, url })
      return false
    }

    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    getLogImplementation()("[opencode-http-api] DELETE error", { message, url })
    return false
  }
}
