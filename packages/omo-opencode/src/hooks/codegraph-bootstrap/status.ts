import { isRecord } from "@oh-my-opencode/utils"

import type { CodegraphCommandResult } from "./command-runner"

type CodegraphStatusDecision =
  | { readonly kind: "init" }
  | { readonly kind: "skip"; readonly reason: string }
  | { readonly kind: "sync" }

function statusText(result: CodegraphCommandResult): string {
  return `${result.stdout}\n${result.stderr ?? ""}`.toLowerCase()
}

function parseStatusJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

function jsonSaysInitialized(value: unknown): boolean | undefined {
  if (!isRecord(value)) return undefined

  const initialized = value.initialized ?? value.isInitialized ?? value.ready
  if (typeof initialized === "boolean") return initialized

  const status = value.status
  if (typeof status !== "string") return undefined

  const normalized = status.toLowerCase()
  if (normalized.includes("not initialized") || normalized.includes("uninitialized")) return false
  if (normalized.includes("initialized") || normalized.includes("ready")) return true
  return undefined
}

export function decideCodegraphStartupAction(status: CodegraphCommandResult): CodegraphStatusDecision {
  if (status.timedOut) return { kind: "skip", reason: "status timed out" }

  const text = statusText(status)
  if (text.includes("not initialized") || text.includes("uninitialized")) return { kind: "init" }

  const parsed = parseStatusJson(status.stdout)
  const initialized = jsonSaysInitialized(parsed)
  if (initialized === false) return { kind: "init" }
  if (initialized === true) return { kind: "sync" }

  if (status.exitCode !== 0) return { kind: "skip", reason: `status exited ${status.exitCode}` }

  return { kind: "sync" }
}
