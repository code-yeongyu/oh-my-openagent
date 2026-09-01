#!/usr/bin/env node
import { argv, stderr } from "node:process";
import { runMcpStdioServer } from "./mcp";

async function main(): Promise<void> {
  const [command = "mcp"] = argv.slice(2);
  if (command === "mcp") {
    await runMcpStdioServer(process.stdin, process.stdout);
    return;
  }

  stderr.write("Usage: omo-git-bash [mcp]\n");
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
