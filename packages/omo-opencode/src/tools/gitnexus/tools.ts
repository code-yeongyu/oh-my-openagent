import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { GitNexusConfig } from "../../config/schema/gitnexus"
import { GitNexusClient } from "./client"

function createClient(config: GitNexusConfig): GitNexusClient | null {
  if (!config?.server_url) return null
  return new GitNexusClient({
    serverUrl: config.server_url,
    apiKey: config.api_key,
    timeoutMs: config.request_timeout_ms ?? 30000,
  })
}

/**
 * Build all GitNexus tools.
 * Returns an empty record when gitnexus.server_url is not configured.
 */
export function createGitNexusTools(config: GitNexusConfig): Record<string, ToolDefinition> {
  const client = createClient(config)
  if (!client) return {}

  return {
    gitnexus_list_repos: tool({
      description: "List all repositories indexed in the GitNexus code knowledge graph. " +
        "Use this first to verify a repo is available before running other GitNexus queries.",
      args: {},
      async execute() {
        const repos = await client.listRepos()
        if (!repos || repos.length === 0) return "No indexed repositories found. The GitNexus server is reachable but has no indexed repos."
        const lines = repos.map((r) =>
          `• ${r.name}  (${r.stats.files} files, ${r.stats.nodes} nodes, ${r.stats.edges} edges, ${r.stats.communities} communities)`
        )
        return `**Indexed Repositories (${repos.length}):**\n\n${lines.join("\n")}`
      },
    }),

    gitnexus_query: tool({
      description: "Search the GitNexus code knowledge graph using natural language. " +
        "Returns execution flows (processes), symbols, and architecture communities. " +
        "Use this for understanding code structure, finding functional areas, and tracing execution paths.",
      args: {
        query: tool.schema.string().describe("Natural language or keyword search query (e.g., 'authentication flow', 'error handling', 'database access')"),
        repo: tool.schema.string().optional().describe("Repository name to search within. Omit if only one repo is indexed."),
        task_context: tool.schema.string().optional().describe("What you are working on (e.g., 'tech debt audit'). Helps ranking."),
        goal: tool.schema.string().optional().describe("What you want to find (e.g., 'architecture communities', 'execution flows')."),
        limit: tool.schema.number().optional().default(5).describe("Maximum number of results to return (default: 5, max: 100)."),
      },
      async execute(args) {
        const result = await client.query({
          query: args.query,
          repo: args.repo,
          task_context: args.task_context,
          goal: args.goal,
          limit: args.limit,
        })
        if (!result) return "GitNexus query returned no results. The server may be unavailable or the repo may not be indexed."
        const parts: string[] = []
        if (result.processes?.length) {
          parts.push(`**Processes (${result.processes.length}):**`)
          for (const p of result.processes) {
            parts.push(`  • ${p.heuristicLabel} (${p.stepCount} steps, communities: ${p.communities.join(", ") || "none"})`)
          }
        }
        if (result.process_symbols?.length) {
          parts.push(`**Symbols (${result.process_symbols.length}):**`)
          for (const s of result.process_symbols.slice(0, 20)) {
            parts.push(`  • ${s.name} (${s.kind}) — ${s.filePath}`)
          }
          if (result.process_symbols.length > 20) parts.push(`  … and ${result.process_symbols.length - 20} more`)
        }
        if (result.definitions?.length) {
          parts.push(`**Definitions (${result.definitions.length}):**`)
          for (const d of result.definitions.slice(0, 10)) {
            parts.push(`  • ${d.name} (${d.kind}) — ${d.filePath}`)
          }
        }
        return parts.length > 0 ? parts.join("\n") : "Query returned no results. Try a different query or check the repo name."
      },
    }),

    gitnexus_cypher: tool({
      description: "Execute a Cypher query against the GitNexus code knowledge graph. " +
        "Use this for dead code detection, circular dependency analysis, architecture queries, " +
        "and any structural analysis that requires graph traversal. " +
        "Schema: Nodes (Function, Class, Interface, Method, File, Community, Process, Route). " +
        "Edges: CALLS, IMPORTS, EXTENDS, IMPLEMENTS, HAS_METHOD, HAS_PROPERTY, ACCESSES, MEMBER_OF, STEP_IN_PROCESS, HANDLES_ROUTE.",
      args: {
        query: tool.schema.string().describe("Cypher query (e.g., 'MATCH (f:Function) WHERE NOT (f)<-[:CALLS]-(:Function) RETURN f.name, f.filePath' for dead code)"),
        repo: tool.schema.string().optional().describe("Repository name. Omit if only one repo is indexed."),
      },
      async execute(args) {
        const result = await client.cypher({ query: args.query, repo: args.repo })
        if (!result) return "Cypher query failed. The server may be unavailable or the query may be invalid."
        return result.markdown || `Query executed successfully. ${result.row_count} row(s) returned.`
      },
    }),

    gitnexus_context: tool({
      description: "Get a 360-degree view of a code symbol from the GitNexus knowledge graph. " +
        "Shows markdown-formatted context with incoming references (what calls/imports this symbol) " +
        "and outgoing references (what this symbol calls/imports). " +
        "Use for understanding dependencies, impact of changes, and tracing how code is used.",
      args: {
        name: tool.schema.string().describe("Symbol name (e.g., 'validateUser', 'AuthService', 'handleLogin')"),
        repo: tool.schema.string().optional().describe("Repository name. Omit if only one repo is indexed."),
        file_path: tool.schema.string().optional().describe("File path to disambiguate common symbol names."),
        kind: tool.schema.string().optional().describe("Symbol kind filter (e.g., 'Function', 'Class', 'Interface', 'Method')."),
        include_content: tool.schema.boolean().optional().default(false).describe("Include full symbol source code (default: false)."),
      },
      async execute(args) {
        const result = await client.context({
          name: args.name,
          repo: args.repo,
          file_path: args.file_path,
          kind: args.kind,
          include_content: args.include_content,
        })
        if (!result) return `No context found for symbol '${args.name}'. The symbol may not exist or the server may be unavailable.`
        if (result.markdown) return result.markdown
        const parts = [`**Context: ${result.name ?? args.name}**`]
        if (result.kind) parts.push(`Kind: ${result.kind}`)
        if (result.filePath) parts.push(`File: ${result.filePath}`)
        if (result.incoming?.length) parts.push(`\n**Incoming (${result.incoming.length}):** ` + result.incoming.map(i => `${i.name} (${i.relationType}) — ${i.filePath}`).join("\n"))
        if (result.outgoing?.length) parts.push(`\n**Outgoing (${result.outgoing.length}):** ` + result.outgoing.map(o => `${o.name} (${o.relationType}) — ${o.filePath}`).join("\n"))
        return parts.join("\n")
      },
    }),

    gitnexus_impact: tool({
      description: "Analyze the blast radius of changing a code symbol. " +
        "Shows what would break if you modify or remove a function, class, or file. " +
        "Returns affected symbols grouped by depth (d1=direct callers WILL break, " +
        "d2=indirect callers likely affected, d3=may need testing). " +
        "Use before refactoring, renaming, or removing code.",
      args: {
        target: tool.schema.string().describe("Name of the function, class, or file to analyze."),
        direction: tool.schema.enum(["upstream", "downstream"]).default("upstream").describe("'upstream' = what depends on this (consumers), 'downstream' = what this depends on (dependencies)."),
        repo: tool.schema.string().optional().describe("Repository name. Omit if only one repo is indexed."),
        file_path: tool.schema.string().optional().describe("File path hint to disambiguate common names."),
        kind: tool.schema.string().optional().describe("Kind filter (e.g., 'Function', 'Class')."),
        max_depth: tool.schema.number().optional().default(3).describe("Max traversal depth (default: 3, min: 1, max: 32)."),
      },
      async execute(args) {
        const result = await client.impact({
          target: args.target,
          direction: args.direction,
          repo: args.repo,
          file_path: args.file_path,
          kind: args.kind,
          maxDepth: args.max_depth,
        })
        if (!result) return `Impact analysis failed for '${args.target}'. The symbol may not exist in the graph or the server may be unavailable.`
        const parts: string[] = [
          `**Impact Analysis: ${args.target}**`,
          `Risk: ${result.risk}`,
          `Summary: ${result.summary}`,
        ]
        if (result.byDepth?.[1]?.length) {
          parts.push(`\n**d=1 — WILL BREAK (${result.byDepth[1].length}):**`)
          for (const s of result.byDepth[1].slice(0, 20)) {
            parts.push(`  • ${s.name} (${s.kind}) — ${s.filePath}`)
          }
        }
        if (result.byDepth?.[2]?.length) {
          parts.push(`\n**d=2 — LIKELY AFFECTED (${result.byDepth[2].length}):**`)
          for (const s of result.byDepth[2].slice(0, 10)) {
            parts.push(`  • ${s.name} (${s.kind}) — ${s.filePath}`)
          }
        }
        if (result.affected_processes?.length) {
          parts.push(`\n**Affected execution flows:**`)
          for (const p of result.affected_processes) {
            parts.push(`  • ${p.heuristicLabel} (step ${p.step})`)
          }
        }
        return parts.join("\n")
      },
    }),
  }
}
