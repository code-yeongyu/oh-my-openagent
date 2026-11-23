import { resolveTelemetryStateDir } from "@oh-my-opencode/telemetry-core"

import { createCodexTelemetryProductConfig } from "../telemetry/product-identity"

// An env the caller passes decides both the opt-out and where install-id and the daily claim are written (#13253);
// without one, the process env decides as before.
export async function trackCodexInstallTelemetry(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  try {
    const { createInstallPostHog } = await import("../telemetry")
    const posthog =
      env === process.env
        ? createInstallPostHog()
        : createInstallPostHog({
            env,
            stateDir: resolveTelemetryStateDir(createCodexTelemetryProductConfig(), { env }),
          })
    posthog.trackActive("install_completed")
    await posthog.shutdown()
  } catch (error) {
    if (error instanceof Error) return
    return
  }
}
