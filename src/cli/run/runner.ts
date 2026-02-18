import pc from "picocolors"
import type { RunOptions, RunContext } from "./types"
import { createEventState, processEvents, serializeError } from "./events"
import { loadPluginConfig } from "../../plugin-config"
import { createServerConnection } from "./server-connection"
import { resolveSession } from "./session-resolver"
import { createJsonOutputManager } from "./json-output"
import { executeOnCompleteHook } from "./on-complete-hook"
import { resolveRunAgent } from "./agent-resolver"
import { pollForCompletion } from "./poll-for-completion"
import { loadAgentProfileColors } from "./agent-profile-colors"
import { suppressRunInput } from "./stdin-suppression"

export { resolveRunAgent }

const EVENT_PROCESSOR_SHUTDOWN_TIMEOUT_MS = 2_000

export async function waitForEventProcessorShutdown(
  eventProcessor: Promise<void>,
  timeoutMs = EVENT_PROCESSOR_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  const completed = await Promise.race([
    eventProcessor.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ])

  void completed
}

export async function run(options: RunOptions): Promise<number> {
  process.env.OPENCODE_CLI_RUN_MODE = "true"

  const startTime = Date.now()
  const {
    message,
    directory = process.cwd(),
  } = options

  const jsonManager = options.json ? createJsonOutputManager() : null
  if (jsonManager) jsonManager.redirectToStderr()

  const pluginConfig = loadPluginConfig(directory, { command: "run" })
  const resolvedAgent = resolveRunAgent(options, pluginConfig)
  const abortController = new AbortController()

  try {
    const { client, cleanup: serverCleanup } = await createServerConnection({
      port: options.port,
      attach: options.attach,
      signal: abortController.signal,
    })

    const cleanup = () => {
      serverCleanup()
    }

    const restoreInput = suppressRunInput()
    const handleSigint = () => {
      console.log(pc.yellow("\nInterrupted. Shutting down..."))
      restoreInput()
      cleanup()
      process.exit(130)
    }

    process.on("SIGINT", handleSigint)

    try {
      const sessionID = await resolveSession({
        client,
        sessionId: options.sessionId,
        directory,
      })

      console.log(pc.dim(`Session: ${sessionID}`))

      const ctx: RunContext = {
        client,
        sessionID,
        directory,
        abortController,
        verbose: options.verbose ?? false,
      }
      const events = await client.event.subscribe({ query: { directory } })
      const eventState = createEventState()
      eventState.agentColorsByName = await loadAgentProfileColors(client)
      const eventProcessor = processEvents(ctx, events.stream, eventState).catch(
        () => {},
      )

      await client.session.promptAsync({
        path: { id: sessionID },
        body: {
          agent: resolvedAgent,
          tools: {
            question: false,
          },
          parts: [{ type: "text", text: message }],
        },
        query: { directory },
      })
      const exitCode = await pollForCompletion(ctx, eventState, abortController)

      // Abort the event stream to stop the processor
      abortController.abort()

      await waitForEventProcessorShutdown(eventProcessor)
      cleanup()

      const durationMs = Date.now() - startTime

      if (options.onComplete) {
        await executeOnCompleteHook({
          command: options.onComplete,
          sessionId: sessionID,
          exitCode,
          durationMs,
          messageCount: eventState.messageCount,
        })
      }

      if (jsonManager) {
        jsonManager.emitResult({
          sessionId: sessionID,
          success: exitCode === 0,
          durationMs,
          messageCount: eventState.messageCount,
          summary: eventState.lastPartText.slice(0, 200) || "Run completed",
        })
      }

      return exitCode
    } catch (err) {
      cleanup()
      throw err
    } finally {
      process.removeListener("SIGINT", handleSigint)
      restoreInput()
    }
  } catch (err) {
    if (jsonManager) jsonManager.restore()
    if (err instanceof Error && err.name === "AbortError") {
      return 130
    }
    console.error(pc.red(`Error: ${serializeError(err)}`))
    return 1
  }
}
