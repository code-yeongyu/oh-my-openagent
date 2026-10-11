import { isGpt6AstraModel } from "@oh-my-opencode/model-core"
import {
  ASTRA_DAG_RUN_VERIFICATION_DIRECTIVE,
  ASTRA_DAG_VERIFICATION_DIRECTIVE,
  DAG_VERIFICATION_DIRECTIVE,
} from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"
import { transformContextText } from "../../extension/context-text-transform"
import type { TaskRuntimeContext } from "./runtime-context"

type DagVerificationScope = "node" | "run"

const DIRECTIVES = [DAG_VERIFICATION_DIRECTIVE, ASTRA_DAG_VERIFICATION_DIRECTIVE, ASTRA_DAG_RUN_VERIFICATION_DIRECTIVE] as const

// A delivered wake can remain in the transcript after the session switches model or falls back.
// Select again at the model-call boundary, using custom-message metadata to preserve node/run scope.
export function wireDagVerificationContext(pi: SenpiExtensionAPI, runtime: TaskRuntimeContext): void {
  pi.on("context", (payload, eventCtx) => {
    if (!isRecord(payload) || !Array.isArray(payload["messages"])) return
    runtime.captureFrom(isRecord(eventCtx) ? eventCtx : {})
    const astra = isGpt6AstraModel(runtime.parentModel())
    let changed = false
    const messages = payload["messages"].map((message: unknown) => {
      if (!isRecord(message) || message["role"] !== "custom" || typeof message["content"] !== "string") return message
      const selected = transformContextText(message, (text, segment) => segment === undefined ? text : selectDirectives(text, verificationScopes(segment), astra))
      if (selected["content"] === message["content"]) return message
      changed = true
      return selected
    })
    return changed ? { messages } : undefined
  })
}

function verificationScopes(message: Record<string, unknown>): readonly DagVerificationScope[] {
  const details = message["details"]
  switch (message["customType"]) {
    case "senpi-task.completion":
      return Array.isArray(details) && details.some((detail: unknown) => isRecord(detail) && isRecord(detail["dag"])) ? ["node"] : []
    case "omo-senpi.dag-run":
      return isRecord(details) && ["completed", "failed", "cancelled"].includes(String(details["status"])) ? ["run"] : []
    case "omo-senpi:wake":
      return Array.isArray(details) ? details.flatMap((detail: unknown) => isRecord(detail) ? verificationScopes(detail) : []) : []
    default:
      return []
  }
}

function selectDirectives(content: string, scopes: readonly DagVerificationScope[], astra: boolean): string {
  let cursor = content.length
  for (const scope of [...scopes].reverse()) {
    const found = DIRECTIVES.map((directive) => ({ directive, index: content.lastIndexOf(directive, cursor - directive.length) }))
      .sort((left, right) => right.index - left.index)[0]
    if (found === undefined || found.index < 0) break
    const selected = astra
      ? scope === "run" ? ASTRA_DAG_RUN_VERIFICATION_DIRECTIVE : ASTRA_DAG_VERIFICATION_DIRECTIVE
      : DAG_VERIFICATION_DIRECTIVE
    content = content.slice(0, found.index) + selected + content.slice(found.index + found.directive.length)
    cursor = found.index
  }
  return content
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
