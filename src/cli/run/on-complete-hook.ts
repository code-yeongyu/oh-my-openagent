import { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide"
import { detectShellType, log } from "../../shared"

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

function resolveHookShellCommand(command: string): string[] {
  const shellType = detectShellType()

  switch (shellType) {
    case "powershell": {
      const powershellExecutable = process.platform === "win32" ? "powershell.exe" : "pwsh"
      return [powershellExecutable, "-NoProfile", "-Command", command]
    }
    case "cmd":
      return [process.env.ComSpec || "cmd.exe", "/d", "/s", "/c", command]
    case "csh":
      return ["csh", "-c", command]
    case "unix":
    default:
      return ["sh", "-c", command]
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
    const shellCommand = resolveHookShellCommand(trimmedCommand)
    const proc = spawnWithWindowsHide(shellCommand, {
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
