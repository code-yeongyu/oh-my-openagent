import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildHermesAnthropicAuthConfig,
  isClaudeCodeTokenValid,
  readClaudeCodeCredentials,
  refreshAnthropicOauthPure,
  resolveAnthropicToken,
  resetClaudeCodeAnthropicAuthForTesting,
} from "./claude-code-anthropic-auth";

function writeClaudeCredentials(
  homeDir: string,
  oauth: Record<string, unknown>,
): void {
  const claudeDir = join(homeDir, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    join(claudeDir, ".credentials.json"),
    JSON.stringify({ claudeAiOauth: oauth }, null, 2),
    "utf-8",
  );
}

describe("claude-code-anthropic-auth", () => {
  let homeDir = "";
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    homeDir = join(
      tmpdir(),
      `claude-code-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(homeDir, { recursive: true });

    originalEnv = {
      HOME: process.env.HOME,
      ANTHROPIC_TOKEN: process.env.ANTHROPIC_TOKEN,
      CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_CUSTOM_HEADERS: process.env.ANTHROPIC_CUSTOM_HEADERS,
    };

    process.env.HOME = homeDir;
    delete process.env.ANTHROPIC_TOKEN;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_CUSTOM_HEADERS;
    resetClaudeCodeAnthropicAuthForTesting();
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetClaudeCodeAnthropicAuthForTesting();
  });

  it("reads refreshable Claude Code credentials from ~/.claude/.credentials.json", () => {
    writeClaudeCredentials(homeDir, {
      accessToken: "sk-ant-oat-local",
      refreshToken: "refresh-local",
      expiresAt: 2_000_000_000_000,
    });

    expect(readClaudeCodeCredentials()).toEqual({
      accessToken: "sk-ant-oat-local",
      refreshToken: "refresh-local",
      expiresAt: 2_000_000_000_000,
      source: "claude_code_credentials_file",
    });
  });

  it("treats expiresAt as milliseconds with a 60 second validity buffer", () => {
    const future = Date.now() + 120_000;
    const nearExpiry = Date.now() + 30_000;

    expect(
      isClaudeCodeTokenValid({ accessToken: "token", expiresAt: future }),
    ).toBe(true);
    expect(
      isClaudeCodeTokenValid({ accessToken: "token", expiresAt: nearExpiry }),
    ).toBe(false);
  });

  it("refreshes expired Claude Code credentials and writes the refreshed pair back to the credentials file", async () => {
    writeClaudeCredentials(homeDir, {
      accessToken: "expired-token",
      refreshToken: "refresh-old",
      expiresAt: Date.now() - 10_000,
      scopes: ["user:inference"],
    });

    const originalFetch = globalThis.fetch;
    const fetchMock = mock(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "fresh-token",
            refresh_token: "refresh-new",
            expires_in: 3600,
          }),
          { status: 200 },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const token = await resolveAnthropicToken();

    expect(token).toBe("fresh-token");
    const persisted = JSON.parse(
      readFileSync(join(homeDir, ".claude", ".credentials.json"), "utf-8"),
    ) as {
      claudeAiOauth: Record<string, unknown>;
    };
    expect(persisted.claudeAiOauth.accessToken).toBe("fresh-token");
    expect(persisted.claudeAiOauth.refreshToken).toBe("refresh-new");
    expect(persisted.claudeAiOauth.scopes).toEqual(["user:inference"]);

    globalThis.fetch = originalFetch;
  });

  it("prefers refreshable Claude Code credentials over a static OAuth env token", async () => {
    process.env.ANTHROPIC_TOKEN = "sk-ant-oat-static";
    writeClaudeCredentials(homeDir, {
      accessToken: "sk-ant-oat-refreshable",
      refreshToken: "refresh-local",
      expiresAt: Date.now() + 120_000,
    });

    await expect(resolveAnthropicToken()).resolves.toBe(
      "sk-ant-oat-refreshable",
    );
  });

  it("falls back to ~/.claude.json primaryApiKey when no OAuth credentials are available", async () => {
    writeFileSync(
      join(homeDir, ".claude.json"),
      JSON.stringify({ primaryApiKey: "sk-ant-oat-setup-token" }, null, 2),
      "utf-8",
    );

    await expect(resolveAnthropicToken()).resolves.toBe(
      "sk-ant-oat-setup-token",
    );
  });

  it("builds Hermes-style Anthropic auth config for OAuth tokens", () => {
    const config = buildHermesAnthropicAuthConfig("sk-ant-oat-token");

    expect(config).toEqual({
      headers: {
        Authorization: "Bearer sk-ant-oat-token",
        "anthropic-beta":
          "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,claude-code-20250219,oauth-2025-04-20",
        "anthropic-version": "2023-06-01",
        "user-agent": expect.stringContaining("(external, sdk-cli)"),
        "x-app": "cli",
      },
    });
  });

  it("merges ANTHROPIC_CUSTOM_HEADERS into OAuth auth config and extends anthropic-beta safely", () => {
    process.env.ANTHROPIC_CUSTOM_HEADERS = JSON.stringify({
      "anthropic-beta": "context-1m-2025-08-07",
      "x-test-header": "enabled",
    });

    const config = buildHermesAnthropicAuthConfig("sk-ant-oat-token");

    expect(config.headers["anthropic-beta"]).toContain("oauth-2025-04-20");
    expect(config.headers["anthropic-beta"]).toContain("context-1m-2025-08-07");
    expect(config.headers["x-test-header"]).toBe("enabled");
  });

  it("ignores Authorization-like values from ANTHROPIC_CUSTOM_HEADERS", () => {
    process.env.ANTHROPIC_CUSTOM_HEADERS = JSON.stringify({
      Authorization: "Bearer should-not-win",
      "x-api-key": "should-not-win",
      "x-safe-header": "ok",
    });

    const config = buildHermesAnthropicAuthConfig("sk-ant-oat-token");

    expect(config.headers.Authorization).toBe("Bearer sk-ant-oat-token");
    expect(config.headers["x-api-key"]).toBeUndefined();
    expect(config.headers["x-safe-header"]).toBe("ok");
    expect(config.headers["user-agent"]).toContain("(external, sdk-cli)");
    expect(config.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("builds Hermes-style Anthropic auth config for regular API keys", () => {
    const config = buildHermesAnthropicAuthConfig("sk-ant-api03-key");

    expect(config).toEqual({
      apiKey: "sk-ant-api03-key",
      headers: {
        "anthropic-beta":
          "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
        "anthropic-version": "2023-06-01",
      },
    });
  });

  it("posts urlencoded refresh requests to the same endpoints Hermes uses", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "fresh",
            refresh_token: "next",
            expires_in: 1234,
          }),
          {
            status: 200,
          },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await refreshAnthropicOauthPure("refresh-token");

    expect(result.access_token).toBe("fresh");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://platform.claude.com/v1/oauth/token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain(
      "(external, sdk-cli)",
    );
    expect(String(init.body)).toContain("grant_type=refresh_token");
    expect(String(init.body)).toContain(
      "client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    );

    globalThis.fetch = originalFetch;
  });
});
