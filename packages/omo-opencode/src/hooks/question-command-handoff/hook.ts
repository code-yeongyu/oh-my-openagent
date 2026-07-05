import type { PluginInput } from "@opencode-ai/plugin"

import { getSessionAgent } from "../../features/claude-code-session-state"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { log } from "../../shared/logger"
import { discoverCommandsSync } from "../../tools/slashcommand/command-discovery"
import {
  dispatchInternalPrompt,
  isInternalPromptDispatchAccepted,
} from "../shared/prompt-async-gate"
import type {
  InternalPromptDispatchArgs,
  InternalPromptDispatchResult,
  PromptAsyncInput,
  PromptDispatchClient,
} from "../../shared/prompt-async-gate/types"
import { HANDOFF_AGENTS, HOOK_NAME, QUESTION_TOOL_NAMES } from "./constants"
import { resolveAnsweredCommandReference, type AnsweredQuestion } from "./detector"

const COMMAND_NAME_CACHE_TTL_MS = 30_000
const PROCESSED_ANSWER_KEY_LIMIT = 256

interface ToolExecuteAfterInput {
  readonly tool: string
  readonly sessionID: string
  readonly callID?: string
  readonly args?: Record<string, unknown>
}

interface ToolExecuteAfterOutput {
  title: string
  output: string
  metadata: Record<string, unknown>
}

export type QuestionCommandDispatch = (
  args: InternalPromptDispatchArgs<PromptAsyncInput>,
) => Promise<InternalPromptDispatchResult>

export interface QuestionCommandHandoffDeps {
  dispatch?: QuestionCommandDispatch
  discoverCommandNames?: (directory: string) => ReadonlySet<string>
  getAgent?: (sessionID: string) => string | undefined
  now?: () => number
}

function isAnsweredQuestionArray(value: unknown): value is AnsweredQuestion[] {
  return (
    Array.isArray(value)
    && value.every((question) =>
      typeof question === "object"
      && question !== null
      && Array.isArray((question as AnsweredQuestion).options))
  )
}

function isAnswerMatrix(value: unknown): value is string[][] {
  return (
    Array.isArray(value)
    && value.every((answer) =>
      Array.isArray(answer) && answer.every((label) => typeof label === "string"))
  )
}

function discoverCommandNamesFromDisk(directory: string): ReadonlySet<string> {
  return new Set(
    discoverCommandsSync(directory).map((command) => command.name.toLowerCase()),
  )
}

export function createQuestionCommandHandoffHook(
  ctx: PluginInput,
  deps: QuestionCommandHandoffDeps = {},
) {
  const dispatch: QuestionCommandDispatch = deps.dispatch ?? dispatchInternalPrompt
  const discoverCommandNames = deps.discoverCommandNames ?? discoverCommandNamesFromDisk
  const getAgent = deps.getAgent ?? getSessionAgent
  const now = deps.now ?? Date.now
  const promptClient: PromptDispatchClient = ctx.client

  let commandNameCache: { names: ReadonlySet<string>; cachedAt: number } | null = null
  const processedAnswerKeys = new Set<string>()

  const getKnownCommandNames = (): ReadonlySet<string> => {
    if (commandNameCache && now() - commandNameCache.cachedAt < COMMAND_NAME_CACHE_TTL_MS) {
      return commandNameCache.names
    }
    commandNameCache = { names: discoverCommandNames(ctx.directory), cachedAt: now() }
    return commandNameCache.names
  }

  const markProcessed = (key: string): boolean => {
    if (processedAnswerKeys.has(key)) return false
    processedAnswerKeys.add(key)
    if (processedAnswerKeys.size > PROCESSED_ANSWER_KEY_LIMIT) {
      const oldest = processedAnswerKeys.values().next().value
      if (oldest !== undefined) processedAnswerKeys.delete(oldest)
    }
    return true
  }

  return {
    "tool.execute.after": async (
      input: ToolExecuteAfterInput,
      output: ToolExecuteAfterOutput | undefined,
    ): Promise<void> => {
      if (!output) return
      if (!QUESTION_TOOL_NAMES.has(input.tool?.toLowerCase())) return

      const agent = getAgent(input.sessionID)
      if (!agent || !HANDOFF_AGENTS.has(getAgentConfigKey(agent))) return

      const questions = input.args?.questions
      const answers = output.metadata?.answers
      if (!isAnsweredQuestionArray(questions) || !isAnswerMatrix(answers)) return

      const commandName = resolveAnsweredCommandReference({
        questions,
        answers,
        knownCommandNames: getKnownCommandNames(),
      })
      if (!commandName) return

      // Answer labels are not a per-call identity, so dedupe only on real
      // call IDs. Without one, the prompt-async-gate's semantic dedupe still
      // collapses duplicate events that would dispatch the same command.
      if (input.callID && !markProcessed(`${input.sessionID}:${input.callID}`)) return

      const result = await dispatch({
        mode: "async",
        client: promptClient,
        sessionID: input.sessionID,
        source: HOOK_NAME,
        input: {
          path: { id: input.sessionID },
          body: { parts: [{ type: "text", text: `/${commandName}` }] },
          query: { directory: ctx.directory },
        },
      })

      if (isInternalPromptDispatchAccepted(result)) {
        log(`[${HOOK_NAME}] Dispatched /${commandName} from answered question option`, {
          sessionID: input.sessionID,
          status: result.status,
        })
        return
      }

      log(`[${HOOK_NAME}] Dispatch of /${commandName} was not accepted`, {
        sessionID: input.sessionID,
        status: result.status,
      })
    },
  }
}
