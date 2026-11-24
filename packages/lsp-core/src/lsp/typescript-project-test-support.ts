import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { LspRequestContext } from "../request-context.js"

export interface TypescriptProjects {
  /** A fresh directory with a package.json, as a real path (tmpdir itself may be a symlink). */
  makeProject(): string
  cleanup(): void
}

export function createTypescriptProjects(prefix: string): TypescriptProjects {
  const roots: string[] = []
  return {
    makeProject() {
      const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
      roots.push(root)
      writeFileSync(join(root, "package.json"), "{}\n")
      return root
    },
    cleanup() {
      for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
    },
  }
}

export function writeExecutable(path: string): string {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, "#!/bin/sh\nexit 0\n")
  chmodSync(path, 0o755)
  return path
}

/** TypeScript 5 ships lib/tsserver.js; TypeScript 7 does not and serves LSP from tsc itself. */
export function installTypescript(nodeModules: string, major: 5 | 7): string {
  const packageDir = join(nodeModules, "typescript")
  mkdirSync(join(packageDir, "lib"), { recursive: true })
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "typescript", version: `${major}.0.0` }))
  if (major === 5) writeFileSync(join(packageDir, "lib", "tsserver.js"), "")
  return writeExecutable(join(nodeModules, ".bin", "tsc"))
}

export function contextFor(cwd: string): LspRequestContext {
  return {
    cwd,
    projectConfigPaths: [join(cwd, ".codex", "lsp-client.json")],
    userConfigPath: join(cwd, "home-config", "lsp-client.json"),
    installDecisionsPath: join(cwd, "home-config", "lsp-install-decisions.json"),
    capabilities: { installDecisionTool: true },
  }
}
