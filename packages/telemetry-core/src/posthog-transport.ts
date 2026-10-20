import { PostHog } from "posthog-node"
import type { TelemetryTransport, TelemetryTransportOptions } from "./types"

class PostHogTelemetryTransport implements TelemetryTransport {
  readonly #client: PostHog

  constructor(apiKey: string, options: TelemetryTransportOptions) {
    this.#client = new PostHog(apiKey, options)
  }

  capture(message: Parameters<PostHog["capture"]>[0]): void {
    this.#client.capture(message)
  }

  async flush(): Promise<void> {
    await this.#client.flush()
  }

  async shutdown(): Promise<void> {
    await this.#client.shutdown()
  }
}

export function createDefaultPostHogTransport(
  apiKey: string,
  options: TelemetryTransportOptions,
): TelemetryTransport {
  return new PostHogTelemetryTransport(apiKey, options)
}
