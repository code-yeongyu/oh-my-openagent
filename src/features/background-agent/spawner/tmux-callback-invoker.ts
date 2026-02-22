import { setTimeout } from "timers/promises"
import type { OnSubagentSessionCreated } from "../constants"
import { TMUX_CALLBACK_DELAY_MS } from "../constants"
import { log } from "../../../shared"
import { isInsideTmux } from "../../../shared/tmux"

export async function maybeInvokeTmuxCallback(options: {
  onSubagentSessionCreated?: OnSubagentSessionCreated
  tmuxEnabled: boolean
  sessionID: string
  parentID: string
  title: string
}): Promise<void> {
  const { onSubagentSessionCreated, tmuxEnabled, sessionID, parentID, title } = options

  log("[background-agent] tmux callback check", {
    hasCallback: !!onSubagentSessionCreated,
    tmuxEnabled,
    isInsideTmux: isInsideTmux(),
    sessionID,
    parentID,
  })

  if (!onSubagentSessionCreated || !tmuxEnabled || !isInsideTmux()) {
    log("[background-agent] SKIP tmux callback - conditions not met")
    return
  }

  log("[background-agent] Invoking tmux callback NOW", { sessionID })
  await onSubagentSessionCreated({
    sessionID,
    parentID,
    title,
  }).catch((error: unknown) => {
    log("[background-agent] Failed to spawn tmux pane:", error)
  })

  log("[background-agent] tmux callback completed, waiting")
  await setTimeout(TMUX_CALLBACK_DELAY_MS)
}
