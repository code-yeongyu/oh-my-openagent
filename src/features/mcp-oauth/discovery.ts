export interface OAuthServerMetadata {
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint?: string
  resource: string
}

const discoveryCache = new Map<string, OAuthServerMetadata>()
const pendingDiscovery = new Map<string, Promise<OAuthServerMetadata>>()

function parseHttpsUrl(value: string, label: string): URL {
  const parsed = new URL(value)
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use https`)
  }
  return parsed
}

function readStringField(source: Record<string, unknown>, field: string): string {
  const value = source[field]
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`OAuth metadata missing ${field}`)
  }
  return value
}

async function fetchMetadata(url: string): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; status: number }> {
  const response = await fetch(url, { headers: { accept: "application/json" } })
  if (!response.ok) {
    return { ok: false, status: response.status }
  }
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!json || typeof json !== "object") {
    throw new Error("OAuth metadata response is not valid JSON")
  }
  return { ok: true, json }
}

async function fetchAuthorizationServerMetadata(issuer: string, resource: string): Promise<OAuthServerMetadata> {
  const issuerUrl = parseHttpsUrl(issuer, "Authorization server URL")
  const issuerPath = issuerUrl.pathname.replace(/\/+$/, "")
  const metadataUrl = new URL(`/.well-known/oauth-authorization-server${issuerPath}`, issuerUrl).toString()
  const metadata = await fetchMetadata(metadataUrl)

  if (!metadata.ok) {
    if (metadata.status === 404) {
      throw new Error("OAuth authorization server metadata not found")
    }
    throw new Error(`OAuth authorization server metadata fetch failed (${metadata.status})`)
  }

  const authorizationEndpoint = parseHttpsUrl(
    readStringField(metadata.json, "authorization_endpoint"),
    "authorization_endpoint"
  ).toString()
  const tokenEndpoint = parseHttpsUrl(
    readStringField(metadata.json, "token_endpoint"),
    "token_endpoint"
  ).toString()
  const registrationEndpointValue = metadata.json.registration_endpoint
  const registrationEndpoint =
    typeof registrationEndpointValue === "string" && registrationEndpointValue.length > 0
      ? parseHttpsUrl(registrationEndpointValue, "registration_endpoint").toString()
      : undefined

  return {
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint,
    resource,
  }
}

function parseAuthorizationServers(metadata: Record<string, unknown>): string[] {
  const servers = metadata.authorization_servers
  if (!Array.isArray(servers)) return []
  return servers.filter((server): server is string => typeof server === "string" && server.length > 0)
}

export async function discoverOAuthServerMetadata(resource: string): Promise<OAuthServerMetadata> {
  const resourceUrl = parseHttpsUrl(resource, "Resource server URL")
  const resourceKey = resourceUrl.toString()

  const cached = discoveryCache.get(resourceKey)
  if (cached) return cached

  const pending = pendingDiscovery.get(resourceKey)
  if (pending) return pending

  const discoveryPromise = (async () => {
    const prmUrl = new URL("/.well-known/oauth-protected-resource", resourceUrl).toString()
    const prmResponse = await fetchMetadata(prmUrl)

    if (prmResponse.ok) {
      const authServers = parseAuthorizationServers(prmResponse.json)
      if (authServers.length === 0) {
        throw new Error("OAuth protected resource metadata missing authorization_servers")
      }
      return fetchAuthorizationServerMetadata(authServers[0], resource)
    }

    if (prmResponse.status !== 404) {
      throw new Error(`OAuth protected resource metadata fetch failed (${prmResponse.status})`)
    }

    return fetchAuthorizationServerMetadata(resourceKey, resource)
  })()

  pendingDiscovery.set(resourceKey, discoveryPromise)

  try {
    const result = await discoveryPromise
    discoveryCache.set(resourceKey, result)
    return result
  } finally {
    pendingDiscovery.delete(resourceKey)
  }
}

export function resetDiscoveryCache(): void {
  discoveryCache.clear()
  pendingDiscovery.clear()
}
