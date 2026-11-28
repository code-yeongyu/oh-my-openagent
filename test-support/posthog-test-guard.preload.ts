// Every runner that installs the PostHog guard loads this preload (posthog-test-guard-preload-audit.test.ts), so the
// real-account guards ride it: no test process may dial this machine's own device service or open its credential store.
import "./real-account-test-guard.preload"
import { installPostHogTestGuard } from "./posthog-test-guard"

process.env.OMO_DISABLE_POSTHOG = "true"
installPostHogTestGuard()
