export async function trackCodexInstallTelemetry(): Promise<void> {
  try {
    const { createInstallPostHog, getPostHogDistinctId } = await import("../telemetry")
    const posthog = createInstallPostHog()
    posthog.trackActive(getPostHogDistinctId(), "install_completed")
    await posthog.shutdown()
  } catch (error) {
    if (error instanceof Error) return
    return
  }
}
