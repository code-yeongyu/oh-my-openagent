import type { ToolContext } from "@opencode-ai/plugin/tool"
import yaml from "js-yaml"
import {
  getHandoffFilePath,
  HandoffSchema,
  writeHandoffFile,
} from "../../features/handoff"
import type { HandoffData } from "../../features/handoff/schema"
import { buildHandoffBody } from "./body-formatter"
import { UNKNOWN_GIT_SHA } from "./constants"
import { getGitHead } from "./git"

/**
 * Args expected for the `create` action. Mirrors the documented handoff
 * sections. All `optional()` fields are passed through to the schema as-is.
 */
export type HandoffCreateArgs = {
  topics: string[]
  user_requests: string
  goal: string
  work_completed: string[]
  current_state: string
  pending_tasks?: string[]
  key_files?: { path: string; purpose: string }[]
  important_decisions?: { decision: string; rationale: string }[]
  explicit_constraints?: string[]
  context_for_continuation?: string
}

/**
 * `handoff` tool — `action: "create"` handler.
 *
 * Builds a structured handoff document (validated YAML frontmatter +
 * human-readable markdown body) and writes it to `.matrixx/handoff.md`.
 * Returns a `Error:` string if the inputs fail schema validation OR if the
 * underlying I/O write fails.
 */
export async function handleCreate(
  args: HandoffCreateArgs,
  ctx: { directory: string },
  context: ToolContext
): Promise<string> {
  //#given - session id from the OpenCode runtime, or the documented fallback
  const sessionID = context.sessionID || "unknown"
  const timestamp = new Date().toISOString()
  const gitHead = await getGitHead(ctx.directory)
  const git_head = gitHead ?? { sha: UNKNOWN_GIT_SHA }

  const frontmatter: HandoffData = {
    frontmatter: {
      session_id: sessionID,
      timestamp,
      git_head,
      topics: args.topics,
    },
    sections: {
      user_requests: args.user_requests,
      goal: args.goal,
      work_completed: args.work_completed,
      current_state: args.current_state,
      pending_tasks: args.pending_tasks,
      key_files: args.key_files,
      important_decisions: args.important_decisions,
      explicit_constraints: args.explicit_constraints,
      context_for_continuation: args.context_for_continuation,
    },
  }

  //#when - validate before writing; the schema is the single source of truth
  const validation = HandoffSchema.safeParse(frontmatter)
  if (!validation.success) {
    const issues = validation.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ")
    return `Error: validation failed: ${issues}`
  }

  const yamlStr = yaml.dump(validation.data, { schema: yaml.JSON_SCHEMA })
  const body = buildHandoffBody(validation.data.sections)
  const content = `---\n${yamlStr}---\n\n${body}\n`

  //#then - write through the storage helper; bail with an error on I/O failure
  const ok = writeHandoffFile(ctx.directory, content)
  if (!ok) {
    return `Error: failed to write handoff file at ${getHandoffFilePath(ctx.directory)}`
  }

  return `Handoff written to ${getHandoffFilePath(ctx.directory)} (session: ${sessionID}, topics: ${args.topics.join(", ")})`
}
