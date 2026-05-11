import type { PluginInput } from "@opencode-ai/plugin"
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import {
  createAlias,
  deleteAlias,
  listAliases,
  resolveSessionIdentifier,
  type SessionAliasEntry,
} from "../../features/session-alias"
import { sessionExists } from "../session-manager/storage"

const SESSION_ALIAS_CREATE_DESCRIPTION = `Create a friendly alias for an OpenCode session ID.

Lets you refer to a session by a short, memorable name (e.g. "auth-refactor") instead of
the raw ID (e.g. "ses_1e95074dcffeKzTEiIHrICIo4o"). Aliases are stored in
\`<project>/.opencode/session-aliases.json\` and are picked up automatically by
\`session_read\`, \`session_info\`, and \`session_search\`.

Rules:
- alias: 1-64 chars, letters/digits/dashes/underscores, must start and end with a letter or digit.
- alias must NOT start with "ses_" (reserved for real session IDs).
- session_id must start with "ses_" and reference an existing session.
- By default fails if the alias already exists; pass \`overwrite=true\` to replace.`

const SESSION_ALIAS_LIST_DESCRIPTION = `List all session aliases for the current project.

Returns a markdown table of alias → session_id with optional notes and creation dates.`

const SESSION_ALIAS_DELETE_DESCRIPTION = `Delete a session alias.

Removes the mapping but leaves the underlying session untouched.`

interface SessionAliasCreateArgs {
  alias: string
  session_id: string
  note?: string
  overwrite?: boolean
  skip_existence_check?: boolean
}

interface SessionAliasDeleteArgs {
  alias: string
}

interface SessionAliasListArgs {
  limit?: number
}

function formatEntry(entry: SessionAliasEntry): string {
  const date = new Date(entry.created_at).toISOString()
  const note = entry.note ? ` — ${entry.note}` : ""
  return `- \`${entry.alias}\` → \`${entry.session_id}\` (created ${date})${note}`
}

function formatList(entries: SessionAliasEntry[]): string {
  if (entries.length === 0) return "No session aliases defined for this project."
  const lines = [`Found ${entries.length} alias${entries.length === 1 ? "" : "es"}:`, ""]
  for (const entry of entries) lines.push(formatEntry(entry))
  return lines.join("\n")
}

export interface CreateSessionAliasToolsDeps {
  sessionExists?: typeof sessionExists
  createAlias?: typeof createAlias
  deleteAlias?: typeof deleteAlias
  listAliases?: typeof listAliases
  resolveSessionIdentifier?: typeof resolveSessionIdentifier
}

export function createSessionAliasTools(
  ctx: PluginInput,
  deps: CreateSessionAliasToolsDeps = {},
): Record<string, ToolDefinition> {
  const resolved = {
    sessionExists: deps.sessionExists ?? sessionExists,
    createAlias: deps.createAlias ?? createAlias,
    deleteAlias: deps.deleteAlias ?? deleteAlias,
    listAliases: deps.listAliases ?? listAliases,
    resolveSessionIdentifier: deps.resolveSessionIdentifier ?? resolveSessionIdentifier,
  }

  const directory = ctx.directory

  const session_alias_create: ToolDefinition = tool({
    description: SESSION_ALIAS_CREATE_DESCRIPTION,
    args: {
      alias: tool.schema.string().describe("Friendly alias name (1-64 chars, alphanumeric/_/-)"),
      session_id: tool.schema.string().describe("Real OpenCode session ID (starts with ses_)"),
      note: tool.schema.string().optional().describe("Optional note about the alias"),
      overwrite: tool.schema.boolean().optional().describe("Replace existing alias with same name (default false)"),
      skip_existence_check: tool.schema
        .boolean()
        .optional()
        .describe("Skip verifying the session exists. Use for sessions stored only in SQLite that may not be visible yet."),
    },
    execute: async (args: SessionAliasCreateArgs, _context) => {
      try {
        if (!args.skip_existence_check) {
          const exists = await resolved.sessionExists(args.session_id).catch(() => false)
          if (!exists) {
            return `Error: session "${args.session_id}" does not exist. Pass skip_existence_check=true to override.`
          }
        }
        const result = await resolved.createAlias(
          {
            alias: args.alias,
            session_id: args.session_id,
            note: args.note,
            overwrite: args.overwrite,
          },
          { directory },
        )
        if (!result.ok) return `Error (${result.code}): ${result.error}`
        const verb = result.replaced ? "Replaced" : "Created"
        const replacedNote = result.replaced ? ` (previous target: \`${result.replaced.session_id}\`)` : ""
        return `${verb} alias \`${result.entry.alias}\` → \`${result.entry.session_id}\`${replacedNote}`
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const session_alias_list: ToolDefinition = tool({
    description: SESSION_ALIAS_LIST_DESCRIPTION,
    args: {
      limit: tool.schema.number().optional().describe("Maximum number of aliases to return"),
    },
    execute: async (args: SessionAliasListArgs, _context) => {
      try {
        let entries = resolved.listAliases({ directory })
        if (args.limit && args.limit > 0) entries = entries.slice(0, args.limit)
        return formatList(entries)
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const session_alias_delete: ToolDefinition = tool({
    description: SESSION_ALIAS_DELETE_DESCRIPTION,
    args: {
      alias: tool.schema.string().describe("Alias name to delete"),
    },
    execute: async (args: SessionAliasDeleteArgs, _context) => {
      try {
        const result = await resolved.deleteAlias(args.alias, { directory })
        if (!result.ok) return `Error (${result.code}): ${result.error}`
        return `Deleted alias \`${result.removed.alias}\` (was → \`${result.removed.session_id}\`)`
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  return { session_alias_create, session_alias_list, session_alias_delete }
}
