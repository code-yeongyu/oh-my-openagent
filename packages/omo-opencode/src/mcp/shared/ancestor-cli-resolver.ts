import { resolve } from "node:path"
import type { RuntimeExecutable, RuntimeExecutableResolver } from "../runtime-executable"

type SourceCandidateAvailabilityInput = {
  readonly root: string
  readonly sourcePath: string
  readonly pathExists: (path: string) => boolean
}

type AncestorCliResolverOptions = {
  readonly startDirectory: string
  readonly packageRel: string
  readonly distCliRel: string
  readonly sourceCliRel: string
  readonly pathExists: (path: string) => boolean
  readonly resolveExecutable: RuntimeExecutableResolver
  readonly isSourceCandidateAvailable?: (input: SourceCandidateAvailabilityInput) => boolean
}

export type AncestorCliCandidate = {
  readonly command: string[]
  readonly root: string
  readonly path: string
  readonly exists: boolean
  readonly runtimeAvailable: boolean
}

export function resolveJavaScriptRuntime(resolveExecutable: RuntimeExecutableResolver): RuntimeExecutable {
  const node = resolveExecutable("node")
  return node.available ? node : resolveExecutable("bun")
}

export function createAncestorCliCandidates(options: AncestorCliResolverOptions): AncestorCliCandidate[] {
  const candidates: AncestorCliCandidate[] = []
  const seenPaths = new Set<string>()
  let currentDirectory = resolve(options.startDirectory)

  while (true) {
    const distCliPath = resolve(currentDirectory, options.packageRel, options.distCliRel)
    if (!seenPaths.has(distCliPath)) {
      const runtime = resolveJavaScriptRuntime(options.resolveExecutable)
      seenPaths.add(distCliPath)
      candidates.push({
        command: [runtime.command, distCliPath, "mcp"],
        root: currentDirectory,
        path: distCliPath,
        exists: runtime.available && options.pathExists(distCliPath),
        runtimeAvailable: runtime.available,
      })
    }

    const sourceCliPath = resolve(currentDirectory, options.packageRel, options.sourceCliRel)
    if (!seenPaths.has(sourceCliPath)) {
      const runtime = options.resolveExecutable("bun")
      const sourceCandidateAvailable =
        options.isSourceCandidateAvailable?.({
          root: currentDirectory,
          sourcePath: sourceCliPath,
          pathExists: options.pathExists,
        }) ?? true
      seenPaths.add(sourceCliPath)
      candidates.push({
        command: [runtime.command, sourceCliPath, "mcp"],
        root: currentDirectory,
        path: sourceCliPath,
        exists: runtime.available && options.pathExists(sourceCliPath) && sourceCandidateAvailable,
        runtimeAvailable: runtime.available,
      })
    }

    const parentDirectory = resolve(currentDirectory, "..")
    if (parentDirectory === currentDirectory) return candidates
    currentDirectory = parentDirectory
  }
}
