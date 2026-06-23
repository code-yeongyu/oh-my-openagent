import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";

import { createAnthropicAuthHook } from "./anthropic-auth";
import * as shared from "../shared";

describe("createAnthropicAuthHook", () => {
  const originalAnthropicBaseUrl = process.env.ANTHROPIC_BASE_URL;

  beforeEach(() => {
    delete process.env.ANTHROPIC_BASE_URL;
  });

  afterEach(() => {
    if (originalAnthropicBaseUrl === undefined)
      delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = originalAnthropicBaseUrl;
  });

  it("runs the Hermes-style Claude setup-token flow and links Claude Code OAuth credentials when present", async () => {
    const setupSpy = spyOn(shared, "runClaudeSetupToken").mockReturnValue(
      "oauth-access",
    );
    const linkedSpy = spyOn(
      shared,
      "readClaudeCodeOauthForAuthStore",
    ).mockReturnValue({
      access: "oauth-access",
      refresh: "oauth-refresh",
      expires: Date.now() + 3_600_000,
    });

    const hook = createAnthropicAuthHook({
      client: { auth: { set: mock(async () => undefined) } },
    } as never);

    const method = hook.methods[0];
    if (method.type !== "oauth") throw new Error("Expected oauth method");
    expect(method.label).toBe(
      "Claude Pro/Max (Claude Code OAuth / setup-token)",
    );

    const auth = await method.authorize();

    expect(setupSpy).toHaveBeenCalled();
    expect(auth.method).toBe("auto");
    expect(auth.instructions).toContain("Claude Code credentials linked");
    if (auth.method !== "auto") throw new Error("Expected auto auth flow");

    const callbackResult = await auth.callback();
    expect(callbackResult).toEqual({
      type: "success",
      access: "oauth-access",
      refresh: "oauth-refresh",
      expires: expect.any(Number),
    });

    setupSpy.mockRestore();
    linkedSpy.mockRestore();
  });

  it("falls back to pasting the setup-token when Claude Code does not auto-link credentials", async () => {
    const setupSpy = spyOn(shared, "runClaudeSetupToken").mockReturnValue(
      "sk-ant-oat-manual",
    );
    const linkedSpy = spyOn(
      shared,
      "readClaudeCodeOauthForAuthStore",
    ).mockReturnValue(null);

    const hook = createAnthropicAuthHook({
      client: { auth: { set: mock(async () => undefined) } },
    } as never);

    const method = hook.methods[0];
    if (method.type !== "oauth") throw new Error("Expected oauth method");
    expect(method.label).toBe(
      "Claude Pro/Max (Claude Code OAuth / setup-token)",
    );

    const auth = await method.authorize();

    expect(auth.method).toBe("code");
    expect(auth.instructions).toContain("setup-token");
    if (auth.method !== "code") throw new Error("Expected code auth flow");

    const callbackResult = await auth.callback("sk-ant-oat-manual");
    expect(callbackResult).toEqual({
      type: "success",
      access: "sk-ant-oat-manual",
      refresh: "",
      expires: expect.any(Number),
    });

    setupSpy.mockRestore();
    linkedSpy.mockRestore();
  });

  it("refreshes stored oauth in the loader and returns Claude CLI-style auth headers", async () => {
    const authSet = mock(async () => undefined);
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          expires_in: 1200,
        }),
        { status: 200 },
      ),
    );

    const hook = createAnthropicAuthHook({
      client: { auth: { set: authSet } },
    } as never);

    const options = await hook.loader?.(
      async () => ({
        type: "oauth",
        access: "expired-access",
        refresh: "refresh-me",
        expires: Date.now() - 1000,
      }),
      { id: "anthropic", models: {} } as never,
    );

    expect(authSet).toHaveBeenCalledTimes(1);
    expect(options?.apiKey).toBe("fresh-access");
    expect(typeof options?.fetch).toBe("function");
    expect(options?.headers?.Authorization).toBe("Bearer fresh-access");
    expect(options?.headers?.["anthropic-beta"]).toBe(
      "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,claude-code-20250219,oauth-2025-04-20",
    );
    expect(options?.headers?.["anthropic-version"]).toBe("2023-06-01");
    expect(options?.headers?.["user-agent"]).toContain("claude-cli/");
    expect(options?.headers?.["user-agent"]).toContain("(external, sdk-cli)");
    expect(options?.headers?.["x-app"]).toBe("cli");

    let seenHeaders: Headers | undefined;
    const sendSpy = spyOn(globalThis, "fetch").mockImplementation(
      async (_url: unknown, reqInit?: RequestInit) => {
        seenHeaders = new Headers(reqInit?.headers);
        return new Response(null, { status: 200 });
      },
    );
    await options?.fetch?.("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "leak", Authorization: "Bearer fresh-access" },
      body: "{}",
    });
    expect(seenHeaders?.get("x-api-key")).toBeNull();
    expect(seenHeaders?.get("Authorization")).toBe("Bearer fresh-access");
    sendSpy.mockRestore();

    fetchSpy.mockRestore();
  });

  it("hydrates missing startup auth from persisted Claude Code OAuth credentials", async () => {
    const authSet = mock(async () => undefined);
    const linkedSpy = spyOn(
      shared,
      "readClaudeCodeOauthForAuthStore",
    ).mockReturnValue({
      access: "persisted-access",
      refresh: "persisted-refresh",
      expires: Date.now() + 3_600_000,
    });

    const hook = createAnthropicAuthHook({
      client: { auth: { set: authSet } },
    } as never);

    const options = await hook.loader?.(
      async () => undefined as never,
      { id: "anthropic", models: {} } as never,
    );

    expect(linkedSpy).toHaveBeenCalledTimes(1);
    expect(authSet).toHaveBeenCalledWith({
      path: { id: "anthropic" },
      body: {
        type: "oauth",
        access: "persisted-access",
        refresh: "persisted-refresh",
        expires: expect.any(Number),
      },
    });
    expect(options?.apiKey).toBe("persisted-access");
    expect(options?.headers?.Authorization).toBe("Bearer persisted-access");

    linkedSpy.mockRestore();
  });

  it("prefers current Claude Code OAuth credentials over stale stored OpenCode OAuth auth", async () => {
    const authSet = mock(async () => undefined);
    const linkedSpy = spyOn(
      shared,
      "readClaudeCodeOauthForAuthStore",
    ).mockReturnValue({
      access: "current-account-access",
      refresh: "current-account-refresh",
      expires: Date.now() + 3_600_000,
    });

    const hook = createAnthropicAuthHook({
      client: { auth: { set: authSet } },
    } as never);

    const options = await hook.loader?.(
      async () => ({
        type: "oauth",
        access: "old-account-access",
        refresh: "old-account-refresh",
        expires: Date.now() + 3_600_000,
      }),
      { id: "anthropic", models: {} } as never,
    );

    expect(linkedSpy).toHaveBeenCalledTimes(1);
    expect(authSet).toHaveBeenCalledWith({
      path: { id: "anthropic" },
      body: {
        type: "oauth",
        access: "current-account-access",
        refresh: "current-account-refresh",
        expires: expect.any(Number),
      },
    });
    expect(options?.apiKey).toBe("current-account-access");
    expect(options?.headers?.Authorization).toBe(
      "Bearer current-account-access",
    );

    linkedSpy.mockRestore();
  });

  it("includes ANTHROPIC_BASE_URL in returned provider options when configured", async () => {
    process.env.ANTHROPIC_BASE_URL = " https://proxy.example.test/v1 ";

    const hook = createAnthropicAuthHook({
      client: { auth: { set: mock(async () => undefined) } },
    } as never);

    const options = await hook.loader?.(
      async () => ({
        type: "oauth",
        access: "fresh-access",
        refresh: "refresh-me",
        expires: Date.now() + 60_000,
      }),
      { id: "anthropic", models: {} } as never,
    );

    expect(options?.baseURL).toBe("https://proxy.example.test/v1");
  });
});
