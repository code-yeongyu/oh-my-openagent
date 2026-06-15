import type { Readable, Writable } from "node:stream";

import { runJsonRpcStdioServer as runCoreJsonRpcStdioServer, type McpLifecycleLog } from "@oh-my-opencode/mcp-stdio-core";
import type { AstGrepMcpOptions, JsonRpcResponse } from "./mcp";

export interface McpStdioServerOptions {
  readonly idleTimeoutMs?: number;
  readonly onIdleTimeout?: () => void | Promise<void>;
  readonly log?: McpLifecycleLog;
}

export type McpRequestHandler = (
  input: unknown,
  options: AstGrepMcpOptions,
) => Promise<JsonRpcResponse | undefined>;

export async function runJsonRpcStdioServer(
  handler: McpRequestHandler,
  input: Readable,
  output: Writable,
  options: AstGrepMcpOptions,
  stdioOptions: McpStdioServerOptions = {},
): Promise<void> {
  await runCoreJsonRpcStdioServer({
    input,
    output,
    handler,
    handlerOptions: options,
    ...stdioOptions,
  });
}
