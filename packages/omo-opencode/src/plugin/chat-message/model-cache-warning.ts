import { isModelCacheAvailable, log } from "../../shared"

type TuiClient = {
  readonly showToast: (input: {
    readonly body: {
      readonly title: string
      readonly message: string
      readonly variant: "warning"
      readonly duration: number
    }
  }) => Promise<unknown>
}

export function notifyWhenModelCacheIsMissing(tui: TuiClient): void {
  if (isModelCacheAvailable()) {
    return
  }

  void tui
    .showToast({
      body: {
        title: "⚠️ Provider Cache Missing",
        message:
          "Model filtering disabled. RESTART OpenCode to enable full functionality.",
        variant: "warning",
        duration: 6000,
      },
    })
    .catch((error: unknown) => {
      log("[chat-message] Failed to show provider cache warning", {
        error: error instanceof Error ? error.message : String(error),
      })
    })
}
