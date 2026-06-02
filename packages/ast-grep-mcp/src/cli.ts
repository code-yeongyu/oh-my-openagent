#!/usr/bin/env node
import { argv, stderr } from "node:process";
import { writeMcpLifecycleLog } from "./mcp-lifecycle-log";
import { runMcpStdioServer } from "./mcp";

async function main(): Promise<void> {
  const [command = "mcp"] = argv.slice(2);
  if (command === "mcp") {
    await runMcpStdioServer(process.stdin, process.stdout, {}, {
      log: writeMcpLifecycleLog,
      onIdleTimeout: () => {
        process.exit(0);
      },
    });
    return;
  }
  stderr.write("Usage: omo-ast-grep [mcp]\n");
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
