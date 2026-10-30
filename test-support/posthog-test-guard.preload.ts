import { installPostHogTestGuard } from "./posthog-test-guard"

process.env.OMO_DISABLE_POSTHOG = "true"
installPostHogTestGuard()
