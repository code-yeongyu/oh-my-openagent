import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleAstGrepMcpRequest } from "./mcp";
import type { RunOptions } from "./runner";
import type { SgResult } from "./types";

const emptyResult: SgResult = {
  matches: [],
  totalMatches: 0,
  truncated: false,
};

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ast-grep MCP", () => {
  it("#given initialize request #when handled #then advertises tools capability", async () => {
    const response = await handleAstGrepMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ast_grep", version: "0.1.0" },
        protocolVersion: "2024-11-05",
      },
    });
  });

  it("#given tools list request #when handled #then exposes search and replace tools", async () => {
    const response = await handleAstGrepMcpRequest({ jsonrpc: "2.0", id: "tools", method: "tools/list" });

    expect(response?.result?.tools?.map((tool) => tool.name)).toEqual(["search", "replace"]);
  });

  it("#given search call without paths #when handled #then defaults paths to workspace directory", async () => {
    const captured: { value?: RunOptions } = {};
    const workspaceDirectory = createTemporaryDirectory("omo-ast-grep-workspace-");
    const response = await handleAstGrepMcpRequest(
      {
        jsonrpc: "2.0",
        id: "search",
        method: "tools/call",
        params: { name: "search", arguments: { pattern: "console.log($$$)", lang: "typescript" } },
      },
      {
        workspaceDirectory,
        runSg: async (options) => {
          captured.value = options;
          return emptyResult;
        },
      },
    );

    expect(captured.value).toEqual({ pattern: "console.log($$$)", lang: "typescript", cwd: realpathSync(workspaceDirectory), paths: ["."], globs: undefined, context: undefined });
    expect(response?.result?.content?.[0]?.text).toContain("No matches found");
  });

  it("#given replace call without dryRun #when handled #then keeps dry-run default", async () => {
    const captured: { value?: RunOptions } = {};
    const workspaceDirectory = createTemporaryDirectory("omo-ast-grep-replace-workspace-");
    mkdirSync(join(workspaceDirectory, "src"));
    await handleAstGrepMcpRequest(
      {
        jsonrpc: "2.0",
        id: "replace",
        method: "tools/call",
        params: {
          name: "replace",
          arguments: { pattern: "console.log($MSG)", rewrite: "logger.info($MSG)", lang: "typescript", paths: ["src"] },
        },
      },
      {
        workspaceDirectory,
        runSg: async (options) => {
          captured.value = options;
          return emptyResult;
        },
      },
    );

    expect(captured.value).toEqual({
      pattern: "console.log($MSG)",
      rewrite: "logger.info($MSG)",
      lang: "typescript",
      cwd: realpathSync(workspaceDirectory),
      paths: ["src"],
      globs: undefined,
      updateAll: false,
    });
  });

  it("#given disabled replace tool #when listed and called #then hides and rejects it", async () => {
    const listResponse = await handleAstGrepMcpRequest({ jsonrpc: "2.0", id: "tools", method: "tools/list" }, { disabledTools: ["replace"] });

    expect(listResponse?.result?.tools?.map((tool) => tool.name)).toEqual(["search"]);

    const callResponse = await handleAstGrepMcpRequest(
      {
        jsonrpc: "2.0",
        id: "replace",
        method: "tools/call",
        params: {
          name: "replace",
          arguments: { pattern: "console.log($MSG)", rewrite: "logger.info($MSG)", lang: "typescript", paths: ["src"] },
        },
      },
      { disabledTools: ["replace"] },
    );

    expect(callResponse?.result?.isError).toBe(true);
    expect(callResponse?.result?.content?.[0]?.text).toContain("ast-grep tool is disabled: replace");
  });

  it("#given unsafe paths #when search is called #then rejects before running ast-grep", async () => {
    const workspaceDirectory = createTemporaryDirectory("omo-ast-grep-sandbox-");
    const outsideDirectory = createTemporaryDirectory("omo-ast-grep-outside-");
    symlinkSync(outsideDirectory, join(workspaceDirectory, "outside-link"));
    let didRun = false;

    for (const path of ["../outside", "/tmp", "--update-all", "outside-link"]) {
      const response = await handleAstGrepMcpRequest(
        {
          jsonrpc: "2.0",
          id: path,
          method: "tools/call",
          params: { name: "search", arguments: { pattern: "console.log($$$)", lang: "typescript", paths: [path] } },
        },
        {
          workspaceDirectory,
          runSg: async () => {
            didRun = true;
            return emptyResult;
          },
        },
      );

      expect(response?.result?.isError).toBe(true);
    }

    expect(didRun).toBe(false);
  });

  it("#given tools list request #when handled #then preserves detailed ast-grep guidance", async () => {
    const response = await handleAstGrepMcpRequest({ jsonrpc: "2.0", id: "tools", method: "tools/list" });
    const searchTool = response?.result?.tools?.find((tool) => tool.name === "search");

    expect(searchTool?.description).toContain("This is NOT regex");
    expect(searchTool?.description).toContain("Meta-variables");
  });
});
