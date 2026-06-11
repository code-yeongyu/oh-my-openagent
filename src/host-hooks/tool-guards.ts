import { existsSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import { runCommentChecker, type CheckResult, type HookInput } from "../hooks/comment-checker/cli"

type ToolCallEvent = {
  toolName: string
  toolCallId: string
  input: Record<string, unknown>
}

type ToolResultEvent = ToolCallEvent & {
  content: Array<{ type: string; text?: string }>
  isError: boolean
}

type ToolGuardContext = {
  cwd?: string
}

export type TargetToolGuardApi = {
  on(event: "tool_call", handler: (event: ToolCallEvent, context: ToolGuardContext) => unknown | Promise<unknown>): void
  on(event: "tool_result", handler: (event: ToolResultEvent, context: ToolGuardContext) => unknown | Promise<unknown>): void
}

export type TargetToolGuardOptions = {
  cwd: string
  checkComments?: (input: HookInput) => Promise<CheckResult>
}

const SIMPLE_FILE_READ = /^\s*(?:cat|head(?:\s+-n\s+\d+)?|tail(?:\s+-n\s+\d+)?)\s+(?!-)[^\s|&;]+\s*$/

function filePath(input: Record<string, unknown>): string | undefined {
  for (const key of ["filePath", "file_path", "path"]) {
    const value = input[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

function absolutePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path)
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

export function registerTargetToolGuards(api: TargetToolGuardApi, options: TargetToolGuardOptions): void {
  const readPaths = new Set<string>()
  const pendingMutationInputs = new Map<string, ToolCallEvent>()
  const checkComments = options.checkComments ?? ((input: HookInput) => runCommentChecker(input))

  api.on("tool_call", (event, context) => {
    const cwd = context.cwd ?? options.cwd
    const name = event.toolName.toLowerCase()
    if (name === "bash") {
      const command = event.input.command
      if (typeof command === "string" && SIMPLE_FILE_READ.test(command)) {
        return { block: true, reason: "Prefer the Read tool for file contents so line anchors remain available." }
      }
      return undefined
    }

    const path = filePath(event.input)
    if (!path) return undefined
    const resolvedPath = absolutePath(cwd, path)
    if (name === "read") {
      if (existsSync(resolvedPath)) readPaths.add(resolvedPath)
      return undefined
    }
    if (name === "write" && existsSync(resolvedPath) && !resolvedPath.includes(`${resolve(cwd, ".omo")}/`)) {
      if (!readPaths.delete(resolvedPath) && event.input.overwrite !== true && event.input.overwrite !== "true") {
        return { block: true, reason: "File already exists. Read it first or use edit." }
      }
    }
    if (name === "write" || name === "edit" || name === "apply_patch") {
      pendingMutationInputs.set(event.toolCallId, event)
    }
    return undefined
  })

  api.on("tool_result", async (event, context) => {
    if (event.isError) return undefined
    const pending = pendingMutationInputs.get(event.toolCallId)
    pendingMutationInputs.delete(event.toolCallId)
    if (!pending) return undefined
    const path = filePath(pending.input)
    if (!path) return undefined
    const input: HookInput = {
      session_id: "target-session",
      tool_name: pending.toolName,
      transcript_path: "",
      cwd: context.cwd ?? options.cwd,
      hook_event_name: "PostToolUse",
      tool_input: {
        file_path: path,
        content: asText(pending.input.content),
        old_string: asText(pending.input.oldString ?? pending.input.old_string),
        new_string: asText(pending.input.newString ?? pending.input.new_string),
      },
      tool_response: event.content,
    }
    const result = await checkComments(input)
    if (!result.hasComments || !result.message) return undefined
    return {
      content: [...event.content, { type: "text", text: result.message }],
    }
  })
}
