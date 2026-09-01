import { describe, expect, it } from "bun:test"
import { join } from "node:path"

import { resolveCodegraphCommand, resolveCodegraphNodeRuntime, resolveCodegraphNodeSupport } from "./codegraph/resolve"

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

  it("#given CODEGRAPH_NODE_BIN points at Node 22 #when resolving a bundled package under a too-new host #then it uses the compatible runtime", () => {
    // given
    const packageRoot = join("/bundle", "node_modules", "@colbymchenry", "codegraph")
    const bundledShim = join(packageRoot, "bin", "codegraph.js")
    const packageJson = join(packageRoot, "package.json")
    const nodeBin = "/opt/node22/bin/node"

    // when
    const result = resolveCodegraphCommand({
      env: { CODEGRAPH_NODE_BIN: nodeBin },
      fileExists: (filePath: string) => filePath === bundledShim || filePath === nodeBin,
      nodeVersion: (candidate: string) => (candidate === nodeBin ? "v22.22.3" : "v26.3.0"),
      provisioned: () => null,
      requireResolve: () => packageJson,
      which: () => null,
    })

    // then
    expect(result).toEqual({
      argsPrefix: [bundledShim],
      command: nodeBin,
      exists: true,
      source: "bundled",
    })
  })

  it("#given the host Node is too new #when Node 22 is on PATH #then bundled CodeGraph uses that compatible runtime", () => {
    // given
    const packageRoot = join("/bundle", "node_modules", "@colbymchenry", "codegraph")
    const bundledShim = join(packageRoot, "npm-shim.js")
    const packageJson = join(packageRoot, "package.json")
    const node22 = "/usr/local/bin/node22"

    // when
    const result = resolveCodegraphCommand({
      fileExists: (filePath: string) => filePath === bundledShim || filePath === node22,
      nodeVersion: (candidate: string) => (candidate === node22 ? "22.14.0" : "26.3.0"),
      provisioned: () => null,
      requireResolve: () => packageJson,
      which: (commandName: string) => (commandName === "node22" ? node22 : null),
    })

    // then
    expect(result).toEqual({
      argsPrefix: [bundledShim],
      command: node22,
      exists: true,
      source: "bundled",
    })
  })

  it("#given Node 22 is on PATH #when resolving CodeGraph Node support #then it reports supported", () => {
    // given
    const node22 = "/usr/local/bin/node22"

    // when
    const runtime = resolveCodegraphNodeRuntime({
      nodeVersion: (candidate: string) => (candidate === node22 ? "v22.14.0" : "v26.0.0"),
      which: (commandName: string) => (commandName === "node22" ? node22 : null),
    })
    const support = resolveCodegraphNodeSupport({
      nodeVersion: (candidate: string) => (candidate === node22 ? "v22.14.0" : "v26.0.0"),
      which: (commandName: string) => (commandName === "node22" ? node22 : null),
    })

    // then
    expect(runtime).toBe(node22)
    expect(support).toEqual({ major: 22, override: false, supported: true })
  })

  it("#given Homebrew node@22 exists without a PATH alias #when resolving CodeGraph Node runtime #then it selects the keg runtime", () => {
    // given
    const node22 = "/opt/homebrew/opt/node@22/bin/node"

    // when
    const runtime = resolveCodegraphNodeRuntime({
      fileExists: (filePath: string) => filePath === node22,
      nodeVersion: (candidate: string) => (candidate === node22 ? "v22.23.0" : "v26.3.1"),
      which: () => null,
    })

    // then
    expect(runtime).toBe(node22)
  })

  it("#given only Node 26 is on PATH #when resolving CodeGraph Node support #then it reports unsupported", () => {
    // given
    const node = "/usr/local/bin/node"

    // when
    const support = resolveCodegraphNodeSupport({
      nodeVersion: (candidate: string) => (candidate === node ? "v26.0.0" : "v0.0.0"),
      which: (commandName: string) => (commandName === "node" ? node : null),
    })

    // then
    expect(support).toEqual({ major: 0, override: false, reason: "too-old", supported: false })
  })

  it("#given CODEGRAPH_NODE_BIN is a command name #when it resolves to Node 22 #then that runtime is selected", () => {
    // given
    const node22 = "/opt/homebrew/bin/node22"

    // when
    const runtime = resolveCodegraphNodeRuntime({
      env: { CODEGRAPH_NODE_BIN: "node22" },
      nodeVersion: (candidate: string) => (candidate === node22 ? "22.17.1" : "26.0.0"),
      which: (commandName: string) => (commandName === "node22" ? node22 : null),
    })

    // then
    expect(runtime).toBe(node22)
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
