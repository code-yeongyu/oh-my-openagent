/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const WORKSPACE_ROOT = resolve(import.meta.dir, "../..")
const MARKDOWN_LINK_RE = /(?<!!)\[[^\]\n]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const MARKDOWN_REFERENCE_DEFINITION_RE = /^ {0,3}\[([^\]\n]+)\]:\s+(\S+)/

function collectMarkdownFiles(): string[] {
  const output = Bun.spawnSync(["git", "ls-files", "*.md"], { cwd: WORKSPACE_ROOT, stdout: "pipe" })
  expect(output.exitCode).toBe(0)
  return output.stdout.toString("utf-8").trim().split("\n").filter(Boolean).map((filePath) => resolve(WORKSPACE_ROOT, filePath))
}

function stripFencedCodeBlocks(markdown: string): string {
  return markdown.replace(/(^|\n) {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n {0,3}\2(?=\n|$)/g, (match) => match.replace(/[^\n]/g, ""))
}

function stripIndentedCodeBlocks(markdown: string): string {
  return markdown.replace(/(^|\n)(?: {4}|\t)[^\n]*/g, (match) => match.replace(/[^\n]/g, ""))
}

function isExternalLink(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("file://")
}

function resolveMarkdownTarget(filePath: string, target: string): string | undefined {
  if (target.startsWith("#") || isExternalLink(target)) {
    return undefined
  }
  const targetUrl = target.split("#", 1)[0]?.split("?", 1)[0]
  if (!targetUrl) {
    return undefined
  }
  if (targetUrl.startsWith("file://")) {
    const fileTarget = targetUrl.slice("file://".length)
    if (fileTarget.startsWith("./") || fileTarget.startsWith("../")) {
      return resolve(dirname(filePath), decodeURIComponent(fileTarget))
    }
    return fileURLToPath(targetUrl)
  }
  return resolve(dirname(filePath), decodeURIComponent(targetUrl))
}

function relativeWorkspacePath(filePath: string): string {
  return relative(WORKSPACE_ROOT, filePath)
}

function collectLinkedTargets(markdown: string): Array<{ line: number; target: string }> {
  return stripIndentedCodeBlocks(stripFencedCodeBlocks(markdown)).split("\n").flatMap((line, lineIndex) => {
    const linkTargets = Array.from(line.matchAll(MARKDOWN_LINK_RE), (match) => match[1])
      .filter((target): target is string => Boolean(target))
      .map((target) => ({ line: lineIndex + 1, target }))
    const referenceTarget = MARKDOWN_REFERENCE_DEFINITION_RE.exec(line)?.[2]
    return referenceTarget ? [...linkTargets, { line: lineIndex + 1, target: referenceTarget }] : linkTargets
  })
}

describe("markdown local link audit", () => {
  test("#given external markdown links #when resolving targets #then http and https links are ignored", () => {
    expect(resolveMarkdownTarget("docs/AGENTS.md", "http://example.com/readme.md")).toBeUndefined()
    expect(resolveMarkdownTarget("docs/AGENTS.md", "https://example.com/readme.md")).toBeUndefined()
  })

  test("#given relative file uri markdown link #when resolving target #then it resolves from the markdown file", () => {
    expect(resolveMarkdownTarget("docs/AGENTS.md", "file://./guide/overview.md")).toBe(resolve("docs/guide/overview.md"))
  })

  test("#given reference-style markdown links #when collecting targets #then link definitions are audited", () => {
    expect(collectLinkedTargets("[Guide][guide]\n\n[guide]: ./guide/overview.md")).toEqual([
      { line: 3, target: "./guide/overview.md" },
    ])
  })

  test("#given indented fenced code block #when collecting targets #then links inside the fence are ignored", () => {
    expect(collectLinkedTargets("   ```markdown\n[Missing](./missing.md)\n   ```\n[Guide](./guide/overview.md)")).toEqual([
      { line: 4, target: "./guide/overview.md" },
    ])
  })

  test("#given indented code block #when collecting targets #then links inside the code block are ignored", () => {
    expect(collectLinkedTargets("    [Missing](./missing.md)\n\t[AlsoMissing](./also-missing.md)\n[Guide](./guide/overview.md)")).toEqual([
      { line: 3, target: "./guide/overview.md" },
    ])
  })

  test("#given checked-in markdown #when local links are audited #then every local target exists", async () => {
    const offenders = (await Promise.all(collectMarkdownFiles().map(async (filePath) => {
      return collectLinkedTargets(await readFile(filePath, "utf-8")).flatMap((linkedTarget) => {
        const targetPath = resolveMarkdownTarget(filePath, linkedTarget.target)
        return targetPath && !existsSync(targetPath) ? [`${relativeWorkspacePath(filePath)}:${linkedTarget.line} missing ${linkedTarget.target}`] : []
      })
    }))).flat()
    expect(offenders.sort()).toEqual([])
  }, 20_000)
})
