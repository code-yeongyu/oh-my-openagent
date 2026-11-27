import { describe, expect, test } from "bun:test";
import { mcpHandler, runCli } from "../vendor/surface/index.ts";
import { surfaceWith } from "../surface.ts";
import { fakeDeps, json, on, TOKEN, type Route } from "./fake.ts";

const cli = async (argv: readonly string[], routes: readonly Route[] = []) => {
  const { deps, seen } = fakeDeps(routes);
  const said: string[] = [];
  const code = await runCli(surfaceWith(deps), argv, {
    cli: "github",
    out: (text) => said.push(text),
    err: (text) => said.push(text),
  });
  return { code, said: said.join("\n"), seen };
};

describe("what leaves the process", () => {
  test("a secret value is refused on the command line before any request", async () => {
    const run = await cli([
      "secret",
      "set",
      "--name",
      "API_KEY",
      "--value",
      "hunter2-plain",
    ]);
    expect(run.code).toBe(2);
    expect(run.said).toContain("--input");
    expect(run.said).not.toContain("hunter2-plain");
    expect(run.seen).toHaveLength(0);
  });

  test("a result that carries the token is printed without it, by the CLI and over MCP", async () => {
    const echo = on("GET", /^\/user$/, () =>
      json({ login: "octo", note: `leaked ${TOKEN}` }),
    );
    const viaCli = await cli(["api", "rest", "--path", "user"], [echo]);
    expect(viaCli.code).toBe(0);
    expect(viaCli.said).toContain("leaked [redacted]");
    expect(viaCli.said).not.toContain(TOKEN);

    const { deps } = fakeDeps([echo]);
    const reply = await mcpHandler(surfaceWith(deps)).handle(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "api_rest",
          arguments: { path: "user" },
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      },
      { legacy: undefined },
    );
    expect(JSON.stringify(reply)).toContain("leaked [redacted]");
    expect(JSON.stringify(reply)).not.toContain(TOKEN);
  });
});
