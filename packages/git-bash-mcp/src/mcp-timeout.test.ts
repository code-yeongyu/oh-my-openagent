import { describe, expect, it } from "bun:test";
import { handleGitBashMcpRequest } from "./mcp";
import type { RunGitBashCommand } from "./runner";

describe("git_bash MCP timeout resolution", () => {
  it("#given inherited default timeout and workdir #when run omits timeout #then runner receives the inherited timeout", async () => {
    // given
    const captured: { bashPath?: string; command?: string; cwd?: string; timeoutMs?: number } = {};
    const runGitBash: RunGitBashCommand = async (input) => {
      captured.bashPath = input.bashPath;
      captured.command = input.command;
      captured.cwd = input.cwd;
      captured.timeoutMs = input.timeoutMs;
      return { exitCode: 0, stdout: "ok\n", stderr: "", timedOut: false };
    };

    // when
    const response = await handleGitBashMcpRequest(
      {
        jsonrpc: "2.0",
        id: "run",
        method: "tools/call",
        params: { name: "run", arguments: { command: "printf ok", workdir: "C:\\repo" } },
      },
      {
        platform: "win32",
        env: { OMO_CODEX_GIT_BASH_PATH: "C:\\Program Files\\Git\\bin\\bash.exe" },
        exists: (path) => path === "C:\\Program Files\\Git\\bin\\bash.exe",
        where: () => [],
        runGitBash,
        defaultTimeoutMs: 45_000,
      },
    );

    // then
    expect(isErrorFromResponse(response)).toBe(false);
    expect(captured).toEqual({
      bashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
      command: "printf ok",
      cwd: "C:\\repo",
      timeoutMs: 45_000,
    });
  });

  it("#given per-call timeout #when inherited timeout exists #then per-call timeout wins", async () => {
    // given
    let timeoutMs = 0;

    // when
    const response = await handleGitBashMcpRequest(
      {
        jsonrpc: "2.0",
        id: "run",
        method: "tools/call",
        params: { name: "run", arguments: { command: "printf ok", timeout: 7000 } },
      },
      {
        platform: "win32",
        env: { OMO_CODEX_GIT_BASH_PATH: "C:\\Program Files\\Git\\bin\\bash.exe" },
        exists: (path) => path === "C:\\Program Files\\Git\\bin\\bash.exe",
        where: () => [],
        runGitBash: async (input) => {
          timeoutMs = input.timeoutMs;
          return { exitCode: 0, stdout: "ok\n", stderr: "", timedOut: false };
        },
        defaultTimeoutMs: 45_000,
      },
    );

    // then
    expect(isErrorFromResponse(response)).toBe(false);
    expect(timeoutMs).toBe(7000);
  });

  it("#given exec command timeout env default #when run omits timeout #then env default is used", async () => {
    // given
    let timeoutMs = 0;

    // when
    const response = await handleGitBashMcpRequest(
      {
        jsonrpc: "2.0",
        id: "run",
        method: "tools/call",
        params: { name: "run", arguments: { command: "printf ok" } },
      },
      {
        platform: "win32",
        env: {
          OMO_CODEX_GIT_BASH_PATH: "C:\\Program Files\\Git\\bin\\bash.exe",
          OMO_CODEX_EXEC_COMMAND_TIMEOUT_MS: "65000",
        },
        exists: (path) => path === "C:\\Program Files\\Git\\bin\\bash.exe",
        where: () => [],
        runGitBash: async (input) => {
          timeoutMs = input.timeoutMs;
          return { exitCode: 0, stdout: "ok\n", stderr: "", timedOut: false };
        },
      },
    );

    // then
    expect(isErrorFromResponse(response)).toBe(false);
    expect(timeoutMs).toBe(65_000);
  });
});

function isErrorFromResponse(response: Awaited<ReturnType<typeof handleGitBashMcpRequest>>): boolean | undefined {
  const result = resultFromResponse(response);
  const value = result?.isError;
  return typeof value === "boolean" ? value : undefined;
}

function resultFromResponse(response: Awaited<ReturnType<typeof handleGitBashMcpRequest>>): Record<string, unknown> | undefined {
  if (response === undefined || "error" in response) return undefined;
  return response.result;
}
