import os from "os"
import { PostHog } from "posthog-node"

type PostHogClient = Pick<PostHog, "capture" | "captureException" | "shutdown">

const NO_OP_POSTHOG: PostHogClient = {
  capture: () => undefined,
  captureException: () => undefined,
  shutdown: async () => undefined,
}

function shouldDisablePostHog(): boolean {
  return process.env.OMO_DISABLE_POSTHOG === "true"
}

function hasPostHogApiKey(): boolean {
  return (process.env.POSTHOG_API_KEY ?? "").trim().length > 0
}

function createPostHogClient(options: ConstructorParameters<typeof PostHog>[1]): PostHogClient {
  if (shouldDisablePostHog() || !hasPostHogApiKey()) {
    return NO_OP_POSTHOG
  }

  return new PostHog(process.env.POSTHOG_API_KEY ?? "", options)
}

export function getPostHogDistinctId(): string {
  return os.hostname()
}

export function createCliPostHog(): PostHogClient {
  return createPostHogClient({
    host: process.env.POSTHOG_HOST,
    enableExceptionAutocapture: true,
    flushAt: 1,
    flushInterval: 0,
  })
}

export function createPluginPostHog(): PostHogClient {
  return createPostHogClient({
    host: process.env.POSTHOG_HOST,
    enableExceptionAutocapture: true,
  })
}
