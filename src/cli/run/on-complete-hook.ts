import { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide"
import { log } from "../../shared"

async function readOutput(
  stream: ReadableStream<Uint8Array> | undefined,
  streamName: "stdout" | "stderr"
): Promise<string> {
  if (!stream) {
    return ""
  }

  try {
    return await new Response(stream).text()
  } catch (error) {
    log("Failed to read on-complete hook output", {
      stream: streamName,
      error: error instanceof Error ? error.message : String(error),
    })
    return ""
  }
}

export async function executeOnCompleteHook(options: {
  command: string
  sessionId: string
  exitCode: number
  durationMs: number
  messageCount: number
}): Promise<void> {
  const { command, sessionId, exitCode, durationMs, messageCount } = options

  const trimmedCommand = command.trim()
  if (!trimmedCommand) {
    return
  }

  log("Running on-complete hook", { command: trimmedCommand })

  try {
    const proc = spawnWithWindowsHide(["sh", "-c", trimmedCommand], {
      env: {
        ...process.env,
        SESSION_ID: sessionId,
        EXIT_CODE: String(exitCode),
        DURATION_MS: String(durationMs),
        MESSAGE_COUNT: String(messageCount),
      },
      stdout: "pipe",
      stderr: "pipe",
    })

    const [hookExitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      readOutput(proc.stdout, "stdout"),
      readOutput(proc.stderr, "stderr"),
    ])

    if (stdout.trim()) {
      log("On-complete hook stdout", { command: trimmedCommand, stdout: stdout.trim() })
    }

    if (stderr.trim()) {
      log("On-complete hook stderr", { command: trimmedCommand, stderr: stderr.trim() })
    }

    if (hookExitCode !== 0) {
      log("On-complete hook exited with non-zero code", {
        command: trimmedCommand,
        exitCode: hookExitCode,
      })
    }
  } catch (error) {
    log("Failed to execute on-complete hook", {
      command: trimmedCommand,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
