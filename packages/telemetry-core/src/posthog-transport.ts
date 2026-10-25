import { PostHog, type PostHogOptions } from "posthog-node"
import type { TelemetryTransport, TelemetryTransportOptions } from "./types"

type ImmediateSender = ReturnType<typeof import("./posthog-immediate-send").createImmediateSender>

/** The transport options plus posthog-node's own knobs (fetch, retries, timeouts), passed through as given. */
export type PostHogTransportOptions = TelemetryTransportOptions & PostHogOptions

class PostHogTelemetryTransport implements TelemetryTransport {
  readonly #client: PostHog
  readonly #apiKey: string
  readonly #options: PostHogTransportOptions
  #immediate: Promise<ImmediateSender> | undefined

  constructor(apiKey: string, options: PostHogTransportOptions) {
    this.#client = new PostHog(apiKey, options)
    this.#apiKey = apiKey
    this.#options = options
  }

  capture(message: Parameters<PostHog["capture"]>[0]): void {
    this.#client.capture(message)
  }

  // capture() only queues the event after an async prepare step that flush() does not wait for, so a
  // resolved flush() proves nothing about one specific event. captureImmediate resolves only on a 2xx answer.
  // The immediate sender is loaded on the first ack-gated send (a bundler may ship it as a sidecar through
  // the `#telemetry-immediate-send` import); a failed load is retried by the next send.
  captureImmediate(message: Parameters<PostHog["capture"]>[0]): Promise<void> {
    this.#immediate ??= import("#telemetry-immediate-send")
      .then(({ createImmediateSender }) => createImmediateSender(this.#apiKey, this.#options, PostHog))
      .catch((error: unknown) => {
        this.#immediate = undefined
        throw error
      })
    return this.#immediate.then((sender) => sender.send(message))
  }

  async flush(): Promise<void> {
    await this.#client.flush()
  }

  async shutdown(): Promise<void> {
    await Promise.all([this.#client.shutdown(), this.#immediate?.then((sender) => sender.shutdown(), () => undefined)])
  }
}

export function createDefaultPostHogTransport(
  apiKey: string,
  options: PostHogTransportOptions,
): TelemetryTransport {
  return new PostHogTelemetryTransport(apiKey, options)
}
