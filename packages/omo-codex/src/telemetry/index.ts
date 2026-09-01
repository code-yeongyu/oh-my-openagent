export {
  __resetActivityStateProviderForTesting,
  __resetOsProviderForTesting,
  __setActivityStateProviderForTesting,
  __setOsProviderForTesting,
  createCliPostHog,
  createInstallPostHog,
  createPluginPostHog,
  getPostHogDistinctId,
} from "./posthog"

export type { PostHogActivityReason, PostHogClient } from "./posthog"
