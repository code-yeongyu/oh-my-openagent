import type { KeyEvent } from "@opentui/core"
import type { KeyInputContext } from "@opentui/keymap"

const DOUBLE_ESCAPE_MAX_INTERVAL_MS = 1_000

export function createBtwEscapeReturn(args: {
  isCurrentSideIdle: () => boolean
  isDialogOpen: () => boolean
  clearPending: () => void
  returnToParent: () => void
  now?: () => number
}) {
  const now = args.now ?? Date.now
  let firstEscapeAt: number | undefined

  function reset(): void {
    firstEscapeAt = undefined
  }

  function handle(context: KeyInputContext<KeyEvent>): void {
    if (
      context.event.eventType !== "press" ||
      context.event.name !== "escape"
    ) {
      if (context.event.eventType !== "release") reset()
      return
    }
    if (args.isDialogOpen() || !args.isCurrentSideIdle()) {
      reset()
      return
    }
    const pressedAt = now()
    if (
      firstEscapeAt === undefined ||
      pressedAt - firstEscapeAt > DOUBLE_ESCAPE_MAX_INTERVAL_MS
    ) {
      firstEscapeAt = pressedAt
      return
    }

    reset()
    args.clearPending()
    context.consume({
      preventDefault: true,
      stopPropagation: true,
    })
    args.returnToParent()
  }

  return {
    handle,
    reset,
  }
}
