/**
 * Builds HTTP Basic Auth header from environment variables.
 *
 * @returns Basic Auth header string, or undefined if OPENCODE_SERVER_PASSWORD is not set
 */
export function getServerBasicAuthHeader(): string | undefined {
  const password = process.env.OPENCODE_SERVER_PASSWORD
  if (!password) {
    return undefined
  }

  const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
  const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64")

  return `Basic ${token}`
}

/**
 * Injects HTTP Basic Auth header into the OpenCode SDK client.
 *
 * This function accesses the SDK's internal `_client.setConfig()` method.
 * While `_client` has an underscore prefix (suggesting internal use), this is actually
 * a stable public API from `@hey-api/openapi-ts` generated client:
 * - `setConfig()` MERGES headers (does not replace existing ones)
 * - This is the documented way to update client config at runtime
 *
 * @see https://github.com/sst/opencode/blob/main/packages/sdk/js/src/gen/client/client.gen.ts
 * @throws {Error} If OPENCODE_SERVER_PASSWORD is set but client structure is incompatible
 */
export function injectServerAuthIntoClient(client: unknown): void {
  const auth = getServerBasicAuthHeader()
  if (!auth) {
    return
  }

  try {
    if (
      typeof client !== "object" ||
      client === null ||
      !("_client" in client) ||
      typeof (client as { _client: unknown })._client !== "object" ||
      (client as { _client: unknown })._client === null
    ) {
      throw new Error(
        "[opencode-server-auth] OPENCODE_SERVER_PASSWORD is set but SDK client structure is incompatible. " +
          "This may indicate an OpenCode SDK version mismatch."
      )
    }

    const internal = (client as { _client: { setConfig?: (config: { headers: Record<string, string> }) => void } })
      ._client

    if (typeof internal.setConfig !== "function") {
      throw new Error(
        "[opencode-server-auth] OPENCODE_SERVER_PASSWORD is set but SDK client._client.setConfig is not a function. " +
          "This may indicate an OpenCode SDK version mismatch."
      )
    }

    internal.setConfig({
      headers: {
        Authorization: auth,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[opencode-server-auth] Failed to inject server auth: ${message}`)
  }
}
