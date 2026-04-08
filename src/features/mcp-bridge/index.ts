import { createServer } from "node:http"
import { resolve } from "node:path"
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z } from "zod"
import { runRg, runRgCount } from "../../tools/grep/cli"
import { runRgFiles } from "../../tools/glob/cli"
import { resolveGrepCliWithAutoInstall } from "../../tools/grep/constants"
import { formatGrepResult, formatCountResult } from "../../tools/grep/result-formatter"
import { formatGlobResult } from "../../tools/glob/result-formatter"
import { runSg } from "../../tools/ast-grep/cli"
import { formatSearchResult } from "../../tools/ast-grep/result-formatter"
import { CLI_LANGUAGES } from "../../tools/ast-grep/constants"
import { log } from "../../shared"

const MCP_BRIDGE_PORT = 4201
const MAX_FILE_SIZE = 100 * 1024

function buildMcpServer(workDir: string): McpServer {
  const server = new McpServer({ name: "oh-my-openagent", version: "1.0.0" })

  server.tool(
    "grep",
    "Search file contents using regular expressions. Output modes: content, files_with_matches (default), count.",
    {
      pattern: z.string().describe("Regex pattern to search for"),
      path: z.string().optional().describe("Directory to search in (default: working directory)"),
      include: z.string().optional().describe("File pattern filter (e.g. '*.ts', '*.{ts,tsx}')"),
      output_mode: z.enum(["content", "files_with_matches", "count"]).optional().describe("Output mode (default: files_with_matches)"),
      head_limit: z.number().optional().describe("Limit output to first N results"),
    },
    async ({ pattern, path, include, output_mode, head_limit }) => {
      try {
        const cli = await resolveGrepCliWithAutoInstall()
        const searchPath = path ? resolve(workDir, path) : workDir
        const globs = include ? [include] : undefined
        const outputMode = output_mode ?? "files_with_matches"
        const headLimit = head_limit ?? 0

        if (outputMode === "count") {
          const results = await runRgCount({ pattern, paths: [searchPath], globs }, cli)
          const limited = headLimit > 0 ? results.slice(0, headLimit) : results
          return { content: [{ type: "text" as const, text: formatCountResult(limited) }] }
        }

        const result = await runRg({
          pattern,
          paths: [searchPath],
          globs,
          outputMode: outputMode === "content" ? "content" : "files_with_matches",
          headLimit,
        }, cli)

        return { content: [{ type: "text" as const, text: formatGrepResult(result) }] }
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }] }
      }
    }
  )

  server.tool(
    "glob",
    "Find files by glob pattern (e.g. '**/*.ts', 'src/**/*.tsx'). Returns matching file paths sorted by modification time.",
    {
      pattern: z.string().describe("Glob pattern to match files against"),
      path: z.string().optional().describe("Directory to search in (default: working directory)"),
    },
    async ({ pattern, path }) => {
      try {
        const cli = await resolveGrepCliWithAutoInstall()
        const searchPath = path ? resolve(workDir, path) : workDir
        const result = await runRgFiles({ pattern, paths: [searchPath] }, cli)
        return { content: [{ type: "text" as const, text: formatGlobResult(result) }] }
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }] }
      }
    }
  )

  server.tool(
    "ast_grep_search",
    "AST-aware code pattern search. Use meta-variables: $VAR (single node), $$$ (multiple nodes). Supports 25 languages.",
    {
      pattern: z.string().describe("AST pattern with meta-variables. Must be a complete AST node."),
      lang: z.enum(CLI_LANGUAGES).describe("Target programming language"),
      paths: z.array(z.string()).optional().describe("Paths to search (default: working directory)"),
      globs: z.array(z.string()).optional().describe("Include/exclude globs (prefix ! to exclude)"),
      context: z.number().optional().describe("Context lines around each match"),
    },
    async ({ pattern, lang, paths, globs, context }) => {
      try {
        const searchPaths = paths?.map(p => resolve(workDir, p)) ?? [workDir]
        const result = await runSg({ pattern, lang, paths: searchPaths, globs, context })
        return { content: [{ type: "text" as const, text: formatSearchResult(result) }] }
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }] }
      }
    }
  )

  server.tool(
    "file_read",
    "Read a file from the local filesystem. Returns contents with line numbers.",
    {
      file_path: z.string().describe("Path to the file (absolute or relative to working directory)"),
      offset: z.number().optional().describe("Line number to start from (1-indexed)"),
      limit: z.number().optional().describe("Maximum number of lines to return (default: 2000)"),
    },
    async ({ file_path, offset, limit }) => {
      try {
        const absPath = resolve(workDir, file_path)
        const info = await stat(absPath)
        if (info.size > MAX_FILE_SIZE) {
          return { content: [{ type: "text" as const, text: `File too large (${Math.round(info.size / 1024)}KB). Use grep or offset/limit to read sections.` }] }
        }
        const content = await readFile(absPath, "utf-8")
        const lines = content.split("\n")
        const start = offset ? offset - 1 : 0
        const end = limit ? start + limit : lines.length
        const numbered = lines.slice(start, end).map((line, i) => `${start + i + 1}: ${line}`).join("\n")
        return { content: [{ type: "text" as const, text: numbered }] }
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }] }
      }
    }
  )

  server.tool(
    "file_list",
    "List directory contents. Returns files and subdirectories.",
    {
      path: z.string().optional().describe("Directory path (default: working directory)"),
    },
    async ({ path }) => {
      try {
        const absPath = path ? resolve(workDir, path) : workDir
        const entries = await readdir(absPath, { withFileTypes: true })
        const lines = entries
          .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
            return a.name.localeCompare(b.name)
          })
          .map(e => `${e.isDirectory() ? e.name + "/" : e.name}`)
        return { content: [{ type: "text" as const, text: lines.join("\n") }] }
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }] }
      }
    }
  )

  server.tool(
    "file_write",
    "Write content to a file on the local filesystem. Creates parent directories if needed.",
    {
      file_path: z.string().describe("Path to the file (absolute or relative to working directory)"),
      content: z.string().describe("Content to write to the file"),
    },
    async ({ file_path, content }) => {
      try {
        const absPath = resolve(workDir, file_path)
        await mkdir(dirname(absPath), { recursive: true })
        await writeFile(absPath, content, "utf-8")
        return { content: [{ type: "text" as const, text: `Written: ${file_path} (${content.length} chars)` }] }
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }] }
      }
    }
  )

  return server
}

export function startMcpBridge(workDir: string): () => void {
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${MCP_BRIDGE_PORT}`)

    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id")

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return }

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ status: "ok", dir: workDir, tools: ["grep", "glob", "ast_grep_search", "file_read", "file_list", "file_write"] }))
      return
    }

    if (url.pathname === "/sse" || url.pathname === "/mcp") {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      const mcpServer = buildMcpServer(workDir)
      await mcpServer.connect(transport)

      let body: unknown
      if (req.method === "POST") {
        let raw = ""
        await new Promise<void>(r => { req.on("data", chunk => { raw += chunk }); req.on("end", r) })
        try { body = JSON.parse(raw) } catch { body = undefined }
      }

      await transport.handleRequest(req as Parameters<typeof transport.handleRequest>[0], res, body)
      return
    }

    res.writeHead(404); res.end()
  })

  httpServer.listen(MCP_BRIDGE_PORT, "0.0.0.0", () => {
    log(`[MCP bridge] listening on :${MCP_BRIDGE_PORT} dir=${workDir}`)
  })

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code !== "EADDRINUSE") {
      log(`[MCP bridge] server error: ${err.message}`)
    }
  })

  return () => { httpServer.close() }
}

export { MCP_BRIDGE_PORT }
