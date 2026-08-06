/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rewriteCachedMcpManifest } from "./codex-cache"

describe("codex-cache Context7 MCP manifest rewrite", () => {
  test("#given cached Context7 manifest has placeholder api-key args #when rewriting #then drops placeholder auth", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-context7-placeholder-"))
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          context7: {
            command: "bunx",
            cwd: ".",
            args: ["--bun", "-y", "@upstash/context7-mcp", "--api-key", "your api key"],
            env: { CONTEXT7_API_KEY: "<YOUR_API_KEY>", SAFE_FLAG: "1" },
          },
        },
      }),
    )

    // when
    await rewriteCachedMcpManifest(root)

    // then
    const raw = await readFile(join(root, ".mcp.json"), "utf8")
    const rewritten = JSON.parse(raw) as {
      mcpServers: { context7: { cwd?: string; args: string[]; env?: Record<string, string> } }
    }
    expect(rewritten.mcpServers.context7.cwd).toBeUndefined()
    expect(rewritten.mcpServers.context7.args).toEqual(["--bun", "-y", "@upstash/context7-mcp"])
    expect(rewritten.mcpServers.context7.env).toEqual({ SAFE_FLAG: "1" })
    expect(raw.toLowerCase()).not.toContain("your api key")
    expect(raw).not.toContain("YOUR_API_KEY")
    expect(raw).not.toContain("--api-key")
  })

  test("#given cached Context7 manifest has real api-key args #when rewriting #then preserves user auth", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-context7-real-key-"))
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          context7: {
            command: "bunx",
            cwd: ".",
            args: ["--bun", "-y", "@upstash/context7-mcp", "--api-key", "ctx7sk_real_user_key"],
            env: { CONTEXT7_API_KEY: "ctx7sk_real_env_key" },
          },
        },
      }),
    )

    // when
    await rewriteCachedMcpManifest(root)

    // then
    const rewritten = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8")) as {
      mcpServers: { context7: { cwd?: string; args: string[]; env?: Record<string, string> } }
    }
    expect(rewritten.mcpServers.context7.cwd).toBeUndefined()
    expect(rewritten.mcpServers.context7.args).toEqual([
      "--bun",
      "-y",
      "@upstash/context7-mcp",
      "--api-key",
      "ctx7sk_real_user_key",
    ])
    expect(rewritten.mcpServers.context7.env).toEqual({ CONTEXT7_API_KEY: "ctx7sk_real_env_key" })
  })

  test("#given cached Context7 manifest has env-only placeholder auth #when rewriting #then drops placeholder env", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-context7-env-placeholder-"))
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          context7: {
            url: "https://mcp.context7.com/mcp",
            env: { CONTEXT7_API_KEY: "YOUR_API_KEY", SAFE_FLAG: "1" },
          },
        },
      }),
    )

    // when
    await rewriteCachedMcpManifest(root)

    // then
    const raw = await readFile(join(root, ".mcp.json"), "utf8")
    const rewritten = JSON.parse(raw) as {
      mcpServers: { context7: { env?: Record<string, string> } }
    }
    expect(rewritten.mcpServers.context7.env).toEqual({ SAFE_FLAG: "1" })
    expect(raw).not.toContain("YOUR_API_KEY")
  })

  test("#given cached Context7 manifest has dangling api-key flag #when rewriting #then drops blank auth flag", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-context7-dangling-key-"))
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          context7: {
            command: "bunx",
            args: ["--bun", "-y", "@upstash/context7-mcp", "--api-key"],
          },
        },
      }),
    )

    // when
    await rewriteCachedMcpManifest(root)

    // then
    const raw = await readFile(join(root, ".mcp.json"), "utf8")
    const rewritten = JSON.parse(raw) as {
      mcpServers: { context7: { args: string[]; env?: Record<string, string> } }
    }
    expect(rewritten.mcpServers.context7.args).toEqual(["--bun", "-y", "@upstash/context7-mcp"])
    expect(rewritten.mcpServers.context7.env).toBeUndefined()
    expect(raw).not.toContain("--api-key")
  })
})
