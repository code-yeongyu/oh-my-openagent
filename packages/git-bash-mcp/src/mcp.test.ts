import { describe, expect, it } from "bun:test";
import { handleGitBashMcpRequest } from "./mcp";
import type { JsonRpcResponse } from "./mcp";
import type { RunGitBashCommand } from "./runner";

type WhichBashPayload = {
  readonly source: string;
  readonly path: string;
  readonly checkedPaths?: readonly string[];
};

type DiagnosePayload = {
  readonly enabled: boolean;
  readonly status: string;
  readonly resolution?: { readonly checkedPaths?: readonly string[] };
};

type RunPayload = {
  readonly stdout: string;
};

class MalformedMcpPayloadError extends Error {
  readonly name = "MalformedMcpPayloadError";
}

describe("git_bash MCP", () => {
  it("#given simulated Windows with env override #when which_bash is called #then returns path and source", async () => {
    const response = await handleGitBashMcpRequest(
      {
        jsonrpc: "2.0",
        id: "which",
        method: "tools/call",
        params: { name: "which_bash", arguments: {} },
      },
      {
        platform: "win32",
        env: { OMO_CODEX_GIT_BASH_PATH: "C:\\Tools\\Git\\bin\\bash.exe" },
        exists: (path) => path === "C:\\Tools\\Git\\bin\\bash.exe",
        where: () => [],
      },
    );

    const payload = whichBashPayloadFromResponse(response);
    expect(isErrorFromResponse(response)).toBe(false);
    expect(payload.source).toBe("env");
    expect(payload.path).toBe("C:\\Tools\\Git\\bin\\bash.exe");
    expect(payload.checkedPaths).toEqual(["C:\\Tools\\Git\\bin\\bash.exe"]);
  });

  it("#given simulated Windows resolved via PATH #when diagnose is called #then resolution lists every probed path", async () => {
    const system32Bash = "C:\\Windows\\System32\\bash.exe";
    const gitBash = "D:\\Git\\bin\\bash.exe";
    const response = await handleGitBashMcpRequest(
      {
        jsonrpc: "2.0",
        id: "diagnose",
        method: "tools/call",
        params: { name: "diagnose", arguments: {} },
      },
      {
        platform: "win32",
        env: {},
        exists: (path) => path === system32Bash || path === gitBash,
        where: () => [system32Bash, gitBash],
      },
    );

    const payload = diagnosePayloadFromResponse(response);
    expect(isErrorFromResponse(response)).toBe(false);
    expect(payload.enabled).toBe(true);
    expect(payload.resolution?.checkedPaths).toEqual([
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
      system32Bash,
      gitBash,
    ]);
  });

  it("#given non-Windows platform #when diagnose is called #then reports disabled state", async () => {
    const response = await handleGitBashMcpRequest(
      {
        jsonrpc: "2.0",
        id: "diagnose",
        method: "tools/call",
        params: { name: "diagnose", arguments: {} },
      },
      { platform: "darwin", env: {}, exists: () => false, where: () => [] },
    );

    const payload = diagnosePayloadFromResponse(response);
    expect(isErrorFromResponse(response)).toBe(false);
    expect(payload.enabled).toBe(false);
    expect(payload.status).toContain("native Windows");
  });

  it("#given non-Windows platform #when tools are listed #then command-running tool is hidden", async () => {
    const response = await handleGitBashMcpRequest(
      { jsonrpc: "2.0", id: "tools", method: "tools/list" },
      { platform: "linux", env: {}, exists: () => false, where: () => [] },
    );

    expect(toolNamesFromResponse(response)).toEqual(["which_bash", "diagnose"]);
  });

  it("#given run call on simulated Windows #when handled #then uses resolved Git Bash with command payload", async () => {
    const captured: { bashPath?: string; command?: string; cwd?: string; timeoutMs?: number } = {};
    const runGitBash: RunGitBashCommand = async (input) => {
      captured.bashPath = input.bashPath;
      captured.command = input.command;
      captured.cwd = input.cwd;
      captured.timeoutMs = input.timeoutMs;
      return { exitCode: 0, stdout: "ok\n", stderr: "", timedOut: false };
    };

    const response = await handleGitBashMcpRequest(
      {
        jsonrpc: "2.0",
        id: "run",
        method: "tools/call",
        params: { name: "run", arguments: { command: "printf ok", cwd: "C:\\repo", timeout_ms: 5000 } },
      },
      {
        platform: "win32",
        env: { OMO_CODEX_GIT_BASH_PATH: "C:\\Program Files\\Git\\bin\\bash.exe" },
        exists: (path) => path === "C:\\Program Files\\Git\\bin\\bash.exe",
        where: () => [],
        runGitBash,
      },
    );

    const payload = runPayloadFromResponse(response);
    expect(isErrorFromResponse(response)).toBe(false);
    expect(payload.stdout).toBe("ok\n");
    expect(captured).toEqual({
      bashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
      command: "printf ok",
      cwd: "C:\\repo",
      timeoutMs: 5000,
    });
  });

  it("#given malformed run command #when handled #then rejects without spawning", async () => {
    let didRun = false;
    const response = await handleGitBashMcpRequest(
      {
        jsonrpc: "2.0",
        id: "run",
        method: "tools/call",
        params: { name: "run", arguments: { command: "   " } },
      },
      {
        platform: "win32",
        env: { OMO_CODEX_GIT_BASH_PATH: "C:\\Program Files\\Git\\bin\\bash.exe" },
        exists: () => true,
        where: () => [],
        runGitBash: async () => {
          didRun = true;
          return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
        },
      },
    );

    expect(isErrorFromResponse(response)).toBe(true);
    expect(textFromResponse(response)).toContain("non-empty string");
    expect(didRun).toBe(false);
  });
});

function textFromResponse(response: Awaited<ReturnType<typeof handleGitBashMcpRequest>>): string {
  const result = resultFromResponse(response);
  const content = result?.content;
  if (!Array.isArray(content)) return "";
  const first = content[0];
  if (typeof first !== "object" || first === null || Array.isArray(first)) return "";
  const text = first.text;
  return typeof text === "string" ? text : "";
}

function whichBashPayloadFromResponse(response: Awaited<ReturnType<typeof handleGitBashMcpRequest>>): WhichBashPayload {
  const payload = jsonObjectFromResponse(response);
  const { path, source } = payload;
  if (typeof path !== "string" || typeof source !== "string") {
    throw new MalformedMcpPayloadError("Expected which_bash payload with string path and source");
  }
  return { path, source, checkedPaths: stringArrayField(payload, "checkedPaths") };
}

function diagnosePayloadFromResponse(response: Awaited<ReturnType<typeof handleGitBashMcpRequest>>): DiagnosePayload {
  const payload = jsonObjectFromResponse(response);
  const { enabled, status, resolution } = payload;
  if (typeof enabled !== "boolean" || typeof status !== "string") {
    throw new MalformedMcpPayloadError("Expected diagnose payload with boolean enabled and string status");
  }
  const resolutionRecord = typeof resolution === "object" && resolution !== null && !Array.isArray(resolution)
    ? Object.fromEntries(Object.entries(resolution))
    : undefined;
  return {
    enabled,
    status,
    resolution: resolutionRecord === undefined ? undefined : { checkedPaths: stringArrayField(resolutionRecord, "checkedPaths") },
  };
}

function stringArrayField(record: Record<string, unknown>, key: string): readonly string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  return value.every((entry): entry is string => typeof entry === "string") ? value : undefined;
}

function runPayloadFromResponse(response: Awaited<ReturnType<typeof handleGitBashMcpRequest>>): RunPayload {
  const payload = jsonObjectFromResponse(response);
  const { stdout } = payload;
  if (typeof stdout !== "string") {
    throw new MalformedMcpPayloadError("Expected run payload with string stdout");
  }
  return { stdout };
}

function jsonObjectFromResponse(response: Awaited<ReturnType<typeof handleGitBashMcpRequest>>): Record<string, unknown> {
  const parsed: unknown = JSON.parse(textFromResponse(response));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new MalformedMcpPayloadError("Expected MCP response text to contain a JSON object");
  }
  return Object.fromEntries(Object.entries(parsed));
}

function toolNamesFromResponse(response: Awaited<ReturnType<typeof handleGitBashMcpRequest>>): readonly string[] {
  const result = resultFromResponse(response);
  const tools = result?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool) => {
    if (typeof tool !== "object" || tool === null || Array.isArray(tool)) return [];
    return typeof tool.name === "string" ? [tool.name] : [];
  });
}

function isErrorFromResponse(response: Awaited<ReturnType<typeof handleGitBashMcpRequest>>): boolean | undefined {
  return booleanField(resultFromResponse(response), "isError");
}

function resultFromResponse(response: JsonRpcResponse | undefined): Record<string, unknown> | undefined {
  if (response === undefined || "error" in response) return undefined;
  return response.result;
}

function booleanField(record: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}
