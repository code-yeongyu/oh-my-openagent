import { mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { runWithRequestContext } from "../request-context.js"
import { __resetServerBinaryResolutionCacheForTests } from "./server-installation.js"
import { findServerForExtension, getAllServers } from "./server-resolution.js"
import {
  contextFor,
  createTypescriptProjects,
  installTypescript,
  writeExecutable,
} from "./typescript-project-test-support.js"

const projects = createTypescriptProjects("lsp-ts-native-")
const makeProject = projects.makeProject
let previousPath: string | undefined

beforeEach(() => {
  previousPath = process.env["PATH"]
  __resetServerBinaryResolutionCacheForTests()
})

afterEach(() => {
  if (previousPath === undefined) delete process.env["PATH"]
  else process.env["PATH"] = previousPath
  projects.cleanup()
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

describe("TypeScript server selection judged by real location", () => {
  function sessionWithLanguageServer(): { readonly session: string; readonly languageServer: string } {
    const session = makeProject()
    mkdirSync(join(session, ".git"))
    const languageServer = writeExecutable(join(session, "node_modules", ".bin", "typescript-language-server"))
    process.env["PATH"] = join(session, "definitely-empty")
    return { session, languageServer }
  }

  test("#given an in-session directory linked to an external TypeScript 7 project #when looking up a file through the link #then the session keeps typescript-language-server", () => {
    // given
    const { session, languageServer } = sessionWithLanguageServer()
    const external = makeProject()
    installTypescript(join(external, "node_modules"), 7)
    mkdirSync(join(external, "src"))
    symlinkSync(external, join(session, "linked"), "dir")

    // when
    const result = runWithRequestContext(contextFor(session), () =>
      findServerForExtension(".ts", join(session, "linked", "src", "a.ts")),
    )

    // then
    if (result.status !== "found") throw new Error(`expected a found server, got ${result.status}`)
    expect(result.server.command).toEqual([languageServer, "--stdio"])
  })

  test("#given a session reached through a symlinked root #when looking up a file of its TypeScript 7 package by the linked path #then that package's tsc serves it", () => {
    // given
    const { session } = sessionWithLanguageServer()
    const packageX = join(session, "packages", "x")
    mkdirSync(join(packageX, "src"), { recursive: true })
    writeFileSync(join(packageX, "package.json"), "{}\n")
    const tscX = installTypescript(join(packageX, "node_modules"), 7)
    const alias = join(makeProject(), "session-alias")
    symlinkSync(session, alias, "dir")

    // when
    const result = runWithRequestContext(contextFor(session), () =>
      findServerForExtension(".ts", join(alias, "packages", "x", "src", "a.ts")),
    )

    // then
    if (result.status !== "found") throw new Error(`expected a found server, got ${result.status}`)
    expect(result.server.command).toEqual([tscX, "--lsp", "--stdio"])
  })

  test("#given a pnpm layout whose typescript entry links into an external store #when looking up #then the project's tsc shim serves LSP", () => {
    // given: node_modules and .bin are real directories; only the typescript entry is a link
    const { session } = sessionWithLanguageServer()
    const store = makeProject()
    const storedTypescript = join(store, "typescript@7.0.0", "node_modules")
    installTypescript(storedTypescript, 7)
    mkdirSync(join(session, "node_modules"), { recursive: true })
    symlinkSync(join(storedTypescript, "typescript"), join(session, "node_modules", "typescript"), "dir")
    const tsc = writeExecutable(join(session, "node_modules", ".bin", "tsc"))

    // when
    const result = runWithRequestContext(contextFor(session), () =>
      findServerForExtension(".ts", join(session, "a.ts")),
    )

    // then
    if (result.status !== "found") throw new Error(`expected a found server, got ${result.status}`)
    expect(result.server.command).toEqual([tsc, "--lsp", "--stdio"])
  })

  test("#given a nearer bin/tsc in a Go package and a hoisted TypeScript 7 #when looking up a file of that package #then the hoisted compiler serves it", () => {
    // given: packages/svc is marked only by go.mod and carries an unrelated bin/tsc
    const { session } = sessionWithLanguageServer()
    const hoisted = installTypescript(join(session, "node_modules"), 7)
    const goPackage = join(session, "packages", "svc")
    mkdirSync(goPackage, { recursive: true })
    writeFileSync(join(goPackage, "go.mod"), "module svc\n")
    const unrelated = writeExecutable(join(goPackage, "bin", "tsc"))

    // when
    const result = runWithRequestContext(contextFor(session), () =>
      findServerForExtension(".ts", join(goPackage, "a.ts")),
    )

    // then
    if (result.status !== "found") throw new Error(`expected a found server, got ${result.status}`)
    expect(result.server.command).toEqual([hoisted, "--lsp", "--stdio"])
    expect(result.server.command).not.toContain(unrelated)
  })

  test("#given a nearer node_modules/.bin/tsc without a typescript package beside it and a hoisted TypeScript 7 #when looking up a file of that package #then the hoisted compiler serves it", () => {
    // given: packages/x keeps a stale tsc shim whose typescript package is gone
    const { session } = sessionWithLanguageServer()
    const hoisted = installTypescript(join(session, "node_modules"), 7)
    const packageX = join(session, "packages", "x")
    mkdirSync(packageX, { recursive: true })
    writeFileSync(join(packageX, "package.json"), "{}\n")
    const stale = writeExecutable(join(packageX, "node_modules", ".bin", "tsc"))

    // when
    const result = runWithRequestContext(contextFor(session), () =>
      findServerForExtension(".ts", join(packageX, "a.ts")),
    )

    // then
    if (result.status !== "found") throw new Error(`expected a found server, got ${result.status}`)
    expect(result.server.command).toEqual([hoisted, "--lsp", "--stdio"])
    expect(result.server.command).not.toContain(stale)
  })

  test("#given a nearer package on TypeScript 5 below a hoisted TypeScript 7 #when looking up a file of that package #then typescript-language-server keeps serving it", () => {
    // given
    const { session, languageServer } = sessionWithLanguageServer()
    installTypescript(join(session, "node_modules"), 7)
    const packageY = join(session, "packages", "y")
    mkdirSync(packageY, { recursive: true })
    writeFileSync(join(packageY, "package.json"), "{}\n")
    installTypescript(join(packageY, "node_modules"), 5)

    // when
    const result = runWithRequestContext(contextFor(session), () =>
      findServerForExtension(".ts", join(packageY, "a.ts")),
    )

    // then
    if (result.status !== "found") throw new Error(`expected a found server, got ${result.status}`)
    expect(result.server.command).toEqual([languageServer, "--stdio"])
  })

  test("#given node_modules/.bin itself linked to an external TypeScript 7 project #when looking up #then the external tsc is not used", () => {
    // given
    const { session, languageServer } = sessionWithLanguageServer()
    const packageX = join(session, "packages", "x")
    mkdirSync(join(packageX, "node_modules"), { recursive: true })
    writeFileSync(join(packageX, "package.json"), "{}\n")
    const external = makeProject()
    installTypescript(join(external, "node_modules"), 7)
    symlinkSync(join(external, "node_modules", "typescript"), join(packageX, "node_modules", "typescript"), "dir")
    symlinkSync(join(external, "node_modules", ".bin"), join(packageX, "node_modules", ".bin"), "dir")

    // when
    const result = runWithRequestContext(contextFor(session), () =>
      findServerForExtension(".ts", join(packageX, "a.ts")),
    )

    // then
    if (result.status !== "found") throw new Error(`expected a found server, got ${result.status}`)
    expect(result.server.command).toEqual([languageServer, "--stdio"])
  })
})
