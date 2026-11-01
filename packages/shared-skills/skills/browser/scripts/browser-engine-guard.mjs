import { readFile } from "node:fs/promises"

export const BROWSER_ENGINE_ENV = "OMO_BROWSER_ENGINE"

const TOOLKIT_TOOL = "omo_desktop_toolkit"
const BUILTIN_UNAVAILABLE = {
  unavailable: "this app does not offer its built-in browser to this session",
  timeout: "the app did not answer the request for its built-in browser",
  invalid_grant: "the app answered the request for its built-in browser with something unusable",
}

export class AttachedBrowserSetupError extends Error {
  constructor(cause) {
    super(
      `Attached browser setup failed: ${cause instanceof Error ? cause.message : String(cause)}. Stop this attempt; do not retry, copy or clone a browser profile, or fall back to an owned engine. Start the daemon outside omo with \`bsk daemon start\`, then run bskDoctor() and continue only when ready. Use a session-owned foreground service instead when that mode is available.`,
      { cause },
    )
    this.name = "AttachedBrowserSetupError"
    this.code = "browser_attached_setup_failed"
    this.retryable = false
    this.fallbackAllowed = false
    this.recovery = { kind: "start_daemon_outside_omo", command: "bsk daemon start" }
  }
}

// The imported runtime is stable across loadOmowright() calls. Re-loading the wrapper
// or changing the task name must not restart a failed daemon or open another engine.
const attachedAttempts = new WeakMap()

function guardAttachedBrowser(raw, extra = {}) {
  let state = attachedAttempts.get(raw)
  if (state === undefined) {
    state = { failure: undefined, pending: undefined }
    attachedAttempts.set(raw, state)
  }
  const library = { ...raw, ...extra }
  for (const method of ["connectBrowserSkill", "bskOnboard"]) {
    if (typeof raw[method] !== "function") continue
    library[method] = async (...args) => {
      if (state.pending) await state.pending
      if (state.failure) throw state.failure
      const pending = (async () => {
        try {
          const result = await raw[method](...args)
          if (method === "bskOnboard" && result.daemon?.error && !result.daemon.running) {
            throw new Error(result.daemon.error)
          }
          return result
        } catch (cause) {
          state.failure = new AttachedBrowserSetupError(cause)
          throw state.failure
        }
      })()
      state.pending = pending
      try {
        return await pending
      } finally {
        if (state.pending === pending) state.pending = undefined
      }
    }
  }
  for (const method of ["connect", "connectPipe", "connectCloakProfile", "connectBuiltinBrowser"]) {
    const connect = library[method]
    if (typeof connect !== "function") continue
    library[method] = async (...args) => {
      await state.pending
      if (state.failure) throw state.failure
      return await connect(...args)
    }
  }
  if (typeof raw.bskDoctor === "function") {
    library.bskDoctor = async (...args) => {
      const report = await raw.bskDoctor(...args)
      // A non-starting diagnostic must positively observe the repaired setup.
      if (report.ready === true) state.failure = undefined
      return report
    }
  }
  return library
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
  if (engine === undefined || engine === "") return guardAttachedBrowser(raw)

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

  return guardAttachedBrowser(raw, { connectBuiltinBrowser })
}
