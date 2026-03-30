export const RETRY_DELAY_MS = 60_000

const RETRYABLE_CONNECTIVITY_ERROR_PATTERNS = [
  /unknown certificate verification error/i,
  /certificate verification/i,
  /unable to verify the first certificate/i,
  /unable to get local issuer certificate/i,
  /unable to verify leaf signature/i,
  /unable_to_verify_leaf_signature/i,
  /self[-_ ]signed certificate/i,
  /self_signed_cert_in_chain/i,
  /cert_has_expired/i,
  /err_tls_cert_altname_invalid/i,
  /unable to connect/i,
  /network error/i,
  /socket hang up/i,
  /econnreset/i,
  /econnrefused/i,
  /timed out/i,
  /timeout/i,
]

const HARD_PROVIDER_BLOCK_PATTERNS = [
  /blocked by a gateway or proxy/i,
  /check your account and provider settings/i,
  /may not have permission to access this resource/i,
]

function clone(value) {
  if (value === undefined) {
    return undefined
  }

  return JSON.parse(JSON.stringify(value))
}

function createRetrySessionState() {
  return {
    state: "idle",
    attempt: 0,
    nextRetryAt: undefined,
    errorMessage: undefined,
    hardProviderBlock: false,
  }
}

function extractErrorMessage(error) {
  if (!error) {
    return ""
  }

  if (typeof error === "string") {
    return error
  }

  if (typeof error?.data?.message === "string") {
    return error.data.message
  }

  if (typeof error?.message === "string") {
    return error.message
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function extractStatusCode(error) {
  if (!error || typeof error !== "object") {
    return undefined
  }

  return error.statusCode ?? error.status ?? error.data?.statusCode ?? error.error?.statusCode
}

function isRetryableConnectivityError(message) {
  return RETRYABLE_CONNECTIVITY_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

function isHardProviderBlock(error) {
  const message = extractErrorMessage(error)
  const statusCode = extractStatusCode(error)

  return statusCode === 403 && HARD_PROVIDER_BLOCK_PATTERNS.some((pattern) => pattern.test(message))
}

function toPromptPart(part) {
  if (!part || typeof part !== "object") {
    return null
  }

  if (part.type === "text" && typeof part.text === "string") {
    const nextPart = { type: "text", text: part.text }

    if (part.synthetic) {
      nextPart.synthetic = true
    }

    if (part.ignored) {
      nextPart.ignored = true
    }

    return nextPart
  }

  if (part.type === "file" && typeof part.mime === "string" && typeof part.url === "string") {
    const nextPart = {
      type: "file",
      mime: part.mime,
      url: part.url,
    }

    if (typeof part.filename === "string") {
      nextPart.filename = part.filename
    }

    if (part.source) {
      nextPart.source = clone(part.source)
    }

    return nextPart
  }

  if (part.type === "agent" && typeof part.name === "string") {
    const nextPart = { type: "agent", name: part.name }

    if (part.source) {
      nextPart.source = clone(part.source)
    }

    return nextPart
  }

  if (
    part.type === "subtask" &&
    typeof part.prompt === "string" &&
    typeof part.description === "string" &&
    typeof part.agent === "string"
  ) {
    return {
      type: "subtask",
      prompt: part.prompt,
      description: part.description,
      agent: part.agent,
    }
  }

  return null
}

function buildRetryBody(payload) {
  const body = {
    parts: clone(payload.parts) ?? [],
  }

  if (payload.agent) {
    body.agent = payload.agent
  }

  if (payload.model) {
    body.model = clone(payload.model)
  }

  if (payload.variant) {
    body.variant = payload.variant
  }

  if (payload.system) {
    body.system = payload.system
  }

  if (payload.tools) {
    body.tools = clone(payload.tools)
  }

  return body
}

async function safeToast(client, body) {
  await client?.tui?.showToast?.({ body }).catch(() => {})
}

async function safeLog(client, level, message, extra = {}) {
  await client?.app?.log?.({
    body: {
      service: "tls-certificate-retry",
      level,
      message,
      extra,
    },
  }).catch(() => {})
}

async function readLastUserPayload(client, directory, sessionID) {
  const response = await client.session.messages({
    path: { id: sessionID },
    query: { directory },
  })

  const messages = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : []
  const lastUserMessage = [...messages].reverse().find((message) => message?.info?.role === "user")

  if (!lastUserMessage) {
    return undefined
  }

  const parts = (lastUserMessage.parts ?? []).map(toPromptPart).filter(Boolean)

  if (parts.length === 0) {
    return undefined
  }

  return {
    agent: lastUserMessage.info.agent,
    model: clone(lastUserMessage.info.model),
    system: lastUserMessage.info.system,
    tools: clone(lastUserMessage.info.tools),
    parts,
  }
}

export function createTlsCertificateRetryRuntime({
  client,
  directory,
  now = () => Date.now(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onStateChange,
} = {}) {
  const lastPayloadBySession = new Map()
  const retryTimerBySession = new Map()
  const retryAttemptBySession = new Map()
  const retryDispatchInFlight = new Set()
  const hardBlockedSessions = new Set()
  const retryStateBySession = new Map()

  const getRetryState = (sessionID) => {
    let state = retryStateBySession.get(sessionID)

    if (!state) {
      state = createRetrySessionState()
      retryStateBySession.set(sessionID, state)
    }

    return state
  }

  const getSessionRetryState = (sessionID) => {
    const state = getRetryState(sessionID)

    return {
      state: state.state,
      attempt: state.attempt,
      nextRetryAt: state.nextRetryAt,
      errorMessage: state.errorMessage,
      hardProviderBlock: state.hardProviderBlock,
      scheduled: retryTimerBySession.has(sessionID),
      dispatchInFlight: retryDispatchInFlight.has(sessionID),
      payloadCached: lastPayloadBySession.has(sessionID),
    }
  }

  const safeStateChange = async (sessionID, signal) => {
    if (typeof onStateChange !== "function") {
      return
    }

    try {
      await onStateChange(sessionID, signal)
    } catch (error) {
      await safeLog(client, "warn", "Retry state bridge rejected an update", {
        sessionID,
        signal,
        error: extractErrorMessage(error),
      })
    }
  }

  const clearRetryTimer = (sessionID) => {
    const timer = retryTimerBySession.get(sessionID)

    if (timer) {
      clearTimeoutFn(timer)
      retryTimerBySession.delete(sessionID)
    }
  }

  const resetRetryState = (sessionID) => {
    const state = getRetryState(sessionID)
    state.state = "idle"
    state.attempt = 0
    state.nextRetryAt = undefined
    state.errorMessage = undefined
    state.hardProviderBlock = false
  }

  const clearSessionState = (sessionID) => {
    clearRetryTimer(sessionID)
    retryAttemptBySession.delete(sessionID)
    retryDispatchInFlight.delete(sessionID)
    hardBlockedSessions.delete(sessionID)
    lastPayloadBySession.delete(sessionID)
    retryStateBySession.delete(sessionID)
  }

  const setRetryingState = async (sessionID, attempt, errorMessage, nextRetryAt) => {
    const state = getRetryState(sessionID)
    state.state = "retrying"
    state.attempt = attempt
    state.nextRetryAt = nextRetryAt
    state.errorMessage = errorMessage
    state.hardProviderBlock = false

    await safeStateChange(sessionID, {
      state: "retrying",
      attempt,
      message: errorMessage,
      next: nextRetryAt,
    })
  }

  const setFailedState = async (sessionID, error, hardProviderBlock) => {
    const state = getRetryState(sessionID)
    state.state = "failed"
    state.nextRetryAt = undefined
    state.errorMessage = extractErrorMessage(error) || "Unknown session error"
    state.hardProviderBlock = Boolean(hardProviderBlock)

    await safeStateChange(sessionID, {
      state: "failed",
      error,
      hardProviderBlock: state.hardProviderBlock,
    })
  }

  const getRetryPayload = async (sessionID) => {
    const cachedPayload = lastPayloadBySession.get(sessionID)

    if (cachedPayload) {
      return clone(cachedPayload)
    }

    const resolvedPayload = await readLastUserPayload(client, directory, sessionID)

    if (resolvedPayload) {
      lastPayloadBySession.set(sessionID, clone(resolvedPayload))
    }

    return resolvedPayload
  }

  const scheduleRetry = async (sessionID, errorMessage) => {
    if (!sessionID || hardBlockedSessions.has(sessionID)) {
      return false
    }

    if (retryTimerBySession.has(sessionID) || retryDispatchInFlight.has(sessionID)) {
      return false
    }

    const nextAttempt = (retryAttemptBySession.get(sessionID) ?? 0) + 1
    const nextRetryAt = now() + RETRY_DELAY_MS
    const timer = setTimeoutFn(() => {
      return dispatchRetry(sessionID)
    }, RETRY_DELAY_MS)

    retryTimerBySession.set(sessionID, timer)
    await setRetryingState(sessionID, nextAttempt, errorMessage, nextRetryAt)

    await safeToast(client, {
      title: "Connection Retry Scheduled",
      message: `Connection failed. Retrying in 60 seconds (attempt ${nextAttempt}).`,
      variant: "warning",
      duration: 7000,
    })

    await safeLog(client, "warn", "Scheduled automatic retry after connectivity failure", {
      sessionID,
      nextAttempt,
      delayMs: RETRY_DELAY_MS,
      error: errorMessage,
    })

    return true
  }

  const dispatchRetry = async (sessionID) => {
    if (hardBlockedSessions.has(sessionID)) {
      clearRetryTimer(sessionID)
      return
    }

    clearRetryTimer(sessionID)

    if (retryDispatchInFlight.has(sessionID)) {
      return
    }

    retryDispatchInFlight.add(sessionID)
    let retryableDispatchErrorMessage

    try {
      const payload = await getRetryPayload(sessionID)

      if (!payload) {
        await safeLog(client, "warn", "Retry skipped because no user payload could be reconstructed", {
          sessionID,
        })
        return
      }

      const attempt = (retryAttemptBySession.get(sessionID) ?? 0) + 1
      retryAttemptBySession.set(sessionID, attempt)

      await safeToast(client, {
        title: "Connection Retry",
        message: `Connection failed. Retrying now (attempt ${attempt}).`,
        variant: "warning",
        duration: 5000,
      })

      await safeLog(client, "warn", "Dispatching automatic retry after connectivity failure", {
        sessionID,
        attempt,
        delayMs: RETRY_DELAY_MS,
      })

      await client.session.promptAsync({
        path: { id: sessionID },
        body: buildRetryBody(payload),
        query: { directory },
      })
    } catch (error) {
      const errorMessage = extractErrorMessage(error)

      await safeLog(client, "error", "Automatic TLS retry dispatch failed", {
        sessionID,
        error: errorMessage,
      })

      if (isHardProviderBlock(error)) {
        hardBlockedSessions.add(sessionID)
        await setFailedState(sessionID, error, true)

        await safeToast(client, {
          title: "Provider Blocked",
          message: "Execution paused because the provider returned a non-retryable gateway/account block. Fix provider or proxy settings, then resend.",
          variant: "error",
          duration: 10000,
        })

        return
      }

      if (isRetryableConnectivityError(errorMessage)) {
        retryableDispatchErrorMessage = errorMessage
      }
    } finally {
      retryDispatchInFlight.delete(sessionID)
    }

    if (retryableDispatchErrorMessage) {
      await scheduleRetry(sessionID, retryableDispatchErrorMessage)
    }
  }

  return {
    hooks: {
      "chat.message": async (input, output) => {
        const sessionID = input.sessionID

        if (!sessionID || output.message?.role !== "user") {
          return
        }

        hardBlockedSessions.delete(sessionID)
        resetRetryState(sessionID)

        const payload = {
          agent: input.agent ?? output.message.agent,
          model: clone(input.model ?? output.message.model),
          variant: input.variant,
          system: output.message.system,
          tools: clone(output.message.tools),
          parts: (output.parts ?? []).map(toPromptPart).filter(Boolean),
        }

        if (payload.parts.length > 0) {
          lastPayloadBySession.set(sessionID, clone(payload))
        }

        if (retryDispatchInFlight.has(sessionID)) {
          return
        }

        if (retryTimerBySession.has(sessionID)) {
          clearRetryTimer(sessionID)
          retryAttemptBySession.delete(sessionID)

          await safeLog(client, "info", "Cancelled scheduled TLS retry because a new user message was sent", {
            sessionID,
          })
        }
      },

      event: async ({ event }) => {
        if (event.type === "session.deleted") {
          const sessionID = event.properties?.info?.id

          if (sessionID) {
            clearSessionState(sessionID)
          }

          return
        }

        if (event.type === "session.idle") {
          const sessionID = event.properties?.sessionID

          if (!sessionID) {
            return
          }

          if (!retryTimerBySession.has(sessionID) && !retryDispatchInFlight.has(sessionID)) {
            retryAttemptBySession.delete(sessionID)

            if (!hardBlockedSessions.has(sessionID)) {
              resetRetryState(sessionID)
            }
          }

          return
        }

        if (event.type !== "session.error") {
          return
        }

        const sessionID = event.properties?.sessionID
        const rawError = event.properties?.error
        const errorMessage = extractErrorMessage(rawError)

        if (!sessionID || hardBlockedSessions.has(sessionID)) {
          return
        }

        if (isHardProviderBlock(rawError)) {
          hardBlockedSessions.add(sessionID)
          clearRetryTimer(sessionID)
          await setFailedState(sessionID, rawError, true)

          await safeToast(client, {
            title: "Provider Blocked",
            message: "The provider returned a non-retryable gateway/account block, so auto-retry is stopped. Fix provider or proxy settings, then resend.",
            variant: "error",
            duration: 10000,
          })

          await safeLog(client, "error", "Detected non-retryable provider block; auto-retry stopped", {
            sessionID,
            error: errorMessage,
            statusCode: extractStatusCode(rawError),
          })

          return
        }

        if (!isRetryableConnectivityError(errorMessage)) {
          return
        }

        await scheduleRetry(sessionID, errorMessage)
      },
    },

    getSessionRetryState,

    getAllSessionRetryStates() {
      return Array.from(retryStateBySession.keys()).map((sessionID) => ({
        sessionID,
        state: getSessionRetryState(sessionID),
      }))
    },
  }
}

export const TlsCertificateRetryPlugin = async ({ client, directory }) => {
  const runtime = createTlsCertificateRetryRuntime({ client, directory })
  return runtime.hooks
}
