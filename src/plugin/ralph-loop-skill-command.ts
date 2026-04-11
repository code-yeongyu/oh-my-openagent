import type { CreatedHooks } from "../create-hooks"
import { parseRalphLoopArguments } from "../hooks/ralph-loop/command-arguments"

type RalphLoopHooks = Pick<CreatedHooks, "ralphLoop">

export function handleRalphLoopSkillCommand(args: {
  hooks: RalphLoopHooks
  sessionID: string
  command: string | undefined
  outputArgs: Record<string, unknown>
}): void {
  const { hooks, sessionID, command, outputArgs } = args
  if (!hooks.ralphLoop || !command) {
    return
  }

  if (command === "ralph-loop") {
    const rawArgs = getLoopCommandArguments(outputArgs, "ralph-loop")
    const parsedArguments = parseRalphLoopArguments(rawArgs)

    hooks.ralphLoop.startLoop(sessionID, parsedArguments.prompt, {
      maxIterations: parsedArguments.maxIterations,
      completionPromise: parsedArguments.completionPromise,
      strategy: parsedArguments.strategy,
    })
    return
  }

  if (command === "cancel-ralph") {
    hooks.ralphLoop.cancelLoop(sessionID)
    return
  }

  if (command === "ulw-loop") {
    const rawArgs = getLoopCommandArguments(outputArgs, "ulw-loop")
    const parsedArguments = parseRalphLoopArguments(rawArgs)

    hooks.ralphLoop.startLoop(sessionID, parsedArguments.prompt, {
      ultrawork: true,
      maxIterations: parsedArguments.maxIterations,
      completionPromise: parsedArguments.completionPromise,
      strategy: parsedArguments.strategy,
    })
  }
}

function getLoopCommandArguments(
  args: Record<string, unknown>,
  command: "ralph-loop" | "ulw-loop",
): string {
  const rawUserMessage = typeof args.user_message === "string" ? args.user_message.trim() : ""
  if (rawUserMessage) {
    return rawUserMessage
  }

  const rawName = typeof args.name === "string" ? args.name : ""
  return rawName.replace(new RegExp(`^/?(${command})\\s*`, "i"), "")
}
