import type { OhMyOpenCodeConfig } from "../../config"

import { isRalphLoopResumeArgument, parseRalphLoopArguments } from "../../hooks/ralph-loop/command-arguments"
import { log } from "../../shared"
import { NATIVE_LOOP_TRIGGERED_FLAG } from "../command-execute-before"
import { extractPromptText } from "./prompt-text"
import { clearStoppedContinuationBeforeWorkStart } from "./start-work-message"
import type { ChatMessageHooks, ChatMessageHandlerOutput, ChatMessageInput } from "./types"

type RawLoopCommand =
  | { readonly command: "ralph-loop" | "ulw-loop"; readonly args: string }
  | { readonly command: "cancel-ralph"; readonly args: "" }

function parseRawLoopSlashCommand(promptText: string): RawLoopCommand | null {
  const trimmed = promptText.trim()
  const commandText = trimmed.startsWith("/")
    ? trimmed
    : trimmed
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^\/(?:ralph-loop|ulw-loop|cancel-ralph)\b/i.test(line))
        .at(-1)

  if (!commandText) {
    return null
  }

  const cancelMatch = commandText.match(/^\/cancel-ralph(?:\s+.*)?$/i)
  if (cancelMatch) {
    return { command: "cancel-ralph", args: "" }
  }

  const loopMatch = commandText.match(/^\/(ralph-loop|ulw-loop)\s*([\s\S]*)$/i)
  if (!loopMatch) {
    return null
  }

  const command = loopMatch[1]?.toLowerCase()
  const args = loopMatch[2]?.trim() ?? ""

  if (command === "ralph-loop" || command === "ulw-loop") {
    return { command, args }
  }

  return null
}

export function handleRalphLoopMessage(args: {
  readonly hooks: ChatMessageHooks
  readonly input: ChatMessageInput
  readonly output: ChatMessageHandlerOutput
  readonly isFirstMessage: boolean
  readonly pluginConfig: OhMyOpenCodeConfig
}): void {
  const { hooks, input, output, isFirstMessage, pluginConfig } = args
  if (!hooks.ralphLoop || output.message[NATIVE_LOOP_TRIGGERED_FLAG] === true) {
    return
  }

  const promptText = extractPromptText(output.parts)
  const isRalphLoopTemplate =
    promptText.includes("You are starting a Ralph Loop") &&
    promptText.includes("<user-task>")
  const isUlwLoopTemplate =
    promptText.includes("You are starting an ULTRAWORK Loop") &&
    promptText.includes("<user-task>")
  const isCancelRalphTemplate = promptText.includes(
    "Cancel the currently active Ralph Loop",
  )
  const rawLoopCommand =
    !isRalphLoopTemplate && !isUlwLoopTemplate && !isCancelRalphTemplate
      ? parseRawLoopSlashCommand(promptText)
      : null

  if (
    isRalphLoopTemplate ||
    isUlwLoopTemplate ||
    rawLoopCommand?.command === "ralph-loop" ||
    rawLoopCommand?.command === "ulw-loop"
  ) {
    const taskMatch = promptText.match(/<user-task>\s*([\s\S]*?)\s*<\/user-task>/i)
    const rawTask = taskMatch?.[1]?.trim() || rawLoopCommand?.args || ""
    const parsedArguments = parseRalphLoopArguments(rawTask)
    const ultrawork = isUlwLoopTemplate || rawLoopCommand?.command === "ulw-loop"
    const command = ultrawork ? "ulw-loop" : "ralph-loop"

    clearStoppedContinuationBeforeWorkStart(hooks, input.sessionID, command)
    const resumed = isRalphLoopResumeArgument(rawTask)
      && hooks.ralphLoop.resumeLoop?.(input.sessionID) === true
    if (!resumed) {
      hooks.ralphLoop.startLoop(input.sessionID, parsedArguments.prompt, {
        ultrawork,
        maxIterations: parsedArguments.maxIterations,
        completionPromise: parsedArguments.completionPromise,
        strategy: parsedArguments.strategy,
      })
    }
  } else if (isCancelRalphTemplate || rawLoopCommand?.command === "cancel-ralph") {
    hooks.ralphLoop.cancelLoop(input.sessionID)
  }

  if (
    !isRalphLoopTemplate
    && !isUlwLoopTemplate
    && !isCancelRalphTemplate
    && !rawLoopCommand
    && isFirstMessage
    && pluginConfig.default_mode?.ralph_loop
  ) {
    const ultrawork = pluginConfig.default_mode?.ultrawork ?? false
    hooks.ralphLoop.startLoop(input.sessionID, promptText, {
      ultrawork,
    })
    log("[chat-message] Default ralph loop auto-started", {
      sessionID: input.sessionID,
      ultrawork,
    })
  }
}
