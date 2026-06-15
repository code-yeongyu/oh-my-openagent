import { describe, expect, it } from "bun:test"
import { join } from "node:path"

import { resolveCodegraphCommand } from "./codegraph/resolve"

describe("resolveCodegraphCommand", () => {
  it("prefers OMO_CODEGRAPH_BIN over bundled, provisioned, and PATH tiers", () => {
    // given
    const env = { OMO_CODEGRAPH_BIN: "/opt/codegraph/bin/codegraph" }

    // when
    const result = resolveCodegraphCommand({
      env,
      fileExists: (filePath: string) => filePath === env.OMO_CODEGRAPH_BIN,
      provisioned: () => "/provisioned/codegraph",
      requireResolve: () => "/bundle/package.json",
      which: () => "/usr/local/bin/codegraph",
    })

    // then
    expect(result).toEqual({
      argsPrefix: [],
      command: "/opt/codegraph/bin/codegraph",
      exists: true,
      source: "env",
    })
  })

  it("keeps an invalid OMO_CODEGRAPH_BIN override unavailable", () => {
    // given
    const env = { OMO_CODEGRAPH_BIN: "/nonexistent" }

    // when
    const result = resolveCodegraphCommand({
      env,
      fileExists: () => false,
      provisioned: () => "/provisioned/codegraph",
      requireResolve: () => "/bundle/package.json",
      which: () => "/usr/local/bin/codegraph",
    })

    // then
    expect(result).toEqual({
      argsPrefix: [],
      command: "/nonexistent",
      exists: false,
      source: "env",
    })
  })

  it("keeps an invalid CODEGRAPH_BIN override unavailable", () => {
    // given
    const env = { CODEGRAPH_BIN: "/missing-codegraph" }

    // when
    const result = resolveCodegraphCommand({
      env,
      fileExists: () => false,
      provisioned: () => "/provisioned/codegraph",
      requireResolve: () => "/bundle/package.json",
      which: () => "/usr/local/bin/codegraph",
    })

    // then
    expect(result).toEqual({
      argsPrefix: [],
      command: "/missing-codegraph",
      exists: false,
      source: "env",
    })
  })

  it("resolves a bundled package through the injected node runtime", () => {
    // given
    const packageRoot = join("/bundle", "node_modules", "@colbymchenry", "codegraph")
    const bundledShim = join(packageRoot, "bin", "codegraph.js")
    const packageJson = join(packageRoot, "package.json")

    // when
    const result = resolveCodegraphCommand({
      fileExists: (filePath: string) => filePath === bundledShim,
      nodeRuntime: () => "/usr/local/bin/node",
      provisioned: () => null,
      requireResolve: () => packageJson,
      which: () => "/usr/local/bin/codegraph",
    })

    // then
    expect(result).toEqual({
      argsPrefix: [bundledShim],
      command: "/usr/local/bin/node",
      exists: true,
      source: "bundled",
    })
  })

  it("uses provisioned binaries before PATH", () => {
    // given
    const provisioned = "/home/me/.omo/codegraph/bin/codegraph"

    // when
    const result = resolveCodegraphCommand({
      fileExists: () => true,
      provisioned: () => provisioned,
      requireResolve: () => {
        throw new Error("not bundled")
      },
      which: () => "/usr/local/bin/codegraph",
    })

    // then
    expect(result).toEqual({
      argsPrefix: [],
      command: provisioned,
      exists: true,
      source: "provisioned",
    })
  })

  it("returns the PATH tier with exists false when every detector fails", () => {
    // given
    const missing = {
      fileExists: () => false,
      homeDir: "/tmp/omo-codegraph-resolve-missing-home",
      provisioned: () => null,
      requireResolve: () => {
        throw new Error("not bundled")
      },
      which: () => null,
    }

    // when
    const result = resolveCodegraphCommand(missing)

    // then
    expect(result).toEqual({
      argsPrefix: [],
      command: "codegraph",
      exists: false,
      source: "path",
    })
  })
})
