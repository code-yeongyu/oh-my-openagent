import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin"
import { join } from "node:path"
import { lookup } from "node:dns/promises"
import { createLibraryIndexer } from "./indexer"
import { LIBRARIAN_LOCAL_INDEX_DESCRIPTION } from "./constants"
import type { LibrarianLocalIndexArgs } from "./types"
import type { BackgroundManager } from "../../features/background-agent"
import { log } from "../../shared/logger"

function validateLibraryName(library: string): string {
  // Sanitize library name to prevent path traversal
  return library.replace(/[/\\]/g, '_').replace(/\.\./g, '').trim()
}

function validateFileName(fileName: string): string {
  // Sanitize file name to prevent path traversal
  return fileName.replace(/[/\\]/g, '_').replace(/\.\./g, '').trim()
}

function isPrivateIP(ip: string): boolean {
  // IPv4 checks
  if (ip.includes('.')) {
    const parts = ip.split('.').map(Number);
    if (parts.length === 4 && parts.every(p => p >= 0 && p <= 255)) {
      const [a, b] = parts;
      // 127.0.0.0/8 (loopback)
      if (a === 127) return true;
      // 192.168.0.0/16
      if (a === 192 && b === 168) return true;
      // 10.0.0.0/8
      if (a === 10) return true;
      // 172.16.0.0/12
      if (a === 172 && b >= 16 && b <= 31) return true;
      // 169.254.0.0/16 (link-local)
      if (a === 169 && b === 254) return true;
    }
  }
  // IPv6 checks
  else if (ip.includes(':')) {
    const lowerIp = ip.toLowerCase();
    // ::1 (loopback)
    if (lowerIp === '::1') return true;
    // fc00::/7 (private)
    if (lowerIp.startsWith('fc') || lowerIp.startsWith('fd')) return true;
    // fe80::/10 (link-local)
    if (lowerIp.startsWith('fe8') || lowerIp.startsWith('fe9') || lowerIp.startsWith('fea') || lowerIp.startsWith('feb')) return true;

    // Handle IPv6-mapped IPv4 addresses (e.g., ::ffff:127.0.0.1)
    const ipv6MappedMatch = lowerIp.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (ipv6MappedMatch) {
      // Recursively check the embedded IPv4 address
      return isPrivateIP(ipv6MappedMatch[1]);
    }
  }
  return false;
}

async function validateSources(sources: string[]): Promise<void> {
  for (const source of sources) {
    try {
      const url = new URL(source)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`Invalid protocol: ${url.protocol}`)
      }
      const hostname = url.hostname.toLowerCase();
      // Block localhost and private IPs
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' ||
          hostname.startsWith('192.168.') || hostname.startsWith('10.') ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
          hostname.startsWith('fc') || hostname.startsWith('fd') || // IPv6 private
          hostname === 'metadata.google.internal' || hostname.endsWith('.internal')) {
        throw new Error(`Local/private host not allowed: ${hostname}`)
      }

      // Resolve hostname to IP addresses to check for SSRF
      try {
        const addresses = await lookup(hostname, { all: true });
        for (const addr of addresses) {
          if (isPrivateIP(addr.address)) {
            throw new Error(`Resolved IP ${addr.address} is private/local (SSRF protection)`);
          }
        }
      } catch (dnsError) {
        // DNS resolution failed - cannot verify IP is not private, reject for security
        throw new Error(`Cannot verify IP addresses for ${hostname} (DNS error: ${dnsError instanceof Error ? dnsError.message : String(dnsError)})`);
      }
    } catch (error) {
      throw new Error(`Invalid source URL "${source}": ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

export function createLibrarianLocalIndex(
  ctx: PluginInput,
  backgroundManager: BackgroundManager
): ToolDefinition {
  const indexer = createLibraryIndexer(ctx)

  return tool({
    description: LIBRARIAN_LOCAL_INDEX_DESCRIPTION,
    args: {
      action: tool.schema
        .enum(["search", "query-tags", "add-doc", "pull-docs", "get-docs", "build-index", "create-script"])
        .describe("Action to perform on the local library index"),
      query: tool.schema.string().optional().describe("Search query for text search"),
      tags: tool.schema.array(tool.schema.string()).optional().describe("Tags to query for (comma-separated)"),
      operator: tool.schema.enum(["AND", "OR"]).optional().describe("Tag query operator (AND/OR)"),
      library: tool.schema.string().optional().describe("Library name for add-doc, pull-docs, or get-docs actions"),
      content: tool.schema.string().optional().describe("Content to add as documentation"),
      frontmatter: tool.schema.string().optional().describe("JSON string of frontmatter metadata"),
      sources: tool.schema.array(tool.schema.string()).optional().describe("Source URLs to pull documentation from"),
      fileName: tool.schema.string().optional().describe("Custom filename for the documentation"),
    },
    async execute(args: LibrarianLocalIndexArgs, toolContext) {
      log(`[LibrarianLocalIndex] Executing action: ${args.action}`)

      try {
        switch (args.action) {
          case "search":
            if (!args.query) {
              return "❌ Error: 'query' parameter is required for search action"
            }
            return await executeSearch(indexer, args.query)

          case "query-tags":
            if (!args.tags || args.tags.length === 0) {
              return "❌ Error: 'tags' parameter is required for query-tags action"
            }
            return await executeQueryByTags(indexer, args.tags, args.operator)

          case "add-doc": {
            if (!args.library || !args.content) {
              return "❌ Error: 'library' and 'content' parameters are required for add-doc action"
            }
            const safeLibrary = validateLibraryName(args.library)
            const safeFileName = args.fileName ? validateFileName(args.fileName) : undefined
            return await executeAddDoc(indexer, safeLibrary, args.content, args.frontmatter, safeFileName)
          }

          case "pull-docs": {
            if (!args.library || !args.sources || args.sources.length === 0) {
              return "❌ Error: 'library' and 'sources' parameters are required for pull-docs action"
            }
            await validateSources(args.sources)
            const safeLibrary = validateLibraryName(args.library)
            return await executePullDocs(indexer, safeLibrary, args.sources)
          }

          case "get-docs": {
            if (!args.library) {
              return "❌ Error: 'library' parameter is required for get-docs action"
            }
            const safeLibrary = validateLibraryName(args.library)
            return await executeGetDocs(indexer, safeLibrary)
          }

          case "build-index":
            return await executeBuildIndex(indexer)

          case "create-script":
            return await executeCreateScript(indexer)

          default:
            return `❌ Error: Unknown action '${args.action}'`
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log(`[LibrarianLocalIndex] Error executing ${args.action}:`, errorMessage)
        return `❌ Error: ${errorMessage}`
      }
    },
  })
}

async function executeSearch(indexer: ReturnType<typeof createLibraryIndexer>, query: string): Promise<string> {
  const results = await indexer.search(query)
  
  if (results.totalCount === 0) {
    return `No results found for query: "${query}"`
  }

  let output = `Found ${results.totalCount} results for query: "${query}"\n\n`
  
  for (const result of results.results) {
    output += `📄 ${result.path}\n`
    output += `   Library: ${result.library}\n`
    output += `   Relevance: ${(result.relevance * 100).toFixed(1)}%\n`
    if (result.tags && result.tags.length > 0) {
      output += `   Tags: ${result.tags.join(", ")}\n`
    }
    output += "\n"
  }

  return output
}

async function executeQueryByTags(
  indexer: ReturnType<typeof createLibraryIndexer>,
  tags: string[],
  operator?: "AND" | "OR"
): Promise<string> {
  const results = await indexer.queryByTags(tags, operator)
  
  if (results.totalCount === 0) {
    return `No documents found with tags: ${tags.join(", ")} (${operator || "OR"})`
  }

  let output = `Found ${results.totalCount} documents with tags: ${tags.join(", ")} (${operator || "OR"})\n\n`
  
  for (const result of results.results) {
    output += `📄 ${result.path}\n`
    output += `   Library: ${result.library}\n`
    output += `   Title: ${result.frontmatter.title}\n`
    output += `   Type: ${result.frontmatter.contentType}\n`
    output += `   Tags: ${result.frontmatter.tags.join(", ")}\n`
    if (result.frontmatter.description) {
      output += `   Description: ${result.frontmatter.description}\n`
    }
    if (result.frontmatter.difficulty) {
      output += `   Difficulty: ${result.frontmatter.difficulty}\n`
    }
    output += "\n"
  }

  return output
}

async function executeAddDoc(
  indexer: ReturnType<typeof createLibraryIndexer>,
  library: string,
  content: string,
  frontmatterJson?: string,
  fileName?: string
): Promise<string> {
  let frontmatter
  try {
    frontmatter = frontmatterJson ? JSON.parse(frontmatterJson) : {}
  } catch (error) {
    return `❌ Error: Invalid JSON in frontmatter parameter`
  }

  await indexer.addLibraryDoc(library, content, frontmatter, fileName)
  
  return `✅ Successfully added documentation for library: ${library}`
}

async function executePullDocs(
  indexer: ReturnType<typeof createLibraryIndexer>,
  library: string,
  sources: string[]
): Promise<string> {
  const results = await indexer.pullDocumentation(library, sources)

  let output = ""

  if (results.success.length > 0) {
    output += `✅ Successfully pulled ${results.success.length} document(s) for library: ${library}\n\n`
    output += "**Pulled URLs:**\n"
    for (const url of results.success) {
      output += `- ${url}\n`
    }
  }

  if (results.failed.length > 0) {
    if (output) output += "\n"
    output += `❌ Failed to pull ${results.failed.length} document(s):\n`
    for (const { url, error } of results.failed) {
      output += `- ${url}: ${error}\n`
    }
  }

  if (results.success.length === 0 && results.failed.length === 0) {
    output = `No documents were pulled for library: ${library}`
  }

  return output.trim()
}

async function executeGetDocs(
  indexer: ReturnType<typeof createLibraryIndexer>,
  library: string
): Promise<string> {
  const docs = await indexer.getLibraryDocs(library)
  
  if (docs.length === 0) {
    return `No documentation found for library: ${library}`
  }

  let output = `Found ${docs.length} documentation files for library: ${library}\n\n`
  
  for (const doc of docs) {
    output += `📄 ${doc.fileName}\n`
    output += `   Title: ${doc.frontmatter.title}\n`
    output += `   Type: ${doc.frontmatter.contentType}\n`
    output += `   Tags: ${doc.frontmatter.tags.join(", ")}\n`
    if (doc.frontmatter.description) {
      output += `   Description: ${doc.frontmatter.description}\n`
    }
    if (doc.frontmatter.source) {
      output += `   Source: ${doc.frontmatter.source}\n`
    }
    output += `   Last Updated: ${doc.frontmatter.lastUpdated}\n`
    output += "\n"
    
    // Include a preview of the content (first 200 characters)
    const preview = doc.content.replace(/^---\n[\s\S]*?\n---\n\n/, "").substring(0, 200)
    output += `   Preview: ${preview}${doc.content.length > 200 ? "..." : ""}\n\n`
  }

  return output
}

async function executeBuildIndex(indexer: ReturnType<typeof createLibraryIndexer>): Promise<string> {
  const index = await indexer.buildIndex()
  
  return `✅ Successfully built library index:\n` +
    `   Libraries: ${Object.keys(index.libraries).length}\n` +
    `   Tags: ${Object.keys(index.tags).length}\n` +
    `   Tokens: ${Object.keys(index.tokens).length}\n` +
    `   Last Built: ${index.lastBuilt}`
}

async function executeCreateScript(indexer: ReturnType<typeof createLibraryIndexer>): Promise<string> {
  await indexer.createTagQueryScript()
  
  return `✅ Created tag query script at ./library/scripts/query-by-tags.js\n\n` +
    `Usage:\n` +
    `  node ./library/scripts/query-by-tags.js tag1,tag2 [--and] [--library libname]\n\n` +
    `Examples:\n` +
    `  node ./library/scripts/query-by-tags.js api,react\n` +
    `  node ./library/scripts/query-by-tags.js tutorial,beginner --and\n` +
    `  node ./library/scripts/query-by-tags.js hooks --library react`
}