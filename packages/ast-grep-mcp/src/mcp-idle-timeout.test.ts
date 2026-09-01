import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import { runMcpStdioServer } from "./mcp";

// The senpi host (which spawns this CLI as `_ast_grep`) auto-reconnects a stdio
// server that exits: transport close marks the connection degraded and the
// reconnect scheduler respawns the child with backoff (senpi connection.ts
// #createTransportConnection + reconnect.ts configureMcpReconnect). That is the
// evidence gate for arming the idle timeout here: an idle exit costs one
// backoff-delayed respawn, not a broken session.
const IDLE_ENV_KEY = "OMO_AST_GREP_IDLE_TIMEOUT_MS";

describe("ast_grep MCP idle timeout", () => {
  it("#given an explicit idle timeout and a live parent that abandons stdin #when the timeout elapses #then the server settles", async () => {
    // given
    const input = new PassThrough();
    const output = new PassThrough();

    // when
    const served = runMcpStdioServer(input, output, { idleTimeoutMs: 25 });
    const outcome = await Promise.race([
      served.then(() => "settled" as const),
      Bun.sleep(2_000).then(() => "hung" as const),
    ]);

    // then
    expect(outcome).toBe("settled");
  });

  it("#given OMO_AST_GREP_IDLE_TIMEOUT_MS in the environment and no explicit option #when the timeout elapses #then the server settles", async () => {
    // given — the senpi component has no per-server option channel; env is the
    // only lever the host can set on the spawned CLI, mirroring
    // OMO_AST_GREP_PROJECT_CWD.
    const previous = process.env[IDLE_ENV_KEY];
    process.env[IDLE_ENV_KEY] = "25";
    try {
      const input = new PassThrough();
      const output = new PassThrough();

      // when
      const served = runMcpStdioServer(input, output);
      const outcome = await Promise.race([
        served.then(() => "settled" as const),
        Bun.sleep(2_000).then(() => "hung" as const),
      ]);

      // then
      expect(outcome).toBe("settled");
    } finally {
      restoreEnv(IDLE_ENV_KEY, previous);
    }
  });

  it("#given an explicit idleTimeoutMs of 0 #when the server runs idle #then it stays parked (opt-out preserved)", async () => {
    // given
    const input = new PassThrough();
    const output = new PassThrough();

    // when
    const served = runMcpStdioServer(input, output, { idleTimeoutMs: 0 });
    const outcome = await Promise.race([
      served.then(() => "settled" as const),
      Bun.sleep(500).then(() => "hung" as const),
    ]);
    // Cleanup of the held-open pipe; keep the provoked rejection handled so
    // the suite cannot fail on an unhandled error after the assertions.
    served.catch(() => {});
    input.destroy();

    // then
    expect(outcome).toBe("hung");
  });

  it("#given the idle timeout resolves from option or env #when the server starts #then stdio_started logs the resolved value", async () => {
    // given
    const input = new PassThrough();
    const output = new PassThrough();
    const lifecycle: Array<{ readonly event: string; readonly data?: unknown }> = [];
    const previous = process.env[IDLE_ENV_KEY];
    process.env[IDLE_ENV_KEY] = "1234";
    try {
      // when
      const served = runMcpStdioServer(input, output, {
        idleTimeoutMs: 4321,
        lifecycleLog: (event, data) => {
          lifecycle.push({ event, data });
        },
      });
      await Promise.race([
        served.then(() => "settled" as const),
        Bun.sleep(2_000).then(() => "hung" as const),
      ]);

      // then — the explicit option must win over the env value.
      expect(lifecycle).toContainEqual({
        event: "stdio_started",
        data: expect.objectContaining({ idle_timeout_ms: 4321 }),
      });
    } finally {
      restoreEnv(IDLE_ENV_KEY, previous);
    }
  });

  it("#given the real CLI spawned the way senpi spawns it #when the parent holds stdin open and never writes #then the child exits on idle", async () => {
    // given — stdin piped and never written or closed: the test process is a
    // live parent holding the write end, which is exactly the abandoned-pipe
    // leak shape.
    const previous = process.env[IDLE_ENV_KEY];
    process.env[IDLE_ENV_KEY] = "300";
    try {
      const cliUrl = new URL("./cli.ts", import.meta.url).pathname;
      const child = Bun.spawn([process.execPath, cliUrl, "mcp"], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      });

      // when
      const outcome = await Promise.race([
        child.exited.then(() => "exited" as const),
        Bun.sleep(5_000).then(() => "alive" as const),
      ]);

      // then
      expect(outcome).toBe("exited");
    } finally {
      restoreEnv(IDLE_ENV_KEY, previous);
    }
  });
});

function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}
