import { existsSync, mkdirSync, appendFileSync, statSync, renameSync, readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

const CONFIG_DIR = join(homedir(), ".claude", "homunculus")
const OBSERVATIONS_FILE = join(CONFIG_DIR, "observations.jsonl")
const OBSERVER_PID_FILE = join(CONFIG_DIR, ".observer.pid")
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB

export function createObservationRecorderHook() {
  const record = async (event: "tool_start" | "tool_complete", tool: string, sessionID: string, data: string | unknown) => {
    try {
      // Ensure directory exists
      if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true })
      }

      // Skip if disabled
      if (existsSync(join(CONFIG_DIR, "disabled"))) {
        return
      }

      // Archive if file too large
      if (existsSync(OBSERVATIONS_FILE)) {
        try {
          const stats = statSync(OBSERVATIONS_FILE)
          if (stats.size >= MAX_FILE_SIZE_BYTES) {
            const archiveDir = join(CONFIG_DIR, "observations.archive")
            if (!existsSync(archiveDir)) {
              mkdirSync(archiveDir, { recursive: true })
            }
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
            renameSync(OBSERVATIONS_FILE, join(archiveDir, `observations-${timestamp}.jsonl`))
          }
        } catch {
          // Ignore archive errors
        }
      }

      // Build observation
      const observation: any = {
        timestamp: new Date().toISOString(),
        event,
        tool,
        session: sessionID,
      }

      // Handle input/output data - guard against undefined
      const dataStr = typeof data === "string" ? data : (data !== undefined ? JSON.stringify(data) : "")
      const truncated = (dataStr ?? "").slice(0, 5000)
      
      if (event === "tool_start") {
        observation.input = truncated
      } else {
        observation.output = truncated
      }

      appendFileSync(OBSERVATIONS_FILE, JSON.stringify(observation) + "\n")

      // Signal observer if running
      if (existsSync(OBSERVER_PID_FILE)) {
        try {
          const pid = parseInt(readFileSync(OBSERVER_PID_FILE, "utf-8").trim(), 10)
          if (!isNaN(pid)) {
            process.kill(pid, "SIGUSR1")
          }
        } catch {
          // Ignore signaling errors
        }
      }
    } catch (err) {
      console.warn(
        `[observation-recorder] Failed to record observation: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  return {
    "tool.execute.before": async (input: { tool: string; sessionID: string; callID: string; input: unknown }): Promise<void> => {
      await record("tool_start", input.tool, input.sessionID, input.input)
    },
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ): Promise<void> => {
      await record("tool_complete", input.tool, input.sessionID, output.output)
    },
  }
}
