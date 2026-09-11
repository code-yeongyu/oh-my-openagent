import { writeFileSync } from "node:fs"
import { handleGitBashMcpRequest } from "../../../packages/git-bash-mcp/src/mcp"
import { errorResponse, runJsonRpcStdioServer } from "../../../packages/mcp-stdio-core/src/index"

await runJsonRpcStdioServer({
  input: process.stdin,
  output: process.stdout,
  handler: async (input, options) => {
    const response = await handleGitBashMcpRequest(input, options)
    if (typeof input === "object" && input !== null && "method" in input && input.method === "tools/call") {
      writeFileSync("/qa/mcp-call.json", JSON.stringify({ input, response }))
    }
    return response
  },
  handlerOptions: {},
  idleTimeoutMs: 0,
  parentWatchdog: {},
  parseErrorResponse: () => errorResponse(null, -32601, "Method not found"),
})
