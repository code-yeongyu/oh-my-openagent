import { drainSkipsAfter } from "../../shared/fsync-skip-tracker"
import { formatFsyncSkipWarning } from "../../shared/fsync-skip-warning-formatter"

type ToolExecuteInput = {
  tool: string
  sessionID: string
  callID: string
}

type ToolBeforeOutput = {
  args: Record<string, unknown>
}

type ToolAfterOutput = {
  title: string
  output: string
  metadata: unknown
}

export function createFsyncSkipWarningHook() {
  const startTimesByCallId = new Map<string, number>()

  const toolExecuteBefore = async (
    input: ToolExecuteInput,
    _output: ToolBeforeOutput,
  ): Promise<void> => {
    startTimesByCallId.set(input.callID, Date.now())
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolAfterOutput,
  ): Promise<void> => {
    if (typeof output.output !== "string") return

    const startTimestamp = startTimesByCallId.get(input.callID) ?? 0
    startTimesByCallId.delete(input.callID)

    const skips = drainSkipsAfter(startTimestamp)
    const warning = formatFsyncSkipWarning(skips)
    if (warning.length === 0) return

    output.output = `${output.output}\n\n${warning}`
  }

  return {
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
  }
}
