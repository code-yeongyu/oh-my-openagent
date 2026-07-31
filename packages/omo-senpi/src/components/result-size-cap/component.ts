import type { ToolDefinition } from "@code-yeongyu/senpi"

import type { OmoSenpiComponent } from "../../extension/types"
import { capResultContent, type CapTextBlockOptions } from "./cap"

function capExecute(execute: ToolDefinition["execute"], options: CapTextBlockOptions): ToolDefinition["execute"] {
  return async function cappedExecute(this: unknown, toolCallId, params, signal, onUpdate, execCtx) {
    const result = await execute.call(this, toolCallId, params, signal, onUpdate, execCtx)
    return capResultContent(result, options)
  }
}

export interface ResultSizeCapOptions extends CapTextBlockOptions {}

/**
 * Cap oversized tool results at the registration boundary so no single result
 * above the threshold can enter the conversation context. Plugins load before
 * builtin tools, so this wrapper reaches apply_patch/read/bash results and
 * prevents the giant-string contexts that break provider serialization and
 * compaction (observed: a 476MB apply_patch result -> "Invalid string length"
 * -> compaction failure loop, 2026-07-30).
 */
export function createResultSizeCapComponent(options: ResultSizeCapOptions = {}): OmoSenpiComponent {
  return {
    name: "result-size-cap",
    register(pi) {
      const wrapped = new Set<unknown>()
      const originalRegisterTool = pi.registerTool.bind(pi)
      pi.registerTool = (tool: Record<string, unknown>): void => {
        const execute = Reflect.get(tool, "execute")
        if (typeof execute === "function" && !wrapped.has(tool)) {
          wrapped.add(tool)
          Reflect.set(tool, "execute", capExecute(execute as ToolDefinition["execute"], options))
        }
        originalRegisterTool(tool)
      }
    },
  }
}
