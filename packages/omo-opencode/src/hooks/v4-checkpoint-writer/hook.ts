import { writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { log } from "../../shared/logger"

const CHECKPOINT_INTERVAL = 20
const CHECKPOINT_DIR_NAME = ".omo/checkpoints"

function isV4Model(modelID: string): boolean {
  const lower = modelID.toLowerCase()
  return lower.includes("deepseek-v4") || lower.includes("deepseek_v4")
}

function resolveCheckpointDir(directory?: string): string {
  if (directory) return join(directory, CHECKPOINT_DIR_NAME)
  return join(homedir(), ".omo", "checkpoints")
}

type SessionState = {
  modelID: string
  toolCallCount: number
  lastToolName: string
  lastCheckpointAt: number
}

type SessionStateCache = Map<string, SessionState>

export function createV4CheckpointWriterHook(options?: { directory?: string }) {
  const sessionStates: SessionStateCache = new Map()
  const checkpointDir = resolveCheckpointDir(options?.directory)

  return {
    event: (input: {
      event: {
        type: string
        properties: {
          info?: {
            sessionID?: string
            modelID?: string
            role?: string
          }
        }
      }
    }): void => {
      if (input.event.type !== "message.updated") return
      const info = input.event.properties?.info
      if (!info?.modelID || !info?.sessionID) return
      if (!isV4Model(info.modelID)) return

      const existing = sessionStates.get(info.sessionID)
      if (!existing) {
        sessionStates.set(info.sessionID, {
          modelID: info.modelID,
          toolCallCount: 0,
          lastToolName: "",
          lastCheckpointAt: 0,
        })
      } else {
        existing.modelID = info.modelID
      }
    },

    "tool.execute.after": (
      input: { tool: string; sessionID: string; callID: string },
      _output?: { title?: string; output?: string; metadata?: unknown },
    ): void => {
      const state = sessionStates.get(input.sessionID)
      if (!state) return

      state.toolCallCount++
      state.lastToolName = input.tool

      if (state.toolCallCount % CHECKPOINT_INTERVAL !== 0) return

      const now = Date.now()
      state.lastCheckpointAt = now

      const checkpoint = {
        sessionID: input.sessionID,
        modelID: state.modelID,
        toolCallCount: state.toolCallCount,
        lastToolName: state.lastToolName,
        timestamp: new Date(now).toISOString(),
      }

      try {
        if (!existsSync(checkpointDir)) {
          mkdirSync(checkpointDir, { recursive: true })
        }
        const filePath = join(checkpointDir, `${input.sessionID}.json`)
        writeFileSync(filePath, JSON.stringify(checkpoint, null, 2) + "\n", "utf8")
        log("[v4-checkpoint-writer] Checkpoint written", {
          sessionID: input.sessionID,
          toolCallCount: state.toolCallCount,
        })
      } catch (error) {
        log("[v4-checkpoint-writer] Failed to write checkpoint", {
          sessionID: input.sessionID,
          error: String(error),
        })
      }
    },
  }
}
