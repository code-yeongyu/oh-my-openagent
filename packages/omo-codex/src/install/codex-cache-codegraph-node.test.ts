/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rewriteCachedMcpManifest } from "./codex-cache"
import { isPlainRecord } from "./codex-cache-fs"

describe("cached CodeGraph MCP runtime", () => {
  test("#given supported Node runtime #when rewriting cached CodeGraph manifest #then CodeGraph launches with that runtime", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-codegraph-node-"))
    const node22 = "/opt/homebrew/opt/node@22/bin/node"
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          codegraph: {
            args: ["components/codegraph/dist/serve.js"],
            command: "node",
            required: false,
          },
        },
      }),
    )

    // when
    await rewriteCachedMcpManifest(root, root, {
      codegraphNodeRuntime: () => node22,
    })

    // then
    const rewritten: unknown = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8"))
    expect(isPlainRecord(rewritten)).toBe(true)
    if (!isPlainRecord(rewritten)) throw new Error("expected manifest object")
    expect(isPlainRecord(rewritten.mcpServers)).toBe(true)
    if (!isPlainRecord(rewritten.mcpServers)) throw new Error("expected mcpServers object")
    const codegraph = rewritten.mcpServers.codegraph
    expect(isPlainRecord(codegraph)).toBe(true)
    if (!isPlainRecord(codegraph)) throw new Error("expected codegraph object")
    expect(codegraph.command).toBe(node22)
    expect(codegraph.args).toEqual([join(root, "components", "codegraph", "dist", "serve.js")])
  })
})
