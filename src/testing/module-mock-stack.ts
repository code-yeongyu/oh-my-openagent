import { pathToFileURL } from "node:url"

function normalizeStackPath(rawPath: string): string {
  return rawPath.startsWith("file://") ? rawPath : pathToFileURL(rawPath).href
}

function getStackCandidatePath(line: string): string | undefined {
  const match = line.match(/(?:\()?(file:\/\/[^\s)]+|\/[^\s):]+):(\d+):(\d+)/)
  return match?.[1]
}

function isIgnoredCallerPath(candidatePath: string): boolean {
  return (
    candidatePath.includes("/test-setup.ts") ||
    candidatePath.includes("/src/testing/module-mock-lifecycle.ts") ||
    candidatePath.includes("/src/testing/module-mock-stack.ts")
  )
}

export function defaultGetCallerStack(): string {
  return new Error().stack ?? ""
}

export function resolveCallerUrlFromStack(stack: string): string {
  const lines = stack.split("\n")

  for (const line of lines) {
    const candidatePath = getStackCandidatePath(line)
    if (!candidatePath) {
      continue
    }

    if (isIgnoredCallerPath(candidatePath)) {
      continue
    }

    return normalizeStackPath(candidatePath)
  }

  return import.meta.url
}

export function isModuleEvaluationStack(stack: string): boolean {
  const lines = stack.split("\n")

  for (const [index, line] of lines.entries()) {
    const candidatePath = getStackCandidatePath(line)
    if (!candidatePath || isIgnoredCallerPath(candidatePath)) {
      continue
    }

    const nextFrame = lines[index + 1] ?? ""
    return (
      nextFrame.includes("moduleEvaluation") ||
      nextFrame.includes("asyncModuleEvaluation") ||
      nextFrame.includes("loadAndEvaluateModule")
    )
  }

  return false
}
