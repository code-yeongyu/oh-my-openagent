import { readFile } from "node:fs/promises"

export const BROWSER_ENGINE_ENV = "OMO_BROWSER_ENGINE"

const TOOLKIT_TOOL = "omo_desktop_toolkit"
const BUILTIN_UNAVAILABLE = {
  unavailable: "this app does not offer its built-in browser to this session",
  timeout: "the app did not answer the request for its built-in browser",
  invalid_grant: "the app answered the request for its built-in browser with something unusable",
}

export class BuiltinBrowserUnavailableError extends Error {
  constructor(reason) {
    const unavailable = Object.hasOwn(BUILTIN_UNAVAILABLE, reason)
    super(
      unavailable
        ? `OmO's built-in browser is not available here: ${BUILTIN_UNAVAILABLE[reason]}. Every other browser works as usual: connectBrowserSkill() for the user's own browser, connectPipe() for a browser of your own.`
        : `OmO's built-in browser was refused: ${reason === "user_stopped" ? "the user stopped browser work" : `the app refused it (${reason})`}. Stop browser work and report the refusal; do not open another browser.`,
    )
    this.name = "BuiltinBrowserUnavailableError"
    this.code = "browser_builtin_unavailable"
    this.reason = reason
  }
}

/**
 * Inside OmO Desktop (`OMO_BROWSER_ENGINE` set) the library is the terminal's own, unchanged, plus
 * `connectBuiltinBrowser()`: the app's built-in browser for this thread, the tab the user sees beside the chat.
 */
export function guardOmowright(raw, { env = process.env, host } = {}) {
  const engine = env[BROWSER_ENGINE_ENV]
  if (engine === undefined || engine === "") return raw

  const acquireBuiltinBrowser = async () => {
    let details
    try {
      details = (await host?.callTool(TOOLKIT_TOOL, { op: "acquire", toolkit: "browser" }))?.details
    } catch {
      details = undefined
    }
    if (details?.ok !== true) throw new BuiltinBrowserUnavailableError(typeof details?.reason === "string" ? details.reason : "unavailable")
    // Without an endpoint CdpClient falls back to 127.0.0.1:9222 and would send the token to whatever listens there.
    const endpoint = details.grant?.endpoint
    if (typeof endpoint !== "string" || endpoint === "") throw new BuiltinBrowserUnavailableError("invalid_grant")
    let token
    try {
      token = (await readFile(details.grant.tokenFile, "utf8")).trim()
    } catch {
      throw new BuiltinBrowserUnavailableError("invalid_grant")
    }
    return { endpoint, authorization: `Bearer ${token}` }
  }

  // A CDP endpoint that shows only this thread's tabs. The token is read from the file the grant names, so it never
  // passes through a tool result.
  const connectBuiltinBrowser = async (options = {}) => {
    let current = await acquireBuiltinBrowser()
    // Concurrent refreshes share one acquire, so a token is never paired with another grant's endpoint.
    let refreshing
    const authorizer = {
      async resolveAuthorization({ forceRefresh } = {}) {
        if (forceRefresh) {
          refreshing ??= acquireBuiltinBrowser()
            .then((next) => {
              current = next
              client.cdpUrl = next.endpoint
              return next
            })
            .finally(() => {
              refreshing = undefined
            })
          return (await refreshing).authorization
        }
        return current.authorization
      },
    }
    const client = new raw.CdpClient({ ...options.client, cdpUrl: current.endpoint, authorizer })
    return await new raw.BrowserConnection(client, options).initialize()
  }

  return { ...raw, connectBuiltinBrowser }
}
