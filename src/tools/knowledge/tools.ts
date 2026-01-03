import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { KnowledgeRepository } from "../../features/knowledge-repo/client"
import type {
  KnowledgeType,
  KnowledgeLayer,
  Severity,
  Constraint,
  ConstraintOperator,
  ConstraintTarget,
} from "../../features/knowledge-repo/types"
import { DEFAULT_QUERY_LIMIT, MAX_CONTENT_PREVIEW } from "./constants"

let repositoryInstance: KnowledgeRepository | null = null

function getRepository(): KnowledgeRepository {
  if (!repositoryInstance) {
    const rootDir = process.env.KNOWLEDGE_REPO_ROOT ?? ".opencode/knowledge"
    repositoryInstance = new KnowledgeRepository({ rootDir })
  }
  return repositoryInstance
}

export const knowledge_query: ToolDefinition = tool({
  description:
    "Search and query the knowledge repository. " +
    "Find ADRs, policies, patterns, and specs by keywords, type, layer, or full-text search. " +
    "Returns summaries to conserve context - use knowledge_show for full details.",
  args: {
    query: tool.schema
      .string()
      .optional()
      .describe("Full-text search query across knowledge summaries"),
    type: tool.schema
      .enum(["adr", "policy", "pattern", "spec"])
      .optional()
      .describe("Filter by knowledge type"),
    layer: tool.schema
      .enum(["company", "org", "project"])
      .optional()
      .describe("Filter by organizational layer"),
    severity: tool.schema
      .enum(["info", "warn", "block"])
      .optional()
      .describe("Filter by severity level"),
    tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Filter by tags"),
    limit: tool.schema
      .number()
      .optional()
      .describe(`Maximum results to return (default: ${DEFAULT_QUERY_LIMIT})`),
  },
  execute: async (args) => {
    try {
      const repo = getRepository()
      await repo.initialize()

      const result = await repo.query({
        search: args.query,
        type: args.type as KnowledgeType | undefined,
        layer: args.layer as KnowledgeLayer | undefined,
        severity: args.severity as Severity | undefined,
        tags: args.tags,
        limit: args.limit ?? DEFAULT_QUERY_LIMIT,
      })

      if (result.items.length === 0) {
        return "No knowledge items found matching the query."
      }

      const lines = [
        `Found ${result.total} knowledge items${result.hasMore ? " (showing first " + result.items.length + ")" : ""}:`,
        "",
      ]

      for (const item of result.items) {
        lines.push(`**${item.id}** [${item.type}/${item.layer}] ${item.severity.toUpperCase()}`)
        lines.push(`  ${item.title}`)
        lines.push(`  ${item.summary}`)
        if (item.tags.length > 0) {
          lines.push(`  Tags: ${item.tags.join(", ")}`)
        }
        lines.push("")
      }

      if (result.hasMore) {
        lines.push(`Use 'limit' parameter to see more results.`)
      }

      return lines.join("\n")
    } catch (e) {
      return `Error querying knowledge: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})

export const knowledge_list: ToolDefinition = tool({
  description:
    "List all knowledge items in the repository with statistics. " +
    "Provides an overview of ADRs, policies, patterns, and specs organized by layer and type.",
  args: {
    layer: tool.schema
      .enum(["company", "org", "project"])
      .optional()
      .describe("Filter to specific layer"),
    type: tool.schema
      .enum(["adr", "policy", "pattern", "spec"])
      .optional()
      .describe("Filter to specific type"),
    verbose: tool.schema
      .boolean()
      .optional()
      .describe("Include item summaries (default: false)"),
  },
  execute: async (args) => {
    try {
      const repo = getRepository()
      await repo.initialize()

      const stats = await repo.getStats()
      const result = await repo.query({
        layer: args.layer as KnowledgeLayer | undefined,
        type: args.type as KnowledgeType | undefined,
        limit: 200,
      })

      const lines = [
        "# Knowledge Repository Statistics",
        "",
        `Total items: ${stats.totalCommits}`,
        "",
        "## By Layer",
        `- Company: ${stats.byLayer.company ?? 0}`,
        `- Org: ${stats.byLayer.org ?? 0}`,
        `- Project: ${stats.byLayer.project ?? 0}`,
        "",
        "## By Type",
        `- ADR: ${stats.byType.adr ?? 0}`,
        `- Policy: ${stats.byType.policy ?? 0}`,
        `- Pattern: ${stats.byType.pattern ?? 0}`,
        `- Spec: ${stats.byType.spec ?? 0}`,
        "",
        "## By Severity",
        `- Block: ${stats.bySeverity.block ?? 0}`,
        `- Warn: ${stats.bySeverity.warn ?? 0}`,
        `- Info: ${stats.bySeverity.info ?? 0}`,
        "",
      ]

      if (args.verbose && result.items.length > 0) {
        lines.push("## Items")
        for (const item of result.items) {
          lines.push(`- **${item.id}** [${item.type}/${item.layer}] ${item.title}`)
        }
      }

      return lines.join("\n")
    } catch (e) {
      return `Error listing knowledge: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})

export const knowledge_show: ToolDefinition = tool({
  description:
    "Show full details of a specific knowledge item by ID. " +
    "Includes complete content, constraints, metadata, and optionally version history.",
  args: {
    id: tool.schema.string().describe("The knowledge item ID to retrieve"),
    includeConstraints: tool.schema
      .boolean()
      .optional()
      .describe("Include constraint details (default: true)"),
    includeHistory: tool.schema
      .boolean()
      .optional()
      .describe("Include version history (default: false)"),
  },
  execute: async (args) => {
    try {
      const repo = getRepository()
      await repo.initialize()

      const commit = await repo.getCommitById(args.id)
      if (!commit) {
        return `Knowledge item not found: ${args.id}`
      }

      const includeConstraints = args.includeConstraints ?? true
      const includeHistory = args.includeHistory ?? false

      const lines = [
        `# ${commit.title}`,
        "",
        `**ID:** ${commit.id}`,
        `**Type:** ${commit.type}`,
        `**Layer:** ${commit.layer}`,
        `**Severity:** ${commit.severity}`,
        `**Author:** ${commit.author.name}`,
        `**Created:** ${commit.createdAt}`,
        "",
      ]

      if (commit.tags.length > 0) {
        lines.push(`**Tags:** ${commit.tags.join(", ")}`)
        lines.push("")
      }

      if (commit.triggerKeywords.length > 0) {
        lines.push(`**Trigger Keywords:** ${commit.triggerKeywords.join(", ")}`)
        lines.push("")
      }

      lines.push("## Content")
      lines.push("")
      lines.push(commit.content)
      lines.push("")

      if (includeConstraints && commit.constraints.length > 0) {
        lines.push("## Constraints")
        lines.push("")
        for (const c of commit.constraints) {
          lines.push(`### ${c.id}`)
          lines.push(`- **Operator:** ${c.operator}`)
          lines.push(`- **Target:** ${c.target}`)
          lines.push(`- **Pattern:** \`${c.pattern}\``)
          lines.push(`- **Severity:** ${c.severity}`)
          if (c.message) lines.push(`- **Message:** ${c.message}`)
          if (c.appliesTo?.length) lines.push(`- **Applies To:** ${c.appliesTo.join(", ")}`)
          if (c.excludes?.length) lines.push(`- **Excludes:** ${c.excludes.join(", ")}`)
          lines.push("")
        }
      }

      if (includeHistory) {
        const history = await repo.getHistory(commit.id)
        if (history.length > 1) {
          lines.push("## Version History")
          lines.push("")
          for (const h of history) {
            lines.push(`- ${h.id} (${h.createdAt}) by ${h.author.name}`)
          }
          lines.push("")
        }
      }

      return lines.join("\n")
    } catch (e) {
      return `Error showing knowledge: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})

export const knowledge_propose: ToolDefinition = tool({
  description:
    "Propose a new knowledge item (ADR, policy, pattern, or spec). " +
    "Creates a draft in the project layer for review. " +
    "Use this to document decisions, establish policies, or share patterns.",
  args: {
    type: tool.schema
      .enum(["adr", "policy", "pattern", "spec"])
      .describe("Type of knowledge item"),
    title: tool.schema.string().describe("Title of the knowledge item"),
    summary: tool.schema
      .string()
      .describe("One-line summary (max 100 chars) for the manifest"),
    content: tool.schema
      .string()
      .describe("Full content in markdown format"),
    layer: tool.schema
      .enum(["company", "org", "project"])
      .optional()
      .describe("Target layer (default: project)"),
    severity: tool.schema
      .enum(["info", "warn", "block"])
      .optional()
      .describe("Default severity for violations (default: info)"),
    tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Tags for categorization"),
    constraints: tool.schema
      .array(
        tool.schema.object({
          operator: tool.schema
            .enum([
              "must_not_use",
              "must_use",
              "must_match",
              "must_not_match",
              "must_exist",
              "must_not_exist",
            ])
            .describe("Constraint operator"),
          target: tool.schema
            .enum(["file", "code", "dependency", "import", "config"])
            .describe("What the constraint applies to"),
          pattern: tool.schema.string().describe("Glob pattern, regex, or exact string"),
          message: tool.schema.string().optional().describe("Custom violation message"),
          severity: tool.schema
            .enum(["info", "warn", "block"])
            .optional()
            .describe("Override severity for this constraint"),
          appliesTo: tool.schema
            .array(tool.schema.string())
            .optional()
            .describe("Glob patterns for files this constraint applies to"),
        })
      )
      .optional()
      .describe("Constraint rules to enforce"),
  },
  execute: async (args) => {
    try {
      const repo = getRepository()
      await repo.initialize()

      const constraints: Constraint[] = (args.constraints ?? []).map((c, i) => ({
        id: `constraint-${i + 1}`,
        operator: c.operator as ConstraintOperator,
        target: c.target as ConstraintTarget,
        pattern: c.pattern,
        message: c.message,
        severity: (c.severity as Severity) ?? (args.severity as Severity) ?? "info",
        appliesTo: c.appliesTo,
      }))

      const commit = await repo.createCommit({
        type: args.type as KnowledgeType,
        title: args.title,
        content: args.content,
        layer: (args.layer as KnowledgeLayer) ?? "project",
        severity: (args.severity as Severity) ?? "info",
        constraints,
        author: {
          id: "agent",
          name: "AI Agent",
        },
        tags: args.tags,
        triggerKeywords: [],
      })

      const lines = [
        "# Knowledge Item Created",
        "",
        `**ID:** ${commit.id}`,
        `**Type:** ${commit.type}`,
        `**Layer:** ${commit.layer}`,
        `**Title:** ${commit.title}`,
        `**Constraints:** ${commit.constraints.length}`,
        "",
        "The knowledge item has been added to the repository.",
        "Use `knowledge_show` with the ID to view full details.",
      ]

      return lines.join("\n")
    } catch (e) {
      return `Error proposing knowledge: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})
