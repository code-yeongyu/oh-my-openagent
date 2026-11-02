import type { PostHog, PostHogOptions } from "posthog-node"

import { TelemetryDeliveryError } from "./telemetry-delivery-error"
import type { TelemetryCaptureMessage } from "./types"

// The `./immediate-send` subpath is the whole send surface: the sender and the error it rejects with.
export { TelemetryDeliveryError }

type Attempt = { status?: number; error?: unknown }
type Fetch = NonNullable<PostHogOptions["fetch"]>

/**
 * posthog-node's captureImmediate resolves even when the request failed (it reports the failure on its
 * `error` event), so it cannot tell a delivered event from a lost one. This sender owns a dedicated client
 * whose fetch records each answer, runs one send at a time so every answer belongs to the current send, and
 * never retries inside the process: an undelivered event stays queued on disk and is retried later.
 *
 * The PostHog class comes from the caller, so a bundle that loads this module lazily (the senpi telemetry
 * sidecar) does not carry a second copy of posthog-node.
 */
export function createImmediateSender(apiKey: string, options: PostHogOptions, PostHogClient: typeof PostHog): {
  readonly send: (message: TelemetryCaptureMessage) => Promise<void>
  readonly shutdown: () => Promise<void>
} {
  const baseFetch: Fetch = options.fetch ?? ((url, init) => fetch(url, init))
  let current: Attempt | undefined
  const trackedFetch: Fetch = async (url, init) => {
    const attempt = current
    try {
      const response = await baseFetch(url, init)
      if (attempt !== undefined) attempt.status = response.status
      return response
    } catch (error) {
      if (attempt !== undefined) attempt.error = error
      throw error
    }
  }
  const client = new PostHogClient(apiKey, { ...options, fetch: trackedFetch, fetchRetryCount: 0 })
  let queue: Promise<unknown> = Promise.resolve()

  const sendOne = async (message: TelemetryCaptureMessage): Promise<void> => {
    const attempt: Attempt = {}
    current = attempt
    try {
      await client.captureImmediate(message)
    } finally {
      current = undefined
    }
    const { status } = attempt
    if (status === undefined || status < 200 || status >= 300) throw new TelemetryDeliveryError(status, attempt.error)
  }

  return {
    send(message) {
      const result = queue.then(() => sendOne(message))
      queue = result.catch(() => undefined)
      return result
    },
    async shutdown() {
      await client.shutdown()
    },
  }
}
