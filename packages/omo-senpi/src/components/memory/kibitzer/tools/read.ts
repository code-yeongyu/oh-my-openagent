import { readFile, stat } from "@oh-my-opencode/memory-core/fs"
import { Type, type Static } from "typebox"

import type { WakeToolBudget } from "./budget"
import type { KibitzerToolCaps } from "./caps"
import { resolveWorkspacePath } from "./path-safety"
import { boundedText, budgeted, okText, rejection, type KibitzerSidecarTool } from "./result"

export const KIBITZER_READ_TOOL_NAME = "read"

export const KibitzerReadParams = Type.Object({
  path: Type.String({ description: "File path relative to the workspace root." }),
  offset: Type.Optional(Type.Integer({ minimum: 1, description: "1-based first line to return; defaults to 1." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum number of lines to return." })),
}, { additionalProperties: false })

export interface KibitzerReadToolInput {
  readonly workspaceRoot: string
  readonly caps: KibitzerToolCaps
  readonly budget: () => WakeToolBudget
}

export function createKibitzerReadTool(input: KibitzerReadToolInput): KibitzerSidecarTool<typeof KibitzerReadParams> {
  return {
    name: KIBITZER_READ_TOOL_NAME,
    label: "Kibitzer read",
    description: `Read a workspace file (bounded to ${input.caps.readChars} characters; secrets are redacted).`,
    parameters: KibitzerReadParams,
    execute: budgeted(input.budget, async (params: Static<typeof KibitzerReadParams>) => {
      const resolved = await resolveWorkspacePath(input.workspaceRoot, params.path)
      if (!resolved.ok) return rejection(resolved.code, resolved.message, params.path)
      let info
      try {
        info = await stat(resolved.path)
      } catch {
        return rejection("not_found", `"${params.path}" does not exist.`, params.path)
      }
      if (!info.isFile()) return rejection("not_a_file", `"${params.path}" is not a regular file.`, params.path)
      const content = await readFile(resolved.path, "utf8")
      return okText(boundedText(sliceLines(content, params.offset, params.limit), input.caps.readChars))
    }),
  }
}

function sliceLines(content: string, offset: number | undefined, limit: number | undefined): string {
  if (offset === undefined && limit === undefined) return content
  const lines = content.split("\n")
  const start = Math.max(0, (offset ?? 1) - 1)
  const end = limit === undefined ? lines.length : start + limit
  return lines.slice(start, end).join("\n")
}
