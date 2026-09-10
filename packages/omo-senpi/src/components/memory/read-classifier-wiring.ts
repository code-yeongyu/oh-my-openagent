import { realpathSync } from "@oh-my-opencode/memory-core/fs"
import { isAbsolute, relative, resolve, sep } from "node:path"

import type { ComponentLogger, SenpiExtensionAPI } from "../../extension/types"
import { createRecallOpenerPicker } from "./recall-openers"

export interface MemoryReadClassifierOptions {
  readonly resolveRepos: () => Iterable<string>
  readonly logger?: ComponentLogger
}

export function registerMemoryReadClassifier(
  pi: SenpiExtensionAPI,
  options: MemoryReadClassifierOptions,
): (() => void) | undefined {
  if (typeof pi.registerReadClassifier !== "function") {
    options.logger?.debug?.("omo-senpi memory read classifier skipped: host API unavailable")
    return
  }

  const picker = createRecallOpenerPicker()
  return pi.registerReadClassifier(({ absolutePath, cwd }) => {
    const path = resolve(cwd, absolutePath)
    for (const repo of options.resolveRepos()) {
      const root = resolve(repo)
      const lexical = repoRelative(root, path)
      if (isGitMetadata(lexical)) continue
      const realRoot = realPath(root)
      const realFile = realPath(path)
      const canonical = realRoot === undefined || realFile === undefined
        ? undefined
        : repoRelative(realRoot, realFile)
      if (isGitMetadata(canonical)) continue
      // Existing symlinks must not make a file outside the repo look like memory.
      if (realRoot !== undefined && realFile !== undefined && canonical === undefined) continue
      const label = lexical ?? canonical
      if (label === undefined) continue
      // One extension-wide sequence, shared by every currently bound identity.
      return { kind: "memory", label, headline: picker.pick("memory-read") }
    }
    return undefined
  })
}

function repoRelative(repo: string, path: string): string | undefined {
  const label = relative(repo, path)
  if (label === "" || label === ".." || label.startsWith(`..${sep}`) || isAbsolute(label)) return undefined
  return label.split(sep).join("/")
}

function isGitMetadata(label: string | undefined): boolean {
  return label === ".git" || label?.startsWith(".git/") === true
}

function realPath(path: string): string | undefined {
  try {
    return realpathSync.native(path)
  } catch (error) {
    // A read may be rendered before its target exists; lexical containment still applies.
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return undefined
    throw error
  }
}
