import { log } from "../../../../shared/logger"
import type { OpenAIErrorType } from "../errors"
import {
  buildOpenAIResponse,
  buildOpenAIResponseWithToolCalls,
} from "../openai-response-builder"
import type { ChatCompletionRequest, ChatCompletionResponse } from "../schemas"
import { parseDsmlToolCalls, parseLeakedDsmlInContent } from "./parser"
import {
  applyParallelToolCallsPolicy,
  applyToolChoicePolicy,
} from "./policy"

export type ToolAwareResponseSelection =
  | { ok: true; response: ChatCompletionResponse }
  | { ok: false; httpStatus: number; errorType: OpenAIErrorType; message: string }

export type ToolAwareResponseInput = {
  body: ChatCompletionRequest
  rawContent: string
  toolsActive: boolean
  parallelEnabled: boolean
  requestId: string
  reasoningContent?: string
}

export function selectToolAwareResponse(
  input: ToolAwareResponseInput,
): ToolAwareResponseSelection {
  if (!input.toolsActive) {
    return {
      ok: true,
      response: buildOpenAIResponse({
        content: input.rawContent,
        model: input.body.model,
        reasoning_content: input.reasoningContent,
      }),
    }
  }
  const parsed = parseDsmlToolCalls(input.rawContent)
  const choiceFiltered = applyToolChoicePolicy(
    parsed.calls,
    input.body.tool_choice,
  )
  const capped = applyParallelToolCallsPolicy(
    choiceFiltered.kept,
    input.parallelEnabled,
  )
  if (capped.kept.length > 0) {
    log(
      `openai-compat-executor: tool_calls accepted [rid=${input.requestId}] parsed=${parsed.calls.length} kept=${capped.kept.length} filtered_choice=${choiceFiltered.filtered} dropped_parallel=${capped.dropped}`,
    )
    return {
      ok: true,
      response: buildOpenAIResponseWithToolCalls({
        toolCalls: capped.kept.map((c) => ({
          name: c.name,
          arguments: c.arguments,
        })),
        model: input.body.model,
        content: null,
        reasoning_content: input.reasoningContent,
      }),
    }
  }
  const leak = parseLeakedDsmlInContent(input.rawContent)
  if (leak.cleanContent !== input.rawContent) {
    const leakChoice = applyToolChoicePolicy(leak.tool_calls ?? [], input.body.tool_choice)
    const leakCapped = applyParallelToolCallsPolicy(
      leakChoice.kept,
      input.parallelEnabled,
    )
    if (leakCapped.kept.length > 0) {
      log(
        `openai-compat-executor: leaked DSML reparsed in content [rid=${input.requestId}] leaked=${leak.tool_calls?.length ?? 0} kept=${leakCapped.kept.length}`,
      )
      return {
        ok: true,
        response: buildOpenAIResponseWithToolCalls({
          toolCalls: leakCapped.kept.map((c) => ({
            name: c.name,
            arguments: c.arguments,
          })),
          model: input.body.model,
          content: leak.cleanContent.length > 0 ? leak.cleanContent : null,
          reasoning_content: input.reasoningContent,
        }),
      }
    }
    if (input.body.tool_choice === "required") {
      log(
        `openai-compat-executor: tool_choice required but model emitted no calls [rid=${input.requestId}] parsed=${parsed.calls.length}`,
      )
      return {
        ok: false,
        httpStatus: 502,
        errorType: "upstream_contract_violation",
        message: `tool_required_but_not_called: model produced ${parsed.calls.length} parsed call(s) but tool_choice="required"`,
      }
    }
    log(
      `openai-compat-executor: leaked DSML stripped in content [rid=${input.requestId}]`,
    )
    return {
      ok: true,
      response: buildOpenAIResponse({
        content: leak.cleanContent,
        model: input.body.model,
        reasoning_content: input.reasoningContent,
      }),
    }
  }
  if (input.body.tool_choice === "required") {
    log(
      `openai-compat-executor: tool_choice required but model emitted no calls [rid=${input.requestId}] parsed=${parsed.calls.length}`,
    )
    return {
      ok: false,
      httpStatus: 502,
      errorType: "upstream_contract_violation",
      message: `tool_required_but_not_called: model produced ${parsed.calls.length} parsed call(s) but tool_choice="required"`,
    }
  }
  return {
    ok: true,
    response: buildOpenAIResponse({
      content: input.rawContent,
      model: input.body.model,
      reasoning_content: input.reasoningContent,
    }),
  }
}
