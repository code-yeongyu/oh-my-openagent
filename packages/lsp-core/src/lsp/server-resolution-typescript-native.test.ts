import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { runWithRequestContext } from "../request-context.js"
import { __resetServerBinaryResolutionCacheForTests } from "./server-installation.js"
import { findServerForExtension, getAllServers } from "./server-resolution.js"

const tempDirectories: string[] = []
let previousPath: string | undefined

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "lsp-ts-native-"))
  tempDirectories.push(root)
  writeFileSync(join(root, "package.json"), "{}\n")
  return root
}

function writeExecutable(path: string): string {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, "#!/bin/sh\nexit 0\n")
  chmodSync(path, 0o755)
  return path
}

function installTypescript(nodeModules: string, major: 5 | 7): string {
  const packageDir = join(nodeModules, "typescript")
  mkdirSync(join(packageDir, "lib"), { recursive: true })
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "typescript", version: `${major}.0.0` }))
  if (major === 5) writeFileSync(join(packageDir, "lib", "tsserver.js"), "")
  return writeExecutable(join(nodeModules, ".bin", "tsc"))
}

function contextFor(cwd: string) {
  return {
    cwd,
    projectConfigPaths: [join(cwd, ".codex", "lsp-client.json")],
    userConfigPath: join(cwd, "home-config", "lsp-client.json"),
    installDecisionsPath: join(cwd, "home-config", "lsp-install-decisions.json"),
    capabilities: { installDecisionTool: true },
  } as const
}

beforeEach(() => {
  previousPath = process.env["PATH"]
  __resetServerBinaryResolutionCacheForTests()
})

afterEach(() => {
  if (previousPath === undefined) delete process.env["PATH"]
  else process.env["PATH"] = previousPath
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
  __resetServerBinaryResolutionCacheForTests()
})

describe("TypeScript server selection from the project's TypeScript", () => {
  test("#given a project on TypeScript 7 #when looking up a typescript file #then its own tsc serves LSP without tsserver options", () => {
    // given: typescript-language-server is installed too, but it cannot start without lib/tsserver.js
    const root = makeProject()
    const tsc = installTypescript(join(root, "node_modules"), 7)
    writeExecutable(join(root, "node_modules", ".bin", "typescript-language-server"))
    process.env["PATH"] = join(root, "definitely-empty")

    // when
    const result = runWithRequestContext(contextFor(root), () => findServerForExtension(".ts"))

    // then
    if (result.status !== "found") throw new Error(`expected a found server, got ${result.status}`)
    expect(result.server.id).toBe("typescript")
    expect(result.server.command).toEqual([tsc, "--lsp", "--stdio"])
    expect(result.server.initialization).toBeUndefined()
  })

  test("#given a project on TypeScript 5 #when looking up a typescript file #then typescript-language-server still serves it", () => {
    // given
    const root = makeProject()
    installTypescript(join(root, "node_modules"), 5)
    const languageServer = writeExecutable(join(root, "node_modules", ".bin", "typescript-language-server"))
    process.env["PATH"] = join(root, "definitely-empty")

    // when
    const result = runWithRequestContext(contextFor(root), () => findServerForExtension(".ts"))

    // then
    if (result.status !== "found") throw new Error(`expected a found server, got ${result.status}`)
    expect(result.server.command).toEqual([languageServer, "--stdio"])
    expect(result.server.initialization).toBeDefined()
  })

  test("#given TypeScript 7 only on PATH #when looking up #then the project-less compiler does not replace the builtin server", () => {
    // given
    const root = makeProject()
    const globalPrefix = makeProject()
    installTypescript(join(globalPrefix, "node_modules"), 7)
    process.env["PATH"] = join(globalPrefix, "node_modules", ".bin")

    // when
    const result = runWithRequestContext(contextFor(root), () => findServerForExtension(".ts"))

    // then
    if (result.status !== "not_installed") throw new Error(`expected not_installed, got ${result.status}`)
    expect(result.server.id).toBe("typescript")
  })

  test("#given a user typescript server with its own command #when the project is on TypeScript 7 #then the configured command wins", () => {
    // given
    const root = makeProject()
    installTypescript(join(root, "node_modules"), 7)
    const custom = writeExecutable(join(root, "node_modules", ".bin", "custom-ts-ls"))
    mkdirSync(join(root, "home-config"), { recursive: true })
    writeFileSync(
      contextFor(root).userConfigPath,
      JSON.stringify({ lsp: { typescript: { command: ["custom-ts-ls", "--stdio"], extensions: [".ts"] } } }),
    )
    process.env["PATH"] = join(root, "definitely-empty")

    // when
    const result = runWithRequestContext(contextFor(root), () => findServerForExtension(".ts"))

    // then
    if (result.status !== "found") throw new Error(`expected a found server, got ${result.status}`)
    expect(result.server.command).toEqual([custom, "--stdio"])
  })

  test("#given a project on TypeScript 7 alone #when listing servers #then typescript reports installed", () => {
    // given
    const root = makeProject()
    installTypescript(join(root, "node_modules"), 7)
    process.env["PATH"] = join(root, "definitely-empty")

    // when
    const servers = runWithRequestContext(contextFor(root), () => getAllServers())

    // then
    expect(servers.find((server) => server.id === "typescript")?.installed).toBe(true)
  })

  test("#given a monorepo session root without TypeScript 7 #when looking up a file per package #then each package's own TypeScript decides", () => {
    // given: the root has typescript-language-server only; packages/x is on TypeScript 7, packages/y on TypeScript 5
    const root = makeProject()
    mkdirSync(join(root, ".git"))
    const languageServer = writeExecutable(join(root, "node_modules", ".bin", "typescript-language-server"))
    const packageX = join(root, "packages", "x")
    const packageY = join(root, "packages", "y")
    mkdirSync(join(packageX, "src"), { recursive: true })
    mkdirSync(join(packageY, "src"), { recursive: true })
    writeFileSync(join(packageX, "package.json"), "{}\n")
    writeFileSync(join(packageY, "package.json"), "{}\n")
    const tscX = installTypescript(join(packageX, "node_modules"), 7)
    installTypescript(join(packageY, "node_modules"), 5)
    process.env["PATH"] = join(root, "definitely-empty")

    // when
    const [inX, inY] = runWithRequestContext(contextFor(root), () => [
      findServerForExtension(".ts", join(packageX, "src", "broken.ts")),
      findServerForExtension(".ts", join(packageY, "src", "fine.ts")),
    ])

    // then
    if (inX?.status !== "found" || inY?.status !== "found") throw new Error("expected found servers for both packages")
    expect(inX.server.command).toEqual([tscX, "--lsp", "--stdio"])
    expect(inY.server.command).toEqual([languageServer, "--stdio"])
  })

  test("#given a user typescript command equal to the default #when the project is on TypeScript 7 #then the command and its initialization are kept", () => {
    // given
    const root = makeProject()
    installTypescript(join(root, "node_modules"), 7)
    const languageServer = writeExecutable(join(root, "node_modules", ".bin", "typescript-language-server"))
    const initialization = { preferences: { quotePreference: "double" } }
    mkdirSync(join(root, "home-config"), { recursive: true })
    writeFileSync(
      contextFor(root).userConfigPath,
      JSON.stringify({ lsp: { typescript: { command: ["typescript-language-server", "--stdio"], initialization } } }),
    )
    process.env["PATH"] = join(root, "definitely-empty")

    // when
    const result = runWithRequestContext(contextFor(root), () => findServerForExtension(".ts"))

    // then
    if (result.status !== "found") throw new Error(`expected a found server, got ${result.status}`)
    expect(result.server.command).toEqual([languageServer, "--stdio"])
    expect(result.server.initialization).toEqual(initialization)
  })

  test("#given user initialization on the inherited typescript command #when the project is on TypeScript 7 #then tsc receives only that initialization", () => {
    // given
    const root = makeProject()
    const tsc = installTypescript(join(root, "node_modules"), 7)
    const initialization = { locale: "en" }
    mkdirSync(join(root, "home-config"), { recursive: true })
    writeFileSync(contextFor(root).userConfigPath, JSON.stringify({ lsp: { typescript: { initialization } } }))
    process.env["PATH"] = join(root, "definitely-empty")

    // when
    const result = runWithRequestContext(contextFor(root), () => findServerForExtension(".ts"))

    // then
    if (result.status !== "found") throw new Error(`expected a found server, got ${result.status}`)
    expect(result.server.command).toEqual([tsc, "--lsp", "--stdio"])
    expect(result.server.initialization).toEqual(initialization)
  })
})
