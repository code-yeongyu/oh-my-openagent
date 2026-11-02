const TELEMETRY_PRIVACY_POLICY_URL =
  "https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/legal/privacy-policy.md"

// Printed once when an installer finishes. install.sh, install.ps1 and omo setup
// (packages/omo-native/bin/lib/setup-summary.js) cannot import this module and carry a copy;
// install-disclosure.test.ts fails when a copy drifts.
export const TELEMETRY_INSTALL_DISCLOSURE_LINES = [
  "OmO sends anonymous usage telemetry (no prompts, code, file paths, or account data) to improve the product.",
  "The data goes to PostHog in the United States.",
  "Turn it off with DO_NOT_TRACK=1 (or OMO_DISABLE_TELEMETRY=1).",
  `Details: ${TELEMETRY_PRIVACY_POLICY_URL}`,
] as const
