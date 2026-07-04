import { isAbsolute, resolve } from "node:path"

import { reportToolHookStatus } from "../../extension/tool-hook-status"
import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { COMMENT_CHECKER_FEEDBACK_HEADER } from "./constants"
import { parseToolResultContext, parseToolResultEvent, toHookInput } from "./hook-input"
import { resolveSenpiCommentCheckerBinary } from "./resolver"
import { defaultRunCommentChecker } from "./runner"
import type { BinaryResolutionState, CommentCheckerComponentOptions } from "./types"
import { getString, normalizeFeedbackText } from "./utils"

export function createCommentCheckerComponent(options: CommentCheckerComponentOptions = {}): OmoSenpiComponent {
  const resolveBinary = options.resolveBinary ?? defaultResolveBinary
  const check = options.runCommentChecker ?? defaultRunCommentChecker
  let binaryPath: string | null | undefined
  let inertForSession = false
  let missingBinaryNoticeLogged = false
  const reportedFilesThisTurn = new Set<string>()

  return {
    name: "comment-checker",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      pi.on("turn_start", () => {
        reportedFilesThisTurn.clear()
        return undefined
      })

      pi.on("tool_result", async (payload, eventContext) => {
        const event = parseToolResultEvent(payload)
        if (event === undefined || event.isError || !isMutationToolName(event.toolName)) {
          return undefined
        }

        const rawPath = getString(event.input.path)
        if (rawPath === undefined) {
          return undefined
        }

        const toolContext = parseToolResultContext(eventContext)
        const absolutePath = isAbsolute(rawPath) ? rawPath : resolve(toolContext.cwd, rawPath)
        if (reportedFilesThisTurn.has(absolutePath)) {
          return undefined
        }

        const resolvedBinaryPath = ensureBinaryPath(resolveBinary, {
          logger: ctx.logger,
          get cachedBinaryPath() {
            return binaryPath
          },
          set cachedBinaryPath(value: string | null | undefined) {
            binaryPath = value
          },
          get inertForSession() {
            return inertForSession
          },
          set inertForSession(value: boolean) {
            inertForSession = value
          },
          get missingBinaryNoticeLogged() {
            return missingBinaryNoticeLogged
          },
          set missingBinaryNoticeLogged(value: boolean) {
            missingBinaryNoticeLogged = value
          },
        })
        if (resolvedBinaryPath === null) {
          return undefined
        }

        reportToolHookStatus(eventContext, "(OmO) Checking Comments")
        const result = await check({
          binaryPath: resolvedBinaryPath,
          hookInput: toHookInput(event, toolContext, absolutePath),
        })
        const message = normalizeFeedbackText(result.message)
        if (!result.hasComments || message.length === 0) {
          return undefined
        }

        reportedFilesThisTurn.add(absolutePath)
        return {
          content: [
            ...event.content,
            {
              type: "text",
              text: `${COMMENT_CHECKER_FEEDBACK_HEADER} ${absolutePath}:\n${message}`,
            },
          ],
        }
      })
    },
  }
}

function ensureBinaryPath(resolveBinary: () => string | null, state: BinaryResolutionState): string | null {
  if (state.inertForSession) {
    return null
  }
  if (state.cachedBinaryPath !== undefined) {
    return state.cachedBinaryPath
  }

  let nextBinaryPath: string | null
  try {
    nextBinaryPath = resolveBinary()
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    state.logger.warn("omo-senpi comment-checker binary resolution failed; component disabled for this session", { error })
    nextBinaryPath = null
  }

  state.cachedBinaryPath = nextBinaryPath
  if (nextBinaryPath === null) {
    state.inertForSession = true
    if (!state.missingBinaryNoticeLogged) {
      state.logger.warn("omo-senpi comment-checker binary unavailable; component disabled for this session")
      state.missingBinaryNoticeLogged = true
    }
  }
  return nextBinaryPath
}

function isMutationToolName(toolName: string): toolName is "edit" | "write" {
  return toolName === "edit" || toolName === "write"
}

function defaultResolveBinary(): string | null {
  return resolveSenpiCommentCheckerBinary()
}
