import { z } from "zod"

/**
 * GitNexus code knowledge graph configuration.
 *
 * GitNexus provides a semantic code graph with symbol relationships,
 * community detection, execution flow tracing, and impact analysis.
 *
 * When `server_url` is configured, OMO exposes gitnexus_* tools for
 * dead code detection, circular dependency analysis, architecture
 * community queries, blast radius analysis, and Cypher graph queries.
 *
 * When not configured, the tools are omitted (no overhead).
 */
export const GitNexusConfigSchema = z
  .object({
    server_url: z
      .string()
      .url()
      .optional()
      .describe(
        "GitNexus server URL (e.g. http://localhost:6789). " +
          "When set, enables gitnexus_query, gitnexus_cypher, gitnexus_context, " +
          "gitnexus_impact, and gitnexus_list_repos tools.",
      ),
    api_key: z
      .string()
      .optional()
      .describe("Optional API key for GitNexus server authentication."),
    request_timeout_ms: z
      .number()
      .int()
      .positive()
      .max(120000)
      .default(30000)
      .describe("Timeout in milliseconds for GitNexus API requests (default: 30000)."),
  })
  .optional()

export type GitNexusConfig = z.infer<typeof GitNexusConfigSchema>
