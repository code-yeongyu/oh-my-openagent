import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { describe, expect, test } from "bun:test"

import { corePackagePaths as corePackages } from "./core-package-paths"


type ForbiddenSourcePattern = {
  readonly pattern: RegExp
  readonly allowPackagePaths?: readonly string[]
}

const forbiddenSourcePatterns: readonly ForbiddenSourcePattern[] = [
  { pattern: /@opencode-ai\// },
  { pattern: /@code-yeongyu\/senpi/ },
  { pattern: /packages\/omo-codex\/plugin/ },
  { pattern: /packages\/omo-senpi\/plugin/ },
  { pattern: /@earendil-works\/pi-/ },
  { pattern: /@mariozechner\/pi-/ },
  { pattern: /plugin\/components/ },
  {
    pattern: /\b(?:SessionStart|UserPromptSubmit|PreToolUse|PostToolUse|PostCompact|Stop|SubagentStop)\b/,
    allowPackagePaths: ["packages/claude-code-compat-core"],
  },
  { pattern: /\bsession\.prompt(?:Async)?\s*\(/ },
] as const

async function collectFiles(root: string, predicate: (path: string) => boolean): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const path = join(root, entry.name)

    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") continue
      files.push(...(await collectFiles(path, predicate)))
      continue
    }

    if (entry.isFile() && predicate(path)) files.push(path)
  }

  return files
}

function toPosixPath(filePath: string): string {
  return filePath.replaceAll("\\", "/")
}

describe("shared core extraction guardrails", () => {
  test("#given core package production sources #when scanned #then they stay harness-neutral", async () => {
    // given
    const files = (
      await Promise.all(
        corePackages.map((packagePath) =>
          collectFiles(packagePath, (path) => path.endsWith(".ts") && !path.endsWith(".test.ts")),
        ),
      )
    ).flat()

    // when
    const offenders: string[] = []
    for (const file of files) {
      const source = await readFile(file, "utf8")
      const relativeFilePath = toPosixPath(relative(process.cwd(), file))
      for (const forbidden of forbiddenSourcePatterns) {
        const allowedByPackage = forbidden.allowPackagePaths?.some((packagePath) =>
          relativeFilePath.startsWith(`${packagePath}/`),
        ) ?? false
        if (!allowedByPackage && forbidden.pattern.test(source)) {
          offenders.push(`${relativeFilePath} matches ${forbidden.pattern}`)
        }
      }
    }

    // then
    expect(offenders).toEqual([])
  })

  test("#given core package manifests #when scanned #then they do not depend on harness adapters", async () => {
    // given
    const packageJsonFiles = corePackages.map((packagePath) => join(packagePath, "package.json"))

    // when
    const offenders: string[] = []
    for (const file of packageJsonFiles) {
      const manifest = await readFile(file, "utf8")
      if (manifest.includes("@opencode-ai/") || manifest.includes("@oh-my-opencode/omo-codex")) {
        offenders.push(toPosixPath(relative(process.cwd(), file)))
      }
    }

    // then
    expect(offenders).toEqual([])
  })

})
