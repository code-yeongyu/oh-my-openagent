/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const WORKSPACE_ROOT = resolve(import.meta.dir, "../../../..")
const MARKDOWN_REFERENCE_DEFINITION_RE = /^ {0,3}\[([^\]\n]+)\]:\s+(\S+)/
const MAINTAINER_LOCAL_PATH_RE = /file:\/\/\/(?:Users|home)\/|(?:^|[\s(`'"])(?:\/Users|\/home)\//

function collectMarkdownFiles(): string[] {
  const output = Bun.spawnSync(["git", "ls-files", "*.md"], { cwd: WORKSPACE_ROOT, stdout: "pipe" })
  expect(output.exitCode).toBe(0)
  return resolveExistingMarkdownFiles(output.stdout.toString("utf-8").trim().split("\n").filter(Boolean))
}

function resolveExistingMarkdownFiles(filePaths: readonly string[]): string[] {
  return filePaths
    .map((filePath) => resolve(WORKSPACE_ROOT, filePath))
    .filter((filePath) => existsSync(filePath))
}

function stripFencedCodeBlocks(markdown: string): string {
  return markdown.replace(/(^|\n) {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n {0,3}\2(?=\n|$)/g, (match) => match.replace(/[^\n]/g, ""))
}

function stripIndentedCodeBlocks(markdown: string): string {
  return markdown.replace(/(^|\n)(?: {4}|\t)[^\n]*/g, (match) => match.replace(/[^\n]/g, ""))
}

function stripInlineCodeSpans(markdown: string): string {
  return markdown.replace(/`[^`\n]*`/g, (match) => match.replace(/[^\n]/g, ""))
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

function countPrecedingBackslashes(line: string, index: number, count = 0): number {
  return line[index - count - 1] === "\\" ? countPrecedingBackslashes(line, index, count + 1) : count
}

function isEscaped(line: string, index: number): boolean {
  return countPrecedingBackslashes(line, index) % 2 === 1
}

function findClosingBracket(line: string, openIndex: number, index = openIndex, depth = 0): number {
  if (index >= line.length) {
    return -1
  }
  const char = line[index]
  const isUnescaped = !isEscaped(line, index)
  const nextDepth = char === "[" && isUnescaped ? depth + 1 : char === "]" && isUnescaped ? depth - 1 : depth
  return char === "]" && isUnescaped && nextDepth === 0
    ? index
    : findClosingBracket(line, openIndex, index + 1, nextDepth)
}

function readMarkdownTarget(line: string, index: number, depth = 0, target = ""): string | undefined {
  const char = line[index]
  if (!char) {
    return undefined
  }
  const isUnescaped = !isEscaped(line, index)
  if (char === ")" && isUnescaped && depth === 0) {
    return target || undefined
  }
  if (/\s/.test(char) && depth === 0) {
    return target || undefined
  }
  const nextDepth = char === "(" && isUnescaped ? depth + 1 : char === ")" && isUnescaped ? depth - 1 : depth
  return readMarkdownTarget(line, index + 1, nextDepth, `${target}${char}`)
}

function readAngleBracketTarget(line: string, index: number, target = ""): string | undefined {
  const char = line[index]
  if (!char) {
    return undefined
  }
  if (char === ">" && !isEscaped(line, index)) {
    return target || undefined
  }
  return readAngleBracketTarget(line, index + 1, `${target}${char}`)
}

function skipLeadingWhitespace(line: string, index: number): number {
  const char = line[index]
  return char && /\s/.test(char) ? skipLeadingWhitespace(line, index + 1) : index
}

function collectInlineTargets(line: string, lineNumber: number, index = 0): Array<{ line: number; target: string }> {
  if (index >= line.length) {
    return []
  }
  const labelStart = line[index] === "!" && line[index + 1] === "[" ? index + 1 : line[index] === "[" ? index : -1
  if (labelStart === -1 || isEscaped(line, labelStart)) {
    return collectInlineTargets(line, lineNumber, index + 1)
  }
  const labelEnd = findClosingBracket(line, labelStart)
  if (labelEnd === -1) {
    return collectInlineTargets(line, lineNumber, index + 1)
  }
  const nestedTargets = collectInlineTargets(line.slice(labelStart + 1, labelEnd), lineNumber)
  const destStart = line[labelEnd + 1] === "(" ? skipLeadingWhitespace(line, labelEnd + 2) : -1
  const target = destStart === -1
    ? undefined
    : line[destStart] === "<" ? readAngleBracketTarget(line, destStart + 1) : readMarkdownTarget(line, destStart)
  const currentTargets = target ? [...nestedTargets, { line: lineNumber, target }] : nestedTargets
  return [...currentTargets, ...collectInlineTargets(line, lineNumber, labelEnd + 1)]
}

function collectLinkedTargets(markdown: string): Array<{ line: number; target: string }> {
  return stripInlineCodeSpans(stripIndentedCodeBlocks(stripFencedCodeBlocks(markdown))).split("\n").flatMap((line, lineIndex) => {
    const referenceTarget = MARKDOWN_REFERENCE_DEFINITION_RE.exec(line)?.[2]
    const targets = collectInlineTargets(line, lineIndex + 1)
    return referenceTarget ? [...targets, { line: lineIndex + 1, target: referenceTarget }] : targets
  })
}

function collectMaintainerLocalPathLines(markdown: string): number[] {
  return stripInlineCodeSpans(stripIndentedCodeBlocks(stripFencedCodeBlocks(markdown))).split("\n").flatMap((line, lineIndex) => (
    MAINTAINER_LOCAL_PATH_RE.test(line) ? [lineIndex + 1] : []
  ))
}

describe("markdown local link audit", () => {
  test("#given a missing indexed markdown file #when files are collected #then the deleted path is ignored", () => {
    const existingPath = "packages/omo-opencode/src/shared/markdown-link-audit.test.ts"
    const missingPath = "packages/omo-opencode/src/shared/__deleted-markdown-fixture__.md"

    expect(resolveExistingMarkdownFiles([existingPath, missingPath])).toEqual([resolve(WORKSPACE_ROOT, existingPath)])
  })

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

  test("#given separated reference-style markdown links #when collecting targets #then each definition target is audited", () => {
    expect(collectLinkedTargets("[Guide][guide] and [Docs][]\n\n[guide]: ./guide/overview.md\n[Docs]: docs/AGENTS.md")).toEqual([
      { line: 3, target: "./guide/overview.md" },
      { line: 4, target: "docs/AGENTS.md" },
    ])
  })

  test("#given image-wrapped markdown link #when collecting targets #then wrapper target is audited", () => {
    expect(collectLinkedTargets("[![License](https://img.shields.io/badge/license-SUL--1.0-white)](LICENSE.md)")).toEqual([
      { line: 1, target: "https://img.shields.io/badge/license-SUL--1.0-white" },
      { line: 1, target: "LICENSE.md" },
    ])
  })

  test("#given nested markdown links #when collecting targets #then each nested target is audited", () => {
    expect(collectLinkedTargets("[[Guide](./guide/overview.md)](README.md)")).toEqual([
      { line: 1, target: "./guide/overview.md" },
      { line: 1, target: "README.md" },
    ])
  })

  test("#given escaped label brackets #when collecting targets #then odd escapes block closing and even escapes allow closing", () => {
    expect(collectLinkedTargets("[Guide\\](./guide/overview.md)")).toEqual([])
    expect(collectLinkedTargets("[Guide\\\\](./guide/overview.md)")).toEqual([
      { line: 1, target: "./guide/overview.md" },
    ])
  })

  test("#given escaped target parentheses #when collecting targets #then odd escapes keep reading and even escapes close target", () => {
    expect(collectLinkedTargets("[Guide](docs/foo\\).md)")).toEqual([
      { line: 1, target: "docs/foo\\).md" },
    ])
    expect(collectLinkedTargets("[Guide](docs/foo\\\\).md)")).toEqual([
      { line: 1, target: "docs/foo\\\\" },
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

  test("#given inline code spans #when collecting targets #then links inside code spans are ignored", () => {
    expect(collectLinkedTargets("Use `create_memory_object_stream[T](max_buffer_size=N)` then [Guide](./guide/overview.md)")).toEqual([
      { line: 1, target: "./guide/overview.md" },
    ])
  })

  test("#given angle-bracket-wrapped destination with spaces #when collecting targets #then the spaced target is audited", () => {
    expect(collectLinkedTargets("[Release notes](<./docs/release notes.md>)")).toEqual([
      { line: 1, target: "./docs/release notes.md" },
    ])
  })

  test("#given whitespace-padded inline destination #when collecting targets #then leading whitespace after the paren is skipped", () => {
    expect(collectLinkedTargets("[Guide]( ./guide/overview.md )")).toEqual([
      { line: 1, target: "./guide/overview.md" },
    ])
  })

  test("#given whitespace-padded angle-bracket destination #when collecting targets #then the spaced target is audited", () => {
    expect(collectLinkedTargets("[Release notes]( <./docs/release notes.md> )")).toEqual([
      { line: 1, target: "./docs/release notes.md" },
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

  test("#given checked-in markdown #when maintainer-local paths are audited #then none are present", async () => {
    const offenders = (await Promise.all(collectMarkdownFiles().map(async (filePath) => {
      return collectMaintainerLocalPathLines(await readFile(filePath, "utf-8")).map((line) => `${relativeWorkspacePath(filePath)}:${line}`)
    }))).flat()
    expect(offenders.sort()).toEqual([])
  }, 20_000)
})
