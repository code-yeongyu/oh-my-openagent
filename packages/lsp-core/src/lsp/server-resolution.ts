import { existsSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { contextCwd, isPathInside } from "../request-context.js"
import { getDisabledServerIds, getMergedServers, type ServerWithSource } from "./config-loader.js"
import { withHostJsRuntime } from "./host-js-runtime.js"
import { BUILTIN_SERVERS, LSP_INSTALL_HINTS } from "./server-definitions.js"
import { isServerInstalled, resolveServerBinary } from "./server-installation.js"
import type { ServerLookupResult } from "./types.js"

/**
 * Replaces the command name with the absolute binary path so the client spawns the exact
 * binary that was resolved -- in particular a repo-local one that is absent from PATH.
 */
function withResolvedCommand(command: string[], binaryPath: string): string[] {
  return [binaryPath, ...command.slice(1)]
}

function usesBuiltinCommand(id: string, command: string[]): boolean {
  const builtin = BUILTIN_SERVERS[id]?.command
  return (
    builtin !== undefined &&
    builtin.length === command.length &&
    builtin.every((part, index) => part === command[index])
  )
}

/**
 * TypeScript 7 serves LSP itself (`tsc --lsp --stdio`) and no longer ships the
 * `lib/tsserver.js` that typescript-language-server wraps. Only the project's own
 * `node_modules/.bin/tsc` decides, so a global compiler never changes the server.
 * A command a config file named is never replaced, even one equal to the default.
 */
function nativeTypescriptCommand(server: ServerWithSource, projectDirectory: string): string[] | null {
  if (server.id !== "typescript" || !server.inheritsBuiltinCommand) return null
  const tsc = resolveServerBinary(["tsc"], projectDirectory, { localOnly: true })
  if (tsc === null) return null
  const packageDir = join(dirname(tsc), "..", "typescript")
  const speaksLsp = existsSync(join(packageDir, "package.json")) && !existsSync(join(packageDir, "lib", "tsserver.js"))
  return speaksLsp ? [tsc, "--lsp", "--stdio"] : null
}

/**
 * The directory whose project owns `targetPath`: the target itself when it is a directory, else
 * its parent. A target outside the request cwd keeps the cwd, so a compiler is only taken from
 * inside the session root (the repo-local walk then stops at the `.git` boundary as usual).
 */
function projectDirectoryFor(targetPath: string | undefined, workingDirectory: string): string {
  if (targetPath === undefined) return workingDirectory
  const absolute = resolve(workingDirectory, targetPath)
  if (!isPathInside(workingDirectory, absolute)) return workingDirectory
  return statSync(absolute, { throwIfNoEntry: false })?.isDirectory() === true ? absolute : dirname(absolute)
}

/**
 * Picks the server for `ext`. `targetPath` is the file or directory being served; when given, a
 * TypeScript 7 compiler is looked up from that target's project instead of the request cwd, so a
 * monorepo package on TypeScript 7 is served by its own `tsc` while the session sits at the root.
 */
export function findServerForExtension(ext: string, targetPath?: string): ServerLookupResult {
  const servers = getMergedServers()
  const workingDirectory = contextCwd()
  const projectDirectory = projectDirectoryFor(targetPath, workingDirectory)

  for (const server of servers) {
    if (!server.extensions.includes(ext)) continue
    const nativeTypescript = nativeTypescriptCommand(server, projectDirectory)
    if (nativeTypescript !== null) {
      // The builtin initialization is typescript-language-server's option set; tsc gets only
      // what a config file supplied.
      return {
        status: "found",
        server: {
          id: server.id,
          command: withHostJsRuntime(server.id, nativeTypescript),
          extensions: server.extensions,
          priority: server.priority,
          ...(server.env === undefined ? {} : { env: server.env }),
          ...(server.configuredInitialization === undefined ? {} : { initialization: server.configuredInitialization }),
        },
      }
    }
    const binaryPath = resolveServerBinary(server.command, workingDirectory)
    if (binaryPath !== null) {
      const resolvedServer = {
        id: server.id,
        command: usesBuiltinCommand(server.id, server.command)
          ? withHostJsRuntime(server.id, withResolvedCommand(server.command, binaryPath))
          : withResolvedCommand(server.command, binaryPath),
        extensions: server.extensions,
        priority: server.priority,
      }
      if (server.env !== undefined) {
        return {
          status: "found",
          server: {
            ...resolvedServer,
            env: server.env,
            ...(server.initialization === undefined ? {} : { initialization: server.initialization }),
          },
        }
      }
      return {
        status: "found",
        server: {
          ...resolvedServer,
          ...(server.initialization === undefined ? {} : { initialization: server.initialization }),
        },
      }
    }
  }

  for (const server of servers) {
    if (server.extensions.includes(ext)) {
      const installHint = LSP_INSTALL_HINTS[server.id] ?? `Install '${server.command[0]}' and ensure it's in your PATH`
      return {
        status: "not_installed",
        server: {
          id: server.id,
          command: server.command,
          extensions: server.extensions,
        },
        installHint,
      }
    }
  }

  const availableServers = [...new Set(servers.map((s) => s.id))]
  return {
    status: "not_configured",
    extension: ext,
    availableServers,
  }
}

export interface ServerStatus {
  id: string
  installed: boolean
  extensions: string[]
  disabled: boolean
  source: string
  priority: number
}

export function getAllServers(): ServerStatus[] {
  const servers = getMergedServers()
  const disabled = getDisabledServerIds()
  const workingDirectory = contextCwd()

  const result: ServerStatus[] = []
  const seen = new Set<string>()

  for (const server of servers) {
    if (seen.has(server.id)) continue
    result.push({
      id: server.id,
      installed:
        isServerInstalled(server.command, workingDirectory) ||
        nativeTypescriptCommand(server, workingDirectory) !== null,
      extensions: server.extensions,
      disabled: false,
      source: server.source,
      priority: server.priority,
    })
    seen.add(server.id)
  }

  for (const id of disabled) {
    if (seen.has(id)) continue
    const builtin = BUILTIN_SERVERS[id]
    result.push({
      id,
      installed: builtin ? isServerInstalled(builtin.command, workingDirectory) : false,
      extensions: builtin?.extensions ?? [],
      disabled: true,
      source: "disabled",
      priority: 0,
    })
  }

  return result
}
