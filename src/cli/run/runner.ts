import { createOpencode } from "@opencode-ai/sdk"
import pc from "picocolors"
import type { RunOptions, RunContext } from "./types"
import { checkCompletionConditions } from "./completion"
import { createEventState, processEvents } from "./events"

const POLL_INTERVAL_MS = 500
const DEFAULT_TIMEOUT_MS = 0

export async function run(options: RunOptions): Promise<number> {
  const {
    message,
    agent,
    directory = process.cwd(),
    timeout = DEFAULT_TIMEOUT_MS,
  } = options

  console.log(pc.cyan("Starting opencode server..."))

  const abortController = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  // timeout=0 means no timeout (run until completion)
  if (timeout > 0) {
    timeoutId = setTimeout(() => {
      console.log(pc.yellow("\nTimeout reached. Aborting..."))
      abortController.abort()
    }, timeout)
  }

  try {
    const { client, server } = await createOpencode({
      signal: abortController.signal,
    })

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      server.close()
    }

    process.on("SIGINT", () => {
      console.log(pc.yellow("\nInterrupted. Shutting down..."))
      cleanup()
      process.exit(130)
    })

    try {
      const sessionRes = await client.session.create({
        body: { title: "oh-my-opencode run" },
      })

      const sessionID = sessionRes.data?.id
      if (!sessionID) {
        console.error(pc.red("Failed to create session"))
        return 1
      }

      console.log(pc.dim(`Session: ${sessionID}`))

      const ctx: RunContext = {
        client,
        sessionID,
        directory,
        abortController,
      }

      const events = await client.event.subscribe()
      const eventState = createEventState()
      const eventProcessor = processEvents(ctx, events.stream, eventState)

      console.log(pc.dim("\nSending prompt..."))
      await client.session.promptAsync({
        path: { id: sessionID },
        body: {
          agent,
          parts: [{ type: "text", text: message }],
        },
        query: { directory },
      })

      console.log(pc.dim("Waiting for completion...\n"))

      while (!abortController.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

        if (!eventState.mainSessionIdle) {
          continue
        }

        // Check if session errored - exit with failure if so
        if (eventState.mainSessionError) {
          console.error(pc.red(`\n\nSession ended with error: ${eventState.lastError}`))
          console.error(pc.yellow("Check if todos were completed before the error."))
          abortController.abort()
          await eventProcessor.catch(() => {})
          cleanup()
          return 1
        }

        const shouldExit = await checkCompletionConditions(ctx)
        if (shouldExit) {
          console.log(pc.green("\n\nAll tasks completed."))
          abortController.abort()
          await eventProcessor.catch(() => {})
          cleanup()
          return 0
        }
      }

      await eventProcessor.catch(() => {})
      cleanup()
      return 130
    } catch (err) {
      cleanup()
      throw err
    }
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId)
    if (err instanceof Error && err.name === "AbortError") {
      return 130
    }
    console.error(pc.red(`Error: ${err}`))
    return 1
  }
}
