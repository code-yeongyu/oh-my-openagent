export type ClientRegistrationRequest = {
  redirect_uris: string[]
  client_name: string
  grant_types: ["authorization_code", "refresh_token"]
  response_types: ["code"]
  token_endpoint_auth_method: "none" | "client_secret_post"
}

export type ClientCredentials = {
  clientId: string
  clientSecret?: string
}

export type ClientRegistrationStorage = {
  getClientRegistration: (serverIdentifier: string) => ClientCredentials | null
  setClientRegistration: (
    serverIdentifier: string,
    credentials: ClientCredentials
  ) => void
}

export type DynamicClientRegistrationOptions = {
  registrationEndpoint?: string | null
  serverIdentifier?: string
  clientName: string
  redirectUris: string[]
  tokenEndpointAuthMethod: "none" | "client_secret_post"
  clientId?: string | null
  storage: ClientRegistrationStorage
  fetch?: DcrFetch
}

export type DcrFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

export async function getOrRegisterClient(
  options: DynamicClientRegistrationOptions
): Promise<ClientCredentials | null> {
  const serverIdentifier =
    options.serverIdentifier ?? options.registrationEndpoint ?? "default"
  const existing = options.storage.getClientRegistration(serverIdentifier)
  if (existing) return existing

  if (!options.registrationEndpoint) {
    return options.clientId ? { clientId: options.clientId } : null
  }

  const fetchImpl = options.fetch ?? globalThis.fetch
  const request: ClientRegistrationRequest = {
    redirect_uris: options.redirectUris,
    client_name: options.clientName,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: options.tokenEndpointAuthMethod,
  }

  try {
    const response = await fetchImpl(options.registrationEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      return options.clientId ? { clientId: options.clientId } : null
    }

    const data: unknown = await response.json()
    const parsed = parseRegistrationResponse(data)
    if (!parsed) {
      return options.clientId ? { clientId: options.clientId } : null
    }

    options.storage.setClientRegistration(serverIdentifier, parsed)
    return parsed
  } catch {
    return options.clientId ? { clientId: options.clientId } : null
  }
}

function parseRegistrationResponse(data: unknown): ClientCredentials | null {
  if (!isRecord(data)) return null
  const clientId = data.client_id
  if (typeof clientId !== "string" || clientId.length === 0) return null

  const clientSecret = data.client_secret
  if (typeof clientSecret === "string" && clientSecret.length > 0) {
    return { clientId, clientSecret }
  }

  return { clientId }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
