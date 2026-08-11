import type { ComponentContext, OmoSenpiComponent } from "../../extension/types"
import {
  capResultContentWithMetadata,
  type CapTextBlockOptions,
  type ResultCapMetadata,
} from "./cap"

interface ToolResultEventLike {
  readonly toolName?: unknown
  readonly content?: unknown
  readonly details?: unknown
  readonly isError?: unknown
  readonly usage?: unknown
}

function isToolResultEvent(value: unknown): value is ToolResultEventLike & { content: ReadonlyArray<{ type: string }> } {
  if (typeof value !== "object" || value === null) return false
  const content = Reflect.get(value, "content")
  return Array.isArray(content)
}

function logCapEvent(ctx: ComponentContext, toolName: string, metadata: ResultCapMetadata): void {
  ctx.logger.info("omo-senpi tool result capped", {
    toolName,
    originalTextBytes: metadata.originalTextBytes,
    emittedTextBytes: metadata.emittedTextBytes,
    originalTextBlocks: metadata.originalTextBlocks,
    emittedTextBlocks: metadata.emittedTextBlocks,
    cappedBlocks: metadata.cappedBlocks,
    perBlockCapped: metadata.perBlockCapped,
    aggregateCapped: metadata.aggregateCapped,
  })
}

export interface ResultSizeCapOptions extends CapTextBlockOptions {}

/**
 * Bound textual results in Senpi's `tool_result` hook. Senpi emits this hook
 * after execution but before it admits the returned replacement into the
 * transcript/provider context, so it covers built-in and extension tools
 * regardless of registration order. Non-text payloads remain a Senpi-core
 * concern tracked by issue #6528.
 */
export function createResultSizeCapComponent(options: ResultSizeCapOptions = {}): OmoSenpiComponent {
  return {
    name: "result-size-cap",
    register(pi, ctx) {
      pi.on("tool_result", (event: unknown) => {
        if (!isToolResultEvent(event)) return undefined
        const capped = capResultContentWithMetadata({ content: event.content }, options)
        if (!capped.metadata.changed) return undefined
        const toolName = typeof event.toolName === "string" ? event.toolName : "unknown"
        logCapEvent(ctx, toolName, capped.metadata)
        return {
          content: capped.result.content,
          details: event.details,
          isError: typeof event.isError === "boolean" ? event.isError : undefined,
          usage: event.usage,
        }
      })
    },
  }
}
