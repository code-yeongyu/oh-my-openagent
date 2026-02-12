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

export { resolveRunAgent }

const DEFAULT_TIMEOUT_MS = 600_000

export async function run(options: RunOptions): Promise<number> {
  process.env.OPENCODE_CLI_RUN_MODE = "true"

  const startTime = Date.now()
  const {
    message,
    directory = process.cwd(),
    timeout = DEFAULT_TIMEOUT_MS,
  } = options

  const jsonManager = options.json ? createJsonOutputManager() : null
  if (jsonManager) jsonManager.redirectToStderr()

  const pluginConfig = loadPluginConfig(directory, { command: "run" })
  const resolvedAgent = resolveRunAgent(options, pluginConfig)
  const abortController = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  if (timeout > 0) {
    timeoutId = setTimeout(() => {
      console.log(pc.yellow("\nTimeout reached. Aborting..."))
      abortController.abort()
    }, timeout)
  }

  try {
    const { client, cleanup: serverCleanup } = await createServerConnection({
      port: options.port,
      attach: options.attach,
      signal: abortController.signal,
    })

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      serverCleanup()
    }

    process.on("SIGINT", () => {
      console.log(pc.yellow("\nInterrupted. Shutting down..."))
      cleanup()
      process.exit(130)
    })

    try {
      const sessionID = await resolveSession({
        client,
        sessionId: options.sessionId,
      })

      console.log(pc.dim(`Session: ${sessionID}`))

      const ctx: RunContext = { client, sessionID, directory, abortController }
      const events = await client.event.subscribe({ query: { directory } })
      const eventState = createEventState()
      const eventProcessor = processEvents(ctx, events.stream, eventState).catch(
        () => {},
      )

      console.log(pc.dim("\nSending prompt..."))
      await client.session.promptAsync({
        path: { id: sessionID },
        body: {
          agent: resolvedAgent,
          parts: [{ type: "text", text: message }],
        },
        query: { directory },
      })

       console.log(pc.dim("Waiting for completion...\n"))
       const exitCode = await pollForCompletion(ctx, eventState, abortController)

       // Abort the event stream to stop the processor
       abortController.abort()

       await eventProcessor
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
    }
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId)
    if (jsonManager) jsonManager.restore()
    if (err instanceof Error && err.name === "AbortError") {
      return 130
    }
    console.error(pc.red(`Error: ${serializeError(err)}`))
    return 1
  }
}

