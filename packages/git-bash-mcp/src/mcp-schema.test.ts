import { describe, expect, it } from "bun:test";
import { handleGitBashMcpRequest } from "./mcp";

describe("git_bash MCP run schema", () => {
  it("#given Windows with Git Bash #when tools are listed #then run schema matches shell command conventions", async () => {
    // given
    const response = await handleGitBashMcpRequest(
      { jsonrpc: "2.0", id: "tools", method: "tools/list" },
      {
        platform: "win32",
        env: { OMO_CODEX_GIT_BASH_PATH: "C:\\Program Files\\Git\\bin\\bash.exe" },
        exists: (path) => path === "C:\\Program Files\\Git\\bin\\bash.exe",
        where: () => [],
      },
    );

    // when
    const runTool = toolFromResponse(response, "run");
    const schema = objectField(runTool, "inputSchema");
    const properties = objectField(schema, "properties");

    // then
    expect(typeof runTool?.description).toBe("string");
    expect(String(runTool?.description)).toContain("exec_command");
    expect(Object.keys(properties ?? {})).toEqual(["command", "timeout", "workdir", "description"]);
    expect(objectField(properties, "timeout")).toMatchObject({ type: "integer", minimum: 1 });
    expect(objectField(properties, "workdir")?.description).toContain("Use this instead of");
    expect(objectField(properties, "description")?.description).toContain("5-10 words");
  });

  it("#given Windows without Git Bash #when tools are listed #then run is gracefully hidden", async () => {
    // given
    const response = await handleGitBashMcpRequest(
      { jsonrpc: "2.0", id: "tools", method: "tools/list" },
      { platform: "win32", env: {}, exists: () => false, where: () => [] },
    );

    // when
    const names = toolNamesFromResponse(response);

    // then
    expect(names).toEqual(["which_bash", "diagnose"]);
  });
});

function toolFromResponse(response: Awaited<ReturnType<typeof handleGitBashMcpRequest>>, name: string): Record<string, unknown> | undefined {
  const result = resultFromResponse(response);
  const tools = result?.tools;
  if (!Array.isArray(tools)) return undefined;
  return tools.find((tool): tool is Record<string, unknown> => isRecord(tool) && tool.name === name);
}

function toolNamesFromResponse(response: Awaited<ReturnType<typeof handleGitBashMcpRequest>>): readonly string[] {
  const result = resultFromResponse(response);
  const tools = result?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool) => {
    if (!isRecord(tool)) return [];
    return typeof tool.name === "string" ? [tool.name] : [];
  });
}

function resultFromResponse(response: Awaited<ReturnType<typeof handleGitBashMcpRequest>>): Record<string, unknown> | undefined {
  if (response === undefined || "error" in response) return undefined;
  return response.result;
}

function objectField(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
