import type { PluginInput } from "@opencode-ai/plugin"
import { LOADING_SPINNER_FRAME_MS, loadingSpinnerFrame } from "@oh-my-opencode/utils/loading-spinner"
import { ignoreToastError } from "./ignore-toast-error"

export async function showSpinnerToast(ctx: PluginInput, version: string, message: string): Promise<void> {
  let elapsedClock = performance.now()
  const deadline = elapsedClock + 5_000

  while (elapsedClock < deadline) {
    const toast = ctx.client.tui
      .showToast({
        body: {
          title: `${loadingSpinnerFrame(Date.now())} OhMyOpenCode ${version}`,
          message,
          variant: "info" as const,
          duration: Math.min(LOADING_SPINNER_FRAME_MS, Math.ceil(deadline - elapsedClock)) + 50,
        },
      })
      .catch(ignoreToastError)

    // Budget the request into the frame interval without letting toast requests overlap.
    const nextFrame = Math.min(elapsedClock + LOADING_SPINNER_FRAME_MS, deadline)
    const delay = Math.max(0, Math.ceil(nextFrame - performance.now()))
    await Promise.all([toast, new Promise<void>((resolve) => setTimeout(resolve, delay))])
    elapsedClock = performance.now()
  }
}
