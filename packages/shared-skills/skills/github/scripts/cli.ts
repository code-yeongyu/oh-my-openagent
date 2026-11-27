#!/usr/bin/env bun
// `bun cli.ts --help`, `bun cli.ts hello greet --name x`, `bun cli.ts mcp` (stdio) or `mcp --http`.
import { runCli } from "./vendor/surface/index.ts";
import { surface } from "./surface.ts";

process.exitCode = await runCli(surface, Bun.argv.slice(2), {
  cli: "github",
});
