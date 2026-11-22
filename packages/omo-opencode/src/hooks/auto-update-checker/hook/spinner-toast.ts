import type { PluginInput } from "@opencode-ai/plugin"
import { LOADING_SPINNER_FRAME_MS, loadingSpinnerFrame } from "@oh-my-opencode/utils/loading-spinner"
import { ignoreToastError } from "./ignore-toast-error"

export async function showSpinnerToast(ctx: PluginInput, version: string, message: string): Promise<void> {
  let now = Date.now()
  const deadline = now + 5_000

  while (now < deadline) {
    const toast = ctx.client.tui
      .showToast({
        body: {
          title: `${loadingSpinnerFrame(now)} OhMyOpenCode ${version}`,
          message,
          variant: "info" as const,
          duration: Math.min(LOADING_SPINNER_FRAME_MS, deadline - now) + 50,
        },
      })
      .catch(ignoreToastError)

    // Budget the request into the frame interval without letting toast requests overlap.
    const delay = Math.max(0, Math.min(now + LOADING_SPINNER_FRAME_MS, deadline) - Date.now())
    await Promise.all([toast, new Promise<void>((resolve) => setTimeout(resolve, delay))])
    now = Date.now()
  }
}
