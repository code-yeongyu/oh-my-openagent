import { isAbsolute, resolve } from "node:path"

import { reportToolHookStatus } from "../../extension/tool-hook-status"
import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { COMMENT_CHECKER_FEEDBACK_HEADER } from "./constants"
import { parseToolResultContext, parseToolResultEvent, toApplyPatchHookInputs, toHookInput } from "./hook-input"
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

        const toolContext = parseToolResultContext(eventContext)
        const rawPath = getString(event.input.path)
        const patchInputs = event.toolName === "apply_patch" ? toApplyPatchHookInputs(event, toolContext) : []
        if (rawPath === undefined && patchInputs.length === 0) return undefined
        const absolutePath = rawPath === undefined ? undefined : (isAbsolute(rawPath) ? rawPath : resolve(toolContext.cwd, rawPath))
        const paths = patchInputs.length > 0 ? patchInputs.map((input) => input.tool_input.file_path).filter((path): path is string => typeof path === "string") : absolutePath ? [absolutePath] : []
        const uniquePaths = paths.filter((path, index) => paths.indexOf(path) === index).filter((path) => !reportedFilesThisTurn.has(path))
        if (uniquePaths.length === 0) return undefined

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
        const inputs = event.toolName === "apply_patch" ? patchInputs : [toHookInput(event, toolContext, uniquePaths[0])]
        const feedback: string[] = []
        for (const hookInput of inputs) {
          const path = hookInput.tool_input.file_path
          if (typeof path !== "string" || !uniquePaths.includes(path)) continue
          const result = await check({ binaryPath: resolvedBinaryPath, hookInput })
          const message = normalizeFeedbackText(result.message)
          if (result.hasComments && message.length > 0) {
            reportedFilesThisTurn.add(path)
            feedback.push(`${COMMENT_CHECKER_FEEDBACK_HEADER} ${path}:\n${message}`)
          }
        }
        if (feedback.length === 0) return undefined
        return { content: [...event.content, ...feedback.map((text) => ({ type: "text", text }))] }
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

function isMutationToolName(toolName: string): toolName is "edit" | "write" | "apply_patch" {
  return toolName === "edit" || toolName === "write" || toolName === "apply_patch"
}

function defaultResolveBinary(): string | null {
  return resolveSenpiCommentCheckerBinary()
}
